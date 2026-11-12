/**
 * Pure ranking and presentation helpers for hybrid search — no DOM, no database, easy to test.
 *
 * - Term normalisation shared by the keyword index and the highlighter (lowercase, accents folded,
 *   very common words dropped), using the same token boundaries as MiniSearch.
 * - AND-aware ordering of keyword hits, reciprocal-rank fusion (RRF) of keyword + meaning rankings,
 *   aggregation from chunks to items, and query-driven boosts.
 * - Snippets with highlight ranges, and short context windows around found values (smart answers).
 */
import type { DateRange, EntityType, Snippet } from "../types";

// ---------- Terms ----------

/** Token separators — identical to MiniSearch's default tokenizer (whitespace + punctuation). */
export const SPLIT_RE = /[\n\r\p{Z}\p{P}]+/u;
const TOKEN_SOURCE = "[^\\n\\r\\p{Z}\\p{P}]+";
const NON_ASCII = /[^\x00-\x7f]/;
const MARKS = /\p{M}+/gu;

/** Very common English words: not worth indexing or highlighting. */
const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our " +
    "she so than that the their them then there these they this to was we were what when where which who will with " +
    "you your"
  ).split(" "),
);

/** Lowercase and fold accents ("Café" → "cafe"). Cheap for plain ASCII. */
export function normalizeTerm(term: string): string {
  const lower = term.toLowerCase();
  return NON_ASCII.test(lower) ? lower.normalize("NFD").replace(MARKS, "") : lower;
}

/** MiniSearch `processTerm`: normalised term, or null to skip stopwords/empties. */
export function processTerm(term: string): string | null {
  const t = normalizeTerm(term);
  if (!t || STOPWORDS.has(t)) return null;
  return t;
}

/** Distinct processed terms of a query, as the keyword index sees them. */
export function indexTerms(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(SPLIT_RE)) {
    const t = raw ? processTerm(raw) : null;
    if (t) out.add(t);
  }
  return Array.from(out);
}

// ---------- Keyword ordering ----------

export interface KeywordChunk {
  id: string;
  itemId: string;
  page?: number;
  /** MiniSearch BM25 score. */
  score: number;
  /** Query terms this chunk matched (processed). */
  queryTerms: string[];
  /** Document terms that matched (incl. prefix / typo expansions). */
  terms: string[];
  /** True when at least one term matched the chunk text itself (not just the item title/tags). */
  textMatch: boolean;
}

/**
 * Order keyword hits so chunks matching *all* query terms rank above chunks matching only some
 * (the search itself is OR-combined so partial matches still show up).
 */
