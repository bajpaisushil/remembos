// Writing processed memories: chunks + entities + item in one atomic transaction, then search indexing.
// Shared by the file pipeline, pasted text / typed notes, and text edits.
import { LIMITS } from "../config";
import { db, saveProcessedItem } from "../db";
import { chunkText, deriveSummary, deriveTitle, PAGE_SEPARATOR } from "../nlp/chunk";
import { extractEntities, normalizeEntity } from "../nlp/entities";
import { embedItem, indexItem } from "../search";
import { getSettings } from "../settings";
import { ensureSpaceFor, handleStorageError } from "../storage/monitor";
import type { Chunk, ExtractedEntity, MemoryItem } from "../types";
import { uid } from "../utils";
import { abortError, IngestError, isStorageError } from "./errors";

/** Lower-case, no "#", trimmed, unique. */
export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return [];
  const out = new Set<string>();
  for (const t of tags) {
    const clean = t.replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, "-");
    if (clean) out.add(clean);
  }
  return Array.from(out);
}

/** Keep at most LIMITS.maxTextChars, cutting pages consistently so chunk offsets stay valid. */
export function limitText(text: string, pages?: string[]): { text: string; pages?: string[] } {
  const max = LIMITS.maxTextChars;
  if (text.length <= max) return { text, pages };
  if (!pages?.length) return { text: text.slice(0, max) };
  const kept: string[] = [];
  let used = 0;
  for (const page of pages) {
    const sep = kept.length ? PAGE_SEPARATOR.length : 0;
    const room = max - used - sep;
    if (room <= 0) break;
    const part = page.length > room ? page.slice(0, room) : page;
    kept.push(part);
    used += sep + part.length;
    if (part.length < page.length) break;
  }
  return { text: kept.join(PAGE_SEPARATOR), pages: kept };
}

/** Chunks for an item. Always at least one, so even text-less memories are findable by title. */
export function buildChunks(itemId: string, text: string, pages?: string[]): Chunk[] {
  const drafts = text ? chunkText(text, pages) : [];
  if (!drafts.length) {
    return [{ id: `${itemId}:0`, itemId, index: 0, text: "", start: 0, end: 0, ...(pages?.length ? { page: 1 } : {}) }];
  }
  return drafts.map((d) => ({
    id: `${itemId}:${d.index}`,
    itemId,
    index: d.index,
    text: d.text,
    start: d.start,
    end: d.end,
    ...(d.page !== undefined ? { page: d.page } : {}),
  }));
}

/** Entities found in the text plus the item's own tags. */
export function withTagEntities(found: ExtractedEntity[], tags: string[]): ExtractedEntity[] {
  if (!tags.length) return found;
  const out = found.slice();
  const seen = new Set(found.filter((e) => e.type === "tag").map((e) => e.normalized));
  for (const tag of tags) {
    const normalized = normalizeEntity("tag", tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ type: "tag", value: `#${tag}`, normalized, count: 1, index: 0 });
  }
  return out;
}

export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

export interface CommitOptions {
  itemId: string;
  text: string;
  pages?: string[];
  /** Fields to change, computed from the item as currently stored (so edits made meanwhile survive). */
  patch: (current: MemoryItem) => Partial<MemoryItem>;
  thumb?: Blob;
  /** Delete the stored original in the same transaction (the "keep originals" setting is off). */
  dropOriginal?: boolean;
  signal?: AbortSignal;
}

/**
 * Atomically write an item's new text, chunks, entities, thumbnail (and optionally drop its original).
 * Throws an AbortError if the item was deleted or the job cancelled meanwhile — never resurrects it.
 */
