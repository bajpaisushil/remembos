/**
 * One-file backups — the user's own copy of everything, kept wherever they like.
 *
 * Archive layout (a plain .zip, format 1):
 *
 *   manifest.json            { app: "remembos", format: 1, exportedAt, counts, embedding }
 *   items.json               MemoryItem[]
 *   entities.json            Entity[]
 *   chunks.json              Chunk[] without embeddings
 *   embeddings.json          { dim, chunkIds } — row i of embeddings.bin belongs to chunkIds[i]
 *   embeddings.bin           Float32 rows (little-endian), `dim` values per row
 *   files/<itemId>.<ext>     original files (screenshots, PDFs, recordings…)
 *   thumbs/<itemId>.<ext>    small previews (usually .webp)
 *   media.json               { files, thumbs }: [{ itemId, path, type, size }] — exact MIME types
 *
 * Export streams record by record into fflate's streaming Zip and moves finished output into Blob
 * parts as it goes, so memory stays low even for big collections. Already-compressed media
 * (JPEG/PNG/WebP, PDF, compressed audio) is stored as-is; JSON and text are deflated.
 *
 * Import merges: memories that already exist (same id) are skipped, everything else is added in
 * small all-or-nothing batches, entity links are merged, and the search index is rebuilt.
 */
import { toast } from "sonner";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "../config";
import { db, getMeta, setMeta } from "../db";
import { backfillEmbeddings, ensureIndex, resetIndex } from "../search";
import { getSettings, updateSettings } from "../settings";
import {
  ENTITY_TYPES,
  MEMORY_KINDS,
  type Chunk,
  type Entity,
  type EntityType,
  type MemoryItem,
  type MemoryKind,
  type StoredFile,
  type StoredThumb,
} from "../types";
import { downloadBlob, formatBytes } from "../utils";
import {
  SAMPLE_IDS_META_KEY,
  backupFilename,
  extensionFor,
  isAlreadyCompressed,
  itemToMarkdown,
  markdownFilename,
  markdownHeader,
  mediaPath,
  mimeForExtension,
  parseMediaPath,
  plural,
} from "./helpers";
import { ensureSpaceFor, handleStorageError, refreshStorage } from "./monitor";

export interface BackupProgress {
  done: number;
  total: number;
  phase: string;
}

/** Version of the archive layout written by {@link exportBackup}. */
export const BACKUP_FORMAT = 1;

/**
 * A problem the person can understand and act on (wrong file, damaged backup, too big…).
 * `title` + `hint` are written for toasts; `handled` is true once a toast has been shown.
 */
export class BackupError extends Error {
  readonly title: string;
  readonly hint: string;
  handled: boolean;
  constructor(title: string, hint: string, handled = false) {
    super(`${title}. ${hint}`);
    this.name = "BackupError";
    this.title = title;
    this.hint = hint;
    this.handled = handled;
  }
}

interface MediaEntry {
  itemId: string;
  path: string;
  type: string;
  size: number;
}

interface Manifest {
  app: "remembos";
  format: number;
  exportedAt: number;
  counts: { items: number; files: number; thumbs: number; chunks: number; entities: number };
  embedding: { model: string; dim: number };
}

type Fflate = typeof import("fflate");
type ZipEntry = InstanceType<Fflate["ZipPassThrough"]> | InstanceType<Fflate["ZipDeflate"]>;

/** Zip32 limits (fflate writes classic zip headers): < 4 GiB and < 65,535 entries. */
const ZIP_MAX_BYTES = 0xffffffff - 64 * 1024 * 1024;
const ZIP_MAX_ENTRIES = 65_000;
const FLUSH_BYTES = 8 * 1024 * 1024;
const PAGE = 250;

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));

function progressReporter(total: number, onProgress?: (p: BackupProgress) => void) {
  let last = 0;
  let lastPhase = "";
  return (done: number, phase: string, force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && phase === lastPhase && now - last < 80) return;
    last = now;
    lastPhase = phase;
    try {
      onProgress({ done: Math.min(done, total), total, phase });
    } catch {
      /* a UI callback must never break the backup */
    }
  };
}

const tooBig = (what: string) =>
  new BackupError(
    "Too much for one backup file",
    `${what} Remove originals of large files you don't need (Your data → Free up space) and try again, or export the text as Markdown.`,
  );

/** Collects zip output into Blob parts so large backups don't pile up as one giant array. */
class ZipSink {
  private parts: Blob[] = [];
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  bytes = 0;
  entries = 0;
  failure: unknown = null;
  readonly zip: InstanceType<Fflate["Zip"]>;
  readonly finished: Promise<void>;

