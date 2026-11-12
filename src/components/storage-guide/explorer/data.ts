/**
 * Read-only data access for the storage explorer.
 *
 * Every list is one page (EXPLORER_PAGE_SIZE rows) read through an index or the primary key —
 * never a whole table. Stored files come back as Blob handles: their size and type are known
 * without reading the bytes, which only happens when someone opens or downloads one.
 * The text reader's database (keyval-store) is read with plain IndexedDB, keys only; a value is
 * read (to measure it) only on request.
 */
import { ENTITY_META, KIND_META, STORAGE_NAMES } from "@/lib/config";
import { db } from "@/lib/db";
import {
  chunkItemId,
  chunkKeyPrefix,
  clampPage,
  describeValue,
  EXPLORER_PAGE_SIZE,
  openExistingDatabase,
  pageOf,
  REMEMBOS_TABLES,
  rowBelongsTo,
  storedFileName,
  type RemembosTable,
} from "@/lib/storage-inspect";
import type { Chunk, Entity, MemoryItem, MemoryKind, MetaRecord, StoredFile, StoredThumb } from "@/lib/types";
import { formatBytes, truncate } from "@/lib/utils";

/** What the explorer can show: a table of "remembos", or the text reader's database. */
export type ExplorerView = RemembosTable | "ocr";

export const EXPLORER_VIEWS: ExplorerView[] = [...REMEMBOS_TABLES, "ocr"];

export function isExplorerView(value: string | null | undefined): value is ExplorerView {
  return !!value && (EXPLORER_VIEWS as string[]).includes(value);
}

export interface ExplorerRow {
  /** Primary key, exactly as IndexedDB stores it. */
  key: string;
  name: string;
  /** Show the name in a monospace font (keys, code-like values). */
  monoName?: boolean;
  type: string;
  /** Formatted size ("2.4 MB", "1,204 chars"). */
  size: string;
  /** Extra detail for the size (tooltip). */
  sizeTitle?: string;
  date?: number;
  /** The memory this row belongs to (items, files, thumbs, chunks). */
  itemId?: string;
  kind?: MemoryKind;
  /** Stored file handle (files, thumbs) — reading .size/.type doesn't load the bytes. */
  blob?: Blob;
  /** Name to download the blob under. */
  fileName?: string;
  /** Belongs to the memory the explorer is focused on. */
  highlight: boolean;
}

export interface TablePage {
  /** Identifies what was asked for, so the UI can tell fresh results from stale ones. */
  request: string;
  table: RemembosTable;
  page: number;
  total: number;
  rows: ExplorerRow[];
  /** Showing only the focused memory's rows. */
  filtered: boolean;
  /** The focused memory doesn't exist (any more). */
  focusMissing: boolean;
}

/** Live record counts of every table (cheap: IndexedDB counts without reading values). */
export async function countTables(): Promise<Record<RemembosTable, number>> {
  const counts = await Promise.all(REMEMBOS_TABLES.map((t) => db.table(t).count()));
  return Object.fromEntries(REMEMBOS_TABLES.map((t, i) => [t, counts[i]])) as Record<RemembosTable, number>;
}

type ItemInfo = Pick<MemoryItem, "id" | "title" | "kind" | "sourceName" | "mimeType" | "createdAt">;

/** Titles etc. for the memories behind a page of files/thumbs (one bulk read, ≤ 50 records). */
async function itemInfo(ids: string[]): Promise<Map<string, ItemInfo>> {
  const map = new Map<string, ItemInfo>();
  if (!ids.length) return map;
  const items = await db.items.bulkGet(ids);
  for (const it of items) {
    if (it) map.set(it.id, { id: it.id, title: it.title, kind: it.kind, sourceName: it.sourceName, mimeType: it.mimeType, createdAt: it.createdAt });
  }
  return map;
}

