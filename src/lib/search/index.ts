/**
 * Hybrid local search over everything the user has remembered — all in this browser.
 *
 * - Keyword: MiniSearch over text chunks (fields text / title / tags; prefix + typo-tolerant matching).
 *   MiniSearch is imported lazily so it never weighs on first page load.
 * - Meaning: cosine similarity between the query embedding and chunk embeddings (`VectorIndex`), used
 *   when meaning search is on and the local model is ready. Search never waits for the model: until
 *   it's ready, keyword search answers alone and the model warms up in the background.
 * - Fusion: reciprocal-rank fusion of both chunk rankings, aggregated to items, then boosted by what the
 *   question asks for (kind hints, entity intents such as "phone number") and filtered by kind/date.
 *   Questions with no keywords ("phone numbers from last week") list the matching items directly.
 * - Smart answers: the actual phone numbers / amounts / emails / links / dates found in the top results.
 *
 * Indexes live in memory and are rebuilt from IndexedDB on start, in small pages so the UI stays smooth.
 * Before answering, the index cheaply checks whether items were added, changed or deleted elsewhere and
 * refreshes just those, so it stays correct even if a caller forgets `indexItem` / `removeFromIndex`.
 *
 * Embeddings: `embedItem` embeds one item's chunks (ingest calls it after saving); `backfillEmbeddings`
 * catches up on items saved while the model was off or unavailable. Both run automatically again when
 * the model becomes ready or meaning search is switched on.
 */
import type MiniSearch from "minisearch";
import type { SearchResult as MiniSearchResult } from "minisearch";
import { embedQuery, embedTexts, embedderStatus, warmupEmbedder } from "../ai/embedder";
import { EMBEDDING_DIM } from "../config";
import { db } from "../db";
import { parseQuery, tokenize } from "../nlp/query";
import { getSettings, settingsStore } from "../settings";
import { handleStorageError } from "../storage/monitor";
import { createStore } from "../store";
import type {
  Chunk,
  Entity,
  EntityType,
  ItemStatus,
  MemoryItem,
  MemoryKind,
  ParsedQuery,
  SearchHit,
  SearchOptions,
  SearchResponse,
  SmartAnswer,
  Snippet,
} from "../types";
import { truncate } from "../utils";
import {
  SPLIT_RE,
  boostScore,
  contextAround,
  createMatcher,
  entityIdsOfTypes,
  fuseRankings,
  hasEntityType,
  inDateRange,
  indexTerms,
  locateValue,
  makeSnippet,
  orderKeywordChunks,
  processTerm,
  snippetAround,
  type FusedItem,
  type KeywordChunk,
  type TermMatcher,
} from "./rank";
import { VectorIndex, normalize, type VectorMatch } from "./vectors";

export const indexStatus = createStore<{ ready: boolean; building: boolean; chunks: number; vectors: number }>({
  ready: false,
  building: false,
  chunks: 0,
  vectors: 0,
});

/** Lightweight copy of an item's searchable metadata, kept in memory next to the indexes. */
export interface IndexedItem {
  id: string;
  kind: MemoryKind;
  title: string;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  sourceDate?: number;
  pinned: boolean;
  tags: string[];
  entityIds: string[];
}

interface ChunkDoc {
  id: string;
  itemId: string;
  title: string;
  tags: string;
  text: string;
  page?: number;
}

type ChunkIndex = MiniSearch<ChunkDoc>;

// ---------- Tuning ----------

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const ITEM_PAGE = 60;
const CHUNK_PAGE = 400;
/** Keyword chunk hits considered for fusion (deeper ranks add almost nothing to RRF). */
const KEYWORD_DEPTH = 600;
/** Semantic: absolute similarity floor, distance-from-best window, and depth. */
const SEMANTIC_MIN = 0.25;
const SEMANTIC_WINDOW = 0.25;
const SEMANTIC_DEPTH = 120;
/** Re-check IndexedDB for outside changes at most this often. */
const SYNC_INTERVAL_MS = 1500;
const ANSWER_SOURCE_HITS = 8;
const MAX_ANSWERS = 6;
const MAX_SNIPPETS = 2;
const QUERY_CACHE_SIZE = 32;

const NOTE_OFF = "Meaning search is off in settings";
const NOTE_LOADING = "Meaning search is downloading…";
const NOTE_UNAVAILABLE = "Model unavailable — showing keyword matches";
const NOTE_PREPARING = "Meaning search is still preparing your memories";

// ---------- State ----------

