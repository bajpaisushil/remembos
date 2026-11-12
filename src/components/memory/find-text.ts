/**
 * "Find in this memory": locate a query inside a memory's text.
 *
 * The exact phrase wins (case-insensitive, any whitespace between words). When the phrase isn't
 * there — typical for questions carried over from search ("what's Priya's phone number") — it
 * falls back to highlighting the individual meaningful words, using the same word matching as
 * search snippets (accent-insensitive, prefix-aware, common words skipped).
 */
import { createMatcher, findHighlights, SPLIT_RE } from "@/lib/search/rank";

export type FindMode = "phrase" | "words" | "none";

export interface FindResult {
  /** [start, end) character ranges in the text, in order. */
  ranges: [number, number][];
  mode: FindMode;
  /** True when more matches exist than were collected. */
  capped: boolean;
}

export const FIND_CAP = 1000;

const EMPTY: FindResult = { ranges: [], mode: "none", capped: false };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Find `query` in `text`. */
export function findInText(text: string, query: string, cap = FIND_CAP): FindResult {
  const q = query.trim();
  if (!text || !q) return EMPTY;

  const pattern = q.split(/\s+/).map(escapeRegExp).join("\\s+");
  const ranges: [number, number][] = [];
  let capped = false;
  try {
    const re = new RegExp(pattern, "giu");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++;
        continue;
      }
      if (ranges.length >= cap) {
        capped = true;
        break;
      }
      ranges.push([m.index, m.index + m[0].length]);
    }
  } catch {
    /* an unusual query the regex engine refuses — fall through to word matching */
  }
  if (ranges.length) return { ranges, mode: "phrase", capped };

  const words = q.split(SPLIT_RE).filter((w) => w.length >= 2);
  if (!words.length) return EMPTY;
  const matcher = createMatcher(words);
  if (!matcher.exact.size && !matcher.prefixes.length) return EMPTY;
  const found = findHighlights(text, matcher, cap + 1);
  if (!found.length) return EMPTY;
  return { ranges: found.slice(0, cap), mode: "words", capped: found.length > cap };
}

export interface TextSegment {
  text: string;
  /** Index into the ranges list when this segment is a match. */
  match?: number;
}

/** Split `text` (only its first `limit` characters) into plain and matched segments. */
export function segmentText(text: string, ranges: readonly [number, number][], limit = text.length): TextSegment[] {
  const end = Math.min(limit, text.length);
  const out: TextSegment[] = [];
  let pos = 0;
  for (let i = 0; i < ranges.length; i++) {
    const [s, e] = ranges[i];
    if (s >= end) break;
    if (s < pos) continue;
    if (s > pos) out.push({ text: text.slice(pos, s) });
    const stop = Math.min(e, end);
    out.push({ text: text.slice(s, stop), match: i });
    pos = stop;
  }
  if (pos < end) out.push({ text: text.slice(pos, end) });
  return out;
}
