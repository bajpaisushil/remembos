/**
 * Meaning-search embedder — the page-side client of `public/workers/embed.worker.js`.
 *
 * The worker runs a small sentence-embedding model (all-MiniLM-L6-v2, 8-bit, ~29 MB with its runtime) with
 * transformers.js on WebAssembly, off the main thread. Model files are downloaded once from public
 * CDNs and cached by the browser (Cache Storage "transformers-cache"); user text never leaves the device.
 *
 * - One worker for the whole app, created lazily. Requests are matched to replies by id and wait
 *   while the model loads.
 * - `embedderStatus` mirrors the model state for the UI: idle → loading → ready | error, or disabled
 *   when meaning search is switched off in settings.
 * - A real download shows a single live progress toast; loading from the cache is silent.
 * - Downloads only start when something needs the model (adding memories, searching, an explicit
 *   "Download now"). `warmupEmbedder()` without options only loads a model that is already cached.
 * - After a failure, automatic retries pause for a minute (or until the browser is back online), so
 *   searches and background work never hammer the network or repeat error toasts. Explicit user
 *   actions retry immediately.
 */
import { toast } from "sonner";
import { EMBEDDING_MODEL, MODELS, STORAGE_NAMES, TRANSFORMERS_CDN } from "../config";
import { getSettings, settingsStore } from "../settings";
import { createStore } from "../store";
import type { ModelStatus } from "../types";
import { assetUrl } from "../utils";

export const embedderStatus = createStore<ModelStatus>({ state: "idle" });

/** Why the model is being loaded — decides how loudly failures are reported. */
type LoadReason = "auto" | "needed" | "user";

export interface WarmupOptions {
  /** Download the model if it isn't cached yet (something needs it now, e.g. a search). */
  allowDownload?: boolean;
  /** Explicit user request ("Download now", "Try again"): download and skip the retry pause. */
  userRequested?: boolean;
}

type WorkerReply =
  | { type: "progress"; loaded: number; total: number; progress: number }
  | { type: "ready"; device?: "webgpu" | "wasm" }
  | { type: "result"; id: number; dim: number; data: Float32Array }
  | { type: "error"; id?: number; message: string };

interface PendingRequest {
  count: number;
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

const TOAST_ID = "model-embedder";
const WORKER_PATH = "/workers/embed.worker.js";
/** Pause automatic retries this long after a failed load. */
const RETRY_PAUSE_MS = 60_000;
/** Don't repeat the same failure toast more often than this (unless the user asked). */
const ERROR_TOAST_GAP_MS = 5 * 60_000;
/** When we can't tell whether the model is cached, show the download toast if loading takes this long. */
const UNKNOWN_CACHE_TOAST_DELAY_MS = 1500;

const DISABLED_ERROR = "semantic-disabled";

let worker: Worker | null = null;
let loadPromise: Promise<void> | null = null;
let settleLoad: { resolve: () => void; reject: (err: Error) => void } | null = null;
let loadReason: LoadReason = "auto";
/** Bumped on every (re)start/teardown so late async callbacks from an old worker are ignored. */
let generation = 0;
const pending = new Map<number, PendingRequest>();
let nextRequestId = 1;

let lastFailure: { at: number; error: Error } | null = null;
let lastErrorToastAt = 0;
let toastShown = false;
let toastPercent = -1;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let onlineListener = false;

// ---------- Public API ----------

/** Embed passages (L2-normalised). Loads the model on first use (status updates via embedderStatus). */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  if (!semanticEnabled()) {
    markDisabled();
    throw new Error(DISABLED_ERROR);
  }
  await ensureLoaded("needed");
  const w = worker;
  if (!w) throw lastFailure?.error ?? new Error("The meaning-search model is not available.");
  const id = nextRequestId++;
  return new Promise<Float32Array[]>((resolve, reject) => {
    pending.set(id, { count: texts.length, resolve, reject });
    try {
      w.postMessage({ type: "embed", id, texts });
    } catch (err) {
      pending.delete(id);
      reject(asError(err));
    }
  });
}

