/**
 * Pure helpers for the search screens: labels, highlight splitting, safe action links for smart
 * answers and the recent-searches list. No DOM, no React — easy to reason about and to test.
 */
import { itemHref } from "@/lib/config";
import type { DateRange, EntityType, MemoryKind } from "@/lib/types";

// ---------- Labels ----------

/** Heading on a smart-answer card. */
export const ANSWER_LABEL: Record<EntityType, string> = {
  phone: "Phone number",
  email: "Email address",
  url: "Link",
  money: "Amount",
  date: "Date",
  name: "Name",
  topic: "Topic",
  tag: "Tag",
};

/** What the person is asking for, as shown in the "understood" chips ("phone numbers"). */
export const INTENT_LABEL: Record<EntityType, string> = {
  phone: "phone numbers",
  email: "email addresses",
  url: "links",
  money: "amounts",
  date: "dates",
  name: "names",
  topic: "topics",
  tag: "tags",
};

/** Badge on a result that contains what was asked for ("Has phone number"). */
export const HAS_ENTITY_LABEL: Record<EntityType, string> = {
  phone: "Has phone number",
  email: "Has email",
  url: "Has link",
  money: "Has amount",
  date: "Has date",
  name: "Has name",
  topic: "Has topic",
  tag: "Has tag",
};

/** Kind filter tabs. */
export const KIND_FILTER_LABEL: Record<MemoryKind, string> = {
  image: "Images",
  pdf: "PDFs",
  video: "Videos",
  file: "Files",
  voice: "Voice",
  text: "Text",
  note: "Notes",
};

/** Kind hints understood from the question ("screenshot" → image). */
export const KIND_HINT_LABEL: Record<MemoryKind, string> = {
  image: "screenshots & photos",
  pdf: "PDFs",
  video: "videos",
  file: "files",
  voice: "voice recordings",
  text: "copied text",
  note: "notes",
};

/** Search options value that switches a date filter off (every real timestamp falls inside). */
export const ANY_TIME: DateRange = { from: 0, to: 8.64e15, label: "any time" };

// ---------- Highlighting ----------