export async function commitItem(opts: CommitOptions): Promise<MemoryItem> {
  const chunks = buildChunks(opts.itemId, opts.text, opts.pages);
  const found = opts.text ? extractEntities(opts.text) : [];
  let saved: MemoryItem | undefined;
  await db.transaction("rw", [db.items, db.chunks, db.entities, db.thumbs, db.files], async () => {
    const current = await db.items.get(opts.itemId);
    if (!current || opts.signal?.aborted) throw abortError();
    const next: MemoryItem = { ...current, ...opts.patch(current), text: opts.text, embedded: 0 };
    if (next.status === "ready") delete next.error;
    if (opts.thumb) {
      await db.thumbs.put({ itemId: opts.itemId, blob: opts.thumb });
      next.hasThumb = 1;
    }
    if (opts.dropOriginal && current.hasFile) {
      await db.files.delete(opts.itemId);
      next.hasFile = 0;
    }
    await saveProcessedItem(next, chunks, withTagEntities(found, next.tags ?? []));
    saved = next;
  });
  if (!saved) throw abortError();
  return saved;
}

/** Keyword-index now; embed for meaning search in the background (its failure never fails the memory). */
export async function indexAndEmbed(itemId: string, embedNow: boolean): Promise<void> {
  try {
    await indexItem(itemId);
  } catch (err) {
    console.warn("[remembos] indexing failed; the index is rebuilt on next start", err);
  }
  if (embedNow && getSettings().semanticSearch) {
    embedItem(itemId).catch(() => {
      /* keyword search still works; embeddings are back-filled later */
    });
  }
}

/**
 * Add pasted/copied text or a typed note. Resolves with the item id as soon as it is saved (a few ms);
 * keyword indexing and meaning search follow right after in the background — a search started meanwhile
 * still finds it, because the keyword index is built from the database.
 */
export async function ingestText(
  text: string,
  opts?: { title?: string; kind?: "text" | "note"; tags?: string[] },
): Promise<string> {
  const kind = opts?.kind ?? "text";
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new IngestError("There's no text to save yet.");
  const clipped = body.slice(0, LIMITS.maxTextChars);
  const title = opts?.title?.trim() || deriveTitle(clipped, kind === "note" ? "Untitled note" : "Pasted text");

  if (!(await ensureSpaceFor(clipped.length * 4))) {
    throw new IngestError("There isn't enough storage space to save this. Free up some space in Your data.", { alreadyShown: true });
  }

  const now = Date.now();
  const item: MemoryItem = {
    id: uid(),
    kind,
    title,
    text: clipped,
    summary: deriveSummary(clipped),
    createdAt: now,
    updatedAt: now,
    size: body.length,
    status: "ready",
    hasFile: 0,
    hasThumb: 0,
    tags: normalizeTags(opts?.tags),
    entityIds: [],
    pinned: 0,
    embedded: 0,
  };
  const chunks = buildChunks(item.id, clipped);
  const entities = withTagEntities(extractEntities(clipped), item.tags);
  try {
    await saveProcessedItem(item, chunks, entities);
  } catch (err) {
    if (isStorageError(err)) handleStorageError(err, `Saving “${title}”`);
    throw err;
  }
  void indexAndEmbed(item.id, true);
  return item.id;
}

/**
 * Replace a memory's text (re-chunks, re-extracts entities, re-indexes, re-embeds in the background).
 * `title` replaces the title when given ("" re-derives it from the text); otherwise the title is kept.
 */
export async function updateItemText(itemId: string, text: string, title?: string): Promise<void> {
  const body = text.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  const clipped = body.slice(0, LIMITS.maxTextChars);
  try {
    await commitItem({
      itemId,
      text: clipped,
      patch: (cur) => {
        const typed = cur.kind === "note" || (cur.kind === "text" && !cur.sourceName);
        return {
          title: title === undefined ? cur.title : title.trim() || deriveTitle(clipped, cur.title),
          summary: clipped.trim() ? deriveSummary(clipped) : "",
          status: "ready",
          size: typed ? body.length : cur.size,
        };
      },
    });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") throw new IngestError("This memory no longer exists.");
    if (isStorageError(err)) handleStorageError(err, "Saving your changes");
    throw err;
  }
  await indexAndEmbed(itemId, true);
}