  constructor(ff: Fflate) {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    this.finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.finished.catch(() => {});
    this.zip = new ff.Zip((err, chunk, final) => {
      if (err) {
        this.failure = err;
        reject(err);
        return;
      }
      if (chunk && chunk.length) {
        this.pending.push(chunk);
        this.pendingBytes += chunk.length;
        this.bytes += chunk.length;
      }
      if (final || this.pendingBytes >= FLUSH_BYTES) this.flush();
      if (final) resolve();
    });
  }

  add(entry: ZipEntry) {
    if (++this.entries > ZIP_MAX_ENTRIES) throw tooBig("Your collection has more files than one backup can hold.");
    this.zip.add(entry);
  }

  check() {
    if (this.failure) throw this.failure;
    if (this.bytes > ZIP_MAX_BYTES) throw tooBig("Backups can hold up to about 4 GB.");
  }

  private flush() {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending as BlobPart[]));
    this.pending = [];
    this.pendingBytes = 0;
  }

  toBlob(): Blob {
    this.flush();
    return new Blob(this.parts, { type: "application/zip" });
  }
}

/** Streams a JSON array into a deflated zip entry, page by page. */
function jsonArrayEntry(ff: Fflate, sink: ZipSink, name: string) {
  const entry = new ff.ZipDeflate(name, { level: 6 });
  sink.add(entry);
  let first = true;
  return {
    write(values: unknown[]) {
      if (!values.length) return;
      let s = "";
      for (const v of values) {
        s += (first ? "[\n" : ",\n") + JSON.stringify(v);
        first = false;
      }
      entry.push(ff.strToU8(s));
      sink.check();
    },
    end() {
      entry.push(ff.strToU8(first ? "[]\n" : "\n]\n"), true);
      sink.check();
    },
  };
}

function textEntry(ff: Fflate, sink: ZipSink, name: string, text: string) {
  const entry = new ff.ZipDeflate(name, { level: 6 });
  sink.add(entry);
  entry.push(ff.strToU8(text), true);
  sink.check();
}

const validMtime = (ms?: number) => {
  if (!ms || !Number.isFinite(ms)) return undefined;
  const y = new Date(ms).getFullYear();
  return y >= 1981 && y <= 2098 ? ms : undefined;
};

/**
 * Stream a blob into a new zip entry. Returns false (and adds nothing) when the blob can't be
 * read at all. A read failure halfway through closes the entry early; the caller leaves such
 * entries out of media.json so a restore ignores them.
 */
async function addBlob(ff: Fflate, sink: ZipSink, path: string, blob: Blob, opts?: { mtime?: number; store?: boolean }): Promise<boolean> {
  const ext = path.slice(path.lastIndexOf(".") + 1);
  const store = opts?.store || isAlreadyCompressed(blob.type, ext);
  const entry: ZipEntry = store ? new ff.ZipPassThrough(path) : new ff.ZipDeflate(path, { level: 6 });
  const when = validMtime(opts?.mtime);
  if (when) entry.mtime = when;

  if (typeof blob.stream !== "function") {
    let data: Uint8Array;
    try {
      data = new Uint8Array(await blob.arrayBuffer());
    } catch {
      return false;
    }
    sink.add(entry);
    entry.push(data, true);
    sink.check();
    return true;
  }

  const reader = blob.stream().getReader();
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    first = await reader.read();
  } catch {
    return false;
  }
  sink.add(entry);
  let complete = true;
  try {
    let next = first;
    while (!next.done) {
      if (next.value?.length) entry.push(next.value);
      sink.check();
      next = await reader.read();
    }
  } catch (err) {
    if (err instanceof BackupError) throw err;
    complete = false;
  }
  entry.push(new Uint8Array(0), true);
  sink.check();
  return complete;
}

function asFloat32(v: unknown): Float32Array | null {
  if (v instanceof Float32Array) return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return Float32Array.from(v);
  return null;
}

/**
 * Build a backup zip of all items, originals, thumbs, chunks (+embeddings), entities.
 * Sets `settings.lastBackupAt`. Does not download or toast — see {@link downloadBackup} for the
 * one-call version. Rejects with a {@link BackupError} for problems people can act on.
 */