const state = {
  /** Bumped by resetIndex(); long-running work started under an older generation stops. */
  gen: 0,
  mini: null as ChunkIndex | null,
  ready: false,
  building: null as Promise<void> | null,
  items: new Map<string, IndexedItem>(),
  itemChunks: new Map<string, string[]>(),
  vectors: new VectorIndex(EMBEDDING_DIM),
  maxUpdatedAt: 0,
  lastSync: 0,
  syncing: null as Promise<void> | null,
};

const queryVectors = new Map<string, Float32Array>();

let MiniSearchClass: (typeof import("minisearch"))["default"] | null = null;

async function loadMiniSearch(): Promise<(typeof import("minisearch"))["default"]> {
  if (!MiniSearchClass) MiniSearchClass = (await import("minisearch")).default;
  return MiniSearchClass;
}

function createChunkIndex(Ctor: (typeof import("minisearch"))["default"]): ChunkIndex {
  return new Ctor<ChunkDoc>({
    fields: ["text", "title", "tags"],
    storeFields: ["itemId", "page"],
    processTerm: (term) => processTerm(term),
    searchOptions: { processTerm: (term) => processTerm(term) },
    autoSuggestOptions: { processTerm: (term) => processTerm(term) },
  });
}

const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const inBrowser = () => typeof window !== "undefined" && typeof indexedDB !== "undefined";

function publishStatus(): void {
  indexStatus.set({
    ready: state.ready,
    building: !state.ready && state.building !== null,
    chunks: state.mini?.documentCount ?? 0,
    vectors: state.vectors.size,
  });
}

function toIndexed(item: MemoryItem): IndexedItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title || "",
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt ?? item.createdAt,
    sourceDate: item.sourceDate,
    pinned: item.pinned === 1,
    tags: Array.isArray(item.tags) ? item.tags : [],
    entityIds: Array.isArray(item.entityIds) ? item.entityIds : [],
  };
}

function rememberItem(item: MemoryItem): void {
  const meta = toIndexed(item);
  state.items.set(item.id, meta);
  if (meta.updatedAt > state.maxUpdatedAt) state.maxUpdatedAt = meta.updatedAt;
}

/** Add chunks whose item is known; replaces chunks already indexed under the same id. */
function addChunks(chunks: Chunk[]): void {
  const mini = state.mini;
  if (!mini) return;
  for (const c of chunks) {
    const meta = state.items.get(c.itemId);
    if (!meta || typeof c.text !== "string") continue;
    const doc: ChunkDoc = { id: c.id, itemId: c.itemId, title: meta.title, tags: meta.tags.join(" "), text: c.text };
    if (c.page !== undefined) doc.page = c.page;
    if (mini.has(c.id)) mini.discard(c.id);
    mini.add(doc);
    let list = state.itemChunks.get(c.itemId);
    if (!list) {
      list = [];
      state.itemChunks.set(c.itemId, list);
    }
    if (!list.includes(c.id)) list.push(c.id);
    if (c.embedding && c.embedding.length === EMBEDDING_DIM) state.vectors.upsert(c.id, c.itemId, c.embedding);
  }
}

/** Forget an item in every in-memory structure. */
function dropItem(itemId: string): void {
  const mini = state.mini;
  const ids = state.itemChunks.get(itemId);
  if (mini && ids) for (const id of ids) if (mini.has(id)) mini.discard(id);
  state.itemChunks.delete(itemId);
  state.vectors.removeItem(itemId);
  state.items.delete(itemId);
}

// ---------- Building & syncing ----------

/** Load all chunks from IndexedDB into the in-memory indexes (idempotent, concurrent-safe). */
export function ensureIndex(): Promise<void> {
  if (state.ready) return Promise.resolve();
  if (state.building) return state.building;
  if (!inBrowser()) return Promise.resolve();
  const gen = state.gen;
  const run = buildIndex(gen)
    .catch((err) => {
      if (gen === state.gen) {
        state.mini = null;
        state.ready = false;
      }
      throw err;
    })
    .finally(() => {
      if (gen === state.gen) {
        state.building = null;
        publishStatus();
      }
    });
  state.building = run;
  publishStatus();
  return run;
}