export type HighlightRange = readonly [number, number];

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** Split `text` into plain and highlighted parts. Ranges may overlap, be unsorted or out of bounds. */
export function splitHighlights(text: string, ranges: readonly HighlightRange[] | undefined): HighlightPart[] {
  if (!text) return [];
  const len = text.length;
  const clean = (ranges ?? [])
    .map(([a, b]) => [Math.max(0, Math.min(len, Math.floor(a))), Math.max(0, Math.min(len, Math.floor(b)))] as [number, number])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (!clean.length) return [{ text, hit: false }];

  const merged: [number, number][] = [];
  for (const r of clean) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const parts: HighlightPart[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) parts.push({ text: text.slice(at, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < len) parts.push({ text: text.slice(at), hit: false });
  return parts;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ranges where query words appear in `text` (case-insensitive, at word starts). Words of three or
 * more letters also match as a prefix and highlight the whole word ("inv" → "invoice"), mirroring
 * how keyword search matches.
 */
export function termRanges(text: string, words: readonly string[], max = 40): [number, number][] {
  if (!text || !words.length) return [];
  const uniq = Array.from(new Set(words.map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2))).sort(
    (a, b) => b.length - a.length,
  );
  if (!uniq.length) return [];
  const alternatives = uniq.map((w) => (w.length >= 3 ? `${escapeRegExp(w)}[\\p{L}\\p{N}]*` : `${escapeRegExp(w)}(?![\\p{L}\\p{N}])`));
  let re: RegExp;
  try {
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})`, "giu");
  } catch {
    return [];
  }
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || !m[0]) continue;
    out.push([m.index, m.index + m[0].length]);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Trim the start of a snippet so its first highlight sits near the beginning — for one-line
 * previews where the match would otherwise be cut off. Adds a leading ellipsis when trimmed.
 */
export function focusSnippet(
  text: string,
  highlights: readonly HighlightRange[] | undefined,
  lead = 32,
): { text: string; highlights: [number, number][] } {
  const ranges = (highlights ?? []).map(([a, b]) => [a, b] as [number, number]);
  const first = ranges.reduce((m, [a]) => Math.min(m, a), Infinity);
  if (!Number.isFinite(first) || first <= lead) return { text, highlights: ranges };
  let start = first - lead;
  const space = text.indexOf(" ", start);
  if (space !== -1 && space < first) start = space + 1;
  const prefix = "…";
  const shift = prefix.length - start;
  return {
    text: prefix + text.slice(start),
    highlights: ranges
      .map(([a, b]) => [Math.max(prefix.length, a + shift), b + shift] as [number, number])
      .filter(([a, b]) => b > a),
  };
}

// ---------- Smart-answer actions ----------

/** `tel:` link for a phone number as written, or null when it doesn't look dialable. */
export function telHref(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 17) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** `mailto:` link for an email address, or null when it isn't one. */
export function mailHref(value: string): string | null {
  const v = value.trim().replace(/^mailto:/i, "");
  return EMAIL_RE.test(v) ? `mailto:${v}` : null;
}

/**
 * A safe http(s) URL to open for a link found in a memory, or null. Bare domains ("example.com/x")
 * get https://; any other scheme (javascript:, data:, file:…) is refused.
 */
export function safeExternalUrl(value: string): string | null {
  const v = value.trim().replace(/[)\].,;:!?'"»”’]+$/, "");
  if (!v || /\s/.test(v)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(v);
  if (hasScheme && !/^https?:\/\//i.test(v)) return null;
  const candidate = hasScheme ? v : v.startsWith("//") ? `https:${v}` : `https://${v}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || (!url.hostname.includes(".") && url.hostname !== "localhost" && !/^\[/.test(url.hostname))) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Short, readable form of a link: no scheme, no "www.", no trailing slash. */
export function displayUrl(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

export type AnswerActionKind = "call" | "email" | "open";

export interface AnswerAction {
  kind: AnswerActionKind;
  href: string;
  label: string;
}

/** The one-tap action for an answer: call a number, email an address, open a link. */
export function answerAction(type: EntityType, value: string): AnswerAction | null {
  if (type === "phone") {
    const href = telHref(value);
    return href ? { kind: "call", href, label: "Call" } : null;
  }
  if (type === "email") {
    const href = mailHref(value);
    return href ? { kind: "email", href, label: "Email" } : null;
  }
  if (type === "url") {
    const href = safeExternalUrl(value);
    return href ? { kind: "open", href, label: "Open link" } : null;
  }
  return null;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The value as shown big on an answer card. Keeps what was written; tidies links and ISO dates. */
export function formatAnswerValue(type: EntityType, value: string): string {
  const v = value.replace(/\s+/g, " ").trim();
  if (type === "url") return displayUrl(v);
  if (type === "tag") return `#${v.replace(/^#/, "")}`;
  if (type === "date") {
    const m = ISO_DAY.exec(v);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (!Number.isNaN(d.getTime()) && d.getDate() === Number(m[3])) {
        return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });
      }
    }
  }
  return v;
}

// ---------- Links ----------

/** Link to a memory that carries the query so the memory page can highlight it. */
export function memoryHref(itemId: string, query: string): string {
  const q = query.trim();
  return q ? `${itemHref(itemId)}&q=${encodeURIComponent(q)}` : itemHref(itemId);
}

// ---------- Recent searches ----------

export const RECENT_MAX = 8;

/**
 * Put `query` at the front of the recent list (case-insensitive de-dupe). When the newest entry is a
 * shorter start of the same search ("invoice" → "invoice total"), it is replaced instead of kept.
 */
export function pushRecent(list: readonly string[], query: string, max = RECENT_MAX): string[] {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!q) return [...list];
  const lower = q.toLowerCase();
  const rest = list.filter((s, i) => {
    const s2 = s.toLowerCase();
    if (s2 === lower) return false;
    if (i === 0 && s2.length < lower.length && lower.startsWith(s2)) return false;
    return true;
  });
  return [q, ...rest].slice(0, max);
}

/** Parse whatever is stored under the recent-searches key; anything unexpected becomes []. */
export function parseRecent(raw: string | null, max = RECENT_MAX): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const v of value) {
      if (typeof v !== "string") continue;
      const q = v.replace(/\s+/g, " ").trim();
      if (q && !out.some((x) => x.toLowerCase() === q.toLowerCase())) out.push(q.slice(0, 200));
      if (out.length >= max) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** "1 memory" / "3 memories". */
export function countLabel(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