/** Embed a search query (L2-normalised). MiniLM uses the same encoding for queries and passages. */
export async function embedQuery(text: string): Promise<Float32Array> {
  const [vector] = await embedTexts([text]);
  return vector;
}

/**
 * Start loading the model in the background. No-op when meaning search is off, or the model is
 * already loading/ready.
 *
 * Without options it never causes a download: it loads the model only if it is already cached on
 * this device — or when called from a click/keypress handler (the browser reports a fresh user
 * gesture), which counts as an explicit request. Pass `{ allowDownload: true }` when something needs
 * the model now, or `{ userRequested: true }` for buttons like "Download now" / "Try again".
 */
export function warmupEmbedder(opts: WarmupOptions = {}): void {
  if (typeof window === "undefined") return;
  if (!semanticEnabled()) {
    markDisabled();
    return;
  }
  const state = embedderStatus.get().state;
  if (state === "loading" || state === "ready") return;
  if (opts.userRequested) {
    void ensureLoaded("user").catch(noop);
    return;
  }
  if (opts.allowDownload) {
    void ensureLoaded("needed").catch(noop);
    return;
  }
  if (hasFreshUserGesture()) {
    void ensureLoaded("user").catch(noop);
    return;
  }
  void checkModelCache().then((cached) => {
    if (cached === true && semanticEnabled()) void ensureLoaded("auto").catch(noop);
  });
}

/**
 * Explicitly download/load the model now (e.g. a "Download now" button). Resolves when ready and
 * rejects with a readable error if it can't load (the error toast is shown either way).
 */
export function loadEmbedder(): Promise<void> {
  return ensureLoaded("user");
}

export function isEmbedderReady(): boolean {
  return embedderStatus.get().state === "ready";
}

/** Whether the model files are already in this browser's cache (no download needed). */
export async function isEmbedderCached(): Promise<boolean> {
  return (await checkModelCache()) === true;
}

/** Terminate the worker and free memory (used after clearing model caches). */
export function disposeEmbedder(): void {
  teardown(new Error("The meaning-search model was unloaded."));
  lastFailure = null;
  if (toastShown) toast.dismiss(TOAST_ID);
  toastShown = false;
  embedderStatus.set(semanticEnabled() ? { state: "idle" } : { state: "disabled" });
}

// ---------- Loading ----------

function ensureLoaded(reason: LoadReason): Promise<void> {
  if (!semanticEnabled()) {
    markDisabled();
    return Promise.reject(new Error(DISABLED_ERROR));
  }
  if (loadPromise) {
    if (reason === "user" || (reason === "needed" && loadReason === "auto")) loadReason = reason;
    return loadPromise;
  }
  if (reason !== "user" && lastFailure && Date.now() - lastFailure.at < RETRY_PAUSE_MS) {
    return Promise.reject(lastFailure.error);
  }
  return startWorker(reason);
}