async function buildIndex(gen: number): Promise<void> {
  const Ctor = await loadMiniSearch();
  if (gen !== state.gen) return;
  state.mini = createChunkIndex(Ctor);
  state.items.clear();
  state.itemChunks.clear();
  state.vectors.clear();
  state.maxUpdatedAt = 0;
  publishStatus();

  // 1) Item metadata (titles, kinds, dates, entity links), page by page.
  let last: string | null = null;
  for (;;) {
    const page: MemoryItem[] =
      last === null
        ? await db.items.orderBy(":id").limit(ITEM_PAGE).toArray()
        : await db.items.where(":id").above(last).limit(ITEM_PAGE).toArray();
    if (gen !== state.gen) return;
    for (const item of page) rememberItem(item);
    if (page.length < ITEM_PAGE) break;
    last = page[page.length - 1].id;
    await yieldToMain();
  }

  // 2) Chunks (text + stored embeddings), page by page.
  last = null;
  for (;;) {
    const page: Chunk[] =
      last === null
        ? await db.chunks.orderBy(":id").limit(CHUNK_PAGE).toArray()
        : await db.chunks.where(":id").above(last).limit(CHUNK_PAGE).toArray();
    if (gen !== state.gen) return;
    const unknown = Array.from(new Set(page.filter((c) => !state.items.has(c.itemId)).map((c) => c.itemId)));
    if (unknown.length) {
      // Saved after step 1 — pick them up now.
      const extra = await db.items.bulkGet(unknown);
      if (gen !== state.gen) return;
      for (const item of extra) if (item) rememberItem(item);
    }
    addChunks(page);
    publishStatus();
    if (page.length < CHUNK_PAGE) break;
    last = page[page.length - 1].id;
    await yieldToMain();
  }

  state.ready = true;
  state.lastSync = Date.now();
  publishStatus();
}

/** The built index; rebuilds if a reset happened while waiting. */
async function readyIndex(): Promise<ChunkIndex> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await ensureIndex();
    if (state.ready && state.mini) return state.mini;
    if (!inBrowser()) break;
  }
  throw new Error("The search index isn't available in this browser.");
}

/**
 * Pick up changes other code made directly in IndexedDB: new, edited (newer `updatedAt`) and deleted
 * items. Costs two index-only queries when nothing changed.
 */
function syncWithDatabase(force = false): Promise<void> {
  if (!state.ready) return Promise.resolve();
  if (state.syncing) return state.syncing;
  if (!force && Date.now() - state.lastSync < SYNC_INTERVAL_MS) return Promise.resolve();
  const gen = state.gen;
  const run = (async () => {
    const [count, newest] = await Promise.all([db.items.count(), db.items.orderBy("updatedAt").reverse().limit(1).keys()]);
    if (gen !== state.gen) return;
    const newestAt = typeof newest[0] === "number" ? newest[0] : 0;
    const changed: MemoryItem[] = newestAt > state.maxUpdatedAt ? await db.items.where("updatedAt").above(state.maxUpdatedAt).toArray() : [];
    if (gen !== state.gen) return;

    const fresh = changed.filter((it) => !state.items.has(it.id)).length;
    let removed: string[] = [];
    if (count !== state.items.size + fresh) {
      const keys = new Set((await db.items.toCollection().primaryKeys()) as string[]);
      if (gen !== state.gen) return;
      removed = Array.from(state.items.keys()).filter((id) => !keys.has(id));
      const changedIds = new Set(changed.map((it) => it.id));
      const missing = Array.from(keys).filter((id) => !state.items.has(id) && !changedIds.has(id));
      if (missing.length) {
        const extra = await db.items.bulkGet(missing);
        if (gen !== state.gen) return;
        for (const it of extra) if (it) changed.push(it);
      }
    }
    for (const id of removed) dropItem(id);
    if (changed.length) await refreshItems(changed, gen);
    state.lastSync = Date.now();
    publishStatus();
  })()
    .catch((err) => console.warn("[remembos] search index sync failed", err))
    .finally(() => {
      state.syncing = null;
    });
  state.syncing = run;
  return run;
}

/** Re-index items (metadata + chunks) from fresh database rows. */
async function refreshItems(items: MemoryItem[], gen: number): Promise<void> {
  for (let i = 0; i < items.length; i += 100) {
    const batch = items.slice(i, i + 100);
    const chunks = await db.chunks
      .where("itemId")
      .anyOf(batch.map((it) => it.id))
      .toArray();
    if (gen !== state.gen || !state.mini) return;
    for (const it of batch) {
      dropItem(it.id);
      rememberItem(it);
    }
    addChunks(chunks);
    if (i + 100 < items.length) await yieldToMain();
  }
}

/** (Re)index one item's chunks + embeddings after it was saved/updated. */
export async function indexItem(itemId: string): Promise<void> {
  await readyIndex();
  const gen = state.gen;
  const [item, chunks] = await Promise.all([db.items.get(itemId), db.chunks.where("itemId").equals(itemId).toArray()]);
  if (gen !== state.gen || !state.mini) return; // reset meanwhile: the next build reads it from the database
  dropItem(itemId);
  if (item) {
    rememberItem(item);
    addChunks(chunks);
  }
  publishStatus();
}

