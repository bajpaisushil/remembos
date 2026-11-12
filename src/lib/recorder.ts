// In-app voice recording via MediaRecorder. The microphone audio stays on this device: the finished
// recording comes back as a File that goes through the normal pipeline (stored in IndexedDB, transcribed
// locally).
//
//   startRecording()                   ask for the mic and start; never rejects — problems set
//                                      recorderState.status = "error" (+ message) and show a toast
//   pauseRecording() / resumeRecording()
//   stopRecording()                    → File "Voice memo YYYY-MM-DD HH-MM.webm" (.m4a / .ogg), or null
//   cancelRecording()                  discard (also abandons a pending permission request)
//
// `recorderState` carries status, elapsed seconds (pauses excluded) and a live input level 0..1 (~20×/s).
// Recording stops by itself at LIMITS.maxRecordingSeconds, or when the microphone goes away; what was
// recorded is then saved automatically. The mic tracks and the audio graph are always released at the end.
import { toast } from "sonner";
import { LIMITS } from "./config";
import { ingestFiles } from "./ingest";
import { detectBrowser } from "./storage/monitor";
import { createStore } from "./store";
import { recorderOpen } from "./ui-state";
import { formatDuration } from "./utils";

export interface RecorderState {
  status: "idle" | "requesting" | "recording" | "paused" | "stopping" | "error";
  /** Elapsed recording time in seconds. */
  elapsed: number;
  /** Live input level 0..1 for the meter (updated ~20×/s while recording). */
  level: number;
  error?: string;
}

export const recorderState = createStore<RecorderState>({ status: "idle", elapsed: 0, level: 0 });

export function isRecordingSupported(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** Preferred formats, best first: Opus in WebM (Chrome, Edge, Firefox), AAC in MP4 (Safari), Opus in Ogg. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];
/** Plenty for clear speech: 30 minutes ≈ 14 MB. */
const BITS_PER_SECOND = 64_000;
const TICK_MS = 50;
const STOP_TIMEOUT_MS = 4_000;

interface Session {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  audio: AudioContext | null;
  nodes: AudioNode[];
  analyser: AnalyserNode | null;
  samples: Float32Array<ArrayBuffer> | null;
  timer: ReturnType<typeof setInterval> | null;
  /** Milliseconds recorded before the current run (pauses excluded). */
  recordedMs: number;
  /** performance.now() when the current run started; null while paused. */
  runStartedAt: number | null;
  level: number;
  stopping: Promise<File | null> | null;
  /** Ended by itself (time limit, mic gone) — the recording is being saved automatically. */
  autoSaved: boolean;
}

let session: Session | null = null;
/** Bumped by cancelRecording so a permission prompt that resolves later is abandoned. */
let requestToken = 0;

const IDLE: RecorderState = { status: "idle", elapsed: 0, level: 0 };

// ---------- helpers ----------

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_CANDIDATES.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/** "audio/webm;codecs=opus" → "audio/webm". Audio-only recordings are always typed audio/*. */
function baseAudioType(mime: string): string {
  const base = (mime.split(";")[0] || "").trim().toLowerCase() || "audio/webm";
  return base.startsWith("video/") ? `audio/${base.slice("video/".length)}` : base;
}

function extensionForType(type: string): string {
  switch (type) {
    case "audio/mp4":
    case "audio/x-m4a":
    case "audio/aac":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/wave":
      return "wav";
    default:
      return "webm";
  }
}

/** "Voice memo 2026-11-11 15-30" (local time; no characters file systems dislike). */
function memoName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Voice memo ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

function createAudioContext(): AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = typeof AudioContext === "function" ? AudioContext : w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* already stopped */
    }
  }
}

function closeAudio(audio: AudioContext | null): void {
  if (audio && audio.state !== "closed") void audio.close().catch(() => {});
}

function elapsedMs(sess: Session): number {
  return sess.recordedMs + (sess.runStartedAt !== null ? performance.now() - sess.runStartedAt : 0);
}

const toSeconds = (ms: number) => Math.floor(ms / 100) / 10;

const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
  event.preventDefault();
};

// ---------- friendly errors ----------

function isMacLike(): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** How to allow the microphone for this site, in the words of the browser being used. */
function siteMicHelp(): string {
  const browser = detectBrowser();
  if (browser === "ios-safari") {
    return "Tap “aA” in the address bar → Website Settings → Microphone → Allow (or Settings → Apps → Safari → Microphone), then try again.";
  }
  if (browser === "safari") return "In the menu bar choose Safari → Settings for This Website… → Microphone → Allow, then try again.";
  if (browser === "firefox") {
    return "Click the crossed-out microphone in the address bar and remove the block (or Settings → Privacy & Security → Permissions → Microphone), then try again.";
  }
  if (isAndroid()) return "Tap the icon left of the address → Permissions → Microphone → Allow, then try again.";
  if (browser === "other") return "Open this site's settings in your browser (usually the icon left of the address) and allow the microphone, then try again.";
  return "Click the icon left of the address (lock or sliders) → Site settings → Microphone → Allow, then try again.";
}