function startWorker(reason: LoadReason): Promise<void> {
  const gen = ++generation;
  loadReason = reason;
  lastFailure = null;
  toastShown = false;
  toastPercent = -1;
  installOnlineListener();

  const promise = new Promise<void>((resolve, reject) => {
    settleLoad = { resolve, reject };
  });
  promise.catch(noop); // callers that care attach their own handlers
  loadPromise = promise;
  embedderStatus.set({ state: "loading", progress: 0 });

  if (typeof Worker === "undefined") {
    loadFailed(gen, new Error("This browser can't run background workers."));
    return promise;
  }
  let w: Worker;
  try {
    w = new Worker(assetUrl(WORKER_PATH), { type: "module" });
  } catch (err) {
    loadFailed(gen, asError(err));
    return promise;
  }
  worker = w;
  w.onmessage = (event: MessageEvent<WorkerReply>) => {
    if (gen === generation) handleReply(gen, event.data);
  };
  w.onerror = (event: ErrorEvent) => {
    event.preventDefault();
    if (gen === generation) loadFailed(gen, new Error(event.message || "The meaning-search worker stopped unexpectedly."));
  };
  w.onmessageerror = () => {
    if (gen === generation) loadFailed(gen, new Error("The meaning-search worker sent an unreadable reply."));
  };
  w.postMessage({ type: "init", cdn: TRANSFORMERS_CDN, model: EMBEDDING_MODEL });

  // Toast only for a real download: silent when the files come from the cache.
  void checkModelCache().then((cached) => {
    if (gen !== generation || embedderStatus.get().state !== "loading") return;
    if (cached === false) showDownloadToast();
    else if (cached === null) {
      toastTimer = setTimeout(() => {
        toastTimer = null;
        if (gen === generation && embedderStatus.get().state === "loading") showDownloadToast();
      }, UNKNOWN_CACHE_TOAST_DELAY_MS);
    }
  });
  return promise;
}

function handleReply(gen: number, msg: WorkerReply): void {
  switch (msg.type) {
    case "progress": {
      const prev = embedderStatus.get();
      if (prev.state !== "loading") return;
      const progress = Math.max(prev.progress ?? 0, clamp01(msg.progress));
      embedderStatus.set({ state: "loading", progress, loadedBytes: msg.loaded, totalBytes: msg.total });
      if (toastShown) updateDownloadToast();
      return;
    }
    case "ready": {
      clearToastTimer();
      embedderStatus.set({ state: "ready", device: msg.device ?? "wasm" });
      settleLoad?.resolve();
      settleLoad = null;
      if (toastShown) {
        toast.success("Meaning search is ready — runs fully on your device", {
          id: TOAST_ID,
          description: "Search now understands what you mean, not just exact words.",
          duration: 5000,
        });
        toastShown = false;
      }
      return;
    }
    case "result": {
      const req = pending.get(msg.id);
      if (!req) return;
      pending.delete(msg.id);
      const { data, dim } = msg;
      if (!(data instanceof Float32Array) || !dim || data.length !== dim * req.count) {
        req.reject(new Error("The meaning-search model returned an unexpected result."));
        return;
      }
      const vectors: Float32Array[] = [];
      // slice() copies: each vector must own its buffer (it gets stored in IndexedDB).
      for (let i = 0; i < req.count; i++) vectors.push(data.slice(i * dim, (i + 1) * dim));
      req.resolve(vectors);
      return;
    }
    case "error": {
      if (msg.id !== undefined) {
        const req = pending.get(msg.id);
        if (!req) return;
        pending.delete(msg.id);
        req.reject(new Error(msg.message || "Couldn't process the text for meaning search."));
      } else {
        loadFailed(gen, new Error(msg.message || "The meaning-search model failed to load."));
      }
      return;
    }
  }
}

function loadFailed(gen: number, err: Error): void {
  if (gen !== generation) return;
  const offline = looksOffline(err);
  const statusText = offline
    ? "You're offline — it downloads once when you're connected."
    : "The model couldn't be downloaded or started.";
  const failure = new Error(`Meaning search unavailable: ${statusText}`);
  const reason = loadReason;
  const toastWasVisible = toastShown;
  console.warn("[remembos] meaning-search model failed to load:", err);

  teardown(failure);
  lastFailure = { at: Date.now(), error: failure };
  embedderStatus.set({ state: "error", error: statusText });

  const now = Date.now();
  const shouldToast = reason === "user" || toastWasVisible || (reason === "needed" && now - lastErrorToastAt > ERROR_TOAST_GAP_MS);
  if (shouldToast) {
    lastErrorToastAt = now;
    toast.error(offline ? "Meaning search needs internet once" : "Couldn't load meaning search", {
      id: TOAST_ID,
      description: offline
        ? `Connect to download it (${approxSize()}, one time). Keyword search still works.`
        : "The download was blocked or failed. Keyword search still works.",
      duration: 10_000,
      action: { label: "Try again", onClick: () => void loadEmbedder().catch(noop) },
    });
  } else if (toastWasVisible) {
    toast.dismiss(TOAST_ID);
  }
  toastShown = false;
}

