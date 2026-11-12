// Remembos voice transcriber — a module Web Worker running Whisper locally with transformers.js.
//
// The page sends {type:"init", cdn, model} once, then {type:"transcribe", id, audio} with 16 kHz mono
// Float32Array samples (transferred). Audio is processed in ~30 s windows cut at the quietest moment
// (with a short overlap when no pause is found) so progress is real and long recordings work. Only the
// library and model files are downloaded (then cached by the browser); the audio never leaves this worker.
//
// Messages to the page:
//   {type:"loading", progress, loaded, total}  model download/initialisation (progress 0..1)
//   {type:"ready", device}                     model ready
//   {type:"load-error", message}               model could not be loaded
//   {type:"progress", id, progress}            0..1 for one transcription
//   {type:"result", id, text}                  finished transcript
//   {type:"error", id, message}                transcription failed
//   {type:"cancelled", id}                     acknowledged a cancel

const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 30;
/** Earliest point (s) in a window where we look for a pause to cut at. */
const MIN_CUT_SECONDS = 24;
/** Overlap (s) added when a window had to be cut mid-speech. */
const OVERLAP_SECONDS = 1;
/** 100 ms analysis frames. */
const FRAME = 1600;
/** Windows whose loudest sample is below this are silence (Whisper invents words for silence). */
const SILENCE_PEAK = 0.005;

let config = null;
let asr = null;
let loading = null;
let queue = Promise.resolve();
const cancelled = new Set();

function post(message) {
  self.postMessage(message);
}

function errorMessage(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

function load() {
  if (asr) return Promise.resolve(asr);
  if (loading) return loading;
  loading = (async () => {
    if (!config) throw new Error("Transcriber was not initialised");
    const lib = await import(/* webpackIgnore: true */ config.cdn);
    const { pipeline, env } = lib;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    // Aggregate download progress. transformers.js v4 reports "progress_total"; per-file "progress"
    // events are summed as a fallback.
    const files = new Map();
    let sawTotal = false;
    let lastPost = 0;
    const report = (progress, loaded, total, force) => {
      const now = Date.now();
      if (!force && now - lastPost < 150) return;
      lastPost = now;
      post({ type: "loading", progress, loaded, total });
    };
    const progress_callback = (info) => {
      if (!info || typeof info !== "object") return;
      if (info.status === "progress_total") {
        sawTotal = true;
        const p = typeof info.progress === "number" ? info.progress / 100 : undefined;
        report(p, info.loaded, info.total, p === 1);
      } else if (info.status === "progress" && !sawTotal && info.file) {
        files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        report(total ? loaded / total : undefined, loaded, total, false);
      }
    };

    // Whisper tiny runs well faster than real time on the CPU with 8-bit weights (~45 MB download).
    // The WebGPU path needs full-precision weights (about three times the download) for little gain
    // on a model this small, so WASM is used everywhere for a predictable, compact experience.
    asr = await pipeline("automatic-speech-recognition", config.model, {
      device: "wasm",
      dtype: "q8",
      progress_callback,
    });
    post({ type: "ready", device: "wasm" });
    return asr;
  })();
  loading.catch((err) => {
    loading = null;
    post({ type: "load-error", message: errorMessage(err) });
  });
  return loading;
}

/** Root-mean-square level of each 100 ms frame. */
function frameLevels(audio) {
  const count = Math.ceil(audio.length / FRAME);
  const levels = new Float32Array(count);
  for (let f = 0; f < count; f++) {
    const start = f * FRAME;
    const end = Math.min(audio.length, start + FRAME);
    let acc = 0;
    for (let i = start; i < end; i++) acc += audio[i] * audio[i];
    levels[f] = Math.sqrt(acc / Math.max(1, end - start));
  }
  return levels;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Split audio into ≤ 30 s windows, cutting at the quietest frame near the end of each window. */
function planWindows(audio) {
  const total = audio.length;
  const windowLen = WINDOW_SECONDS * SAMPLE_RATE;
  if (total <= windowLen) return [{ start: 0, end: total, overlapsPrevious: false }];
  const levels = frameLevels(audio);
  const quiet = Math.max(0.003, median(levels) * 0.3);
  const windows = [];
  let start = 0;
  let overlap = false;
  while (start < total) {
    if (total - start <= windowLen) {
      windows.push({ start, end: total, overlapsPrevious: overlap });
      break;
    }
    const firstFrame = Math.ceil((start + MIN_CUT_SECONDS * SAMPLE_RATE) / FRAME);
    const lastFrame = Math.floor((start + windowLen) / FRAME) - 1;
    let best = lastFrame;
    for (let f = firstFrame; f <= lastFrame; f++) {
      if (levels[f] < levels[best]) best = f;
    }
    const cut = Math.min(start + windowLen, best * FRAME + FRAME / 2);
    windows.push({ start, end: cut, overlapsPrevious: overlap });
    if (levels[best] <= quiet) {
      start = cut;
      overlap = false;
    } else {
      start = Math.max(start + 1, cut - OVERLAP_SECONDS * SAMPLE_RATE);
      overlap = true;
    }
  }
  return windows;
}

function isSilent(slice) {
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] > SILENCE_PEAK || slice[i] < -SILENCE_PEAK) return false;
  }
  return true;
}