/** Remove items from in-memory indexes (after deletion). */
export function removeFromIndex(itemIds: string[]): void {
  for (const id of itemIds) dropItem(id);
  publishStatus();
}

/** Drop all in-memory indexes (after clear-all / import). Next search rebuilds. */
export function resetIndex(): void {
  state.gen++;
  state.mini = null;
  state.ready = false;
  state.building = null;
  state.syncing = null;
  state.items.clear();
  state.itemChunks.clear();
  state.vectors.clear();
  state.maxUpdatedAt = 0;
  state.lastSync = 0;
  queryVectors.clear();
  indexStatus.set({ ready: false, building: false, chunks: 0, vectors: 0 });
}

// ---------- Query understanding ----------

function understand(raw: string): ParsedQuery {
  try {
    return parseQuery(raw);
  } catch (err) {
    console.warn("[remembos] query parsing failed; using plain keywords", err);
    const text = raw.trim();
    return { raw, keywords: text, semantic: text, intents: [], kindHints: [] };
  }
}

function queryWords(text: string): string[] {
  if (!text.trim()) return [];
  try {
    return tokenize(text);
  } catch {
    return text.toLowerCase().split(SPLIT_RE).filter(Boolean);
  }
}

// ---------- Search ----------

interface RankedItem {
  itemId: string;
  score: number;
  fused?: FusedItem;
  entity: boolean;
}

/** Answer a natural-language query from local data. Builds the index on first call. */
export async function search(raw: string, opts: SearchOptions = {}): Promise<SearchResponse> {
  const started = now();
  const query = understand(raw);
  const empty = (): SearchResponse => ({ query, hits: [], answers: [], tookMs: Math.round(now() - started), semanticUsed: false });
  if (!raw.trim()) return empty();

  const mini = await readyIndex();
  await syncWithDatabase();

  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
  const range = opts.dateRange ?? query.dateRange;
  const kinds = opts.kinds?.length ? new Set(opts.kinds) : null;
  const intents = new Set<EntityType>(query.intents);
  const kindHints = new Set<MemoryKind>(query.kindHints);
  const keywords = query.keywords.trim();

  const passes = (itemId: string): boolean => {
    const meta = state.items.get(itemId);
    if (!meta) return false;
    if (kinds && !kinds.has(meta.kind)) return false;
    if (range && !inDateRange(meta.createdAt, meta.sourceDate, range)) return false;
    return true;
  };

  let ranked: RankedItem[];
  let semanticUsed = false;
  let semanticNote: string | undefined;

  if (!keywords && (intents.size || range || kindHints.size)) {
    // "phone numbers from last week", "screenshots from yesterday": list what matches, newest first.
    ranked = browseItems(passes, intents, kindHints);
  } else {
    const keywordHits = keywords ? keywordSearch(mini, keywords, passes) : [];
    const semantic = await semanticSearch(query.semantic.trim() || keywords, opts, passes);
    semanticUsed = semantic.used;
    semanticNote = semantic.note;
    const fused = fuseRankings(keywordHits, semantic.matches);
    ranked = [];
    for (const f of fused.values()) {
      const meta = state.items.get(f.itemId);
      if (!meta) continue;
      const entity = hasEntityType(meta.entityIds, intents);
      const score = boostScore(f.score, { kindHint: kindHints.has(meta.kind), intent: entity, pinned: meta.pinned });
      ranked.push({ itemId: f.itemId, score, fused: f, entity });
    }
    ranked.sort((a, b) => b.score - a.score);
  }

  const top = ranked.slice(0, limit);
  const fetched = await db.items.bulkGet(top.map((r) => r.itemId));
  const hits: SearchHit[] = [];
  const hitRanks: RankedItem[] = [];
  top.forEach((r, i) => {
    const item = fetched[i];
    if (!item) return;
    // Re-check filters on the fresh row in case it changed since it was indexed.
    if (kinds && !kinds.has(item.kind)) return;
    if (range && !inDateRange(item.createdAt, item.sourceDate, range)) return;
    const matched: SearchHit["matched"] = [];
    if (r.fused?.keyword) matched.push("keyword");
    if (r.fused?.semantic) matched.push("semantic");
    if (r.entity) matched.push("entity");
    hits.push({ item, score: r.score, snippets: [], matched });
    hitRanks.push(r);
  });

  const topScore = hits.length ? hits[0].score : 1;
  for (const h of hits) h.score = Math.round((h.score / (topScore || 1)) * 10_000) / 10_000;

  const entities = intents.size ? await loadIntentEntities(hits, intents) : new Map<string, Entity>();
  await attachSnippets(hits, hitRanks, keywords, intents, entities);
  const answers = intents.size ? smartAnswers(hits.slice(0, ANSWER_SOURCE_HITS), intents, entities) : [];

  return {
    query,
    hits,
    answers,
    tookMs: Math.round(now() - started),
    semanticUsed,
    ...(semanticNote ? { semanticNote } : {}),
  };
}