function systemMicHelp(): string {
  if (isMacLike()) {
    return "Open System Settings → Privacy & Security → Microphone, turn it on for your browser, then restart the browser.";
  }
  return "Open your system's privacy settings for the microphone (on Windows: Settings → Privacy & security → Microphone) and allow your browser, then try again.";
}

function fail(title: string, description: string): void {
  recorderState.set({ status: "error", elapsed: 0, level: 0, error: `${title}. ${description}` });
  toast.error(title, { id: "recorder-error", description, duration: 12_000 });
}

function micError(err: unknown): void {
  const name = (err as { name?: string } | null)?.name ?? "";
  const message = String((err as { message?: string } | null)?.message ?? "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    if (/system/i.test(message)) fail("Your computer is blocking the microphone", systemMicHelp());
    else fail("Microphone access is blocked", siteMicHelp());
    return;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    fail(
      "No microphone found",
      "Plug in or turn on a microphone (and check it isn't switched off in your system's sound settings), then try again.",
    );
    return;
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    fail("The microphone is busy", "Another app — like a video call — may be using it. Close that app, then try again.");
    return;
  }
  fail("Couldn't start recording", "Something went wrong while opening the microphone. Try again, or upload a recording instead.");
}

// ---------- level meter ----------

function attachMeter(sess: Session, audio: AudioContext | null): void {
  if (!audio) return;
  try {
    const source = audio.createMediaStreamSource(sess.stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    // Routed to a silent output so every browser keeps the analyser running (and nothing is played back).
    const mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    analyser.connect(mute);
    mute.connect(audio.destination);
    sess.audio = audio;
    sess.nodes = [source, analyser, mute];
    sess.analyser = analyser;
    sess.samples = new Float32Array(analyser.fftSize);
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    closeAudio(audio);
  }
}

/** RMS of the latest input, as 0..1 on a decibel scale (speech lands mid-way), fast attack / soft release. */
function readLevel(sess: Session): number {
  const { analyser, samples } = sess;
  if (!analyser || !samples) return 0;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  const target = Math.max(0, Math.min(1, (db + 60) / 50));
  sess.level = target > sess.level ? target : sess.level * 0.8 + target * 0.2;
  return Math.round(sess.level * 1000) / 1000;
}

function tick(sess: Session): void {
  if (session !== sess || sess.stopping) return;
  const ms = elapsedMs(sess);
  const elapsed = toSeconds(ms);
  const level = sess.runStartedAt !== null ? readLevel(sess) : 0;
  const current = recorderState.get();
  if (current.elapsed !== elapsed || current.level !== level) recorderState.set({ ...current, elapsed, level });
  if (ms >= LIMITS.maxRecordingSeconds * 1000) void endEarly(sess, "limit");
}

// ---------- lifecycle ----------

function release(sess: Session): void {
  if (sess.timer) clearInterval(sess.timer);
  sess.timer = null;
  stopTracks(sess.stream);
  for (const node of sess.nodes) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  sess.nodes = [];
  sess.analyser = null;
  sess.samples = null;
  closeAudio(sess.audio);
  sess.audio = null;
  if (session === sess) {
    session = null;
    window.removeEventListener("beforeunload", warnBeforeLeaving);
    recorderState.set(IDLE);
  }
}

function buildFile(sess: Session): File | null {
  if (!sess.chunks.length) return null;
  const type = baseAudioType(sess.recorder.mimeType || sess.mimeType);
  const blob = new Blob(sess.chunks, { type });
  if (!blob.size) return null;
  const now = new Date();
  return new File([blob], `${memoName(now)}.${extensionForType(type)}`, { type, lastModified: now.getTime() });
}

/** Stop the recorder, wait for its last data, release everything; the File (or null when discarding). */
function finish(sess: Session, discard: boolean): Promise<File | null> {
  if (sess.stopping) return sess.stopping;
  if (sess.runStartedAt !== null) {
    sess.recordedMs += performance.now() - sess.runStartedAt;
    sess.runStartedAt = null;
  }
  recorderState.set({ ...recorderState.get(), status: "stopping", elapsed: toSeconds(sess.recordedMs), level: 0 });
  sess.stopping = new Promise<File | null>((resolve) => {
    let done = false;
    const complete = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const file = discard ? null : buildFile(sess);
      sess.chunks = [];
      release(sess);
      resolve(file);
    };
    // Some browsers never fire "stop" if the device vanished mid-way; keep whatever arrived.
    const timer = setTimeout(complete, STOP_TIMEOUT_MS);
    if (sess.recorder.state === "inactive") {
      complete();
      return;
    }
    sess.recorder.addEventListener("stop", complete, { once: true });
    try {
      sess.recorder.stop();
    } catch {
      complete();
    }
  });
  return sess.stopping;
}

