// Videos & screen recordings → searchable text, entirely on this device:
//   • a poster thumbnail (≤ 480 px webp) from a frame at min(1 s, 10 %),
//   • duration and size,
//   • "On screen" text: up to LIMITS.maxVideoOcrFrames evenly spaced frames read with local OCR (lines merged,
//     repeats dropped, order kept; frames identical to the previous one are skipped),
//   • the spoken words: the file's sound track decoded with Web Audio and transcribed with local Whisper.
// A file whose "video" has no picture (an audio-only .webm/.mp4) is handled as a voice recording instead.
// The video element and its object URL are released as soon as frames are read.
import { LIMITS } from "../config";
import { getSettings } from "../settings";
import type { Extracted, ExtractContext } from "./context";
import { abortError, isAbortError, throwIfAborted } from "./errors";
import { extractVoice } from "./extract-audio";
import { followOcrDownload } from "./extract-image";
import { recognize } from "./ocr";
import { canvasToBlob, context2d, createCanvas, makeThumbnail, prepareForOcr, releaseCanvas } from "./thumbnail";
import { decodeAudio, transcribeSamples, whisperStatus } from "./transcribe";

/** Frames handed to OCR are at most this many pixels on their longest side. */
const OCR_FRAME_MAX_SIDE = 1600;
/** Roughly one sampled frame per this many seconds, so a short clip isn't read six times over. */
const SECONDS_PER_FRAME = 2;
const METADATA_TIMEOUT_MS = 20_000;
const SEEK_TIMEOUT_MS = 10_000;
/** HTMLMediaElement.HAVE_CURRENT_DATA — a frame is available to draw. */
const HAVE_CURRENT_DATA = 2;
/** Sound quieter than this everywhere is silence — no need to load the transcriber at all. */
const SILENCE_PEAK = 0.005;
/** Tiny greyscale picture used to spot frames that didn't change (static slides, paused screens). */
const PRINT_W = 64;
const PRINT_H = 36;

// ---------- pure helpers (exported for tests) ----------

/** Evenly spaced sample times (seconds) inside a video, avoiding the very first and last frames. */
export function frameTimes(durationSec: number, maxFrames: number = LIMITS.maxVideoOcrFrames): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || maxFrames <= 0) return [];
  const count = Math.max(1, Math.min(maxFrames, Math.round(durationSec / SECONDS_PER_FRAME)));
  return Array.from({ length: count }, (_, i) => (durationSec * (i + 0.5)) / count);
}

/** Merge the text of several frames: one line each, whitespace/case-insensitive repeats dropped, first-seen order kept. */
export function mergeScreenText(frames: string[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const frame of frames) {
    for (const raw of frame.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(line);
    }
  }
  return lines;
}

/** Transcript first, then what was shown on screen. */
export function composeVideoText(transcript: string, screenLines: string[]): string {
  const spoken = transcript.trim();
  const shown = screenLines.length ? `On screen:\n${screenLines.join("\n")}` : "";
  return spoken && shown ? `${spoken}\n\n${shown}` : spoken || shown;
}

// ---------- the video element ----------

interface OpenVideo {
  video: HTMLVideoElement;
  width: number;
  height: number;
  /** Seconds, or undefined when the file doesn't say and seeking couldn't find out. */
  duration?: number;
  close(): void;
}

/**
 * Resolve true when one of `events` fires (and `ready()` holds), false on an error event or timeout.
 * Rejects with an AbortError when the job is cancelled. Attach BEFORE triggering the action.
 */
function waitFor(
  video: HTMLVideoElement,
  events: string[],
  timeoutMs: number,
  signal: AbortSignal,
  ready: () => boolean = () => true,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      for (const e of events) video.removeEventListener(e, onEvent);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onEvent = () => {
      if (!ready()) return;
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      resolve(false);
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    for (const e of events) video.addEventListener(e, onEvent);
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const finiteDuration = (video: HTMLVideoElement) =>
  Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;

/**
 * Recordings made in browsers (MediaRecorder WebM) don't store their length, so the element reports Infinity.
 * Seeking far past the end makes the browser scan the file and work it out.
 */
async function settleDuration(video: HTMLVideoElement, signal: AbortSignal): Promise<number | undefined> {
  const known = finiteDuration(video);
  if (known !== undefined) return known;
  const found = waitFor(video, ["durationchange", "seeked"], 8_000, signal, () => finiteDuration(video) !== undefined || !video.seeking);
  try {
    video.currentTime = 1e7;
  } catch {
    return undefined;
  }
  await found;
  return finiteDuration(video);
}

/** Load a video's metadata in a muted, inline, invisible element. Null when this browser can't play it. */
async function openVideo(blob: Blob, signal: AbortSignal, forFrames: boolean): Promise<OpenVideo | null> {
  throwIfAborted(signal);
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  // Frames are only fetched on demand with "metadata"; reading several frames goes faster with "auto".
  video.preload = forFrames ? "auto" : "metadata";
  // Kept in the page but invisible — some mobile browsers only decode frames for attached elements.
  Object.assign(video.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0",
    pointerEvents: "none",
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      video.pause();
    } catch {
      /* not playing */
    }
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      /* already released */
    }
    video.remove();
    URL.revokeObjectURL(url);
  };

  try {
    document.body.appendChild(video);
    const loaded = waitFor(video, ["loadedmetadata"], METADATA_TIMEOUT_MS, signal);
    video.src = url;
    if (!(await loaded)) {
      close();
      return null;
    }
    const duration = await settleDuration(video, signal);
    return { video, width: video.videoWidth, height: video.videoHeight, duration, close };
  } catch (err) {
    close();
    throw err;
  }
}