function keywordSearch(mini: ChunkIndex, keywords: string, passes: (itemId: string) => boolean): KeywordChunk[] {
  const termCount = indexTerms(keywords).length;
  if (!termCount) return [];
  const results = mini.search(keywords, {
    prefix: (term) => term.length >= 3,
    fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
    boost: { title: 2, tags: 1.5 },
    combineWith: "OR",
    filter: (r) => passes(r.itemId as string),
  });
  const hits: KeywordChunk[] = results.map((r: MiniSearchResult) => ({
    id: r.id as string,
    itemId: r.itemId as string,
    page: typeof r.page === "number" ? r.page : undefined,
    score: r.score,
    queryTerms: r.queryTerms,
    terms: r.terms,
    textMatch: Object.values(r.match).some((fields) => fields.includes("text")),
  }));
  return orderKeywordChunks(hits, termCount).slice(0, KEYWORD_DEPTH);
}

async function semanticSearch(
  text: string,
  opts: SearchOptions,
  passes: (itemId: string) => boolean,
): Promise<{ matches: VectorMatch[]; used: boolean; note?: string }> {
  if (opts.semantic === false || !text) return { matches: [], used: false };
  if (!getSettings().semanticSearch) return { matches: [], used: false, note: NOTE_OFF };
  if (!state.mini?.documentCount) return { matches: [], used: false }; // nothing to search yet

  if (embedderStatus.get().state !== "ready") {
    // Never wait for the model: answer with keywords now, get meaning search ready for next time.
    warmupEmbedder({ allowDownload: true });
    const after = embedderStatus.get().state;
    if (after === "error") return { matches: [], used: false, note: NOTE_UNAVAILABLE };
    if (after === "disabled") return { matches: [], used: false, note: NOTE_OFF };
    return { matches: [], used: false, note: NOTE_LOADING };
  }
  if (state.vectors.size === 0) {
    void backfillEmbeddings();
    return { matches: [], used: false, note: NOTE_PREPARING };
  }
  try {
    const q = await queryVector(text);
    const matches = state.vectors.search(q, {
      minScore: SEMANTIC_MIN,
      window: SEMANTIC_WINDOW,
      limit: SEMANTIC_DEPTH,
      filter: passes,
    });
    return { matches, used: true };
  } catch {
    return { matches: [], used: false, note: NOTE_UNAVAILABLE };
  }
}

async function queryVector(text: string): Promise<Float32Array> {
  const key = text.trim().toLowerCase();
  const cached = queryVectors.get(key);
  if (cached) {
    queryVectors.delete(key);
    queryVectors.set(key, cached);
    return cached;
  }
  const vector = await embedQuery(text);
  queryVectors.set(key, vector);
  if (queryVectors.size > QUERY_CACHE_SIZE) queryVectors.delete(queryVectors.keys().next().value as string);
  return vector;
}

/** Items matching only filters/intents (no keywords), newest first; hinted kinds first. */
function browseItems(passes: (itemId: string) => boolean, intents: Set<EntityType>, kindHints: Set<MemoryKind>): RankedItem[] {
  let list: IndexedItem[] = [];
  for (const meta of state.items.values()) {
    if (meta.status !== "ready" || !passes(meta.id)) continue;
    if (intents.size && !hasEntityType(meta.entityIds, intents)) continue;
    list.push(meta);
  }
  if (kindHints.size) {
    const hinted = list.filter((m) => kindHints.has(m.kind));
    if (hinted.length) list = hinted;
  }
  const when = (m: IndexedItem) => m.sourceDate ?? m.createdAt;
  list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || when(b) - when(a));
  return list.map((m, i) => ({ itemId: m.id, score: 1 / (1 + i * 0.02), entity: intents.size > 0 }));
}

// ---------- Snippets & answers ----------