function chars(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? "char" : "chars"}`;
}

function itemRow(it: MemoryItem, focusId: string): ExplorerRow {
  const textLength = it.text?.length ?? 0;
  return {
    key: it.id,
    name: it.title || "Untitled memory",
    type: KIND_META[it.kind]?.label ?? it.kind,
    size: chars(textLength),
    sizeTitle: `${chars(textLength)} of text${it.hasFile ? ` · original file ${formatBytes(it.size)} (in “files”)` : ""}`,
    date: it.createdAt,
    itemId: it.id,
    kind: it.kind,
    highlight: rowBelongsTo("items", it.id, focusId),
  };
}

function blobRow(table: "files" | "thumbs", rec: StoredFile | StoredThumb, info: ItemInfo | undefined, focusId: string): ExplorerRow {
  const blob = rec.blob;
  const variant = table === "files" ? "original" : "preview";
  const fileName = storedFileName(blob as Blob & { name?: unknown }, info, variant);
  return {
    key: rec.itemId,
    name: table === "files" ? fileName : info ? `Preview of “${info.title || "Untitled memory"}”` : "Preview",
    type: blob.type || "unknown type",
    size: formatBytes(blob.size),
    sizeTitle: `${blob.size.toLocaleString()} bytes`,
    date: info?.createdAt,
    itemId: rec.itemId,
    kind: info?.kind,
    blob,
    fileName,
    highlight: rowBelongsTo(table, rec.itemId, focusId),
  };
}

function chunkRow(c: Chunk, focusId: string): ExplorerRow {
  const vectorBytes = c.embedding ? c.embedding.byteLength : 0;
  const parts = [c.page ? `Page ${c.page}` : null, c.embedding ? "text + meaning vector" : "text only"].filter(Boolean);
  return {
    key: c.id,
    name: truncate((c.text ?? "").replace(/\s+/g, " ").trim(), 90) || "(empty)",
    type: parts.join(" · "),
    size: chars(c.text?.length ?? 0),
    sizeTitle: vectorBytes ? `${chars(c.text?.length ?? 0)} + ${formatBytes(vectorBytes)} meaning vector (${c.embedding?.length ?? 0} numbers)` : undefined,
    itemId: c.itemId ?? chunkItemId(c.id) ?? undefined,
    highlight: rowBelongsTo("chunks", c.id, focusId),
  };
}

function entityRow(e: Entity, focusId: string): ExplorerRow {
  const n = e.itemIds?.length ?? 0;
  return {
    key: e.id,
    name: e.value,
    type: ENTITY_META[e.type]?.label ?? e.type,
    size: `in ${n.toLocaleString()} ${n === 1 ? "memory" : "memories"}`,
    sizeTitle: `${e.count.toLocaleString()} ${e.count === 1 ? "mention" : "mentions"}`,
    date: e.lastSeen,
    itemId: n === 1 ? e.itemIds[0] : undefined,
    highlight: rowBelongsTo("entities", e.id, focusId, e.itemIds),
  };
}

function metaRow(m: MetaRecord): ExplorerRow {
  const v = describeValue(m.value);
  return { key: String(m.key), name: v.preview, monoName: true, type: v.type, size: formatBytes(v.bytes), highlight: false };
}

/**
 * Where the focused memory's first row sits in the table's normal order (null = no single spot,
 * e.g. bookkeeping). Counting keys below a bound is an index-only operation.
 */
async function focusOffset(table: RemembosTable, focus: MemoryItem): Promise<number | null> {
  switch (table) {
    case "items":
      return db.items.where("createdAt").above(focus.createdAt).count();
    case "files":
      return focus.hasFile ? db.files.where(":id").below(focus.id).count() : null;
    case "thumbs":
      return focus.hasThumb ? db.thumbs.where(":id").below(focus.id).count() : null;
    case "chunks":
      return db.chunks.where(":id").below(chunkKeyPrefix(focus.id)).count();
    case "entities": {
      const first = [...(focus.entityIds ?? [])].sort()[0];
      return first ? db.entities.where(":id").below(first).count() : null;
    }
    case "meta":
      return null;
  }
}

/**
 * One page of a table. `page: "auto"` opens on the page holding the focused memory's rows.
 * `onlyFocus` narrows the table to that memory's rows (via its indexes).
 */
export async function loadTablePage(table: RemembosTable, page: number | "auto", focusId: string, onlyFocus: boolean): Promise<TablePage> {
  const request = `${table}|${page}|${focusId}|${onlyFocus ? 1 : 0}`;
  const focus = focusId ? await db.items.get(focusId) : undefined;
  const base = { request, table, filtered: false, focusMissing: !!focusId && !focus };
  const size = EXPLORER_PAGE_SIZE;

  if (focus && onlyFocus) {
    switch (table) {
      case "items":
        return { ...base, filtered: true, page: 0, total: 1, rows: [itemRow(focus, focusId)] };
      case "files":
      case "thumbs": {
        const rec = table === "files" ? await db.files.get(focus.id) : await db.thumbs.get(focus.id);
        const info = await itemInfo(rec ? [focus.id] : []);
        return { ...base, filtered: true, page: 0, total: rec ? 1 : 0, rows: rec ? [blobRow(table, rec, info.get(focus.id), focusId)] : [] };
      }
      case "chunks": {
        const total = await db.chunks.where("itemId").equals(focus.id).count();
        const p = clampPage(page === "auto" ? 0 : page, total);
        const list = await db.chunks.where("itemId").equals(focus.id).offset(p * size).limit(size).toArray();
        list.sort((a, b) => a.index - b.index);
        return { ...base, filtered: true, page: p, total, rows: list.map((c) => chunkRow(c, focusId)) };
      }
      case "entities": {
        const total = await db.entities.where("itemIds").equals(focus.id).count();
        const p = clampPage(page === "auto" ? 0 : page, total);
        const list = await db.entities.where("itemIds").equals(focus.id).offset(p * size).limit(size).toArray();
        return { ...base, filtered: true, page: p, total, rows: list.map((e) => entityRow(e, focusId)) };
      }
      case "meta":
        break; // bookkeeping isn't tied to memories: show the whole (tiny) table
    }
  }

  const total = await db.table(table).count();
  let p = 0;
  if (page === "auto") {
    const offset = focus ? await focusOffset(table, focus) : null;
    p = clampPage(offset === null ? 0 : pageOf(offset, size), total);
  } else p = clampPage(page, total);
  const from = p * size;

  switch (table) {
    case "items": {
      const list = await db.items.orderBy("createdAt").reverse().offset(from).limit(size).toArray();
      return { ...base, page: p, total, rows: list.map((it) => itemRow(it, focusId)) };
    }
    case "files":
    case "thumbs": {
      const list: (StoredFile | StoredThumb)[] =
        table === "files" ? await db.files.orderBy(":id").offset(from).limit(size).toArray() : await db.thumbs.orderBy(":id").offset(from).limit(size).toArray();
      const info = await itemInfo(list.map((r) => r.itemId));
      return { ...base, page: p, total, rows: list.map((r) => blobRow(table, r, info.get(r.itemId), focusId)) };
    }
    case "chunks": {
      const list = await db.chunks.orderBy(":id").offset(from).limit(size).toArray();
      return { ...base, page: p, total, rows: list.map((c) => chunkRow(c, focusId)) };
    }
    case "entities": {
      const list = await db.entities.orderBy(":id").offset(from).limit(size).toArray();
      return { ...base, page: p, total, rows: list.map((e) => entityRow(e, focusId)) };
    }
    case "meta": {
      const list = await db.meta.orderBy(":id").offset(from).limit(size).toArray();
      return { ...base, page: p, total, rows: list.map(metaRow) };
    }
  }
}

// ---------- One memory, everywhere it is stored ----------

export interface ItemStorage {
  item: MemoryItem;
  /** Original file handle, if kept. */
  file: Blob | null;
  thumb: Blob | null;
  /** Number of search pieces (chunks) stored for it. */
  chunks: number;
  /** Linked entities (the first few). */
  entities: Entity[];
  /** Entities linked but not shown (the card shows the first few). */
  moreEntities: number;
}

const MAX_ENTITY_CHIPS = 40;

/** Everything stored for one memory (null = not found). Reads one record per table plus a chunk count. */
export async function loadItemStorage(itemId: string): Promise<ItemStorage | null> {
  const item = await db.items.get(itemId);
  if (!item) return null;
  const ids = (item.entityIds ?? []).slice(0, MAX_ENTITY_CHIPS);
  const [file, thumb, chunks, entities] = await Promise.all([
    item.hasFile ? db.files.get(item.id) : Promise.resolve(undefined),
    item.hasThumb ? db.thumbs.get(item.id) : Promise.resolve(undefined),
    db.chunks.where("itemId").equals(item.id).count(),
    ids.length ? db.entities.bulkGet(ids) : Promise.resolve([] as (Entity | undefined)[]),
  ]);
  return {
    item,
    file: file?.blob ?? null,
    thumb: thumb?.blob ?? null,
    chunks,
    entities: entities.filter((e): e is Entity => !!e),
    moreEntities: Math.max(0, (item.entityIds?.length ?? 0) - ids.length),
  };
}

// ---------- The text reader's database (keyval-store) ----------

export interface OcrRow {
  store: string;
  key: string;
}

export interface OcrDatabase {
  /** false = not downloaded yet · null = this browser can't tell without creating it. */
  exists: boolean | null;
  version: number | null;
  stores: { name: string; count: number }[];
  total: number;
  /** Keys only — values (megabytes of language data) are read on request. */
  rows: OcrRow[];
  page: number;
  error?: string;
}

function keyText(key: IDBValidKey): string {
  if (typeof key === "string") return key;
  if (typeof key === "number") return String(key);
  if (key instanceof Date) return key.toISOString();
  if (Array.isArray(key)) return `[${key.map(keyText).join(", ")}]`;
  return "(binary key)";
}

/**
 * Keys of the text reader's database, one page at a time, without creating the database.
 * `listed` = names from indexedDB.databases() (null when the browser can't list).
 */
export async function loadOcrDatabase(page: number, listed: { name: string; version: number | null }[] | null): Promise<OcrDatabase> {
  const empty: OcrDatabase = { exists: false, version: null, stores: [], total: 0, rows: [], page: 0 };
  const known = listed?.find((d) => d.name === STORAGE_NAMES.ocrDb);
  if (listed && !known) return empty;
  const database = await openExistingDatabase(STORAGE_NAMES.ocrDb);
  if (!database) return { ...empty, exists: listed ? true : null, version: known?.version ?? null, error: listed ? "Couldn't open it right now." : undefined };
  try {
    const names = Array.from(database.objectStoreNames);
    if (!names.length) return { ...empty, exists: true, version: database.version };
    const tx = database.transaction(names, "readonly");
    const counts = await Promise.all(names.map((n) => request(tx.objectStore(n).count())));
    const stores = names.map((name, i) => ({ name, count: counts[i] }));
    const total = counts.reduce((a, b) => a + b, 0);
    const p = clampPage(page, total);
    // Walk keys only (openKeyCursor never loads values), skipping to the requested page.
    const rows: OcrRow[] = [];
    let skip = p * EXPLORER_PAGE_SIZE;
    for (const s of stores) {
      if (rows.length >= EXPLORER_PAGE_SIZE) break;
      if (skip >= s.count) {
        skip -= s.count;
        continue;
      }
      const keys = await request(tx.objectStore(s.name).getAllKeys(null, skip + (EXPLORER_PAGE_SIZE - rows.length)));
      for (const k of keys.slice(skip)) rows.push({ store: s.name, key: keyText(k) });
      skip = 0;
    }
    return { exists: true, version: database.version, stores, total, rows, page: p };
  } catch (err) {
    return { ...empty, exists: true, version: database.version, error: err instanceof Error ? err.message : "Couldn't read it." };
  } finally {
    database.close();
  }
}

/** Size in bytes of one value in the text reader's database (reads that one value). */
export async function measureOcrValue(store: string, key: string): Promise<number | null> {
  const database = await openExistingDatabase(STORAGE_NAMES.ocrDb);
  if (!database) return null;
  try {
    const value: unknown = await request(database.transaction(store, "readonly").objectStore(store).get(key));
    if (value === undefined) return null;
    if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength;
    return describeValue(value).bytes;
  } catch {
    return null;
  } finally {
    database.close();
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}
