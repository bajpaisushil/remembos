/**
 * Text chunking, titles and summaries — pure functions, no DOM.
 *
 * `chunkText` cuts long text into overlapping passages (~LIMITS.chunkTargetChars) for keyword indexing and
 * embeddings. Cuts prefer, in order: paragraph breaks, line breaks, sentence ends, word boundaries; a hard cut
 * only happens inside very long unbroken strings. Every chunk's `text` equals `fullText.slice(start, end)`.
 */
import { LIMITS } from "../config";
import type { ChunkDraft } from "../types";

/** Separator used to join PDF pages into an item's full text (chunk offsets assume it). */
export const PAGE_SEPARATOR = "\n\n";

/**
 * Split text into overlapping chunks (~LIMITS.chunkTargetChars) on paragraph/sentence boundaries.
 * When `pages` is given, chunks never span pages and carry 1-based `page`; offsets refer to
 * the full text formed by pages.join(PAGE_SEPARATOR).
 */
export function chunkText(text: string, pages?: string[]): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  if (pages && pages.length) {
    let offset = 0;
    pages.forEach((page, i) => {
      chunkSegment(page ?? "", offset, i + 1, out);
      offset += (page ?? "").length + PAGE_SEPARATOR.length;
    });
    return out;
  }
  if (text) chunkSegment(text, 0, undefined, out);
  return out;
}

const WS = /\s/;
const PARAGRAPH_BREAK_RE = /\n[ \t ]*\n\s*/g;
const LINE_BREAK_RE = /\n\s*/g;
const SENTENCE_END_RE = /[.!?;。！？…]["'”’)\]]*(?=\s)/g;
const SENTENCE_START_RE = /[.!?。！？…]["'”’)\]]*\s+/g;
const SPACE_RE = /\s+/g;

function chunkSegment(seg: string, base: number, page: number | undefined, out: ChunkDraft[]): void {
  const target = Math.max(80, LIMITS.chunkTargetChars);
  const overlap = Math.min(LIMITS.chunkOverlapChars, Math.floor(target / 3));
  let pos = skipSpace(seg, 0);
  const end = trimmedEnd(seg);
  while (pos < end) {
    if (end - pos <= target) {
      emit(seg, pos, end, base, page, out);
      return;
    }
    const cut = findCut(seg, pos + Math.floor(target / 2), pos + target);
    emit(seg, pos, cut, base, page, out);
    if (skipSpace(seg, cut) >= end) return;
    const next = skipSpace(seg, overlapStart(seg, cut, overlap));
    pos = next > pos && next < cut ? next : skipSpace(seg, cut);
  }
}

function emit(seg: string, from: number, to: number, base: number, page: number | undefined, out: ChunkDraft[]): void {
  let a = from;
  let b = to;
  while (a < b && WS.test(seg[a])) a++;
  while (b > a && WS.test(seg[b - 1])) b--;
  if (a >= b) return;
  const chunk: ChunkDraft = { index: out.length, text: seg.slice(a, b), start: base + a, end: base + b };
  if (page !== undefined) chunk.page = page;
  out.push(chunk);
}

/** Best end position for a chunk within [lo, hi]. */
function findCut(seg: string, lo: number, hi: number): number {
  const window = seg.slice(lo, hi);
  for (const re of [PARAGRAPH_BREAK_RE, LINE_BREAK_RE, SENTENCE_END_RE, SPACE_RE]) {
    const at = lastMatchEnd(re, window);
    if (at > 0) return lo + at;
  }
  // No boundary at all (e.g. a long URL or base64): hard cut, never splitting a surrogate pair.
  let cut = hi;
  const code = seg.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return cut;
}

/** Where the next chunk starts so it repeats ~`overlap` chars, beginning at a sentence or word boundary. */
function overlapStart(seg: string, cut: number, overlap: number): number {
  const from = Math.max(0, cut - overlap);
  const window = seg.slice(from, cut);
  SENTENCE_START_RE.lastIndex = 0;
  const sentence = SENTENCE_START_RE.exec(window);
  if (sentence && sentence.index + sentence[0].length < window.length) return from + sentence.index + sentence[0].length;
  if (from === 0 || WS.test(seg[from - 1])) return from;
  const space = window.search(/\s/);
  if (space !== -1 && space < window.length - 1) return from + space + 1;
  return from;
}

function lastMatchEnd(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let end = -1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    end = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return end;
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && WS.test(s[i])) i++;
  return i;
}

function trimmedEnd(s: string): number {
  let e = s.length;
  while (e > 0 && WS.test(s[e - 1])) e--;
  return e;
}

// ───────────────────────────── titles & summaries ─────────────────────────────

const TITLE_MAX = 80;
const SUMMARY_MAX = 280;
const BULLET_RE = /^\s*(?:[-*+•▪◦‣●○■□➤►–—]\s+|\d{1,3}[.)]\s+)/;

interface CleanLine {
  text: string;
  bullet: boolean;
  heading: boolean;
}

