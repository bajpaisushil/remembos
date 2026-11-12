import Dexie, { type EntityTable } from "dexie";
import type { Chunk, Entity, ExtractedEntity, MemoryItem, MetaRecord, StoredFile, StoredThumb } from "./types";

/**
 * Everything the user stores lives here, in this browser's IndexedDB.
 * Nothing is ever sent to a server.
 */
export class RemembosDB extends Dexie {
  items!: EntityTable<MemoryItem, "id">;
  files!: EntityTable<StoredFile, "itemId">;
  thumbs!: EntityTable<StoredThumb, "itemId">;
  chunks!: EntityTable<Chunk, "id">;
  entities!: EntityTable<Entity, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor() {
    super("remembos");
    this.version(1).stores({
      items: "id, kind, createdAt, updatedAt, status, pinned, embedded, *tags, *entityIds",
      files: "itemId",
      thumbs: "itemId",
      chunks: "id, itemId",
      entities: "id, type, *itemIds, count, lastSeen",
      meta: "key",
    });
  }
}

/** Safe to construct during prerender; queries only run in the browser. */
export const db = new RemembosDB();

export const entityId = (type: string, normalized: string) => `${type}:${normalized}`;

/** True for browser "disk full / quota exceeded" errors from IndexedDB, Cache API or localStorage. */
export function isQuotaError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 8) return false;
  const e = err as { name?: string; inner?: unknown; code?: number; message?: string };
  if (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014) return true;
  if (typeof e.message === "string" && /quota|disk is full|not enough space/i.test(e.message)) return true;
  // Dexie wraps the browser error in `inner`; the depth cap guards against self-referencing chains.
  return e.inner && e.inner !== err ? isQuotaError(e.inner, depth + 1) : false;
}

/** True when IndexedDB is unusable (very old browser, some private modes, blocked by settings). */
export async function isDatabaseAvailable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    await db.open();
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically store a processed item with its chunks and entities.
 * Safe for re-processing: replaces old chunks and detaches old entity links.
 * Sets item.entityIds from `extracted`. Throws on quota errors (callers handle UX).
 */
export async function saveProcessedItem(item: MemoryItem, chunks: Chunk[], extracted: ExtractedEntity[]): Promise<void> {
  const now = Date.now();
  await db.transaction("rw", [db.items, db.chunks, db.entities], async () => {
    const previous = await db.items.get(item.id);
    if (previous?.entityIds?.length) await detachEntities(item.id, previous.entityIds);
    await db.chunks.where("itemId").equals(item.id).delete();

    const ids: string[] = [];
    for (const x of extracted) {
      const id = entityId(x.type, x.normalized);
      ids.push(id);
      const existing = await db.entities.get(id);
      if (existing) {
        if (!existing.itemIds.includes(item.id)) existing.itemIds.push(item.id);
        existing.count += x.count;
        existing.lastSeen = now;
        await db.entities.put(existing);
      } else {
        await db.entities.put({
          id,
          type: x.type,
          value: x.value,
          normalized: x.normalized,
          itemIds: [item.id],
          count: x.count,
          firstSeen: now,
          lastSeen: now,
        });
      }
    }
    item.entityIds = Array.from(new Set(ids));
    item.updatedAt = now;
    await db.items.put(item);
    if (chunks.length) await db.chunks.bulkPut(chunks);
  });
}

async function detachEntities(itemId: string, ids: string[]): Promise<void> {
  const ents = await db.entities.bulkGet(ids);
  for (const e of ents) {
    if (!e) continue;
    e.itemIds = e.itemIds.filter((x) => x !== itemId);
    if (e.itemIds.length === 0) await db.entities.delete(e.id);
    else await db.entities.put(e);
  }
}

/** Delete items and everything derived from them (files, thumbs, chunks, entity links). */
export async function deleteItemsCascade(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.transaction("rw", [db.items, db.files, db.thumbs, db.chunks, db.entities], async () => {
    const items = await db.items.bulkGet(ids);
    for (const it of items) {
      if (!it) continue;
      if (it.entityIds?.length) await detachEntities(it.id, it.entityIds);
    }
    await db.chunks.where("itemId").anyOf(ids).delete();
    await db.files.bulkDelete(ids);
    await db.thumbs.bulkDelete(ids);
    await db.items.bulkDelete(ids);
  });
}

/** Wipe every table (keeps the database itself). */
export async function clearDatabase(): Promise<void> {
  await db.transaction("rw", [db.items, db.files, db.thumbs, db.chunks, db.entities, db.meta], async () => {
    await Promise.all([db.items.clear(), db.files.clear(), db.thumbs.clear(), db.chunks.clear(), db.entities.clear(), db.meta.clear()]);
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const rec = await db.meta.get(key);
  return rec?.value as T | undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await db.meta.put({ key, value });
}
