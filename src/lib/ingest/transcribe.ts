// Local speech-to-text.
//
// Audio is decoded and resampled to 16 kHz mono here in the page (Web Audio is not available in workers),
// then transferred to public/workers/whisper.worker.js, which runs Whisper via transformers.js (loaded from
// a pinned CDN URL; model weights cached in Cache Storage). The recording itself never leaves the device.
// The worker is shut down after a few idle minutes to free memory.
import { LIMITS, MODELS, TRANSFORMERS_CDN, WHISPER_MODEL } from "../config";
import { createStore } from "../store";
import type { ModelStatus } from "../types";
import { assetUrl, formatDuration, uid } from "../utils";
import { abortError, IngestError, throwIfAborted } from "./errors";
import { modelDownloadToast, type ModelToast } from "./model-toast";

export const whisperStatus = createStore<ModelStatus>({ state: "idle" });

export const WHISPER_SAMPLE_RATE = 16_000;
const IDLE_MS = 3 * 60_000;

type FromWorker =
  | { type: "loading"; progress?: number; loaded?: number; total?: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "load-error"; message: string }
  | { type: "progress"; id: string; progress: number }
  | { type: "result"; id: string; text: string }
  | { type: "error"; id: string; message: string }
  | { type: "cancelled"; id: string };

interface PendingJob {
  resolve(text: string): void;
  reject(err: Error): void;
  onProgress?: (p: number) => void;
}

let worker: Worker | null = null;
let notice: ModelToast | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, PendingJob>();

function clearIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdle(): void {
  clearIdle();
  if (pending.size === 0) idleTimer = setTimeout(() => disposeWhisper(), IDLE_MS);
}

function failAll(err: Error): void {
  const jobs = Array.from(pending.values());
  pending.clear();
  for (const job of jobs) job.reject(err);
}

function stopWorker(): void {
  clearIdle();
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
  worker = null;
}

const LOAD_FAILED = "Couldn't load the voice transcriber (a one-time download). Check your connection, then retry.";

function handleMessage(msg: FromWorker): void {
  switch (msg.type) {
    case "loading": {
      const progress = typeof msg.progress === "number" ? Math.max(0, Math.min(1, msg.progress)) : undefined;
      whisperStatus.set({ state: "loading", progress, loadedBytes: msg.loaded, totalBytes: msg.total });
      notice?.progress(progress, msg.loaded, msg.total);
      break;
    }
    case "ready":
      whisperStatus.set({ state: "ready", progress: 1, device: msg.device });
      notice?.ready();
      notice = null;
      break;
    case "load-error":
      console.warn("[remembos] voice transcriber failed to load:", msg.message);
      whisperStatus.set({ state: "error", error: "Couldn't download the voice transcriber. Check your connection, then retry." });
      notice?.fail();
      notice = null;
      failAll(new IngestError(LOAD_FAILED));
      stopWorker();
      break;
    case "progress":
      pending.get(msg.id)?.onProgress?.(Math.max(0, Math.min(1, msg.progress)));
      break;
    case "result": {
      const job = pending.get(msg.id);
      pending.delete(msg.id);
      job?.resolve(msg.text);
      scheduleIdle();
      break;
    }
    case "error": {
      console.warn("[remembos] transcription failed:", msg.message);
      const job = pending.get(msg.id);
      pending.delete(msg.id);
      job?.reject(new IngestError("Couldn't transcribe this recording. Retry, or convert it to MP3 or M4A first."));
      scheduleIdle();
      break;
    }
    case "cancelled":
      break;
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(assetUrl("/workers/whisper.worker.js"), { type: "module" });
  w.onmessage = (e: MessageEvent<FromWorker>) => handleMessage(e.data);
  w.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    console.warn("[remembos] voice transcriber stopped:", e.message || "the worker script could not be loaded");
    const loading = whisperStatus.get().state !== "ready";
    whisperStatus.set({
      state: "error",
      error: loading ? "Couldn't start the voice transcriber." : "The voice transcriber stopped unexpectedly.",
    });
    if (loading) notice?.fail();
    notice = null;
    failAll(new IngestError(loading ? LOAD_FAILED : "The voice transcriber stopped unexpectedly (often low memory). Retry in a moment."));
    stopWorker();
  };
  worker = w;
  if (whisperStatus.get().state !== "ready") {
    whisperStatus.set({ state: "loading", progress: 0 });
    notice = modelDownloadToast({
      id: "model-whisper",
      label: "the voice transcriber",
      approxBytes: MODELS.whisper.approxBytes,
      readyTitle: "Voice transcriber ready",
      readyDescription: "Transcribing on your device — nothing is uploaded.",
    });
  }
  w.postMessage({ type: "init", cdn: TRANSFORMERS_CDN, model: WHISPER_MODEL });
  return w;
}

