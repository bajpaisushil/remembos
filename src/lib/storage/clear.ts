/**
 * Deleting things — memories, originals, downloaded AI models, or everything.
 *
 * Confirmation UX (dialogs, typed "DELETE") belongs to the callers; these functions do the work,
 * keep the search index and the storage meter in sync, and show a short result toast saying what
 * was removed and how much space came back.
 */
import { toast } from "sonner";
import { EMBEDDING_DIM, STORAGE_NAMES } from "../config";
import { clearDatabase, db, deleteItemsCascade } from "../db";
import { removeFromIndex, resetIndex } from "../search";
import { DEFAULT_SETTINGS, settingsStore } from "../settings";
import { formatBytes } from "../utils";
import { plural } from "./helpers";
import { handleStorageError, refreshStorage } from "./monitor";

/** Approximate bytes an item occupies: original + preview + text + search chunks + vectors. */
async function measureItems(ids: string[]): Promise<number> {
  const [items, files, thumbs, chunks] = await Promise.all([
    db.items.bulkGet(ids),
    db.files.bulkGet(ids),
    db.thumbs.bulkGet(ids),
    db.chunks.where("itemId").anyOf(ids).toArray(),
  ]);
  let bytes = 0;
  for (const it of items) if (it) bytes += (it.text?.length ?? 0) + (it.summary?.length ?? 0) + 512;
  for (const f of files) if (f?.blob) bytes += f.blob.size;
  for (const t of thumbs) if (t?.blob) bytes += t.blob.size;
  for (const c of chunks) bytes += c.text.length + (c.embedding ? EMBEDDING_DIM * 4 : 0);
  return bytes;
}

/**
 * Delete items (cascade + search index). Shows an "Undo"-less success toast with count/bytes freed.
 * Rejects (after showing a storage-error toast) if the browser refuses the delete.
 */
export async function deleteItems(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return;
  try {
    const bytes = await measureItems(unique).catch(() => 0);
    const existing = (await db.items.bulkGet(unique)).filter(Boolean).length;
    await deleteItemsCascade(unique);
    removeFromIndex(unique);
    void refreshStorage();
    const n = existing || unique.length;
    toast.success(`Deleted ${plural(n, "memory", "memories")} · freed ${formatBytes(bytes)}`, {
      id: "storage-deleted",
      description: n === 1 ? "It's gone from this device for good." : "They're gone from this device for good.",
    });
  } catch (err) {
    handleStorageError(err, unique.length === 1 ? "deleting that memory" : "deleting those memories");
    throw err;
  }
}

/**
 * Delete originals but keep text/search (frees space). Items still being processed are left
 * alone (processing needs the original). Returns bytes freed and shows a result toast.
 */
export async function deleteOriginals(ids: string[]): Promise<number> {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return 0;
  let freed = 0;
  let removed = 0;
  let busy = 0;
  try {
    await db.transaction("rw", [db.items, db.files], async () => {
      const [items, files] = await Promise.all([db.items.bulkGet(unique), db.files.bulkGet(unique)]);
      const drop: string[] = [];
      items.forEach((it, i) => {
        if (!it) return;
        const file = files[i];
        if (!it.hasFile && !file) return;
        if (it.status === "processing") {
          busy++;
          return;
        }
        freed += file?.blob?.size ?? 0;
        removed++;
        drop.push(it.id);
      });
      if (!drop.length) return;
      await db.files.bulkDelete(drop);
      await Promise.all(drop.map((id) => db.items.update(id, { hasFile: 0 })));
    });
  } catch (err) {
    handleStorageError(err, "removing original files");
    throw err;
  }
  void refreshStorage();

  if (!removed) {
    toast.info(busy ? "Those memories are still being processed" : "No original files to remove", {
      id: "storage-originals",
      description: busy ? "Try again once they're done." : "These memories only keep their text, so there's nothing more to free.",
    });
    return 0;
  }
  toast.success(`Removed ${plural(removed, "original file", "original files")} · freed ${formatBytes(freed)}`, {
    id: "storage-originals",
    description: `Text, previews and search still work.${busy ? ` ${plural(busy, "memory", "memories")} still processing ${busy === 1 ? "was" : "were"} left alone.` : ""}`,
  });
  return freed;
}

function removePrefixedKeys(storage: Storage | undefined): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_NAMES.keyPrefix)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
  } catch {
    /* storage blocked — nothing of ours can be in it */
  }
}

/**
 * Wipe all memories, indexes, settings. Leaves downloaded AI models unless `includeModels`.
 *
 * Memories (IndexedDB), preferences and session flags (localStorage/sessionStorage keys starting
 * with `remembos:`) and the in-memory search index are cleared; the app shell cache stays so the
 * app keeps working offline. Shows a success toast.
 *
 * Callers should reload the page afterwards (e.g. `window.location.assign(assetUrl("/"))`) to drop
 * in-memory state such as the processing queue and loaded models — that decision is left to the
 * caller so it can show its own "all clear" moment first.
 */
export async function clearAllData(opts?: { includeModels?: boolean }): Promise<void> {
  const includeModels = !!opts?.includeModels;
  try {
    await clearDatabase();
  } catch (err) {
    handleStorageError(err, "clearing your data");
    throw err;
  }
  if (typeof window !== "undefined") {
    removePrefixedKeys(safeStorage(() => window.localStorage));
    removePrefixedKeys(safeStorage(() => window.sessionStorage));
  }
  settingsStore.set({ ...DEFAULT_SETTINGS, snoozed: {} });
  resetIndex();
  if (includeModels) await removeModelFiles();
  await refreshStorage();
  toast.success("All Remembos data is cleared", {
    id: "storage-cleared",
    description: includeModels
      ? "Memories, settings and downloaded AI models are gone from this browser."
      : "Memories and settings are gone from this browser. Downloaded AI models were kept, so you won't need to download them again.",
    duration: 8_000,
  });
}

