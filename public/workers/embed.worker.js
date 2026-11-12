// Remembos meaning-search worker (plain ES module worker, no bundler).
//
// Turns text into sentence embeddings with transformers.js, entirely on this device. The library is
// imported from the pinned CDN URL the app sends in "init"; model files come from the Hugging Face
// Hub and are cached by the browser (Cache Storage "transformers-cache"). Text never leaves the worker.
//
// Messages in:
//   { type: "init", cdn, model }      load the library + model (once)
//   { type: "embed", id, texts }      embed texts (batches of 16; short requests are served first)
// Messages out:
//   { type: "progress", loaded, total, progress }   download/initialisation progress, progress 0..1
//   { type: "ready", device }                        model loaded ("wasm")
//   { type: "result", id, dim, data }                Float32Array of texts.length × dim, transferred
//   { type: "error", id?, message }                  with id: that request failed; without: loading failed
//
// Runtime: WebAssembly with the 8-bit quantised model (~23 MB, plus the ~5.5 MB runtime shared with Whisper). It is fast for a model this small and
// works everywhere. WebGPU is deliberately not used: it needs the fp32/fp16 weights (2–4× the
// download), and its int8 support is patchy across browsers and drivers.

const BATCH_SIZE = 16;
/** The model reads at most 256 tokens; longer input only costs time. */
const MAX_CHARS = 2000;
/** Don't flood the page with progress messages. */
const PROGRESS_INTERVAL_MS = 120;

/** @type {Promise<any> | null} resolves to the feature-extraction pipeline */
let extractorPromise = null;

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "init") {
    if (extractorPromise) return;
    extractorPromise = load(String(msg.cdn || ""), String(msg.model || ""));
    extractorPromise.then(
      () => self.postMessage({ type: "ready", device: "wasm" }),
      (err) => self.postMessage({ type: "error", message: describe(err) }),
    );
  } else if (msg.type === "embed") {
    void embed(msg.id, msg.texts);
  }
});

/** Resolve the CDN package URL to the self-contained browser ES module build. */
function libraryUrl(cdn) {
  if (/\.m?js(\?|$)/.test(cdn)) return cdn;
  return cdn.replace(/\/+$/, "") + "/dist/transformers.min.js";
}

async function load(cdn, model) {
  if (!cdn || !model) throw new Error("Missing library or model name.");
  const { pipeline, env } = await import(libraryUrl(cdn));

  env.allowLocalModels = false; // never probe this site for /models/ — always use the Hub (cached)
  env.useBrowserCache = true;

  const progress = createProgressReporter();
  prefetchRuntime(env, (loaded, total) => progress.onEvent({ status: "progress", file: RUNTIME_FILE, loaded, total }));
  const extractor = await pipeline("feature-extraction", model, {
    device: "wasm",
    dtype: "q8",
    progress_callback: progress.onEvent,
  });
  progress.flush();

  // One tiny run compiles the runtime now, so the first real search is instant and a broken
  // runtime is reported as a loading error rather than a failed search.
  const warm = await extractor("warm up", { pooling: "mean", normalize: true });
  if (typeof warm.dispose === "function") warm.dispose();
  return extractor;
}

const RUNTIME_FILE = "onnxruntime.wasm";
/** Typical brotli/gzip ratio of the runtime binary: turns decoded bytes into an estimate of bytes on the wire. */
const RUNTIME_COMPRESSION_ESTIMATE = 4.8;

/**
 * transformers.js downloads the ONNX runtime binary (~5.5 MB compressed) only after the model, and
 * without progress events — the progress bar would sit at 100% meanwhile. Fetch it here instead, in
 * parallel with the model and with progress, into the same cache entry transformers.js reads; its
 * fetch for that URL is answered from this download, so the file is downloaded once.
 */
function prefetchRuntime(env, report) {
  const paths = env.backends && env.backends.onnx && env.backends.onnx.wasm && env.backends.onnx.wasm.wasmPaths;
  const url = paths && typeof paths === "object" ? paths.wasm : null;
  if (!url || typeof url !== "string" || typeof caches === "undefined" || env.useWasmCache === false) return;

  const download = (async () => {
    const cache = await caches.open(env.cacheKey || "transformers-cache");
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    // With compression, content-length counts wire bytes while the stream yields decoded bytes.
    const wire = Number(res.headers.get("content-length")) || 0;
    const encoding = (res.headers.get("content-encoding") || "identity").toLowerCase();
    const ratio = encoding === "identity" ? 1 : RUNTIME_COMPRESSION_ESTIMATE;
    const reader = res.body.getReader();
    const parts = [];
    let decoded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      decoded += value.byteLength;
      const estimate = decoded / ratio;
      if (wire) report(Math.min(estimate, wire * 0.98), wire);
      else report(estimate, estimate);
    }
    const total = wire || decoded;
    report(total, total);
    const stored = new Response(new Blob(parts, { type: "application/wasm" }), {
      headers: { "content-type": "application/wasm" },
    });
    await cache.put(url, stored.clone()).catch(() => {});
    return stored;
  })().catch(() => null);

  const baseFetch = env.fetch;
  env.fetch = async (input, init) => {
    const target = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (target === url) {
      const res = await download;
      if (res) return res.clone();
    }
    return baseFetch(input, init);
  };
}