async function loadIntentEntities(hits: SearchHit[], intents: Set<EntityType>): Promise<Map<string, Entity>> {
  const ids = new Set<string>();
  for (const h of hits) for (const id of entityIdsOfTypes(h.item.entityIds ?? [], intents)) ids.add(id);
  const map = new Map<string, Entity>();
  if (!ids.size) return map;
  const list = await db.entities.bulkGet(Array.from(ids));
  for (const e of list) if (e) map.set(e.id, e);
  return map;
}

async function attachSnippets(
  hits: SearchHit[],
  ranks: RankedItem[],
  keywords: string,
  intents: Set<EntityType>,
  entities: Map<string, Entity>,
): Promise<void> {
  const words = queryWords(keywords);
  const wanted = new Map<number, { id: string; focus: boolean; terms: string[] }[]>();
  const browseIds: string[] = [];

  hits.forEach((hit, i) => {
    const fused = ranks[i].fused;
    if (!fused) {
      browseIds.push(hit.item.id);
      return;
    }
    const picks: { id: string; focus: boolean; terms: string[] }[] = [];
    const textual = fused.chunks.filter((c) => c.keyword?.textMatch);
    const semanticOnly = fused.chunks.filter((c) => !c.keyword && c.semanticScore !== undefined);
    const best = fused.chunks[0];
    if (best.keyword?.textMatch) picks.push({ id: best.id, focus: true, terms: best.keyword.terms });
    else if (best.semanticScore !== undefined) picks.push({ id: best.id, focus: false, terms: best.keyword?.terms ?? [] });
    else if (textual.length) picks.push({ id: textual[0].id, focus: true, terms: textual[0].keyword?.terms ?? [] });
    else if (semanticOnly.length) picks.push({ id: semanticOnly[0].id, focus: false, terms: [] });
    else picks.push({ id: lowestChunk(fused), focus: false, terms: best.keyword?.terms ?? [] }); // title/tag-only match
    for (const c of textual) {
      if (picks.length >= MAX_SNIPPETS) break;
      if (!picks.some((p) => p.id === c.id)) picks.push({ id: c.id, focus: true, terms: c.keyword?.terms ?? [] });
    }
    wanted.set(i, picks);
  });

  const chunkIds = Array.from(new Set(Array.from(wanted.values()).flatMap((p) => p.map((x) => x.id))));
  const [chunkRows, browseChunks] = await Promise.all([
    chunkIds.length ? db.chunks.bulkGet(chunkIds) : Promise.resolve([] as (Chunk | undefined)[]),
    browseIds.length && intents.size ? db.chunks.where("itemId").anyOf(browseIds).toArray() : Promise.resolve([] as Chunk[]),
  ]);
  const chunks = new Map<string, Chunk>();
  for (const c of chunkRows) if (c) chunks.set(c.id, c);
  const byItem = new Map<string, Chunk[]>();
  for (const c of browseChunks) {
    const list = byItem.get(c.itemId) ?? [];
    list.push(c);
    byItem.set(c.itemId, list);
  }

  hits.forEach((hit, i) => {
    const picks = wanted.get(i);
    if (picks) {
      for (const p of picks) {
        const chunk = chunks.get(p.id);
        if (!chunk) continue;
        const matcher: TermMatcher = createMatcher(words, p.terms);
        hit.snippets.push(makeSnippet(chunk, matcher, p.focus));
      }
    } else {
      const s = intentSnippet(hit.item, byItem.get(hit.item.id) ?? [], intents, entities);
      if (s) hit.snippets.push(s);
    }
    if (!hit.snippets.length) hit.snippets.push(summarySnippet(hit.item));
  });
}

function lowestChunk(fused: FusedItem): string {
  let best = fused.chunks[0].id;
  let bestIndex = Infinity;
  for (const c of fused.chunks) {
    const idx = Number(c.id.slice(c.id.lastIndexOf(":") + 1));
    if (Number.isFinite(idx) && idx < bestIndex) {
      bestIndex = idx;
      best = c.id;
    }
  }
  return best;
}

/** For "phone numbers…" style queries: the chunk around the first value of the wanted type. */
function intentSnippet(item: MemoryItem, chunks: Chunk[], intents: Set<EntityType>, entities: Map<string, Entity>): Snippet | null {
  if (!intents.size || !chunks.length) return null;
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  for (const id of entityIdsOfTypes(item.entityIds ?? [], intents)) {
    const e = entities.get(id);
    if (!e) continue;
    for (const c of sorted) {
      const at = locateValue(c.text, e.value, e.type, e.normalized);
      if (at) return snippetAround(c, at);
    }
  }
  return null;
}