function safeStorage(get: () => Storage): Storage | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}

async function currentUsage(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    return typeof est?.usage === "number" ? est.usage : null;
  } catch {
    return null;
  }
}

type DeleteOutcome = "deleted" | "blocked" | "failed";

/** Delete an IndexedDB database; "blocked" means another tab still has it open (it goes once that tab closes). */
function deleteIndexedDb(name: string, timeoutMs = 4_000): Promise<DeleteOutcome> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve("failed");
    let blocked = false;
    let settled = false;
    const finish = (outcome: DeleteOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish(blocked ? "blocked" : "failed"), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => finish("deleted");
      req.onerror = () => finish("failed");
      req.onblocked = () => {
        blocked = true;
      };
    } catch {
      finish("failed");
    }
  });
}

/** Stop the model workers, then delete their caches. Returns bytes freed (best effort). */
async function removeModelFiles(): Promise<number> {
  const before = await currentUsage();
  const estimated = await estimateModelCacheBytes().catch(() => 0);

  // Free the models in memory first so nothing holds the cached files open.
  const [embedder, transcribe, ocr] = await Promise.allSettled([import("../ai/embedder"), import("../ingest/transcribe"), import("../ingest/ocr")]);
  try {
    if (embedder.status === "fulfilled") embedder.value.disposeEmbedder();
  } catch {
    /* already stopped */
  }
  try {
    if (transcribe.status === "fulfilled") transcribe.value.disposeWhisper();
  } catch {
    /* already stopped */
  }
  try {
    if (ocr.status === "fulfilled") await ocr.value.disposeOcr();
  } catch {
    /* already stopped */
  }

  if (typeof caches !== "undefined") {
    for (const name of STORAGE_NAMES.modelCaches) {
      try {
        await caches.delete(name);
      } catch {
        /* cache missing or blocked */
      }
    }
  }
  const ocrOutcome = await deleteIndexedDb(STORAGE_NAMES.ocrDb);
  if (ocrOutcome === "blocked") {
    toast.warning("Close other Remembos tabs to finish", {
      id: "storage-models-blocked",
      description: "The text reader's files are in use in another tab. They'll be removed as soon as that tab closes.",
      duration: 12_000,
    });
  }

  const after = await currentUsage();
  const delta = before !== null && after !== null ? before - after : 0;
  return delta > 0 ? delta : estimated;
}

/** Remove downloaded AI model files (Cache Storage + tesseract's IndexedDB cache). Returns bytes freed (best effort). */
export async function clearModelCaches(): Promise<number> {
  const freed = await removeModelFiles();
  void refreshStorage();
  return freed;
}

function valueBytes(v: unknown): number {
  if (!v) return 0;
  if (typeof Blob !== "undefined" && v instanceof Blob) return v.size;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (typeof v === "string") return v.length;
  return 0;
}

/** Sum of value sizes in an existing IndexedDB database; never creates the database. */
async function idbValueBytes(name: string): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  if (typeof indexedDB.databases === "function") {
    try {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === name)) return 0;
    } catch {
      /* fall through: the open below never creates a database */
    }
  }
  return new Promise<number>((resolve) => {
    let settled = false;
    const finish = (n: number) => {
      if (!settled) {
        settled = true;
        resolve(n);
      }
    };
    setTimeout(() => finish(0), 4_000);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(name);
    } catch {
      return finish(0);
    }
    // A brand-new database means it didn't exist: abort so nothing is created.
    req.onupgradeneeded = () => {
      try {
        req.transaction?.abort();
      } catch {
        /* ignore */
      }
    };
    req.onerror = () => finish(0);
    req.onblocked = () => finish(0);
    req.onsuccess = () => {
      const database = req.result;
      const stores = Array.from(database.objectStoreNames);
      if (!stores.length) {
        database.close();
        return finish(0);
      }
      let total = 0;
      try {
        const tx = database.transaction(stores, "readonly");
        for (const s of stores) {
          const cursorReq = tx.objectStore(s).openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            total += valueBytes(cursor.value);
            cursor.continue();
          };
        }
        tx.oncomplete = () => {
          database.close();
          finish(total);
        };
        tx.onerror = tx.onabort = () => {
          database.close();
          finish(total);
        };
      } catch {
        database.close();
        finish(0);
      }
    };
  });
}

/** Best-effort size of downloaded model caches in bytes. */
export async function estimateModelCacheBytes(): Promise<number> {
  let total = 0;
  if (typeof caches !== "undefined") {
    for (const name of STORAGE_NAMES.modelCaches) {
      try {
        if (!(await caches.has(name))) continue;
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          const res = await cache.match(req);
          if (!res) continue;
          const len = Number(res.headers.get("content-length"));
          if (Number.isFinite(len) && len > 0) total += len;
          else if (res.type !== "opaque") total += (await res.blob()).size;
        }
      } catch {
        /* unreadable cache — skip */
      }
    }
  }
  try {
    total += await idbValueBytes(STORAGE_NAMES.ocrDb);
  } catch {
    /* best effort */
  }
  return total;
}