export async function exportBackup(onProgress?: (p: BackupProgress) => void): Promise<{ blob: Blob; filename: string; items: number }> {
  const ff = await import("fflate");
  const exportedAt = Date.now();

  const [itemIds, fileIds, thumbIds, chunkIds, entityIds] = await Promise.all([
    db.items.toCollection().primaryKeys(),
    db.files.toCollection().primaryKeys(),
    db.thumbs.toCollection().primaryKeys(),
    db.chunks.toCollection().primaryKeys(),
    db.entities.toCollection().primaryKeys(),
  ]);

  if (fileIds.length + thumbIds.length + 10 > ZIP_MAX_ENTRIES) throw tooBig("Your collection has more files than one backup can hold.");
  let mediaBytes = 0;
  await db.files.each((f) => {
    mediaBytes += f.blob?.size ?? 0;
  });
  if (mediaBytes > ZIP_MAX_BYTES) throw tooBig(`Your original files add up to ${formatBytes(mediaBytes)}, and backups can hold up to about 4 GB.`);

  const total = itemIds.length + entityIds.length + chunkIds.length + fileIds.length + thumbIds.length + 1;
  const report = progressReporter(total, onProgress);
  let done = 0;
  report(0, "Getting ready", true);

  const sink = new ZipSink(ff);
  const manifest: Manifest = {
    app: "remembos",
    format: BACKUP_FORMAT,
    exportedAt,
    counts: { items: itemIds.length, files: fileIds.length, thumbs: thumbIds.length, chunks: chunkIds.length, entities: entityIds.length },
    embedding: { model: EMBEDDING_MODEL, dim: EMBEDDING_DIM },
  };
  textEntry(ff, sink, "manifest.json", JSON.stringify(manifest, null, 2));

  // Memories.
  const itemInfo = new Map<string, Pick<MemoryItem, "mimeType" | "sourceName" | "createdAt" | "sourceDate">>();
  const items = jsonArrayEntry(ff, sink, "items.json");
  for (let i = 0; i < itemIds.length; i += PAGE) {
    const page = (await db.items.bulkGet(itemIds.slice(i, i + PAGE))).filter((x): x is MemoryItem => !!x);
    for (const it of page) itemInfo.set(it.id, { mimeType: it.mimeType, sourceName: it.sourceName, createdAt: it.createdAt, sourceDate: it.sourceDate });
    items.write(page);
    done += Math.min(PAGE, itemIds.length - i);
    report(done, "Saving your memories");
    await yieldToBrowser();
  }
  items.end();

  // Entities (names, phones, tags… linked to memories).
  const entities = jsonArrayEntry(ff, sink, "entities.json");
  for (let i = 0; i < entityIds.length; i += PAGE * 4) {
    const page = (await db.entities.bulkGet(entityIds.slice(i, i + PAGE * 4))).filter((x): x is Entity => !!x);
    entities.write(page);
    done += Math.min(PAGE * 4, entityIds.length - i);
    report(done, "Saving people, places and topics");
    await yieldToBrowser();
  }
  entities.end();

  // Search chunks (text) + their meaning vectors, collected into a side blob.
  const chunks = jsonArrayEntry(ff, sink, "chunks.json");
  const vectorIds: string[] = [];
  const vectorBlobs: Blob[] = [];
  let vectorPending: Uint8Array[] = [];
  let vectorPendingBytes = 0;
  for (let i = 0; i < chunkIds.length; i += PAGE * 2) {
    const page = (await db.chunks.bulkGet(chunkIds.slice(i, i + PAGE * 2))).filter((x): x is Chunk => !!x && itemInfo.has(x.itemId));
    const rows: Omit<Chunk, "embedding">[] = [];
    for (const c of page) {
      const { embedding, ...rest } = c;
      rows.push(rest);
      const vec = asFloat32(embedding);
      if (vec && vec.length === EMBEDDING_DIM) {
        vectorIds.push(c.id);
        vectorPending.push(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength));
        vectorPendingBytes += vec.byteLength;
        if (vectorPendingBytes >= FLUSH_BYTES / 2) {
          vectorBlobs.push(new Blob(vectorPending as BlobPart[]));
          vectorPending = [];
          vectorPendingBytes = 0;
        }
      }
    }
    chunks.write(rows);
    done += Math.min(PAGE * 2, chunkIds.length - i);
    report(done, "Saving search data");
    await yieldToBrowser();
  }
  chunks.end();
  if (vectorPending.length) vectorBlobs.push(new Blob(vectorPending as BlobPart[]));
  textEntry(ff, sink, "embeddings.json", JSON.stringify({ dim: EMBEDDING_DIM, model: EMBEDDING_MODEL, chunkIds: vectorIds }));
  // Float32 vectors barely compress, so they are stored as-is.
  await addBlob(ff, sink, "embeddings.bin", new Blob(vectorBlobs, { type: "application/octet-stream" }), { store: true });

  // Original files and previews.
  const media: { files: MediaEntry[]; thumbs: MediaEntry[] } = { files: [], thumbs: [] };
  let unreadable = 0;
  for (const id of fileIds) {
    const info = itemInfo.get(id);
    const rec: StoredFile | undefined = info ? await db.files.get(id) : undefined;
    if (info && rec?.blob) {
      const ext = extensionFor(rec.blob.type || info.mimeType, info.sourceName);
      const path = mediaPath("files", id, ext);
      const ok = await addBlob(ff, sink, path, rec.blob, { mtime: info.sourceDate ?? info.createdAt });
      if (ok) media.files.push({ itemId: id, path, type: rec.blob.type || info.mimeType || mimeForExtension(ext), size: rec.blob.size });
      else unreadable++;
    }
    report(++done, "Adding your original files");
  }
  for (const id of thumbIds) {
    const info = itemInfo.get(id);
    const rec: StoredThumb | undefined = info ? await db.thumbs.get(id) : undefined;
    if (info && rec?.blob) {
      const found = extensionFor(rec.blob.type);
      const ext = found === "bin" ? "webp" : found;
      const path = mediaPath("thumbs", id, ext);
      if (await addBlob(ff, sink, path, rec.blob)) media.thumbs.push({ itemId: id, path, type: rec.blob.type || mimeForExtension(ext), size: rec.blob.size });
    }
    report(++done, "Adding previews");
    if (done % 50 === 0) await yieldToBrowser();
  }
  if (unreadable) console.warn(`[remembos] ${unreadable} original file(s) could not be read and were left out of the backup`);
  textEntry(ff, sink, "media.json", JSON.stringify(media));

  report(done, "Finishing up", true);
  sink.zip.end();
  await sink.finished;
  sink.check();
  const blob = sink.toBlob();
  report(total, "Done", true);

  updateSettings({ lastBackupAt: exportedAt });
  return { blob, filename: backupFilename(new Date(exportedAt)), items: itemInfo.size };
}