function summarySnippet(item: MemoryItem): Snippet {
  const text = item.summary || truncate((item.text || "").replace(/\s+/g, " ").trim(), 220);
  return { chunkId: `${item.id}:0`, text, highlights: [] };
}

function smartAnswers(hits: SearchHit[], intents: Set<EntityType>, entities: Map<string, Entity>): SmartAnswer[] {
  const out: SmartAnswer[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const item = hit.item;
    for (const id of entityIdsOfTypes(item.entityIds ?? [], intents)) {
      if (out.length >= MAX_ANSWERS) return out;
      if (seen.has(id)) continue;
      const e = entities.get(id);
      if (!e) continue;
      seen.add(id);
      const at = locateValue(item.text || "", e.value, e.type, e.normalized);
      const context = at ? contextAround(item.text, at.index, at.length, 120) : truncate(item.summary || "", 120);
      out.push({ type: e.type, value: e.value, itemId: item.id, itemTitle: item.title, itemKind: item.kind, context });
    }
  }
  return out;
}

// ---------- Suggestions ----------

const SUGGEST_ENTITY_TYPES: EntityType[] = ["name", "tag", "topic", "email", "url"];

/** Autocomplete suggestions for the search box. */
export async function suggest(prefix: string, limit = 8): Promise<string[]> {
  const q = prefix.trim();
  if (q.length < 2 || !inBrowser()) return [];
  const mini = await readyIndex();
  const lower = q.toLowerCase();

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const key = s.toLowerCase();
    if (!s || seen.has(key) || key === lower) return;
    seen.add(key);
    out.push(s);
  };

  // Names, tags and topics found in memories that start with what was typed.
  try {
    const ents = await db.entities
      .where("id")
      .startsWithAnyOfIgnoreCase(SUGGEST_ENTITY_TYPES.map((t) => `${t}:${lower}`))
      .limit(40)
      .toArray();
    ents.sort((a, b) => b.itemIds.length - a.itemIds.length || b.count - a.count);
    for (const e of ents.slice(0, Math.ceil(limit / 2))) add(e.value);
  } catch {
    /* entity lookup is a nice-to-have */
  }

  for (const s of mini.autoSuggest(q, { prefix: true, fuzzy: (term) => (term.length >= 5 ? 0.2 : false), boost: { title: 2 } })) {
    if (out.length >= limit) break;
    add(s.suggestion);
  }
  return out.slice(0, limit);
}

// ---------- Embeddings ----------

const EMBED_BATCH = 16;
const embedRuns = new Map<string, Promise<"done" | "skipped">>();

/** The model itself is unavailable (disabled, offline, failed) — stops the backfill until later. */
class ModelUnavailableError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ModelUnavailableError";
  }
}

/** Saving vectors failed (disk full, database closed…) — also stops the backfill. Keeps the cause in `inner`. */
class VectorSaveError extends Error {
  readonly inner: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "VectorSaveError";
    this.inner = cause;
  }
}

function embedInput(title: string, text: string): string {
  return title ? `${title}\n${text}` : text;
}

const hasVector = (c: Chunk) => !!c.embedding && c.embedding.length === EMBEDDING_DIM;

/**
 * Embed all chunks of one item with the local model, store vectors on the chunks, set item.embedded=1,
 * and update the in-memory vector index. Rejects if the model is disabled/unavailable — callers
 * (ingest) must catch: an item without embeddings is still keyword-searchable.
 */
export async function embedItem(itemId: string, onProgress?: (p: number) => void): Promise<void> {
  await queueEmbed(itemId, { onProgress, onlyReady: false });
}

/** One embedding run per item at a time; a new request waits for the running one, then catches up. */
function queueEmbed(itemId: string, opts: { onProgress?: (p: number) => void; onlyReady: boolean }): Promise<"done" | "skipped"> {
  const previous = embedRuns.get(itemId);
  const run = (previous ? previous.catch(() => "skipped" as const) : Promise.resolve("skipped" as const)).then(() =>
    runEmbedItem(itemId, opts),
  );
  embedRuns.set(itemId, run);
  const cleanup = () => {
    if (embedRuns.get(itemId) === run) embedRuns.delete(itemId);
  };
  run.then(cleanup, cleanup);
  return run;
}