/** Strip Markdown/HTML/list syntax from one line. */
function cleanLine(raw: string): CleanLine {
  let s = raw.replace(/\t/g, " ");
  const heading = /^\s{0,3}#{1,6}\s/.test(s);
  s = s
    .replace(/<[^>]{1,200}>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)+/, "");
  const bullet = BULLET_RE.test(s);
  s = s
    .replace(BULLET_RE, "")
    .replace(/^\s*\[[ xX]\]\s+/, "")
    .replace(/(\*\*|__|~~|`+)/g, "")
    .replace(/(^|[\s(])[*_]([^\s*_](?:[^*_]*[^\s*_])?)[*_](?=$|[\s.,!?;:)])/g, "$1$2")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])(?=\s|$)/g, "$1")
    .trim();
  return { text: s, bullet, heading };
}

/** Lines that are pure decoration: rules, code fences, table separators. */
function isDecoration(line: string): boolean {
  return /^\s*(?:[-=_*~#|:+.]{3,}|`{3,}.*|\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?)\s*$/.test(line);
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

/** A line worth using as a title: real words, not OCR debris or a bare link. */
function isMeaningful(s: string): boolean {
  const letters = letterCount(s);
  if (letters < 3) return false;
  const visible = s.replace(/\s/g, "").length;
  if (letters / visible < 0.45) return false;
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(s)) return false;
  return /\p{L}{2,}/u.test(s);
}

/** Cut at a word boundary so the result (with "…") fits in `max` characters. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const room = s.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  const cut = space > max * 0.5 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:.\-–—]+$/, "")}…`;
}

/** Email-style header lines ("From: …", "Sent: …") that describe a message rather than say anything. */
const HEADER_RE = /^\s*(?:from|sent|to|cc|bcc|date|reply-to|received|importance)\s*:/i;
const SUBJECT_RE = /^\s*(?:subject|title)\s*:\s*(.+)$/i;
const REPLY_PREFIX_RE = /^(?:(?:re|fwd?|aw|wg|sv)\s*:\s*)+/i;

/** First meaningful line(s) → a short title (≤ 80 chars). */
export function deriveTitle(text: string, fallback: string): string {
  const lines = (text ?? "").slice(0, 8000).split(/\r?\n/).slice(0, 80);
  // A pasted email: its subject is the best title.
  for (const raw of lines.slice(0, 15)) {
    const subject = SUBJECT_RE.exec(raw);
    if (!subject) continue;
    const s = cleanLine(subject[1]).text.replace(REPLY_PREFIX_RE, "");
    if (isMeaningful(s)) return clip(s, TITLE_MAX).replace(/[\s.,;:]+$/, "");
  }
  let linkLine: string | null = null;
  for (const raw of lines) {
    if (isDecoration(raw) || HEADER_RE.test(raw)) continue;
    let s = cleanLine(raw).text.replace(/^(?:(?:subject|title|topic)\s*:\s*)+/i, "").replace(REPLY_PREFIX_RE, "");
    if (!s) continue;
    if (!isMeaningful(s)) {
      if (!linkLine && /^(?:https?:\/\/|www\.)\S+$/i.test(s)) linkLine = s;
      continue;
    }
    if (s.length > TITLE_MAX) {
      const sentence = /^(.{12,}?[.!?])(?:\s|$)/.exec(s);
      if (sentence && sentence[1].length <= TITLE_MAX) s = sentence[1];
    }
    s = clip(s, TITLE_MAX).replace(/[\s.,;:]+$/, "");
    if (s) return s;
  }
  if (linkLine) {
    const link = linkLine.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
    return clip(link, TITLE_MAX);
  }
  const fb = (fallback ?? "").trim();
  return fb ? clip(fb, TITLE_MAX) : fb;
}

/** Clean ≤ 280 char preview. */
export function deriveSummary(text: string): string {
  const lines = (text ?? "").slice(0, 6000).split(/\r?\n/);
  // Skip an email header block at the top ("From: …", "Subject: …") — the body is the useful preview.
  let first = 0;
  while (first < lines.length && (HEADER_RE.test(lines[first]) || SUBJECT_RE.test(lines[first]))) first++;
  if (first > 0 && first < lines.length && lines.slice(first).some((l) => l.trim())) lines.splice(0, first);
  const parts: CleanLine[] = [];
  let length = 0;
  for (const raw of lines) {
    if (isDecoration(raw)) continue;
    const line = cleanLine(raw);
    if (!line.text) continue;
    parts.push(line);
    length += line.text.length + 1;
    if (length > SUMMARY_MAX * 2) break;
  }
  // A Markdown heading on top is the title; the preview reads better without repeating it.
  if (parts.length > 1 && parts[0].heading) parts.shift();
  let out = "";
  let prevBullet = false;
  for (const p of parts) {
    if (!out) out = p.text;
    else if (p.bullet || prevBullet) out += /[.!?:;,]$/.test(out) ? ` ${p.text}` : ` · ${p.text}`;
    else out += ` ${p.text}`;
    prevBullet = p.bullet;
  }
  return clip(out.replace(/\s+/g, " ").trim(), SUMMARY_MAX);
}