export function tooLongMessage(durationSec: number): string {
  const limitMin = Math.round(LIMITS.maxAudioSeconds / 60);
  return `This recording is ${formatDuration(durationSec)} long — the limit is ${limitMin} minutes. Split it into shorter parts, then add them.`;
}

/** Average all channels into one. Always returns a fresh array (safe to transfer). */
function downmix(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i];
  }
  const k = 1 / channels;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/** Resample with a box filter when downsampling (cheap anti-aliasing), linear interpolation otherwise. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  if (ratio > 1) {
    for (let i = 0; i < out.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let acc = 0;
      for (let j = start; j < end; j++) acc += input[j];
      out[i] = end > start ? acc / (end - start) : input[Math.min(start, input.length - 1)];
    }
  } else {
    for (let i = 0; i < out.length; i++) {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const frac = pos - j;
      const a = input[j] ?? 0;
      const b = input[j + 1] ?? a;
      out[i] = a + (b - a) * frac;
    }
  }
  return out;
}

type AudioContextCtor = new () => AudioContext;

/**
 * Decode any audio the browser understands (and the audio track of .webm videos) into 16 kHz mono.
 * First asks an OfflineAudioContext running at 16 kHz to decode (the browser resamples, high quality);
 * falls back to decoding at the device rate and resampling here.
 */
export async function decodeAudio(blob: Blob, signal?: AbortSignal): Promise<{ samples: Float32Array; durationSec: number }> {
  let buffer: AudioBuffer | null = null;
  if (typeof OfflineAudioContext === "function") {
    try {
      const ctx = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      buffer = null;
    }
  }
  throwIfAborted(signal);
  if (!buffer) {
    const w = window as Window & { webkitAudioContext?: AudioContextCtor };
    const Ctor: AudioContextCtor | undefined = typeof AudioContext === "function" ? AudioContext : w.webkitAudioContext;
    if (!Ctor) throw new IngestError("This browser can't decode audio. Try a recent Chrome, Edge, Firefox or Safari.");
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctor();
      buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new IngestError("Couldn't find playable audio in this file. Try converting it to MP3 or M4A.");
    } finally {
      void ctx?.close().catch(() => {});
    }
  }
  throwIfAborted(signal);
  const mono = downmix(buffer);
  const samples = resample(mono, buffer.sampleRate, WHISPER_SAMPLE_RATE);
  return { samples, durationSec: buffer.duration };
}

/**
 * Transcribe 16 kHz mono samples in the worker. The array is transferred (unusable afterwards).
 * Loads the model on first use (status in `whisperStatus`, one-time download toast).
 */
export function transcribeSamples(samples: Float32Array, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  clearIdle();
  const w = getWorker();
  const id = uid("asr");
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      w.postMessage({ type: "cancel", id });
      reject(abortError());
      scheduleIdle();
    };
    pending.set(id, {
      resolve: (text) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(text);
      },
      reject: (err) => {
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
      onProgress,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    const audio = samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength ? samples : samples.slice();
    w.postMessage({ type: "transcribe", id, audio }, [audio.buffer]);
  });
}

/** Decode + resample audio to 16 kHz mono and transcribe locally. */
export async function transcribe(
  blob: Blob,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<{ text: string; durationSec: number }> {
  const { samples, durationSec } = await decodeAudio(blob, signal);
  if (durationSec > LIMITS.maxAudioSeconds) throw new IngestError(tooLongMessage(durationSec));
  const text = await transcribeSamples(samples, onProgress, signal);
  return { text, durationSec };
}

/** Stop the transcriber worker and free its memory (model files stay cached). */
export function disposeWhisper(): void {
  const hadWorker = !!worker;
  stopWorker();
  notice = null;
  failAll(new IngestError("The voice transcriber was stopped. Retry to transcribe this recording."));
  if (hadWorker && whisperStatus.get().state !== "error") whisperStatus.set({ state: "idle" });
}

/** Download and start the voice transcriber ahead of time (e.g. "Get ready for offline"). */
export function warmupWhisper(): Promise<void> {
  if (whisperStatus.get().state === "ready") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const settle = () => {
      const s = whisperStatus.get();
      if (s.state === "ready") {
        unsubscribe();
        scheduleIdle();
        resolve();
      } else if (s.state === "error") {
        unsubscribe();
        reject(new Error(s.error ?? "Couldn't download the voice transcriber."));
      }
    };
    const unsubscribe = whisperStatus.subscribe(settle);
    getWorker();
    settle();
  });
}