/** Remove Whisper's non-speech markers like "[BLANK_AUDIO]", "[Music]" or a lone "(upbeat music)". */
function cleanOutput(text) {
  let t = String(text || "");
  t = t.replace(/\[[^\]]{0,60}\]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (/^\([^()]{0,60}\)$/.test(t)) return "";
  if (/^[\s.,!?♪*~-]*$/.test(t)) return "";
  return t;
}

function normWord(w) {
  return w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Drop words at the start of `next` that repeat the end of `prev` (from the overlapping audio). */
function dedupeBoundary(prev, next) {
  const a = prev.split(/\s+/).filter(Boolean);
  const b = next.split(/\s+/).filter(Boolean);
  const max = Math.min(10, a.length, b.length);
  for (let k = max; k >= 1; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (normWord(a[a.length - k + i]) !== normWord(b[i])) {
        same = false;
        break;
      }
    }
    if (same) return b.slice(k).join(" ");
  }
  return next;
}

/** Collapse a sentence repeated over and over (a known Whisper failure mode) to at most two copies. */
function collapseRepeats(text) {
  const sentences = text.match(/[^.!?]+[.!?]*/g);
  if (!sentences) return text;
  const out = [];
  let run = 0;
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (prev !== null && prev.toLowerCase() === s.toLowerCase()) {
      run++;
      if (run >= 2) continue;
    } else {
      run = 0;
    }
    out.push(s);
  }
  return out.join(" ");
}

async function transcribe(id, audio) {
  try {
    const model = await load();
    const windows = planWindows(audio);
    const parts = [];
    for (const w of windows) {
      if (cancelled.has(id)) {
        cancelled.delete(id);
        post({ type: "cancelled", id });
        return;
      }
      const slice = audio.slice(w.start, w.end);
      if (!isSilent(slice)) {
        const output = await model(slice);
        const result = Array.isArray(output) ? output[0] : output;
        let text = cleanOutput(result && result.text);
        if (text && w.overlapsPrevious && parts.length) text = dedupeBoundary(parts[parts.length - 1], text);
        if (text) parts.push(text);
      }
      post({ type: "progress", id, progress: w.end / audio.length });
    }
    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ type: "cancelled", id });
      return;
    }
    const text = collapseRepeats(parts.join(" ").replace(/\s+/g, " ").trim());
    post({ type: "result", id, text });
  } catch (err) {
    cancelled.delete(id);
    post({ type: "error", id, message: errorMessage(err) });
  }
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  switch (msg.type) {
    case "init":
      if (!config) {
        config = { cdn: msg.cdn, model: msg.model };
        load().catch(() => {});
      }
      break;
    case "transcribe": {
      const audio = msg.audio instanceof Float32Array ? msg.audio : new Float32Array(msg.audio || []);
      queue = queue.then(() => transcribe(msg.id, audio));
      break;
    }
    case "cancel":
      cancelled.add(msg.id);
      break;
    default:
      break;
  }
});