// ---------------------------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------------------------

const NOT_A_BACKUP = () =>
  new BackupError("That isn't a Remembos backup", "Choose the .zip file you downloaded with “Back up” — it's named like remembos-backup-2026-01-31.zip.");
const DAMAGED = () =>
  new BackupError("This backup looks damaged", "It may not have finished downloading or copying. Try downloading it again, or choose another backup.");

const CORE_FILES = new Set(["manifest.json", "items.json", "entities.json", "chunks.json", "embeddings.json", "embeddings.bin", "media.json"]);

const isStr = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function parseJson(bytes: Uint8Array | undefined, ff: Fflate): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(ff.strFromU8(bytes));
  } catch {
    throw DAMAGED();
  }
}

function sanitizeItem(raw: unknown, now: number): MemoryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !r.id || !MEMORY_KINDS.includes(r.kind as MemoryKind)) return null;
  const createdAt = num(r.createdAt, now);
  const interrupted = r.status !== "ready" && r.status !== "error";
  const item: MemoryItem = {
    ...(r as Partial<MemoryItem>),
    id: r.id,
    kind: r.kind as MemoryKind,
    title: isStr(r.title) && r.title.trim() ? r.title : "Untitled memory",
    text: isStr(r.text) ? r.text : "",
    summary: isStr(r.summary) ? r.summary : "",
    createdAt,
    updatedAt: num(r.updatedAt, createdAt),
    sourceDate: optNum(r.sourceDate),
    sourceName: isStr(r.sourceName) ? r.sourceName : undefined,
    mimeType: isStr(r.mimeType) ? r.mimeType : undefined,
    size: num(r.size, 0),
    status: interrupted ? "error" : (r.status as MemoryItem["status"]),
    error: interrupted ? "This memory was still being processed when the backup was made. Try processing it again." : isStr(r.error) ? r.error : undefined,
    hasFile: 0,
    hasThumb: 0,
    tags: Array.isArray(r.tags) ? r.tags.filter(isStr) : [],
    entityIds: Array.isArray(r.entityIds) ? Array.from(new Set(r.entityIds.filter(isStr))) : [],
    pinned: r.pinned ? 1 : 0,
    embedded: 0,
    sample: r.sample === true ? true : undefined,
  };
  for (const k of ["pageCount", "durationSec", "width", "height", "ocrConfidence"] as const) item[k] = optNum(r[k]);
  return item;
}