/** Seek to `t` seconds and wait until that frame can be drawn. False when the browser couldn't get there. */
async function seekTo(v: OpenVideo, t: number, signal: AbortSignal): Promise<boolean> {
  const { video } = v;
  const target = Math.max(0, v.duration ? Math.min(t, Math.max(0, v.duration - 0.05)) : t);
  const seeked = waitFor(video, ["seeked"], SEEK_TIMEOUT_MS, signal);
  try {
    video.currentTime = target;
  } catch {
    return false;
  }
  if (!(await seeked)) return false;
  if (video.readyState >= HAVE_CURRENT_DATA) return true;
  return waitFor(video, ["loadeddata", "canplay", "timeupdate"], SEEK_TIMEOUT_MS, signal, () => video.readyState >= HAVE_CURRENT_DATA);
}

async function makePoster(v: OpenVideo, signal: AbortSignal): Promise<Blob | undefined> {
  const at = v.duration ? Math.min(1, v.duration * 0.1) : 0.1;
  if (!(await seekTo(v, at, signal))) return undefined;
  try {
    return await makeThumbnail(v.video, v.width, v.height);
  } catch {
    return undefined;
  }
}

// ---------- on-screen text ----------

function framePrint(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8ClampedArray {
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, PRINT_W, PRINT_H);
  const px = ctx.getImageData(0, 0, PRINT_W, PRINT_H).data;
  const grey = new Uint8ClampedArray(PRINT_W * PRINT_H);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) grey[j] = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
  return grey;
}

/** Same picture, give or take compression noise (a new line of text changes many pixels clearly). */
function sameFrame(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 16 && ++changed > 2) return false;
  }
  return true;
}

interface ScreenText {
  lines: string[];
  confidence?: number;
}

async function readOnScreenText(blob: Blob, ctx: ExtractContext): Promise<ScreenText> {
  ctx.setStage("ocr", "Reading on-screen text…");
  const v = await openVideo(blob, ctx.signal, true);
  if (!v) return { lines: [] };
  const print = createCanvas(PRINT_W, PRINT_H);
  const stopFollowing = followOcrDownload(ctx);
  try {
    if (!v.width || !v.height) return { lines: [] };
    const times = v.duration ? frameTimes(v.duration) : [1];
    const n = times.length;
    const texts: string[] = [];
    let weighted = 0;
    let chars = 0;
    let previous: Uint8ClampedArray | null = null;
    for (let i = 0; i < n; i++) {
      throwIfAborted(ctx.signal);
      const label = `Reading video frames ${i + 1}/${n}`;
      ctx.setProgress(i / n, label);
      if (!(await seekTo(v, times[i], ctx.signal))) continue;
      const fingerprint = framePrint(v.video, print);
      if (previous && sameFrame(previous, fingerprint)) continue;
      previous = fingerprint;

      const canvas = prepareForOcr(v.video, v.width, v.height, OCR_FRAME_MAX_SIDE);
      let image: Blob;
      try {
        image = await canvasToBlob(canvas, "image/png");
      } finally {
        releaseCanvas(canvas);
      }
      throwIfAborted(ctx.signal);
      const result = await recognize(image, (p) => ctx.setProgress((i + p) / n, label));
      if (result.text) {
        texts.push(result.text);
        weighted += result.confidence * result.text.length;
        chars += result.text.length;
      }
    }
    const lines = mergeScreenText(texts);
    return { lines, confidence: lines.length && chars ? Math.round((weighted / chars) * 10) / 10 : undefined };
  } finally {
    stopFollowing();
    releaseCanvas(print);
    v.close();
  }
}

// ---------- spoken words ----------

type SoundGap = "off" | "too-long" | "unreadable";

interface SoundText {
  text: string;
  /** Why there is no transcript (undefined = transcribed, possibly no speech). */
  missing?: SoundGap;
  durationSec?: number;
}