/** Stop the worker and fail everything waiting on it. */
function teardown(err: Error): void {
  generation++;
  clearToastTimer();
  const w = worker;
  worker = null;
  if (w) {
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
  }
  for (const req of pending.values()) req.reject(err);
  pending.clear();
  if (settleLoad) {
    settleLoad.reject(err);
    settleLoad = null;
  }
  loadPromise = null;
}

// ---------- Toasts ----------

/** Download size for copy: the measured total once known, else the configured estimate. */
function approxSize(): string {
  const measured = embedderStatus.get().totalBytes ?? 0;
  const bytes = measured > 0 ? measured : MODELS.embedder.approxBytes;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
}

function progressText(): string {
  const s = embedderStatus.get();
  const pct = Math.round((s.progress ?? 0) * 100);
  if (!s.totalBytes) return "Starting download… it stays on your device.";
  if (pct >= 99) return "Downloaded · finishing setup…";
  return `${pct}% · ${megabytes(s.loadedBytes ?? 0)} of ${megabytes(s.totalBytes)} MB · stays on your device`;
}

function showDownloadToast(): void {
  toastShown = true;
  toastPercent = Math.round((embedderStatus.get().progress ?? 0) * 100);
  toast.loading(`Downloading meaning-search model · ${approxSize()} (one time)`, {
    id: TOAST_ID,
    description: progressText(),
    duration: Infinity,
  });
}

function updateDownloadToast(): void {
  const pct = Math.round((embedderStatus.get().progress ?? 0) * 100);
  if (pct === toastPercent) return;
  toastPercent = pct;
  toast.loading(`Downloading meaning-search model · ${approxSize()} (one time)`, {
    id: TOAST_ID,
    description: progressText(),
    duration: Infinity,
  });
}

function clearToastTimer(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
}

// ---------- Helpers ----------

function semanticEnabled(): boolean {
  return getSettings().semanticSearch;
}

function markDisabled(): void {
  if (embedderStatus.get().state !== "disabled") embedderStatus.set({ state: "disabled" });
}

/**
 * true = model files are in Cache Storage, false = they are not, null = can't tell (no Cache API).
 * Only looks; never creates a cache.
 */
async function checkModelCache(): Promise<boolean | null> {
  try {
    if (typeof caches === "undefined") return null;
    const name = STORAGE_NAMES.modelCaches[0];
    if (!(await caches.has(name))) return false;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const needle = `/${EMBEDDING_MODEL}/`;
    return keys.some((req) => req.url.includes(needle) && /\.onnx(?:$|\?)/.test(req.url));
  } catch {
    return null;
  }
}

/** True right after a click/keypress (transient user activation), where supported. */
function hasFreshUserGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation;
  return activation?.isActive === true;
}

function looksOffline(err: Error): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|networkerror|network error|load failed|fetch dynamically imported module|importing a module script failed|err_internet|err_name_not_resolved|err_connection/i.test(
    err.message,
  );
}

/** When the browser comes back online, allow an automatic retry right away. */
function installOnlineListener(): void {
  if (onlineListener || typeof window === "undefined") return;
  onlineListener = true;
  window.addEventListener("online", () => {
    if (lastFailure) lastFailure = { ...lastFailure, at: 0 };
  });
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function noop(): void {}

// Follow the settings switch: turning meaning search off frees the model right away.
let semanticWasOn = settingsStore.get().semanticSearch;
settingsStore.subscribe(() => {
  const on = settingsStore.get().semanticSearch;
  if (on === semanticWasOn) return;
  semanticWasOn = on;
  if (!on) disposeEmbedder();
  else if (embedderStatus.get().state === "disabled") embedderStatus.set({ state: "idle" });
});
