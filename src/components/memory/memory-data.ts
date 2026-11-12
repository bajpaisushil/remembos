/**
 * Data helpers for browsing and editing memories (library grid, item page, related memories).
 *
 * Reads stay narrow, as the performance budget asks: the default view (newest/oldest first) is one
 * limit-bounded scan of the `createdAt` index; filtered views use index key scans (`primaryKeys()`),
 * and only the visible page of items is ever loaded. Counts come from indexes. Sorting by title or
 * size and the quick text filter need fields that have no index, so a small in-memory cache of
 * those fields is filled once and then refreshed incrementally from the `updatedAt` index.
 *
 * Every write catches storage failures and routes them to `handleStorageError` (friendly toast).
 */
import { db, entityId } from "@/lib/db";
import { normalizeTags } from "@/lib/ingest/save";
import { normalizeEntity } from "@/lib/nlp/entities";
import { indexItem } from "@/lib/search";
import { handleStorageError } from "@/lib/storage/monitor";
import { MEMORY_KINDS, type Entity, type EntityType, type JobStage, type MemoryItem, type MemoryKind } from "@/lib/types";

/** A memory without its (possibly huge) full text — what cards and lists render. */
export type CardItem = Omit<MemoryItem, "text">;

/** One entity shown as a chip on a card. */
export interface CardChip {
  id: string;
  type: EntityType;
  value: string;
}

export type LibrarySort = "newest" | "oldest" | "title" | "largest";

export const LIBRARY_SORTS: { value: LibrarySort; label: string; description: string }[] = [
  { value: "newest", label: "Newest first", description: "Most recently added on top" },
  { value: "oldest", label: "Oldest first", description: "Where it all started" },
  { value: "title", label: "Title A–Z", description: "Alphabetical by name" },
  { value: "largest", label: "Largest first", description: "Find what takes up space" },
];

export interface LibraryQuery {
  kind: MemoryKind | "all";
  tag: string | null;
  /** Quick filter over title, summary, file name and tags (case-insensitive). */
  text: string;
  sort: LibrarySort;
  limit: number;
}

export interface LibraryResult {
  items: CardItem[];
  /** Chips per item id (up to three each). */
  chips: Record<string, CardChip[]>;
  /** How many memories match the filters (pinned included). */
  total: number;
}

export interface LibraryStats {
  total: number;
  /** Memories still being read (OCR, transcription…). */
  processing: number;
  byKind: Record<MemoryKind, number>;
  /** User tags with how many memories carry each, most used first. */
  tags: { tag: string; count: number }[];
}

/** Drop `text` so lists never hold megabytes of extracted text in memory. */
export function toCardItem(item: MemoryItem): CardItem {
  const card: Partial<MemoryItem> = { ...item };
  delete card.text;
  return card as CardItem;
}

/** Entity type of an entity id (`type:normalized`). */
export function entityTypeOf(id: string): EntityType | null {
  const colon = id.indexOf(":");
  return colon > 0 ? (id.slice(0, colon) as EntityType) : null;
}

/** Most useful first: the concrete values people come back for, then names, tags and topics. */
const CHIP_PRIORITY: EntityType[] = ["phone", "email", "money", "date", "url", "name", "tag", "topic"];

/** Pick up to `max` entity ids for a card, most useful types first (keeps extraction order within a type). */
export function pickChipIds(entityIds: readonly string[] | undefined, max = 3): string[] {
  if (!entityIds?.length) return [];
  const ranked = entityIds
    .map((id, i) => {
      const type = entityTypeOf(id);
      const rank = type ? CHIP_PRIORITY.indexOf(type) : -1;
      return { id, i, rank: rank < 0 ? CHIP_PRIORITY.length : rank };
    })
    .sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.slice(0, max).map((r) => r.id);
}