export function orderKeywordChunks<T extends KeywordChunk>(hits: T[], termCount: number): T[] {
  const scored = hits.map((h) => {
    let s = h.score;
    if (termCount > 1) {
      const coverage = Math.min(1, new Set(h.queryTerms).size / termCount);
      const f = 0.35 + 0.65 * coverage;
      s *= f * f;
    }
    return { h, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.h);
}

// ---------- Fusion ----------

export interface SemanticChunk {
  chunkId: string;
  itemId: string;
  score: number;
}

export interface FusedChunk {
  id: string;
  /** Fused RRF score of this chunk. */
  score: number;
  keyword?: KeywordChunk;
  semanticScore?: number;
}

export interface FusedItem {
  itemId: string;
  score: number;
  /** Matched chunks, best first. */
  chunks: FusedChunk[];
  keyword: boolean;
  semantic: boolean;
}

export const RRF_K = 60;
const MULTI_HIT_STEP = 0.08;
const MULTI_HIT_CAP = 0.3;

/**
 * Rank positions that count *items*, not chunks: every chunk of an item shares the position of the
 * item's first chunk in the list. Without this, one long document matching in 40 chunks would push
 * every other memory 40 places down.
 */
export function itemDenseRanks(list: { id: string; itemId: string }[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const itemRank = new Map<string, number>();
  for (const entry of list) {
    let r = itemRank.get(entry.itemId);
    if (r === undefined) {
      r = itemRank.size + 1;
      itemRank.set(entry.itemId, r);
    }
    if (!ranks.has(entry.id)) ranks.set(entry.id, r);
  }
  return ranks;
}

/**
 * Reciprocal-rank fusion of keyword and semantic chunk rankings (both best first), aggregated to items:
 * item score = best chunk score × (1 + small bonus per additional matching chunk).
 */
export function fuseRankings(keyword: KeywordChunk[], semantic: SemanticChunk[], k = RRF_K): Map<string, FusedItem> {
  const kwRanks = itemDenseRanks(keyword);
  const semRanks = itemDenseRanks(semantic.map((s) => ({ id: s.chunkId, itemId: s.itemId })));
  const chunks = new Map<string, FusedChunk & { itemId: string }>();

  for (const hit of keyword) {
    if (chunks.has(hit.id)) continue;
    chunks.set(hit.id, { id: hit.id, itemId: hit.itemId, score: 1 / (k + (kwRanks.get(hit.id) as number)), keyword: hit });
  }
  for (const s of semantic) {
    const add = 1 / (k + (semRanks.get(s.chunkId) as number));
    const existing = chunks.get(s.chunkId);
    if (existing) {
      if (existing.semanticScore === undefined) {
        existing.score += add;
        existing.semanticScore = s.score;
      }
    } else {
      chunks.set(s.chunkId, { id: s.chunkId, itemId: s.itemId, score: add, semanticScore: s.score });
    }
  }

  const items = new Map<string, FusedItem>();
  for (const c of chunks.values()) {
    let it = items.get(c.itemId);
    if (!it) {
      it = { itemId: c.itemId, score: 0, chunks: [], keyword: false, semantic: false };
      items.set(c.itemId, it);
    }
    it.chunks.push({ id: c.id, score: c.score, keyword: c.keyword, semanticScore: c.semanticScore });
    if (c.keyword) it.keyword = true;
    if (c.semanticScore !== undefined) it.semantic = true;
  }
  for (const it of items.values()) {
    it.chunks.sort((a, b) => b.score - a.score);
    // Title-only keyword matches repeat on every chunk of an item, so they don't count as extra hits.
    const hits = it.chunks.filter((c) => c.keyword?.textMatch || c.semanticScore !== undefined).length;
    const bonus = Math.min(MULTI_HIT_CAP, MULTI_HIT_STEP * Math.max(0, hits - 1));
    it.score = it.chunks[0].score * (1 + bonus);
  }
  return items;
}

// ---------- Boosts & filters ----------

export const BOOSTS = {
  /** The query hints at this kind ("…in the screenshot"). */
  kindHint: 1.25,
  /** The item contains what the query asks for ("phone number" → has a phone entity). */
  intent: 1.4,
  /** Pinned by the user. */
  pinned: 1.05,
} as const;

export function boostScore(score: number, f: { kindHint?: boolean; intent?: boolean; pinned?: boolean }): number {
  let s = score;
  if (f.kindHint) s *= BOOSTS.kindHint;
  if (f.intent) s *= BOOSTS.intent;
  if (f.pinned) s *= BOOSTS.pinned;
  return s;
}

/** An item is in range when either its original file date or the date it was added falls inside. */
export function inDateRange(createdAt: number, sourceDate: number | undefined, range: DateRange): boolean {
  const inside = (t: number | undefined) => typeof t === "number" && t >= range.from && t < range.to;
  return inside(sourceDate) || inside(createdAt);
}

/** True if any of the entity ids (`type:normalized`) is of one of the given types. */
export function hasEntityType(entityIds: readonly string[], types: ReadonlySet<EntityType>): boolean {
  if (!types.size) return false;
  for (const id of entityIds) {
    const colon = id.indexOf(":");
    if (colon > 0 && types.has(id.slice(0, colon) as EntityType)) return true;
  }
  return false;
}

/** Entity ids of the given types, in their original order. */
export function entityIdsOfTypes(entityIds: readonly string[], types: ReadonlySet<EntityType>): string[] {
  return entityIds.filter((id) => {
    const colon = id.indexOf(":");
    return colon > 0 && types.has(id.slice(0, colon) as EntityType);
  });
}

// ---------- Highlights & snippets ----------

export interface TermMatcher {
  /** Normalised words that match exactly. */
  exact: Set<string>;
  /** Normalised query words (≥ 3 chars) that also match as a word prefix ("inv" → "invoice"). */
  prefixes: string[];
}

/**
 * Build a matcher from the user's query words (prefix-aware) and the document terms the keyword
 * index reported as matched (which already include typo-tolerant and prefix expansions).
 */
export function createMatcher(queryWords: Iterable<string>, docTerms: Iterable<string> = []): TermMatcher {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const w of queryWords) {
    const n = normalizeTerm(w.trim());
    if (!n || STOPWORDS.has(n)) continue;
    exact.add(n);
    if (n.length >= 3 && !prefixes.includes(n)) prefixes.push(n);
  }
  for (const d of docTerms) {
    const n = normalizeTerm(d);
    if (n) exact.add(n);
  }
  return { exact, prefixes };
}

function tokenMatches(token: string, m: TermMatcher): boolean {
  if (m.exact.has(token)) return true;
  for (const p of m.prefixes) if (token.length > p.length && token.startsWith(p)) return true;
  return false;
}

/** Ranges of whole words in `text` that match the matcher (max `cap` ranges). */
export function findHighlights(text: string, m: TermMatcher, cap = 200): [number, number][] {
  const out: [number, number][] = [];
  if (!text || (!m.exact.size && !m.prefixes.length)) return out;
  const re = new RegExp(TOKEN_SOURCE, "gu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) && out.length < cap) {
    if (tokenMatches(normalizeTerm(match[0]), m)) out.push([match.index, match.index + match[0].length]);
  }
  return out;
}

export const SNIPPET_CHARS = 220;
/** Characters of context shown before the first highlighted word of a window. */
const SNIPPET_LEAD = 48;
/** How far we look for a word boundary when trimming a window edge. */
const EDGE_SLACK = 24;
const WS = /\s/;

/** Choose a window start that shows the most distinct highlighted words. */
export function bestWindowStart(text: string, highlights: [number, number][], maxLen = SNIPPET_CHARS): number {
  if (!highlights.length || text.length <= maxLen) return 0;
  let best = -1;
  let bestStart = 0;
  let first = 0;
  for (let i = 0; i < highlights.length; i++) {
    const start = Math.max(0, highlights[i][0] - SNIPPET_LEAD);
    const end = start + maxLen;
    while (first < highlights.length && highlights[first][0] < start) first++;
    const distinct = new Set<string>();
    let count = 0;
    for (let j = first; j < highlights.length && highlights[j][1] <= end; j++) {
      distinct.add(normalizeTerm(text.slice(highlights[j][0], highlights[j][1])));
      count++;
    }
    const score = distinct.size * 100 + count;
    if (score > best) {
      best = score;
      bestStart = start;
    }
  }
  return bestStart;
}

/**
 * Cut a readable window out of `text` starting near `start`: trimmed at word boundaries, whitespace
 * collapsed, "…" where text was cut, and highlight ranges remapped into the window.
 */
export function windowText(
  text: string,
  start: number,
  highlights: [number, number][] = [],
  maxLen = SNIPPET_CHARS,
): { text: string; highlights: [number, number][] } {
  const len = text.length;
  let s = Math.max(0, Math.min(start, len));
  let e = Math.min(len, s + maxLen);
  if (e === len) s = Math.max(0, len - maxLen);

  const inWindow = highlights.filter(([a, b]) => a >= s && b <= e);
  if (s > 0) {
    // Start at the next word, but never skip past the first highlighted word.
    const limit = Math.min(e, s + EDGE_SLACK, inWindow.length ? inWindow[0][0] : e);
    for (let i = s; i < limit; i++) {
      if (WS.test(text[i])) {
        s = i + 1;
        break;
      }
    }
  }
  if (e < len) {
    // End after the last whole word, but keep the last highlighted word.
    const floor = Math.max(s, e - EDGE_SLACK, inWindow.length ? inWindow[inWindow.length - 1][1] : s);
    for (let i = e; i > floor; i--) {
      if (WS.test(text[i])) {
        e = i;
        break;
      }
    }
  }

  // Collapse whitespace while tracking where each raw character lands.
  const raw = text.slice(s, e);
  const map = new Int32Array(raw.length + 1);
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (WS.test(ch)) {
      if (out.length) pendingSpace = true;
      map[i] = out.length;
      continue;
    }
    if (pendingSpace) {
      out += " ";
      pendingSpace = false;
    }
    map[i] = out.length;
    out += ch;
  }
  map[raw.length] = out.length;

  const prefix = s > 0 ? "…" : "";
  const suffix = e < len ? "…" : "";
  const shift = prefix.length;
  const ranges: [number, number][] = [];
  for (const [a, b] of highlights) {
    if (a < s || b > e || b <= a) continue;
    const from = map[a - s] + shift;
    const to = map[b - 1 - s] + 1 + shift;
    if (to > from) ranges.push([from, to]);
  }
  return { text: prefix + out + suffix, highlights: ranges };
}

/**
 * Snippet for a matched chunk. With `focus` the window centres on the densest highlights (keyword
 * matches); without it the chunk's opening is shown (meaning-only matches), still highlighting any
 * query words that appear.
 */
export function makeSnippet(
  chunk: { id: string; text: string; page?: number },
  matcher: TermMatcher | null,
  focus: boolean,
  maxLen = SNIPPET_CHARS,
): Snippet {
  const hl = matcher ? findHighlights(chunk.text, matcher) : [];
  const start = focus ? bestWindowStart(chunk.text, hl, maxLen) : 0;
  const w = windowText(chunk.text, start, hl, maxLen);
  const snippet: Snippet = { chunkId: chunk.id, text: w.text, highlights: w.highlights };
  if (chunk.page !== undefined) snippet.page = chunk.page;
  return snippet;
}

/** Snippet centred on a known range (e.g. a phone number found in the chunk), which is highlighted. */
export function snippetAround(
  chunk: { id: string; text: string; page?: number },
  at: { index: number; length: number },
  maxLen = SNIPPET_CHARS,
): Snippet {
  const start = Math.max(0, at.index - Math.floor((maxLen - at.length) / 3));
  const w = windowText(chunk.text, start, [[at.index, at.index + at.length]], maxLen);
  const snippet: Snippet = { chunkId: chunk.id, text: w.text, highlights: w.highlights };
  if (chunk.page !== undefined) snippet.page = chunk.page;
  return snippet;
}

// ---------- Smart-answer context ----------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex that finds a digit sequence even when written with spaces, dots, dashes or brackets. */
function looseDigits(digits: string): RegExp {
  return new RegExp(digits.split("").join("[\\s().,\\-/]{0,3}"));
}

/**
 * Where an entity value appears in `text`. The stored value is the first-seen spelling, so other
 * memories may format it differently ("+1 555 123 4567" vs "(555) 123-4567"): numbers are matched
 * loosely by their digits.
 */
export function locateValue(
  text: string,
  value: string,
  type: EntityType,
  normalized?: string,
): { index: number; length: number } | null {
  if (!text || !value) return null;
  const lower = text.toLowerCase();
  for (const candidate of [value, normalized]) {
    if (!candidate) continue;
    const i = lower.indexOf(candidate.toLowerCase());
    if (i >= 0) return { index: i, length: candidate.length };
  }
  if (type === "phone" || type === "money" || type === "date") {
    const digits = (normalized || value).replace(/\D/g, "");
    if (digits.length >= 3) {
      const tries = type === "phone" ? [digits, digits.slice(-10), digits.slice(-7)] : [digits];
      for (const d of tries) {
        if (d.length < 3) continue;
        const m = looseDigits(d).exec(text);
        if (m) return { index: m.index, length: m[0].length };
      }
    }
  }
  if (type === "url") {
    const bare = value.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    if (bare) {
      const m = new RegExp(escapeRegExp(bare), "i").exec(text);
      if (m) return { index: m.index, length: m[0].length };
    }
  }
  return null;
}

/** ~`total` characters of tidy text around a range, cut at word boundaries, with ellipses. */
export function contextAround(text: string, index: number, length: number, total = 120): string {
  const radius = Math.max(16, Math.floor((total - length) / 2));
  const start = Math.max(0, index - radius);
  return windowText(text, start, [[index, index + length]], Math.max(total, length + 2 * 16)).text;
}
