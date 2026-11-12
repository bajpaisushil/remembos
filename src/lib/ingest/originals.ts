// Originals of just-added files are written to IndexedDB in the background, right after their memory rows
// appear — so adding a file never waits for the browser to copy it (a 300 MB video takes a while). While a
// write is in flight, processing reads the in-memory file and waits for the write to finish before the
// memory is marked ready, so a memory is never "ready" without its original stored.
import { db } from "../db";

interface PendingOriginal {
  blob: Blob;
  written: Promise<void>;
}

/** Writes in flight, by item id. */
const writing = new Map<string, PendingOriginal>();
/** Writes that failed and haven't been reported by processing yet. */
const failed = new Map<string, unknown>();

async function write(itemId: string, blob: Blob): Promise<void> {
  await db.transaction("rw", db.items, db.files, async () => {
    // Deleted or cancelled meanwhile: never leave an orphaned file behind.
    const exists = await db.items.where("id").equals(itemId).count();
    if (!exists) return;
    await db.files.put({ itemId, blob });
  });
}

/**
 * Store the original of a freshly created item. Resolves once it is safely in IndexedDB; a failure
 * (e.g. the disk is full) is reported when the item is processed (see readOriginal).
 */
export function storeOriginal(itemId: string, blob: Blob): Promise<void> {
  const entry: PendingOriginal = { blob, written: write(itemId, blob) };
  writing.set(itemId, entry);
  entry.written.then(
    () => {
      if (writing.get(itemId) === entry) writing.delete(itemId);
    },
    (err: unknown) => {
      if (writing.get(itemId) === entry) writing.delete(itemId);
      failed.set(itemId, err);
    },
  );
  return entry.written;
}

/**
 * The original file of an item: straight from memory while it is still being stored (with `written` to
 * await before committing), else from the database. Throws the storage error if storing it failed.
 * Resolves undefined when there is no original.
 */
export async function readOriginal(itemId: string): Promise<{ blob: Blob; written?: Promise<void> } | undefined> {
  if (failed.has(itemId)) {
    const err = failed.get(itemId);
    failed.delete(itemId);
    throw err;
  }
  const entry = writing.get(itemId);
  if (entry) return entry;
  const stored = await db.files.get(itemId);
  return stored ? { blob: stored.blob } : undefined;
}