/** Any audible sample at all? Stops at the first one; yields between slices so long tracks never block the page. */
async function hasSound(samples: Float32Array, signal: AbortSignal): Promise<boolean> {
  const slice = 1_000_000;
  for (let start = 0; start < samples.length; start += slice) {
    const end = Math.min(samples.length, start + slice);
    for (let i = start; i < end; i++) {
      const s = samples[i];
      if (s > SILENCE_PEAK || s < -SILENCE_PEAK) return true;
    }
    await new Promise((r) => setTimeout(r));
    throwIfAborted(signal);
  }
  return false;
}

async function transcribeTrack(blob: Blob, durationSec: number | undefined, ctx: ExtractContext): Promise<SoundText> {
  if (!getSettings().transcribeAudio) return { text: "", missing: "off" };
  if (durationSec !== undefined && durationSec > LIMITS.maxAudioSeconds + 1) return { text: "", missing: "too-long" };

  ctx.setStage("reading", "Reading the sound track…");
  let decoded: { samples: Float32Array; durationSec: number };
  try {
    decoded = await decodeAudio(blob, ctx.signal);
  } catch (err) {
    // No sound track, or a container this browser's audio decoder can't open — the video is still useful.
    if (isAbortError(err)) throw err;
    return { text: "", missing: "unreadable" };
  }
  throwIfAborted(ctx.signal);
  if (decoded.durationSec > LIMITS.maxAudioSeconds + 1) return { text: "", missing: "too-long", durationSec: decoded.durationSec };
  if (!(await hasSound(decoded.samples, ctx.signal))) return { text: "", durationSec: decoded.durationSec };

  ctx.setStage("transcribing", whisperStatus.get().state === "ready" ? "Transcribing…" : "Getting the voice transcriber ready…");
  const stop = whisperStatus.subscribe(() => {
    const s = whisperStatus.get();
    if (s.state === "loading") ctx.setProgress(s.progress ?? 0, "Getting the voice transcriber ready…");
  });
  try {
    const text = await transcribeSamples(decoded.samples, (p) => ctx.setProgress(p, "Transcribing…"), ctx.signal);
    return { text: text.trim(), durationSec: decoded.durationSec };
  } finally {
    stop();
  }
}

// ---------- notes shown when something couldn't be read ----------

const audioLimitMinutes = () => Math.round(LIMITS.maxAudioSeconds / 60);

function soundNote(gap: SoundGap): string {
  switch (gap) {
    case "off":
      return "Sound not transcribed (transcription is off)";
    case "too-long":
      return `Sound not transcribed (over ${audioLimitMinutes()} minutes)`;
    default:
      return "Sound not transcribed (this browser couldn't read it)";
  }
}

function emptyNote(sound: SoundText, screenRead: boolean, playable: boolean): string {
  if (!playable) {
    return sound.missing === "off"
      ? "This browser can't play this video, and transcription is off — turn it on in Your data"
      : "This browser can't play this video";
  }
  const screen = screenRead ? "No on-screen text found" : "Too long to read on-screen text";
  switch (sound.missing) {
    case "off":
      return `${screen}, and transcription is off — turn it on in Your data`;
    case "too-long":
      return screenRead ? `${screen}, and it's too long to transcribe` : "Too long to read on this device";
    case "unreadable":
      return `${screen}, and the sound couldn't be read`;
    default:
      return screenRead ? "No speech or on-screen text found" : "No speech found";
  }
}

// ---------- extractor ----------

export async function extractVideo(blob: Blob, ctx: ExtractContext): Promise<Extracted> {
  ctx.setStage("reading", "Opening video…");
  const opened = await openVideo(blob, ctx.signal, false);

  if (opened && !opened.width && !opened.height) {
    // Sound only (e.g. a voice memo saved as .webm or .mp4): treat it as the recording it is.
    opened.close();
    const voice = await extractVoice(blob, ctx);
    return { ...voice, kind: "voice" };
  }

  let thumb: Blob | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let duration: number | undefined;
  if (opened) {
    try {
      width = opened.width;
      height = opened.height;
      duration = opened.duration;
      ctx.setStage("reading", "Making a preview…");
      thumb = await makePoster(opened, ctx.signal);
    } finally {
      opened.close();
    }
  }
  throwIfAborted(ctx.signal);

  const playable = !!opened;
  const readScreen = playable && (duration === undefined || duration <= LIMITS.maxVideoOcrSeconds);

  return ctx.heavy(async () => {
    const screen: ScreenText = readScreen ? await readOnScreenText(blob, ctx) : { lines: [] };
    throwIfAborted(ctx.signal);
    const sound = await transcribeTrack(blob, duration, ctx);

    const text = composeVideoText(sound.text, screen.lines);
    const hasTranscript = sound.text.length > 0;
    return {
      text,
      durationSec: duration ?? sound.durationSec,
      width,
      height,
      thumb,
      ocrConfidence: screen.lines.length ? screen.confidence : undefined,
      summaryNote: text && !hasTranscript && sound.missing ? soundNote(sound.missing) : undefined,
      emptyNote: emptyNote(sound, readScreen, playable),
    };
  });
}