/** What a chip shows (tags without "#", case-insensitive) — two chips that read the same are one. */
function chipKey(chip: Pick<CardChip, "value">): string {
  return chip.value.replace(/^#+/, "").trim().toLowerCase();
}

/** Drop chips whose visible text repeats an earlier one (e.g. the tag #atlas and the topic "atlas"). */
export function dedupeChips(chips: CardChip[]): CardChip[] {
  const seen = new Set<string>();
  return chips.filter((c) => {
    const key = chipKey(c);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Load chips for a set of cards in one round trip. */
async function loadChips(items: CardItem[], max = 3): Promise<Record<string, CardChip[]>> {
  const wanted = new Map<string, string[]>();
  const all = new Set<string>();
  for (const it of items) {
    // A few spare candidates, so duplicates can be dropped and the card still gets `max` chips.
    const ids = pickChipIds(it.entityIds, max * 2);
    wanted.set(it.id, ids);
    ids.forEach((id) => all.add(id));
  }
  if (!all.size) return {};
  const found = await db.entities.bulkGet(Array.from(all));
  const byId = new Map<string, Entity>();
  found.forEach((e) => {
    if (e) byId.set(e.id, e);
  });
  const out: Record<string, CardChip[]> = {};
  for (const [itemId, ids] of wanted) {
    const chips: CardChip[] = [];
    for (const id of ids) {
      const e = byId.get(id);
      if (e) chips.push({ id: e.id, type: e.type, value: e.value });
    }
    const unique = dedupeChips(chips).slice(0, max);
    if (unique.length) out[itemId] = unique;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sort / filter field cache
// ---------------------------------------------------------------------------------------------

interface ItemFields {
  title: string;
  size: number;
  /** Lower-cased title + summary + file name + tags, for the quick filter. */
  haystack: string;
}

const fieldCache = {
  map: new Map<string, ItemFields>(),
  /** Highest `updatedAt` seen so far; anything at or above it is re-read on the next sync. */
  since: Number.NEGATIVE_INFINITY,
};

function fieldsOf(item: MemoryItem): ItemFields {
  return {
    title: item.title || "",
    size: item.size || 0,
    haystack: [item.title, item.summary, item.sourceName, ...(item.tags ?? [])].filter(Boolean).join(" \u0000 ").toLowerCase(),
  };
}

/**
 * Bring the field cache up to date. First call reads every item once; later calls only read items
 * changed since (via the `updatedAt` index) and forget deleted ones.
 */
async function syncFieldCache(existingIds: readonly string[]): Promise<Map<string, ItemFields>> {
  const map = fieldCache.map;
  let since = fieldCache.since;
  const remember = (it: MemoryItem) => {
    map.set(it.id, fieldsOf(it));
    if (typeof it.updatedAt === "number" && it.updatedAt > since) since = it.updatedAt;
  };

  if (Number.isFinite(since)) {
    (await db.items.where("updatedAt").aboveOrEqual(since).toArray()).forEach(remember);
  }
  if (map.size > existingIds.length) {
    const keep = new Set(existingIds);
    for (const id of map.keys()) if (!keep.has(id)) map.delete(id);
  }
  // Never-seen items (first run, or imported with an older updatedAt): read in small pages so a
  // big library never has to sit in memory all at once.
  const missing = existingIds.filter((id) => !map.has(id));
  for (let i = 0; i < missing.length; i += FIELD_PAGE) {
    const rows = await db.items.bulkGet(missing.slice(i, i + FIELD_PAGE));
    rows.forEach((it) => {
      if (it) remember(it);
    });
  }
  fieldCache.since = Number.isFinite(since) ? since : 0;
  return map;
}

const FIELD_PAGE = 200;

/** Forget cached fields (e.g. after everything was cleared). */
export function resetLibraryCache(): void {
  fieldCache.map.clear();
  fieldCache.since = Number.NEGATIVE_INFINITY;
}

const collator = typeof Intl !== "undefined" ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;

function compareTitles(a: string, b: string): number {
  return collator ? collator.compare(a, b) : a.localeCompare(b);
}

/** Split a quick-filter string into lower-case words; every word must appear. */
export function filterWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^#+/, "").trim())
    .filter(Boolean);
}

function isRow(row: MemoryItem | undefined): row is MemoryItem {
  return Boolean(row);
}

/**
 * The default view (everything, newest or oldest first): pinned memories, then one `limit`-bounded
 * key scan of the `createdAt` index — only the visible page is ever read, however big the library.
 */
async function queryByDate(sort: "newest" | "oldest", limit: number): Promise<{ rows: MemoryItem[]; total: number }> {
  const [total, pinnedIds] = await Promise.all([db.items.count(), db.items.where("pinned").equals(1).primaryKeys()]);
  const dir = sort === "oldest" ? 1 : -1;
  const pinnedRows = pinnedIds.length ? (await db.items.bulkGet(pinnedIds)).filter(isRow) : [];
  pinnedRows.sort((a, b) => dir * (a.createdAt - b.createdAt));
  const pinnedPage = pinnedRows.slice(0, limit);
  const room = limit - pinnedPage.length;
  if (room <= 0) return { rows: pinnedPage, total };

  const pinned = new Set(pinnedIds);
  const byDate = db.items.orderBy("createdAt");
  const keys = await (sort === "oldest" ? byDate : byDate.reverse()).limit(room + pinned.size).primaryKeys();
  const restIds = keys.filter((id) => !pinned.has(id)).slice(0, room);
  const rest = restIds.length ? (await db.items.bulkGet(restIds)).filter(isRow) : [];
  return { rows: [...pinnedPage, ...rest], total };
}

/**
 * One page of the library for the given filters: pinned first, then by the chosen order.
 * Only the visible page of items (≤ `limit`) is loaded from IndexedDB.
 */
export async function queryLibrary(q: LibraryQuery): Promise<LibraryResult> {
  const limit = Math.max(0, q.limit);
  if (q.kind === "all" && !q.tag && !filterWords(q.text).length && (q.sort === "newest" || q.sort === "oldest")) {
    const { rows, total } = await queryByDate(q.sort, limit);
    const items = rows.map(toCardItem);
    return { items, chips: await loadChips(items), total };
  }

  const [ordered, kindIds, tagIds, pinnedIds] = await Promise.all([
    db.items.orderBy("createdAt").primaryKeys(),
    q.kind !== "all" ? db.items.where("kind").equals(q.kind).primaryKeys() : Promise.resolve(null),
    q.tag ? db.items.where("tags").equals(q.tag).primaryKeys() : Promise.resolve(null),
    db.items.where("pinned").equals(1).primaryKeys(),
  ]);

  const kindSet = kindIds ? new Set(kindIds) : null;
  const tagSet = tagIds ? new Set(tagIds) : null;
  const words = filterWords(q.text);
  const needsFields = words.length > 0 || q.sort === "title" || q.sort === "largest";
  const fields = needsFields ? await syncFieldCache(ordered) : null;

  // Oldest → newest from the index; flip for "newest" (also the tie-break order for other sorts).
  let ids = q.sort === "oldest" ? ordered.slice() : ordered.slice().reverse();
  ids = ids.filter((id) => {
    if (kindSet && !kindSet.has(id)) return false;
    if (tagSet && !tagSet.has(id)) return false;
    if (words.length) {
      const hay = fields?.get(id)?.haystack ?? "";
      for (const w of words) if (!hay.includes(w)) return false;
    }
    return true;
  });

  if (fields && (q.sort === "title" || q.sort === "largest")) {
    const position = new Map(ids.map((id, i) => [id, i]));
    ids.sort((a, b) => {
      const fa = fields.get(a);
      const fb = fields.get(b);
      const primary =
        q.sort === "title" ? compareTitles(fa?.title ?? "", fb?.title ?? "") : (fb?.size ?? 0) - (fa?.size ?? 0);
      return primary || (position.get(a) ?? 0) - (position.get(b) ?? 0);
    });
  }

  // Pinned first (stable).
  const pinned = new Set(pinnedIds);
  if (pinned.size) ids = [...ids.filter((id) => pinned.has(id)), ...ids.filter((id) => !pinned.has(id))];

  const pageIds = ids.slice(0, limit);
  const rows = pageIds.length ? await db.items.bulkGet(pageIds) : [];
  const items = rows.filter(isRow).map(toCardItem);
  const chips = await loadChips(items);
  return { items, chips, total: ids.length };
}

/** Total + per-kind counts and tag counts, all from index keys (no item values are read). */
export async function queryLibraryStats(): Promise<LibraryStats> {
  const kinds = MEMORY_KINDS;
  const [total, processing, counts, tagKeys] = await Promise.all([
    db.items.count(),
    db.items.where("status").equals("processing").count(),
    Promise.all(kinds.map((k) => db.items.where("kind").equals(k).count())),
    db.items.orderBy("tags").keys(),
  ]);
  const byKind = {} as Record<MemoryKind, number>;
  kinds.forEach((k, i) => (byKind[k] = counts[i]));
  const tagCounts = new Map<string, number>();
  for (const key of tagKeys) {
    if (typeof key !== "string" || !key) continue;
    tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
  }
  const tags = Array.from(tagCounts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || compareTitles(a.tag, b.tag),
  );
  return { total, processing, byKind, tags };
}

// ---------------------------------------------------------------------------------------------
// Related memories
// ---------------------------------------------------------------------------------------------

/** How much a shared entity of each type says about two memories being related. */
const RELATION_WEIGHT: Record<EntityType, number> = {
  phone: 1.6,
  email: 1.6,
  url: 1.3,
  money: 1.2,
  name: 1.2,
  tag: 1.1,
  date: 0.8,
  topic: 0.7,
};

export interface RelatedMemory {
  item: CardItem;
  /** Entities this memory shares with the current one (most telling first). */
  shared: CardChip[];
  score: number;
}

/**
 * Memories sharing the most entities with `item`, weighted so rare, specific things (a phone
 * number, an email) count more than common topics shared by half the library.
 */
export async function queryRelated(item: Pick<MemoryItem, "id" | "entityIds">, limit = 6): Promise<RelatedMemory[]> {
  if (!item.entityIds?.length) return [];
  const entities = (await db.entities.bulkGet(item.entityIds)).filter((e): e is Entity => Boolean(e));
  const scores = new Map<string, { score: number; shared: { chip: CardChip; weight: number }[] }>();
  for (const e of entities) {
    const others = e.itemIds.filter((id) => id !== item.id);
    if (!others.length) continue;
    const weight = (RELATION_WEIGHT[e.type] ?? 1) / Math.log2(1 + e.itemIds.length);
    const chip: CardChip = { id: e.id, type: e.type, value: e.value };
    for (const other of others) {
      const entry = scores.get(other) ?? { score: 0, shared: [] };
      entry.score += weight;
      entry.shared.push({ chip, weight });
      scores.set(other, entry);
    }
  }
  if (!scores.size) return [];
  const top = Array.from(scores, ([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score || b.shared.length - a.shared.length)
    .slice(0, limit * 2);
  const rows = await db.items.bulkGet(top.map((t) => t.id));
  const out: RelatedMemory[] = [];
  top.forEach((t, i) => {
    const row = rows[i];
    if (!row || out.length >= limit) return;
    out.push({
      item: toCardItem(row),
      shared: dedupeChips(t.shared.sort((a, b) => b.weight - a.weight).map((s) => s.chip)),
      score: t.score,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

function reindex(itemId: string): void {
  indexItem(itemId).catch(() => {
    /* the search index re-syncs changed items on its own before the next search */
  });
}

/** Pin or unpin memories (pinned ones float to the top of the library and get a small search boost). */
export async function setPinned(ids: string[], pinned: boolean): Promise<boolean> {
  if (!ids.length) return true;
  const now = Date.now();
  try {
    await db.transaction("rw", db.items, async () => {
      await Promise.all(ids.map((id) => db.items.update(id, { pinned: pinned ? 1 : 0, updatedAt: now })));
    });
  } catch (err) {
    handleStorageError(err, pinned ? "pinning that memory" : "unpinning that memory");
    return false;
  }
  ids.forEach(reindex);
  return true;
}

/** Rename a memory. Empty titles are ignored. */
export async function saveTitle(itemId: string, title: string): Promise<boolean> {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clean) return false;
  try {
    const changed = await db.items.update(itemId, { title: clean, updatedAt: Date.now() });
    if (!changed) return false;
  } catch (err) {
    handleStorageError(err, "renaming this memory");
    return false;
  }
  reindex(itemId);
  return true;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the text itself mentions `#tag` (then the tag entity stays linked even if the user tag goes). */
function textHasHashtag(text: string, normalized: string): boolean {
  if (!text || !normalized) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])#${escapeRegExp(normalized)}(?![\\p{L}\\p{N}_-])`, "iu");
  return re.test(text);
}

/**
 * Replace a memory's user tags. Keeps the knowledge graph in step: tag entities gain or lose the
 * link to this memory (a tag the text itself mentions as #hashtag stays linked).
 * Resolves with the saved tags, or null when saving failed (a toast explains why).
 */
export async function saveTags(itemId: string, input: string[]): Promise<string[] | null> {
  const tags = normalizeTags(input).map((t) => t.slice(0, 40)).filter(Boolean);
  const now = Date.now();
  try {
    await db.transaction("rw", [db.items, db.entities], async () => {
      const item = await db.items.get(itemId);
      if (!item) return;
      const before = new Set(item.tags ?? []);
      const after = new Set(tags);
      const linked = new Set(item.entityIds ?? []);

      for (const tag of after) {
        if (before.has(tag)) continue;
        const normalized = normalizeEntity("tag", tag);
        if (!normalized) continue;
        const id = entityId("tag", normalized);
        const existing = await db.entities.get(id);
        if (existing) {
          if (!existing.itemIds.includes(itemId)) {
            existing.itemIds.push(itemId);
            existing.count += 1;
          }
          existing.lastSeen = now;
          await db.entities.put(existing);
        } else {
          await db.entities.put({ id, type: "tag", value: `#${tag}`, normalized, itemIds: [itemId], count: 1, firstSeen: now, lastSeen: now });
        }
        linked.add(id);
      }

      for (const tag of before) {
        if (after.has(tag)) continue;
        const normalized = normalizeEntity("tag", tag);
        if (!normalized || textHasHashtag(item.text, normalized)) continue;
        const id = entityId("tag", normalized);
        const existing = await db.entities.get(id);
        if (existing) {
          existing.itemIds = existing.itemIds.filter((x) => x !== itemId);
          if (!existing.itemIds.length) await db.entities.delete(id);
          else {
            existing.count = Math.max(existing.itemIds.length, existing.count - 1);
            await db.entities.put(existing);
          }
        }
        linked.delete(id);
      }

      await db.items.update(itemId, { tags, entityIds: Array.from(linked), updatedAt: now });
    });
  } catch (err) {
    handleStorageError(err, "saving tags");
    return null;
  }
  reindex(itemId);
  return tags;
}

// ---------------------------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------------------------

/** Short, friendly words for each processing stage. */
export const STAGE_LABELS: Record<JobStage, string> = {
  queued: "Waiting in line",
  reading: "Opening the file",
  ocr: "Reading the text",
  transcribing: "Transcribing",
  extracting: "Finding names & numbers",
  indexing: "Making it searchable",
  embedding: "Learning what it means",
  done: "Done",
  error: "Couldn't finish",
  cancelled: "Cancelled",
};

/** Compact stage words for small card badges. */
export const STAGE_SHORT: Record<JobStage, string> = {
  queued: "Waiting…",
  reading: "Opening…",
  ocr: "Reading text…",
  transcribing: "Transcribing…",
  extracting: "Finding details…",
  indexing: "Indexing…",
  embedding: "Understanding…",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

/** Filter-chip labels for kinds (plural, short). */
export const KIND_FILTER_LABELS: Record<MemoryKind, string> = {
  image: "Images",
  pdf: "PDFs",
  video: "Videos",
  voice: "Voice",
  text: "Text",
  note: "Notes",
};

/** Small stable hash for decorative, per-item visuals. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A file name for downloading a memory's original. */
export function downloadName(item: Pick<MemoryItem, "title" | "sourceName">, ext: string): string {
  if (item.sourceName) return item.sourceName;
  const base = (item.title || "memory")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "memory"}.${ext.replace(/^\./, "") || "bin"}`;
}

/** Words in a text (cheap whitespace count). */
export function wordCount(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}