/**
 * transformers.js reports progress per file ("progress"), plus an aggregate ("progress_total") that
 * already knows the sizes of files not started yet. Merge both into one overall byte count.
 */
function createProgressReporter() {
  /** @type {Map<string, { loaded: number, total: number }>} */
  const files = new Map();
  let lastPost = 0;
  // The runtime download starts first; until the model's file sizes are known a percentage would be
  // computed against the runtime alone and then jump backwards, so hold reports until then.
  let modelSeen = false;

  function merge(file, loaded, total) {
    if (file !== RUNTIME_FILE) modelSeen = true;
    const prev = files.get(file) || { loaded: 0, total: 0 };
    const l = Math.max(prev.loaded, Number(loaded) || 0);
    const t = Math.max(prev.total, Number(total) || 0, l);
    files.set(file, { loaded: l, total: t });
  }

  function post(force) {
    const now = Date.now();
    if (!force && (!modelSeen || now - lastPost < PROGRESS_INTERVAL_MS)) return;
    lastPost = now;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    const progress = total > 0 ? Math.min(1, loaded / total) : 0;
    self.postMessage({ type: "progress", loaded, total, progress });
  }

  function onEvent(info) {
    if (!info || typeof info !== "object") return;
    if (info.status === "progress_total" && info.files && typeof info.files === "object") {
      for (const [file, f] of Object.entries(info.files)) merge(file, f && f.loaded, f && f.total);
      post(false);
    } else if (info.status === "progress" && info.file) {
      merge(info.file, info.loaded, info.total);
      post(false);
    } else if (info.status === "done" && info.file) {
      const f = files.get(info.file);
      if (f && f.total) f.loaded = f.total;
      post(true);
    }
  }

  return { onEvent, flush: () => post(true) };
}

function cleanText(text) {
  const s = String(text == null ? "" : text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHARS);
  return s || " ";
}

/**
 * Embedding requests are processed one batch at a time by a tiny scheduler: short requests (a search
 * query) go before the remaining batches of long ones (a big PDF being indexed), and the worker
 * yields between batches so new requests are seen promptly. Inference itself runs one batch at a time.
 */
/** @type {{ id: unknown, inputs: string[], parts: Float32Array[], next: number, dim: number }[]} */
const jobs = [];
let pumping = false;

function embed(id, texts) {
  if (!extractorPromise) {
    self.postMessage({ type: "error", id, message: "The model is not loaded." });
    return;
  }
  const inputs = Array.isArray(texts) ? texts.map(cleanText) : [];
  jobs.push({ id, inputs, parts: [], next: 0, dim: 0 });
  if (!pumping) void pump();
}

async function pump() {
  pumping = true;
  try {
    let extractor;
    try {
      extractor = await extractorPromise;
    } catch (err) {
      for (const job of jobs.splice(0)) self.postMessage({ type: "error", id: job.id, message: describe(err) });
      return;
    }
    while (jobs.length) {
      let index = jobs.findIndex((j) => j.inputs.length - j.next <= BATCH_SIZE);
      if (index < 0) index = 0;
      const job = jobs[index];
      try {
        if (job.next < job.inputs.length) {
          const batch = job.inputs.slice(job.next, job.next + BATCH_SIZE);
          const output = await extractor(batch, { pooling: "mean", normalize: true });
          job.dim = output.dims[output.dims.length - 1];
          job.parts.push(new Float32Array(output.data)); // copy: the tensor's memory is released below
          if (typeof output.dispose === "function") output.dispose();
          job.next += batch.length;
        }
        if (job.next >= job.inputs.length) {
          jobs.splice(jobs.indexOf(job), 1);
          const data = new Float32Array(job.inputs.length * job.dim);
          let offset = 0;
          for (const part of job.parts) {
            data.set(part, offset);
            offset += part.length;
          }
          self.postMessage({ type: "result", id: job.id, dim: job.dim, data }, [data.buffer]);
        }
      } catch (err) {
        const at = jobs.indexOf(job);
        if (at >= 0) jobs.splice(at, 1);
        self.postMessage({ type: "error", id: job.id, message: describe(err) });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    pumping = false;
  }
}

function describe(err) {
  if (err && typeof err === "object" && "message" in err && err.message) return String(err.message);
  return String(err || "Unknown error");
}