/** Recording ended without the person pressing stop: save what was recorded and say why. */
async function endEarly(sess: Session, reason: "limit" | "mic-lost" | "error"): Promise<void> {
  if (session !== sess || sess.stopping) return;
  sess.autoSaved = true;
  const file = await finish(sess, false);
  recorderOpen.set(false);
  if (!file) {
    toast.error("Recording stopped", {
      id: "recorder-error",
      description: "The microphone stopped before anything was recorded. Check it's connected, then try again.",
    });
    return;
  }
  const title =
    reason === "limit"
      ? `Recording stopped at ${formatDuration(LIMITS.maxRecordingSeconds)}`
      : reason === "mic-lost"
        ? "Microphone disconnected"
        : "Recording stopped unexpectedly";
  toast.info(title, {
    id: "recorder-ended",
    description:
      reason === "limit"
        ? "That's the longest single recording. It's saved and being transcribed — start a new one to keep going."
        : "Everything recorded until then is saved and being transcribed.",
    duration: 10_000,
  });
  await ingestFiles([file]);
}

/** Ask for the mic and start recording. Friendly toasts on permission/device errors. Never rejects. */
export async function startRecording(): Promise<void> {
  const status = recorderState.get().status;
  if (session || status === "requesting") return;
  if (!isRecordingSupported()) {
    fail(
      "Recording isn't available here",
      typeof window !== "undefined" && !window.isSecureContext
        ? "Browsers only allow the microphone on secure (https://) pages. Open Remembos over https, or upload a recording instead."
        : "This browser can't record audio. Try a recent Chrome, Edge, Firefox or Safari, or upload a recording instead.",
    );
    return;
  }

  const token = ++requestToken;
  // Created inside the click that started recording, so the browser lets it run (it drives the level meter).
  const audio = createAudioContext();
  recorderState.set({ status: "requesting", elapsed: 0, level: 0 });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    closeAudio(audio);
    if (token === requestToken) micError(err);
    return;
  }
  if (token !== requestToken) {
    // Cancelled while the browser was asking.
    stopTracks(stream);
    closeAudio(audio);
    return;
  }

  const preferred = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { ...(preferred ? { mimeType: preferred } : {}), audioBitsPerSecond: BITS_PER_SECOND });
  } catch {
    try {
      recorder = new MediaRecorder(stream);
    } catch {
      stopTracks(stream);
      closeAudio(audio);
      fail("Couldn't start recording", "This browser can't record from the microphone. Try a recent Chrome, Edge, Firefox or Safari.");
      return;
    }
  }

  const sess: Session = {
    stream,
    recorder,
    chunks: [],
    mimeType: recorder.mimeType || preferred || "audio/webm",
    audio: null,
    nodes: [],
    analyser: null,
    samples: null,
    timer: null,
    recordedMs: 0,
    runStartedAt: null,
    level: 0,
    stopping: null,
    autoSaved: false,
  };
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) sess.chunks.push(event.data);
  };
  recorder.onerror = () => void endEarly(sess, "error");
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", () => void endEarly(sess, "mic-lost"), { once: true });
  }
  attachMeter(sess, audio);

  try {
    // Hand over data every second so nothing is lost if the recording ends abruptly.
    recorder.start(1000);
  } catch {
    stopTracks(stream);
    closeAudio(sess.audio ?? audio);
    fail("Couldn't start recording", "The browser refused to start the recorder. Try again, or upload a recording instead.");
    return;
  }
  sess.runStartedAt = performance.now();
  session = sess;
  sess.timer = setInterval(() => tick(sess), TICK_MS);
  window.addEventListener("beforeunload", warnBeforeLeaving);
  recorderState.set({ status: "recording", elapsed: 0, level: 0 });
}

export function pauseRecording(): void {
  const sess = session;
  if (!sess || sess.stopping || recorderState.get().status !== "recording" || sess.recorder.state !== "recording") return;
  try {
    sess.recorder.pause();
  } catch {
    return;
  }
  if (sess.runStartedAt !== null) {
    sess.recordedMs += performance.now() - sess.runStartedAt;
    sess.runStartedAt = null;
  }
  sess.level = 0;
  recorderState.set({ status: "paused", elapsed: toSeconds(sess.recordedMs), level: 0 });
}

export function resumeRecording(): void {
  const sess = session;
  if (!sess || sess.stopping || recorderState.get().status !== "paused" || sess.recorder.state !== "paused") return;
  try {
    sess.recorder.resume();
  } catch {
    return;
  }
  sess.runStartedAt = performance.now();
  if (sess.audio?.state === "suspended") void sess.audio.resume().catch(() => {});
  recorderState.set({ status: "recording", elapsed: toSeconds(sess.recordedMs), level: 0 });
}

/**
 * Stop and return the recording as a File ("Voice memo <date time>.webm|.m4a"), or null if nothing recorded
 * (or the recording already ended by itself — it is then saved automatically).
 */
export async function stopRecording(): Promise<File | null> {
  const sess = session;
  if (!sess || sess.autoSaved) return null;
  return finish(sess, false);
}

/** Stop and discard. Releases the microphone. */
export function cancelRecording(): void {
  requestToken++;
  const sess = session;
  if (sess) {
    void finish(sess, true);
    return;
  }
  if (recorderState.get().status !== "idle") recorderState.set(IDLE);
}