function sanitizeChunk(raw: unknown): Chunk | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !isStr(r.itemId) || !isStr(r.text)) return null;
  const chunk: Chunk = {
    id: r.id,
    itemId: r.itemId,
    index: num(r.index, 0),
    text: r.text,
    start: num(r.start, 0),
    end: num(r.end, r.text.length),
  };
  const page = optNum(r.page);
  if (page !== undefined) chunk.page = page;
  return chunk;
}

function sanitizeEntity(raw: unknown, now: number): Entity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !ENTITY_TYPES.includes(r.type as EntityType)) return null;
  const normalized = isStr(r.normalized) ? r.normalized : r.id.slice(r.id.indexOf(":") + 1);
  return {
    id: r.id,
    type: r.type as EntityType,
    value: isStr(r.value) && r.value ? r.value : normalized,
    normalized,
    itemIds: Array.isArray(r.itemIds) ? r.itemIds.filter(isStr) : [],
    count: Math.max(1, num(r.count, 1)),
    firstSeen: num(r.firstSeen, now),
    lastSeen: num(r.lastSeen, now),
  };
}

/** Rebuild an entity from its id (`type:normalized`) when the backup has no record for it. */
function entityFromId(id: string, now: number): Entity | null {
  const i = id.indexOf(":");
  const type = id.slice(0, i) as EntityType;
  const normalized = id.slice(i + 1);
  if (i < 1 || !normalized || !ENTITY_TYPES.includes(type)) return null;
  return { id, type, value: normalized, normalized, itemIds: [], count: 0, firstSeen: now, lastSeen: now };
}

function sanitizeMedia(raw: unknown): MediaEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MediaEntry[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (isStr(r.itemId) && isStr(r.path)) out.push({ itemId: r.itemId, path: r.path, type: isStr(r.type) ? r.type : "", size: num(r.size, 0) });
  }
  return out;
}

