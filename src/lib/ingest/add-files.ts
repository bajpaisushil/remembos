// Dropped, picked, pasted or shared files → memories: validate type and size, skip duplicates, check free
// space, create "processing" items in one quick write (so they show up instantly), then store the originals
// and process everything in the background queue. Adding a batch takes milliseconds, whatever the file sizes.
import { toast } from "sonner";
import { itemHref, LIMITS, ROUTES } from "../config";
import { db } from "../db";
import { ensureSpaceFor, handleStorageError, refreshStorage } from "../storage/monitor";
import type { MemoryItem, MemoryKind } from "../types";
import { formatBytes, uid } from "../utils";
import { baseName, canDecodeImage, detectKind, isHeic, needsDecodeCheck, shortName, unsupportedReason } from "./detect";
import { navigate } from "./nav";
import { storeOriginal } from "./originals";
import { enqueue, reserveItems, type QueueEntry } from "./queue";

interface Rejected {
  name: string;
  /** Groups identical problems into one sentence. */
  key: string;
  reason: string;
  hint: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function nameList(names: string[], max = 3): string {
  const shown = names.slice(0, max).map((n) => shortName(n, 28));
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

/** One toast for everything that was skipped, with the reason and what to do about it. */
function showRejected(list: Rejected[]): void {
  if (!list.length) return;
  if (list.length === 1) {
    const r = list[0];
    toast.warning(`Skipped “${shortName(r.name)}”`, { description: `${capitalize(r.reason)}. ${r.hint}`, duration: 10_000 });
    return;
  }
  const title = `${list.length} files skipped`;
  const sameProblem = list.every((r) => r.key === list[0].key);
  const description = sameProblem
    ? `${capitalize(list[0].reason)}: ${nameList(list.map((r) => r.name))}. ${list[0].hint}`
    : `${list
        .slice(0, 3)
        .map((r) => `${shortName(r.name, 28)} (${r.reason})`)
        .join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}.`;
  toast.warning(title, { description, duration: 12_000 });
}

function showDuplicates(list: { name: string; itemId: string }[]): void {
  if (!list.length) return;
  if (list.length === 1) {
    const d = list[0];
    toast.info(`Already remembered: ${shortName(d.name)}`, {
      description: "It's in your memories already, so it wasn't added twice.",
      action: { label: "Open", onClick: () => navigate(itemHref(d.itemId)) },
    });
    return;
  }
  toast.info(`Already remembered ${list.length} of these`, {
    description: `${nameList(list.map((d) => d.name))} — skipped so nothing is added twice.`,
    action: { label: "View", onClick: () => navigate(ROUTES.library) },
  });
}

function showLarge(files: File[]): void {
  if (!files.length) return;
  const total = files.reduce((n, f) => n + f.size, 0);
  toast.warning(
    files.length === 1 ? `Big file: “${shortName(files[0].name)}” (${formatBytes(total)})` : `${files.length} big files (${formatBytes(total)})`,
    { description: "Reading may take a while and it uses space on this device. You can remove originals later in Your data." },
  );
}

// ---------- duplicate detection ----------
// The same name + size + modified time is the same file. Keys of everything stored are cached for the session
// (one pass over the items table, done ahead of time when someone starts dragging files in or opens the
// picker), then kept up to date as files are added — so checking a batch costs one count query. Matches are
// re-checked against the database, so a memory deleted meanwhile never blocks adding the file again.

const duplicateKey = (name: string, size: number, date: number | undefined) => `${name}\u0000${size}\u0000${date || ""}`;

/** key → item id, for everything stored (as of `knownCount` items). */
let knownFiles: Map<string, string> | null = null;
let knownCount = 0;
let loadingKnown: Promise<Map<string, string>> | null = null;
let lastWarm = 0;

function scanKnownFiles(): Promise<Map<string, string>> {
  if (!loadingKnown) {
    loadingKnown = (async () => {
      const keys = new Map<string, string>();
      let count = 0;
      await db.items.each((it) => {
        count++;
        if (it.sourceName) keys.set(duplicateKey(it.sourceName, it.size, it.sourceDate), it.id);
      });
      knownFiles = keys;
      knownCount = count;
      return keys;
    })().finally(() => {
      loadingKnown = null;
    });
  }
  return loadingKnown;
}

/** Keys of stored files. Rescans only when items appeared that this tab didn't add (another tab, a restore). */
async function storedFileKeys(): Promise<Map<string, string>> {
  if (loadingKnown) return loadingKnown;
  const count = await db.items.count();
  if (knownFiles && count <= knownCount) return knownFiles;
  return scanKnownFiles();
}

function rememberFiles(entries: { key: string; itemId: string }[]): void {
  if (!knownFiles) return;
  for (const e of entries) knownFiles.set(e.key, e.itemId);
  knownCount += entries.length;
}

/**
 * Get ready before files arrive (called when a file drag enters the window or a file picker opens): load the
 * duplicate check and refresh the storage estimate, so the drop itself has nothing to wait for. Cheap when
 * already warm; at most once every few seconds.
 */
export function prepareForFiles(): void {
  const now = Date.now();
  if (now - lastWarm < 1_500) return;
  lastWarm = now;
  storedFileKeys().catch(() => {
    /* checked again (with error handling) when files are actually added */
  });
  void refreshStorage();
}

/** Which of these candidate item ids still exist (key-only read, no item data loaded). */
async function existingIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const keys = await db.items.where("id").anyOf(ids).primaryKeys();
  return new Set(keys);
}

async function classify(file: File): Promise<{ kind: MemoryKind } | { rejected: Rejected }> {
  const name = file.name || "Unnamed file";
  if (file.size === 0) {
    return { rejected: { name, key: "empty", reason: "the file is empty", hint: "There's nothing in it to remember." } };
  }
  if (file.size > LIMITS.maxFileBytes) {
    return {
      rejected: {
        name,
        key: "too-big",
        reason: `it's over ${formatBytes(LIMITS.maxFileBytes, 0)}`,
        hint: "Browsers struggle with files that large — compress or split it first.",
      },
    };
  }
  const kind = detectKind(file);
  if (!kind) {
    const { reason, hint } = unsupportedReason(file);
    return { rejected: { name, key: reason, reason, hint } };
  }
  if (kind === "image" && needsDecodeCheck(file) && !(await canDecodeImage(file))) {
    return isHeic(file)
      ? {
          rejected: {
            name,
            key: "heic",
            reason: "this browser can't open HEIC photos",
            hint: "Export it as JPG first (on iPhone: Settings → Camera → Formats → Most Compatible), or open Remembos in Safari.",
          },
        }
      : {
          rejected: {
            name,
            key: "image-format",
            reason: "this browser can't open this image format",
            hint: "Save it as PNG or JPG first, then add it again.",
          },
        };
  }
  return { kind };
}

type Accepted = { file: File; kind: MemoryKind };
type Fresh = Accepted & { key: string };

/** Drop files already remembered (one toast for them) and repeats within the batch. */
async function withoutDuplicates(accepted: Accepted[]): Promise<Fresh[]> {
  const known = await storedFileKeys();
  const candidates = new Map<string, string>();
  const seenInBatch = new Set<string>();
  const unique: Fresh[] = [];
  for (const { file, kind } of accepted) {
    const key = duplicateKey(file.name, file.size, file.lastModified || undefined);
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    const id = known.get(key);
    if (id) candidates.set(key, id);
    unique.push({ file, kind, key });
  }
  const stillThere = await existingIds(Array.from(candidates.values()));
  const duplicates: { name: string; itemId: string }[] = [];
  const fresh: Fresh[] = [];
  for (const entry of unique) {
    const id = candidates.get(entry.key);
    if (id && stillThere.has(id)) {
      duplicates.push({ name: entry.file.name, itemId: id });
      continue;
    }
    if (id) knownFiles?.delete(entry.key);
    fresh.push(entry);
  }
  showDuplicates(duplicates);
  return fresh;
}

function newItem({ file, kind }: Accepted, createdAt: number): MemoryItem {
  return {
    id: uid(),
    kind,
    title: baseName(file.name),
    text: "",
    summary: "",
    createdAt,
    updatedAt: createdAt,
    ...(file.lastModified ? { sourceDate: file.lastModified } : {}),
    sourceName: file.name,
    ...(file.type ? { mimeType: file.type } : {}),
    size: file.size,
    status: "processing",
    hasFile: 1,
    hasThumb: 0,
    tags: [],
    entityIds: [],
    pinned: 0,
    embedded: 0,
  };
}

/** Duplicate check → space check → one bulk insert of "processing" rows → originals + processing in the background. */
async function createItems(accepted: Accepted[], opts: { loadingTitle?: string }): Promise<string[]> {
  let fresh: Fresh[];
  try {
    fresh = await withoutDuplicates(accepted);
  } catch (err) {
    handleStorageError(err, "Adding files");
    return [];
  }
  if (!fresh.length) return [];

  showLarge(fresh.map((f) => f.file).filter((f) => f.size > LIMITS.largeFileBytes));

  const totalBytes = fresh.reduce((n, f) => n + f.file.size, 0);
  if (!(await ensureSpaceFor(totalBytes * 1.3))) return [];

  const now = Date.now();
  // Slightly decreasing times so a batch lists in the order it was dropped (newest-first views).
  const items = fresh.map((entry, i) => newItem(entry, now - i));
  const ids = items.map((it) => it.id);

  reserveItems(ids);
  try {
    await db.items.bulkAdd(items);
  } catch (err) {
    reserveItems(ids, false);
    handleStorageError(err, fresh.length === 1 ? `Saving “${shortName(fresh[0].file.name)}”` : "Adding files");
    return [];
  }
  rememberFiles(fresh.map((f, i) => ({ key: f.key, itemId: ids[i] })));

  const created: QueueEntry[] = fresh.map(({ file, kind }, i) => {
    void storeOriginal(ids[i], file);
    return { itemId: ids[i], name: file.name, kind, size: file.size };
  });
  enqueue(created, opts);
  return ids;
}

/** Batches are checked and inserted one at a time, so the same file dropped twice in a row is added once. */
let addChain: Promise<unknown> = Promise.resolve();

/**
 * Add files. Validates type/size/free space (shows toasts for rejected files), creates the "processing"
 * memories in one quick write (they show up in every list immediately), then stores the originals and
 * processes them in the background. Resolves with the created item ids as soon as the rows exist — it
 * never waits for files to be copied or read.
 */
export async function addFiles(input: File[], opts: { loadingTitle?: string } = {}): Promise<string[]> {
  if (!input.length) return [];

  const rejected: Rejected[] = [];
  const accepted: Accepted[] = [];
  const classified = await Promise.all(input.map((file) => classify(file)));
  classified.forEach((res, i) => {
    if ("rejected" in res) rejected.push(res.rejected);
    else accepted.push({ file: input[i], kind: res.kind });
  });
  showRejected(rejected);
  if (!accepted.length) return [];

  const run = addChain.then(() => createItems(accepted, opts));
  addChain = run.catch(() => undefined);
  return run;
}

/**
 * Add files. Validates type/size/free space (shows toasts for rejected files), creates items with status
 * "processing" immediately (so they appear in the UI), then stores the originals and processes them in the
 * background with limited concurrency. Resolves with the created item ids within milliseconds (does NOT
 * wait for storing or processing).
 */
export function ingestFiles(files: File[] | FileList): Promise<string[]> {
  return addFiles(Array.from(files));
}
