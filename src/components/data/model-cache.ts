/**
 * What AI model files are already downloaded to this browser, and how much space they take.
 *
 * Read-only checks (nothing is created or downloaded):
 * - meaning search + voice transcriber: transformers.js keeps model files in Cache Storage
 *   (`transformers-cache`); a model counts as downloaded when its `.onnx` weights are there.
 * - text reader (OCR): tesseract.js keeps language data in its own IndexedDB database
 *   (`keyval-store`); it counts as downloaded when that database exists.
 *
 * Results live in `modelCacheStore` so the storage meter and the models panel share one
 * measurement. Call `refreshModelCaches()` after anything that changes the caches (a model
 * finished loading, models were removed); concurrent calls are coalesced.
 */
import { EMBEDDING_MODEL, STORAGE_NAMES, WHISPER_MODEL } from "@/lib/config";
import { createStore } from "@/lib/store";

export interface ModelCacheState {
  /** true = files on this device, false = not downloaded, null = unknown / not checked yet. */
  embedder: boolean | null;
  ocr: boolean | null;
  whisper: boolean | null;
  /** Bytes used by downloaded model files; null until measured. */
  bytes: number | null;
  /** A check is running. */
  checking: boolean;
}

export const modelCacheStore = createStore<ModelCacheState>({
  embedder: null,
  ocr: null,
  whisper: null,
  bytes: null,
  checking: false,
});

async function cacheHasModel(model: string): Promise<boolean | null> {
  if (typeof caches === "undefined") return null;
  const name = STORAGE_NAMES.modelCaches[0];
  try {
    if (!(await caches.has(name))) return false;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    const needle = `/${model}/`;
    return keys.some((req) => req.url.includes(needle) && /\.onnx(?:$|\?)/.test(req.url));
  } catch {
    return null;
  }
}

async function ocrDataCached(): Promise<boolean | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  try {
    const list = await indexedDB.databases();
    return list.some((d) => d.name === STORAGE_NAMES.ocrDb);
  } catch {
    return null;
  }
}

async function measureModelBytes(): Promise<number | null> {
  try {
    const { estimateModelCacheBytes } = await import("@/lib/storage/clear");
    return await estimateModelCacheBytes();
  } catch {
    return null;
  }
}

let running: Promise<void> | null = null;
let rerun = false;

/** Re-check which models are downloaded and how much space they use. Never rejects. */
export function refreshModelCaches(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (running) {
    rerun = true;
    return running;
  }
  modelCacheStore.set((s) => ({ ...s, checking: true }));
  running = (async () => {
    do {
      rerun = false;
      const [embedder, whisper, ocr, bytes] = await Promise.all([
        cacheHasModel(EMBEDDING_MODEL),
        cacheHasModel(WHISPER_MODEL),
        ocrDataCached(),
        measureModelBytes(),
      ]);
      modelCacheStore.set({ embedder, whisper, ocr, bytes, checking: rerun });
    } while (rerun);
  })()
    .catch(() => {
      modelCacheStore.set((s) => ({ ...s, checking: false }));
    })
    .finally(() => {
      running = null;
    });
  return running;
}