async function runImport(file: File, onProgress?: (p: BackupProgress) => void): Promise<{ added: number; skipped: number }> {
  const ff = await import("fflate");
  const now = Date.now();
  const early = progressReporter(1, onProgress);
  early(0, "Opening your backup", true);

  if (/\.(md|markdown|txt)$/i.test(file.name)) {
    throw new BackupError("That's the text export, not a backup", "Markdown exports are for reading. To restore, choose the .zip file from “Back up”.");
  }
  if (!file.size) throw NOT_A_BACKUP();

  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new BackupError(
      "Couldn't open that file",
      "Your browser couldn't read it — it may be too big for this device's memory, or it was moved. Try again, or pick the file from another folder.",
    );
  }
  if (buf.length < 22 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw NOT_A_BACKUP();

  // Everything in the archive (names + sizes) without extracting anything yet.
  const entries = new Map<string, number>();
  let core: Record<string, Uint8Array>;
  try {
    ff.unzipSync(buf, {
      filter: (f) => {
        entries.set(f.name, f.originalSize);
        return false;
      },
    });
    core = ff.unzipSync(buf, { filter: (f) => CORE_FILES.has(f.name) });
  } catch {
    throw DAMAGED();
  }

  const manifest = parseJson(core["manifest.json"], ff) as Partial<Manifest> | undefined;
  if (!manifest || typeof manifest !== "object" || manifest.app !== "remembos") throw NOT_A_BACKUP();
  if (typeof manifest.format !== "number") throw DAMAGED();
  if (manifest.format > BACKUP_FORMAT) {
    throw new BackupError("This backup is from a newer Remembos", "Reload Remembos to get the latest version, then try restoring again.");
  }

  const rawItems = parseJson(core["items.json"], ff);
  if (!Array.isArray(rawItems)) throw DAMAGED();
  const rawEntities = parseJson(core["entities.json"], ff);
  const rawChunks = parseJson(core["chunks.json"], ff);
  const rawMedia = parseJson(core["media.json"], ff) as { files?: unknown; thumbs?: unknown } | undefined;
  const rawVectors = parseJson(core["embeddings.json"], ff) as { dim?: unknown; chunkIds?: unknown } | undefined;

  // Validate memories and find which are new.
  const seen = new Set<string>();
  const candidates: MemoryItem[] = [];
  let invalid = 0;
  for (const raw of rawItems) {
    const it = sanitizeItem(raw, now);
    if (!it || seen.has(it.id)) {
      invalid++;
      continue;
    }
    seen.add(it.id);
    candidates.push(it);
  }
  const existing = new Set(await db.items.where(":id").anyOf(candidates.map((c) => c.id)).primaryKeys());
  const toAdd = candidates.filter((c) => !existing.has(c.id));
  const skipped = candidates.length - toAdd.length;

  if (!toAdd.length) {
    if (!candidates.length) throw new BackupError("This backup has no memories in it", invalid ? "Its contents couldn't be read. Try another backup." : "It was made before anything was added.");
    toast.info("Everything in this backup is already here", {
      id: "backup-restore",
      description: `${plural(skipped, "memory was", "memories were")} skipped because ${skipped === 1 ? "it already exists" : "they already exist"}.`,
    });
    return { added: 0, skipped };
  }

  // Where each memory's original and preview live inside the archive.
  const filesById = new Map<string, MediaEntry>();
  const thumbsById = new Map<string, MediaEntry>();
  if (rawMedia && typeof rawMedia === "object") {
    for (const m of sanitizeMedia(rawMedia.files)) if (entries.has(m.path)) filesById.set(m.itemId, m);
    for (const m of sanitizeMedia(rawMedia.thumbs)) if (entries.has(m.path)) thumbsById.set(m.itemId, m);
  } else {
    for (const [name, size] of entries) {
      const parsed = parseMediaPath(name);
      if (!parsed) continue;
      const entry = { itemId: parsed.itemId, path: name, type: mimeForExtension(parsed.ext), size };
      (parsed.folder === "files" ? filesById : thumbsById).set(parsed.itemId, entry);
    }
  }

  // Will it fit?
  let needBytes = 0;
  for (const it of toAdd) {
    needBytes += (filesById.get(it.id)?.size ?? 0) + (thumbsById.get(it.id)?.size ?? 0) + it.text.length * 2;
  }
  if (!(await ensureSpaceFor(needBytes))) {
    throw new BackupError("Not enough space to restore this backup", "Free up some space first, then try again.", true);
  }

  // Search chunks + meaning vectors for the new memories.
  const addIds = new Set(toAdd.map((i) => i.id));
  const chunksByItem = new Map<string, Chunk[]>();
  if (Array.isArray(rawChunks)) {
    for (const raw of rawChunks) {
      const c = sanitizeChunk(raw);
      if (!c || !addIds.has(c.itemId)) continue;
      const list = chunksByItem.get(c.itemId);
      if (list) list.push(c);
      else chunksByItem.set(c.itemId, [c]);
    }
  }
  const vectorRow = new Map<string, number>();
  const vectorBin = core["embeddings.bin"];
  if (rawVectors && rawVectors.dim === EMBEDDING_DIM && Array.isArray(rawVectors.chunkIds) && vectorBin) {
    const ids = rawVectors.chunkIds as unknown[];
    if (vectorBin.byteLength === ids.length * EMBEDDING_DIM * 4) ids.forEach((id, row) => isStr(id) && vectorRow.set(id, row));
  }
  const rowBytes = EMBEDDING_DIM * 4;
  const vectorFor = (chunkId: string): Float32Array | undefined => {
    const row = vectorRow.get(chunkId);
    if (row === undefined || !vectorBin) return undefined;
    const start = vectorBin.byteOffset + row * rowBytes;
    return new Float32Array(vectorBin.buffer.slice(start, start + rowBytes));
  };

  const backupEntities = new Map<string, Entity>();
  if (Array.isArray(rawEntities)) {
    for (const raw of rawEntities) {
      const e = sanitizeEntity(raw, now);
      if (e) backupEntities.set(e.id, e);
    }
  }

  // Restore in small all-or-nothing batches.
  const total = toAdd.length + 1;
  const report = progressReporter(total, onProgress);
  report(0, "Restoring your memories", true);
  const MAX_BATCH_ITEMS = 40;
  const MAX_BATCH_BYTES = 32 * 1024 * 1024;
  let added = 0;
  let needsEmbedding = false;
  const restoredSampleIds: string[] = [];

  for (let i = 0; i < toAdd.length; ) {
    const batch: MemoryItem[] = [];
    let batchBytes = 0;
    while (i < toAdd.length && batch.length < MAX_BATCH_ITEMS) {
      const it = toAdd[i];
      const size = (filesById.get(it.id)?.size ?? 0) + (thumbsById.get(it.id)?.size ?? 0);
      if (batch.length && batchBytes + size > MAX_BATCH_BYTES) break;
      batch.push(it);
      batchBytes += size;
      i++;
    }

    const wanted = new Set<string>();
    for (const it of batch) {
      const f = filesById.get(it.id);
      const t = thumbsById.get(it.id);
      if (f) wanted.add(f.path);
      if (t) wanted.add(t.path);
    }
    let extracted: Record<string, Uint8Array> = {};
    if (wanted.size) {
      try {
        extracted = ff.unzipSync(buf, { filter: (f) => wanted.has(f.name) });
      } catch {
        throw DAMAGED();
      }
    }

    const files: StoredFile[] = [];
    const thumbs: StoredThumb[] = [];
    const chunks: Chunk[] = [];
    for (const it of batch) {
      const f = filesById.get(it.id);
      const fileData = f && extracted[f.path];
      if (f && fileData) {
        files.push({ itemId: it.id, blob: new Blob([fileData as BlobPart], { type: f.type || it.mimeType || "" }) });
        it.hasFile = 1;
      }
      const t = thumbsById.get(it.id);
      const thumbData = t && extracted[t.path];
      if (t && thumbData) {
        thumbs.push({ itemId: it.id, blob: new Blob([thumbData as BlobPart], { type: t.type || "image/webp" }) });
        it.hasThumb = 1;
      }
      const list = chunksByItem.get(it.id) ?? [];
      let vectors = 0;
      for (const c of list) {
        const v = vectorFor(c.id);
        if (v) {
          c.embedding = v;
          vectors++;
        }
        chunks.push(c);
      }
      it.embedded = list.length > 0 && vectors === list.length ? 1 : 0;
      if (!it.embedded && list.length) needsEmbedding = true;
      if (it.sample) restoredSampleIds.push(it.id);
    }

    // Which memories in this batch mention each entity.
    const holders = new Map<string, string[]>();
    for (const it of batch) {
      for (const eid of it.entityIds) {
        const list = holders.get(eid);
        if (list) list.push(it.id);
        else holders.set(eid, [it.id]);
      }
    }

    await db.transaction("rw", [db.items, db.files, db.thumbs, db.chunks, db.entities], async () => {
      const ids = Array.from(holders.keys());
      const current = await db.entities.bulkGet(ids);
      const puts: Entity[] = [];
      const dropped = new Set<string>();
      ids.forEach((eid, idx) => {
        const who = holders.get(eid) ?? [];
        const src = backupEntities.get(eid);
        const share = src ? Math.max(who.length, Math.round((src.count * who.length) / Math.max(1, src.itemIds.length))) : who.length;
        const cur = current[idx];
        if (cur) {
          const merged = new Set(cur.itemIds);
          who.forEach((x) => merged.add(x));
          puts.push({
            ...cur,
            itemIds: Array.from(merged),
            count: cur.count + share,
            firstSeen: Math.min(cur.firstSeen, src?.firstSeen ?? cur.firstSeen),
            lastSeen: Math.max(cur.lastSeen, src?.lastSeen ?? cur.lastSeen),
          });
          return;
        }
        const base = src ?? entityFromId(eid, now);
        if (!base) {
          dropped.add(eid);
          return;
        }
        puts.push({ ...base, itemIds: who, count: share });
      });
      if (dropped.size) for (const it of batch) it.entityIds = it.entityIds.filter((x) => !dropped.has(x));
      if (puts.length) await db.entities.bulkPut(puts);
      await db.items.bulkPut(batch);
      if (chunks.length) await db.chunks.bulkPut(chunks);
      if (files.length) await db.files.bulkPut(files);
      if (thumbs.length) await db.thumbs.bulkPut(thumbs);
    });

    added += batch.length;
    report(added, "Restoring your memories");
    await yieldToBrowser();
  }

  if (restoredSampleIds.length) {
    try {
      const known = (await getMeta<string[]>(SAMPLE_IDS_META_KEY)) ?? [];
      await setMeta(SAMPLE_IDS_META_KEY, Array.from(new Set([...known, ...restoredSampleIds])));
    } catch {
      /* only used to keep demo items out of reminders */
    }
  }

  report(added, "Rebuilding search", true);
  resetIndex();
  try {
    await ensureIndex();
  } catch (err) {
    console.warn("[remembos] search index rebuild after restore failed; it will rebuild on the next search", err);
  }
  if (needsEmbedding && getSettings().semanticSearch) void backfillEmbeddings().catch(() => {});
  void refreshStorage();
  report(total, "Done", true);

  toast.success(`Restored ${plural(added, "memory", "memories")}`, {
    id: "backup-restore",
    description: skipped
      ? `${plural(skipped, "memory was", "memories were")} already here and ${skipped === 1 ? "was" : "were"} skipped.`
      : "Everything from the backup is back and searchable.",
    duration: 8_000,
  });
  return { added, skipped };
}