async function runEmbedItem(itemId: string, opts: { onProgress?: (p: number) => void; onlyReady: boolean }): Promise<"done" | "skipped"> {
  if (!getSettings().semanticSearch) throw new ModelUnavailableError(new Error("semantic-disabled"));
  const item = await db.items.get(itemId);
  if (!item) return "skipped"; // deleted meanwhile
  if (opts.onlyReady && item.status !== "ready") return "skipped";
  const chunks = (await db.chunks.where("itemId").equals(itemId).toArray()).sort((a, b) => a.index - b.index);
  const todo = chunks.filter((c) => !hasVector(c));
  opts.onProgress?.(0);

  const vectors = new Map<string, { text: string; vector: Float32Array }>();
  for (let i = 0; i < todo.length; i += EMBED_BATCH) {
    const batch = todo.slice(i, i + EMBED_BATCH);
    let out: Float32Array[];
    try {
      out = await embedTexts(batch.map((c) => embedInput(item.title, c.text)));
    } catch (err) {
      throw new ModelUnavailableError(err);
    }
    batch.forEach((c, j) => vectors.set(c.id, { text: c.text, vector: out[j] }));
    opts.onProgress?.(Math.min(0.99, (i + batch.length) / todo.length));
  }

  // Save onto chunks that still exist unchanged (the item may have been edited while we worked).
  const saved: Chunk[] = [];
  let complete = true;
  try {
    await db.transaction("rw", db.items, db.chunks, async () => {
      const current = await db.chunks.where("itemId").equals(itemId).toArray();
      const updates: Chunk[] = [];
      for (const c of current) {
        const v = vectors.get(c.id);
        if (v && v.text === c.text) {
          c.embedding = v.vector;
          updates.push(c);
        } else if (!hasVector(c)) {
          complete = false;
        }
        if (hasVector(c)) saved.push(c);
      }
      if (updates.length) await db.chunks.bulkPut(updates);
      if (complete) await db.items.update(itemId, { embedded: 1 });
    });
  } catch (err) {
    handleStorageError(err, "Saving meaning-search data");
    throw new VectorSaveError(err);
  }

  if (state.mini && state.items.has(itemId)) {
    for (const c of saved) state.vectors.upsert(c.id, itemId, c.embedding as Float32Array);
    publishStatus();
  }
  opts.onProgress?.(1);
  return "done";
}

let backfillRun: Promise<void> | null = null;

/**
 * Embed chunks of items with embedded=0 in the background (e.g. model was off/loading during import).
 * Safe to call repeatedly; runs one pass at a time.
 */
export function backfillEmbeddings(): Promise<void> {
  if (backfillRun) return backfillRun;
  if (!inBrowser()) return Promise.resolve();
  const run = runBackfill()
    .catch((err) => console.warn("[remembos] background embedding stopped", err))
    .finally(() => {
      if (backfillRun === run) backfillRun = null;
    });
  backfillRun = run;
  return run;
}

async function runBackfill(): Promise<void> {
  const attempted = new Set<string>();
  for (;;) {
    if (!getSettings().semanticSearch) return;
    const ids = (await db.items.where("embedded").equals(0).primaryKeys()) as string[];
    const todo = ids.filter((id) => !attempted.has(id));
    if (!todo.length) return;
    for (const id of todo) {
      attempted.add(id);
      if (!getSettings().semanticSearch) return;
      try {
        await queueEmbed(id, { onlyReady: true });
      } catch (err) {
        if (err instanceof ModelUnavailableError || err instanceof VectorSaveError) return; // try again later
        console.warn("[remembos] couldn't prepare meaning search for one memory", err);
      }
      await yieldToMain();
    }
  }
}

// ---------- Exports for the knowledge graph ----------

/** Metadata of every indexed item (fresh: syncs with the database first). */
export async function getIndexedItems(): Promise<IndexedItem[]> {
  await readyIndex();
  await syncWithDatabase(true);
  return Array.from(state.items.values());
}

/** Normalised mean embedding per item ("what it's about"), for items that have embeddings. */
export async function getItemVectors(itemIds: Iterable<string>): Promise<Map<string, Float32Array>> {
  await readyIndex();
  const out = new Map<string, Float32Array>();
  for (const id of itemIds) {
    const v = state.vectors.itemMean(id);
    if (v) out.set(id, normalize(v));
  }
  return out;
}

// ---------- Background triggers ----------

if (typeof window !== "undefined") {
  // When the model becomes ready (or meaning search is switched on), catch up on unembedded memories.
  let modelState = embedderStatus.get().state;
  embedderStatus.subscribe(() => {
    const next = embedderStatus.get().state;
    if (next === "ready" && modelState !== "ready") void backfillEmbeddings();
    modelState = next;
  });
  let semanticOn = settingsStore.get().semanticSearch;
  settingsStore.subscribe(() => {
    const on = settingsStore.get().semanticSearch;
    if (on && !semanticOn) void backfillEmbeddings();
    semanticOn = on;
  });
}