/**
 * Restore from a backup file (merges; skips items that already exist). Re-indexes afterwards.
 * Shows its own toasts — a summary on success, a plain-language explanation on failure — so
 * callers only need to update their own UI state. Rejects after showing the error toast.
 */
export async function importBackup(file: File, onProgress?: (p: BackupProgress) => void): Promise<{ added: number; skipped: number }> {
  try {
    return await runImport(file, onProgress);
  } catch (err) {
    if (err instanceof BackupError) {
      if (!err.handled) {
        toast.error(err.title, { id: "backup-restore", description: err.hint, duration: 15_000 });
        err.handled = true;
      }
    } else {
      handleStorageError(err, "restoring your backup");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------
// Markdown export & one-call downloads
// ---------------------------------------------------------------------------------------------

/** Export just the text of every memory as Markdown — readable anywhere. Newest first. */
export async function exportMarkdown(): Promise<{ blob: Blob; filename: string }> {
  const now = Date.now();
  const ids = await db.items.orderBy("createdAt").reverse().primaryKeys();
  const parts: string[] = [markdownHeader(ids.length, now)];
  for (let i = 0; i < ids.length; i += PAGE) {
    const page = await db.items.bulkGet(ids.slice(i, i + PAGE));
    for (const it of page) if (it) parts.push(`\n\n---\n\n${itemToMarkdown(it)}`);
    await yieldToBrowser();
  }
  parts.push("\n");
  return { blob: new Blob(parts, { type: "text/markdown;charset=utf-8" }), filename: markdownFilename(new Date(now)) };
}

let backupInProgress = false;

/**
 * Build a backup and download it, with a live progress toast and a friendly result toast.
 * Never rejects: resolves null when there was nothing to back up or something went wrong
 * (the toast already explained it).
 */
export async function downloadBackup(): Promise<{ filename: string; items: number; bytes: number } | null> {
  const id = "backup-download";
  if (backupInProgress) {
    toast.info("Your backup is already being prepared", { id: `${id}-busy` });
    return null;
  }
  backupInProgress = true;
  try {
    const count = await db.items.count();
    if (!count) {
      toast.info("Nothing to back up yet", { id, description: "Add a memory first — then you can download a backup of everything." });
      return null;
    }
    toast.loading("Preparing your backup…", { id, description: "Gathering your memories" });
    const result = await exportBackup((p) => {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      toast.loading(`Preparing your backup… ${pct}%`, { id, description: p.phase });
    });
    downloadBlob(result.blob, result.filename);
    toast.success("Backup downloaded", {
      id,
      description: `${result.filename} · ${formatBytes(result.blob.size)} · ${plural(result.items, "memory", "memories")}. Keep it somewhere safe, like a cloud drive or USB stick — restore it any time from Your data.`,
      duration: 12_000,
    });
    return { filename: result.filename, items: result.items, bytes: result.blob.size };
  } catch (err) {
    if (err instanceof BackupError) {
      toast.error(err.title, { id, description: err.hint, duration: 15_000 });
      err.handled = true;
    } else {
      console.warn("[remembos] backup failed", err);
      toast.error("Couldn't create the backup", {
        id,
        description: "Something went wrong while reading your memories. Reload the page and try again — nothing was changed.",
        duration: 15_000,
      });
    }
    return null;
  } finally {
    backupInProgress = false;
  }
}

/** Build the Markdown export and download it, with a result toast. Never rejects. */
export async function downloadMarkdown(): Promise<{ filename: string; bytes: number } | null> {
  const id = "markdown-download";
  try {
    const count = await db.items.count();
    if (!count) {
      toast.info("Nothing to export yet", { id, description: "Add a memory first — then you can export all your text as one file." });
      return null;
    }
    const { blob, filename } = await exportMarkdown();
    downloadBlob(blob, filename);
    toast.success("Text export downloaded", {
      id,
      description: `${filename} · ${formatBytes(blob.size)}. Opens in any notes app or text editor. (It has text only — use “Back up” for a full copy.)`,
      duration: 10_000,
    });
    return { filename, bytes: blob.size };
  } catch (err) {
    console.warn("[remembos] markdown export failed", err);
    toast.error("Couldn't export your memories", { id, description: "Reload the page and try again — nothing was changed.", duration: 12_000 });
    return null;
  }
}
