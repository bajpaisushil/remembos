/**
 * Entity extraction — pure, synchronous, no DOM.
 *
 * Finds the things people later search for in a memory: phone numbers, email addresses, links, amounts of
 * money, dates, proper-noun names (people, companies, products, places), #hashtags and a handful of salient
 * topic keywords. Everything is heuristic and tuned for real-world text (OCR output, receipts, chats, notes):
 * precision matters more than recall, because every entity becomes a chip in the UI and a node in the graph.
 *
 * Passes run in a fixed order and "claim" the characters they consume, so later passes never re-interpret
 * them (a date is never also a phone number, the domain inside an email is never also a link, …).
 * All passes are linear-time regex scans; 200k characters take well under 150 ms.
 */
import type { EntityType, ExtractedEntity } from "../types";
import { daysInMonth, expandYear, isoDay, isoMonth, isValidDay } from "./calendar";
import {
  ACRONYM_NOISE,
  CALENDAR_WORDS,
  COMPANY_SUFFIXES,
  GENERIC_WORDS,
  HONORIFICS,
  MONTH_PATTERN,
  MONTHS,
  NAME_CONNECTORS,
  NAME_NOISE,
  SENTENCE_VERBS,
  STOPWORDS,
} from "./lexicon";

export interface ExtractOptions {
  /** Maximum proper-noun names returned (default 15, ranked by mentions). */
  maxNames?: number;
  /** Maximum topic keywords returned (default 5). */
  maxTopics?: number;
  /** Reference date used to complete dates written without a year ("Sept 3rd"). Defaults to now. */
  now?: Date | number;
}

const DEFAULT_MAX_NAMES = 15;
const DEFAULT_MAX_TOPICS = 5;

/** Output order of entity types (stable, most actionable first). */
const TYPE_ORDER: EntityType[] = ["phone", "email", "url", "money", "date", "name", "tag", "topic"];

/** Extract phones, emails, urls, money, dates, proper-noun names, #tags and top topics from text. */
export function extractEntities(text: string, opts?: ExtractOptions): ExtractedEntity[] {
  if (!text || !text.trim()) return [];
  const ctx = new Context(text);
  extractUrlsWithScheme(ctx);
  extractEmails(ctx);
  extractBareDomains(ctx);
  extractMoney(ctx);
  extractDates(ctx, referenceYear(opts?.now));
  extractPhones(ctx);
  extractTags(ctx);
  const tokens = tokenizeWords(ctx);
  const nameWords = extractNames(ctx, tokens, opts?.maxNames ?? DEFAULT_MAX_NAMES);
  extractTopics(ctx, tokens, nameWords, opts?.maxTopics ?? DEFAULT_MAX_TOPICS);
  return ctx.result();
}

/** Normalise a value for an entity type (used for ids & dedupe), e.g. phone → digits with leading +. */
export function normalizeEntity(type: ExtractedEntity["type"], value: string): string {
  const v = (value ?? "").trim();
  switch (type) {
    case "phone":
      return normalizePhone(v);
    case "email":
      return v.replace(/^mailto:/i, "").toLowerCase();
    case "url":
      return normalizeUrl(v);
    case "money":
      return normalizeMoney(v);
    case "date":
      return normalizeDate(v);
    case "name":
      return normalizeName(v);
    case "tag":
      return v.replace(/^#+/, "").toLowerCase();
    case "topic":
      return v.toLowerCase().replace(/\s+/g, " ");
    default:
      return v.toLowerCase();
  }
}

// ───────────────────────────── shared state ─────────────────────────────

class Context {
  readonly text: string;
  private readonly claimed: Uint8Array;
  private readonly found = new Map<string, ExtractedEntity>();

  constructor(text: string) {
    this.text = text;
    this.claimed = new Uint8Array(text.length);
  }

  /** True when no character in [start, end) was consumed by an earlier pass. */
  isFree(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.claimed[i]) return false;
    return true;
  }

  claim(start: number, end: number): void {
    this.claimed.fill(1, start, end);
  }

  add(type: EntityType, value: string, normalized: string, index: number, count = 1): void {
    if (!normalized) return;
    const key = `${type}:${normalized}`;
    const prev = this.found.get(key);
    if (prev) {
      prev.count += count;
      if (index < prev.index) {
        prev.index = index;
        prev.value = value;
      }
    } else {
      this.found.set(key, { type, value, normalized, count, index });
    }
  }

  /** Grouped by type; names and topics keep their rank order (they are added best-first), others by position. */
  result(): ExtractedEntity[] {
    const rank = (t: EntityType) => TYPE_ORDER.indexOf(t);
    const ranked = (t: EntityType) => t === "name" || t === "topic";
    return [...this.found.values()].sort(
      (a, b) => rank(a.type) - rank(b.type) || (ranked(a.type) ? 0 : a.index - b.index),
    );
  }
}

function referenceYear(now: Date | number | undefined): number {
  const d = now === undefined ? new Date() : new Date(now);
  return Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
}

/** Lower-cased text just before `pos` on the same line, at most `max` chars (cue words like "phone:"). */
function contextBefore(text: string, pos: number, max: number): string {
  const slice = text.slice(Math.max(0, pos - max), pos);
  const nl = slice.lastIndexOf("\n");
  return (nl === -1 ? slice : slice.slice(nl + 1)).toLowerCase();
}

/** The full line around [start, end), or null when the line is longer than `max` (never a heading). */
function lineAround(text: string, start: number, end: number, max = 160): string | null {
  const before = text.slice(Math.max(0, start - max), start);
  const nlBefore = before.lastIndexOf("\n");
  if (nlBefore === -1 && start - max > 0) return null;
  const after = text.slice(end, end + max);
  const nlAfter = after.indexOf("\n");
  if (nlAfter === -1 && end + max < text.length) return null;
  return (
    (nlBefore === -1 ? before : before.slice(nlBefore + 1)) +
    text.slice(start, end) +
    (nlAfter === -1 ? after : after.slice(0, nlAfter))
  );
}

/** Index where the last match of `re` ends inside `s`, or -1. `re` must be global. */
function lastMatchEnd(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let end = -1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    end = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return end;
}

// ───────────────────────────── URLs & emails ─────────────────────────────

const URL_CHARS = String.raw`[^\s<>"'\x60{}|\\^[\]]`;
const URL_SCHEME_RE = new RegExp(String.raw`\b(?:https?|ftp):\/\/${URL_CHARS}+`, "gi");
const URL_WWW_RE = new RegExp(String.raw`(?<![\w.@/:-])www\.${URL_CHARS}+`, "gi");

/** Common TLDs for links written without "http" or "www" (lower-case only, to avoid "done.So" typos). */
const TLDS = [
  "com", "org", "net", "edu", "gov", "mil", "int", "io", "co", "ai", "app", "dev", "me", "in", "uk", "us", "ca",
  "de", "fr", "es", "nl", "se", "au", "nz", "jp", "cn", "kr", "sg", "hk", "ch", "ie", "br", "mx", "ru", "za",
  "info", "biz", "xyz", "tech", "ly", "gg", "tv", "fm", "to", "so", "be", "page", "site", "online", "store", "shop",
  "blog", "news", "cloud", "design", "art", "link", "live", "life", "world", "email", "agency", "studio", "works",
  "tools", "academy", "money", "finance", "health", "education", "website", "space", "digital", "social", "media",
  "club", "team", "network", "systems", "solutions", "services", "company", "global", "group", "careers", "jobs",
  "travel",
]
  .sort((a, b) => b.length - a.length)
  .join("|");

const URL_BARE_RE = new RegExp(
  String.raw`(?<![\w.@/:%+-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:${TLDS})(?![\w-]|\.[A-Za-z0-9])(?::\d{2,5})?(?:\/${URL_CHARS}*)?`,
  "g",
);

const EMAIL_RE =
  /(?<![\w.%+-])[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![\w-]|\.[A-Za-z0-9])/g;

/** Drop sentence punctuation glued to the end of a link, keeping balanced brackets (Wikipedia-style URLs). */
function trimUrl(raw: string): string {
  let s = raw;
  for (;;) {
    const last = s.charAt(s.length - 1);
    if (/[.,;:!?'"’”*_~>]/.test(last)) {
      s = s.slice(0, -1);
    } else if (last === ")" && count(s, "(") < count(s, ")")) {
      s = s.slice(0, -1);
    } else if (last === "]" && count(s, "[") < count(s, "]")) {
      s = s.slice(0, -1);
    } else {
      return s;
    }
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (let i = s.indexOf(ch); i !== -1; i = s.indexOf(ch, i + 1)) n++;
  return n;
}

function addUrl(ctx: Context, start: number, raw: string): void {
  const value = trimUrl(raw);
  const end = start + value.length;
  if (value.length < 4 || !ctx.isFree(start, end)) return;
  const normalized = normalizeUrl(value);
  const host = normalized.split(/[/?#]/)[0];
  if (!host || !/[a-z]/i.test(host)) return;
  ctx.claim(start, end);
  ctx.add("url", value, normalized, start);
}

function extractUrlsWithScheme(ctx: Context): void {
  for (const m of ctx.text.matchAll(URL_SCHEME_RE)) addUrl(ctx, m.index, m[0]);
  for (const m of ctx.text.matchAll(URL_WWW_RE)) {
    if (/^www\.[^./]+\.[a-z]{2,}/i.test(m[0])) addUrl(ctx, m.index, m[0]);
  }
}

function extractBareDomains(ctx: Context): void {
  for (const m of ctx.text.matchAll(URL_BARE_RE)) {
    const hostPart = m[0].split("/")[0];
    const labels = hostPart.split(".");
    // At least one non-TLD label must contain a letter ("3.co" is not a link).
    if (!labels.slice(0, -1).some((l) => /[a-z]/i.test(l))) continue;
    addUrl(ctx, m.index, m[0]);
  }
}

function extractEmails(ctx: Context): void {
  for (const m of ctx.text.matchAll(EMAIL_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!ctx.isFree(start, end)) continue;
    ctx.claim(start, end);
    ctx.add("email", m[0], m[0].toLowerCase(), start);
  }
}

/** Lower-case host (no scheme, no "www.") + path without trailing slash; tracking parameters removed. */
export function normalizeUrl(raw: string): string {
  let s = trimUrl(raw.trim()).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  const cut = s.search(/[/?#]/);
  let host = cut === -1 ? s : s.slice(0, cut);
  let rest = cut === -1 ? "" : s.slice(cut);
  host = host.toLowerCase().replace(/:(?:80|443)$/, "").replace(/\.$/, "");
  if (rest.includes("?")) {
    const q = rest.indexOf("?");
    const hash = rest.indexOf("#", q);
    const path = rest.slice(0, q);
    const query = rest.slice(q + 1, hash === -1 ? undefined : hash);
    const frag = hash === -1 ? "" : rest.slice(hash);
    const kept = query
      .split("&")
      .filter((p) => p && !/^(?:utm_[a-z]+|fbclid|gclid|mc_eid|mc_cid|igshid|ref_src)=/i.test(p));
    rest = path + (kept.length ? `?${kept.join("&")}` : "") + frag;
  }
  rest = rest.replace(/[?#]+$/, "").replace(/\/+$/, "");
  s = host + rest;
  return s;
}

// ───────────────────────────── money ─────────────────────────────

const CURRENCY_CODES =
  "USD|EUR|GBP|INR|JPY|CNY|RMB|CAD|AUD|NZD|CHF|SGD|HKD|AED|SAR|QAR|ZAR|BRL|MXN|KRW|SEK|NOK|DKK|PLN|RUB|TRY|NGN|KES|PKR|BDT|LKR|NPR|IDR|MYR|THB|VND|ILS|EGP";
const SYMBOL_PREFIX = String.raw`US\$|CA\$|C\$|AU\$|A\$|NZ\$|HK\$|S\$|R\$|[$€£₹¥₩₽₺₦₱₫฿₪]`;
const NUM = String.raw`\d+(?:[.,]\d+)*`;
const MULT = String.raw`k|K|mn|MN|bn|BN|m|M|b|B|million|billion|trillion|thousand|lakhs?|lacs?|crores?|cr`;
const CURRENCY_WORDS = String.raw`[Dd]ollars?|DOLLARS|[Bb]ucks|[Ee]uros?|EUROS?|[Rr]upees?|RUPEES?|[Yy]en|YEN`;

const MONEY_PREFIX_RE = new RegExp(
  String.raw`(?<![\w$€£₹¥])(?:${SYMBOL_PREFIX}|\b(?:[Rr][Ss]\.?|${CURRENCY_CODES})(?=\s?\d))\s?-?${NUM}(?:\s?(?:${MULT})(?![A-Za-z]))?`,
  "g",
);
const MONEY_SUFFIX_RE = new RegExp(
  String.raw`(?<![\w$€£₹¥.,])${NUM}(?:\s?(?:${MULT})(?![A-Za-z]))?\s?(?:(?:${CURRENCY_CODES})(?![A-Za-z])|[€£₹$](?![\w$])|(?:${CURRENCY_WORDS})\b)`,
  "g",
);
const MONEY_BARE_RE = /(?<![\w$€£₹¥.,])\d+(?:\.\d+)?\s?(?:k|K|M|mn|bn|million|billion|lakhs?|crores?|cr)(?![A-Za-z0-9])/g;
const MONEY_CUE_RE =
  /\b(?:budget|cost|costs|price|priced|pricing|salary|paid|pay|payment|revenue|spent|spend|total|amount|fees?|rent|raised?|funding|valuation|invoice|bill|earn(?:ed|ings)?|income|loan|deposit|worth|ctc|package|offer|sales|profit|loss|turnover|arr|mrr|deal|savings|refund)\b/g;
const NOT_MONEY_AFTER_RE =
  /^\s*(?:steps|followers|views|users|subscribers|likes|words|miles|km|run|runs|people|members|downloads|visitors|items|records|rows|lines|tokens|calories|kcal|cal|feet|ft|meters|metres|mb|gb|kb|tb|hz|times|clicks|impressions|stars|resolution|monitor|tv|video|pixels|px)\b/i;

const SYMBOL_CODES: [string, string][] = [
  ["US$", "USD"], ["CA$", "CAD"], ["C$", "CAD"], ["AU$", "AUD"], ["A$", "AUD"], ["NZ$", "NZD"], ["HK$", "HKD"],
  ["S$", "SGD"], ["R$", "BRL"], ["$", "USD"], ["€", "EUR"], ["£", "GBP"], ["₹", "INR"], ["¥", "JPY"], ["₩", "KRW"],
  ["₽", "RUB"], ["₺", "TRY"], ["₦", "NGN"], ["₱", "PHP"], ["₫", "VND"], ["฿", "THB"], ["₪", "ILS"],
];
const CODE_RE = new RegExp(String.raw`\b(${CURRENCY_CODES})\b`, "i");
const RS_RE = /(?:^|[^a-z])rs\.?\s?\d/i;
const WORD_CODES: [RegExp, string][] = [
  [/\b(?:dollars?|bucks?)\b/i, "USD"],
  [/\beuros?\b/i, "EUR"],
  [/\brupees?\b/i, "INR"],
  [/\byen\b/i, "JPY"],
];
const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, trillion: 1e12, tn: 1e12,
  lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7,
};
const AMOUNT_RE = /(\d+(?:[.,]\d+)*)\s?(k|thousand|mn|million|m|bn|billion|b|trillion|tn|lakhs?|lacs?|crores?|cr)?(?![a-z])/i;

function detectCurrency(s: string): string | null {
  for (const [sym, code] of SYMBOL_CODES) {
    if (sym.length > 1 ? s.toUpperCase().includes(sym) : s.includes(sym)) return code;
  }
  const code = CODE_RE.exec(s);
  if (code) return code[1].toUpperCase() === "RMB" ? "CNY" : code[1].toUpperCase();
  if (RS_RE.test(s)) return "INR";
  for (const [re, c] of WORD_CODES) if (re.test(s)) return c;
  return null;
}

/** Parse "1,234.56", "1.234,56", "12,50", "1,20,000" into a number, using the currency as a hint. */
function parseAmount(num: string, code: string | null): number {
  const commas = count(num, ",");
  const dots = count(num, ".");
  let decimal: "," | "." | null = null;
  if (commas && dots) {
    decimal = num.lastIndexOf(",") > num.lastIndexOf(".") ? "," : ".";
  } else if (commas) {
    const tail = num.slice(num.lastIndexOf(",") + 1);
    decimal = commas === 1 && tail.length <= 2 ? "," : null;
  } else if (dots) {
    const tail = num.slice(num.lastIndexOf(".") + 1);
    decimal = dots === 1 && !(tail.length === 3 && code === "EUR") ? "." : null;
  }
  const grouping = decimal === "," ? /\./g : /,/g;
  let clean = num.replace(grouping, "");
  if (decimal === ",") clean = clean.replace(",", ".");
  else if (decimal === null) clean = clean.replace(/[.,]/g, "");
  return Number(clean);
}

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** "$1,234.56" → "USD 1234.56", "Rs. 500" → "INR 500", "$2.4M" → "USD 2400000", "3.5k" → "3500". */
export function normalizeMoney(raw: string): string {
  const s = raw.trim();
  const code = detectCurrency(s);
  const m = AMOUNT_RE.exec(s);
  if (!m) return s.toLowerCase();
  const mult = m[2] ? (MULTIPLIERS[m[2].toLowerCase()] ?? 1) : 1;
  const amount = formatAmount(parseAmount(m[1], code) * mult);
  if (!amount) return s.toLowerCase();
  return code ? `${code} ${amount}` : amount;
}

function addMoney(ctx: Context, start: number, raw: string): void {
  const value = raw.trim();
  const end = start + raw.length;
  if (!ctx.isFree(start, end)) return;
  const normalized = normalizeMoney(value);
  if (!/\d/.test(normalized)) return;
  ctx.claim(start, end);
  ctx.add("money", value, normalized, start);
}

function extractMoney(ctx: Context): void {
  const { text } = ctx;
  for (const m of text.matchAll(MONEY_PREFIX_RE)) addMoney(ctx, m.index, m[0]);
  for (const m of text.matchAll(MONEY_SUFFIX_RE)) addMoney(ctx, m.index, m[0]);
  for (const m of text.matchAll(MONEY_BARE_RE)) {
    const end = m.index + m[0].length;
    if (!ctx.isFree(m.index, end)) continue;
    if (lastMatchEnd(MONEY_CUE_RE, contextBefore(text, m.index, 40)) === -1) continue;
    if (NOT_MONEY_AFTER_RE.test(text.slice(end, end + 24))) continue;
    addMoney(ctx, m.index, m[0]);
  }
}

// ───────────────────────────── dates ─────────────────────────────

interface DateHit {
  start: number;
  end: number;
  value: string;
  y: number | null;
  m: number;
  d: number | null;
}

const ORD = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const MON = String.raw`(${MONTH_PATTERN})\.?`;
const DATE_ISO_RE = /(?<![\w.\-/])(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?!\d|[-/.]\d)/g;
const DATE_NUMERIC_RE = /(?<![\w.\-/:])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?!\d|[-/.:]\d)/g;
const DATE_DASH_MON_RE = new RegExp(String.raw`(?<![\w.])(\d{1,2})([-/])(${MONTH_PATTERN})\2(\d{4}|\d{2})\b`, "gi");
const DATE_MDY_RE = new RegExp(String.raw`(?<![\w])${MON}\s+${ORD}\b(?:,?\s+(\d{4})\b)?`, "gi");
const DATE_DMY_RE = new RegExp(String.raw`(?<![\w.])${ORD}(?:\s+of)?\s+${MON}(?![a-z])(?:,?\s+(\d{4})\b)?`, "gi");
const DATE_MY_RE = new RegExp(String.raw`(?<![\w])${MON}\s+(?:of\s+)?(\d{4})\b`, "gi");

function countMatches(re: RegExp, text: string): number {
  let n = 0;
  for (const m of text.matchAll(re)) if (m[0]) n++;
  return n;
}

function monthIndex(name: string): number {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? -1;
}

/** "may" in lower case without a year is almost always the verb ("you may 2x the dose"). */
function ambiguousMonthWord(word: string, hasYear: boolean): boolean {
  return !hasYear && (word === "may" || word === "march");
}

function extractDates(ctx: Context, refYear: number): void {
  const { text } = ctx;
  const hits: DateHit[] = [];
  const push = (start: number, raw: string, y: number | null, m: number, d: number | null) => {
    const value = raw.trim().replace(/[,.]$/, "");
    const end = start + value.length;
    if (m < 0 || m > 11) return;
    if (d !== null && (d < 1 || d > 31)) return;
    if (y !== null && d !== null && !isValidDay(y, m, d)) return;
    if (y !== null && (y < 1900 || y > 2199)) return;
    if (!ctx.isFree(start, end)) return;
    ctx.claim(start, end);
    hits.push({ start, end, value, y, m, d });
  };

  for (const m of text.matchAll(DATE_ISO_RE)) push(m.index, m[0], Number(m[1]), Number(m[3]) - 1, Number(m[4]));

  // Numeric day/month order: decide per document from unambiguous dates ("25/12/2026"), dates written with
  // month names ("01-Oct-2026" vs "October 1, 2026") and the currency in use; else by separator.
  const numeric = [...text.matchAll(DATE_NUMERIC_RE)].filter((m) => !(m[2] === "." && m[4].length !== 4));
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  if (numeric.length) {
    for (const m of numeric) {
      const a = Number(m[1]);
      const b = Number(m[3]);
      if (a > 12 && b <= 12) dayFirstVotes += 3;
      else if (b > 12 && a <= 12) monthFirstVotes += 3;
    }
    for (const re of [DATE_DASH_MON_RE, DATE_DMY_RE]) dayFirstVotes += 2 * countMatches(re, text);
    monthFirstVotes += 2 * countMatches(DATE_MDY_RE, text);
    if (/[₹€£]|\b(?:INR|EUR|GBP|Rs\.?)\s?\d/.test(text)) dayFirstVotes++;
    if (/\$\s?\d|\bUSD\b/.test(text)) monthFirstVotes++;
  }
  for (const m of numeric) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const y = expandYear(m[4]);
    let dayFirst: boolean;
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    else if (a > 12 && b > 12) continue;
    else if (dayFirstVotes !== monthFirstVotes) dayFirst = dayFirstVotes > monthFirstVotes;
    else dayFirst = m[2] !== "/";
    const day = dayFirst ? a : b;
    const month = (dayFirst ? b : a) - 1;
    push(m.index, m[0], y, month, day);
  }

  for (const m of text.matchAll(DATE_DASH_MON_RE)) {
    push(m.index, m[0], expandYear(m[4]), monthIndex(m[3]), Number(m[1]));
  }
  for (const m of text.matchAll(DATE_MDY_RE)) {
    if (ambiguousMonthWord(m[1], Boolean(m[3]))) continue;
    push(m.index, m[0], m[3] ? Number(m[3]) : null, monthIndex(m[1]), Number(m[2]));
  }
  for (const m of text.matchAll(DATE_DMY_RE)) {
    if (ambiguousMonthWord(m[2], Boolean(m[3]))) continue;
    push(m.index, m[0], m[3] ? Number(m[3]) : null, monthIndex(m[2]), Number(m[1]));
  }
  for (const m of text.matchAll(DATE_MY_RE)) push(m.index, m[0], Number(m[2]), monthIndex(m[1]), null);

  // Complete year-less dates from the nearest explicit year in the text, else the reference year.
  hits.sort((a, b) => a.start - b.start);
  const withYear = hits.filter((h) => h.y !== null);
  for (const h of hits) {
    let y = h.y;
    if (y === null) {
      let prev: DateHit | undefined;
      let next: DateHit | undefined;
      for (const w of withYear) {
        if (w.start < h.start) prev = w;
        else {
          next = w;
          break;
        }
      }
      y = (prev ?? next)?.y ?? refYear;
      if (h.d !== null && h.d > daysInMonth(y, h.m)) continue;
    }
    const normalized = h.d === null ? isoMonth(y, h.m) : isoDay(y, h.m, h.d);
    ctx.add("date", h.value, normalized, h.start);
  }
}

/** Parse a date string into ISO yyyy-mm-dd / yyyy-mm (or a lower-cased fallback when unparseable). */
export function normalizeDate(raw: string, refYear = new Date().getFullYear()): string {
  const v = raw.trim();
  const ctx = new Context(v);
  extractDates(ctx, refYear);
  const hit = ctx.result()[0];
  return hit ? hit.normalized : v.toLowerCase();
}

// ───────────────────────────── phones ─────────────────────────────

const PHONE_SEP = String.raw`(?:[  ]?[.\-–][  ]?|[  ]{1,2})`;
const PHONE_RE = new RegExp(
  String.raw`(?<![\w$€£₹¥#@%/\\+\-–.,])(?<!\d[.,:])(?:(?:\+|\b00)[  ]?\d{1,3}${PHONE_SEP}?)?(?:\(\d{1,5}\)${PHONE_SEP}?)?\d{1,12}(?:${PHONE_SEP}\d{1,12}){0,6}(?![\w$€£₹%°@/]|[ .,:\-–]?\d|\.\w)`,
  "g",
);
const PHONE_CUE_RE =
  /(?:\b(?:phone|ph|tel|telephone|mobile|mob|cell|cellphone|call|calls|contact|whatsapp|fax|landline|helpline|hotline|sms|text|dial|ring|reach)\b|\b[mtpf]\s?[:.])/g;
const NOT_PHONE_CUE_RE =
  /\b(?:order|orders|invoice|inv|receipt|txn|transaction|ref|reference|id|account|acct|a\/c|tracking|awb|pnr|booking|confirmation|serial|s\/n|sku|isbn|policy|gst|gstin|pan|aadhaar|aadhar|ssn|iban|swift|ifsc|routing|upi|utr|ticket|case|claim|member|membership|roll|registration|reg|vin|imei|model|part|batch|lot|otp|pin|code|card|cvv|emp|employee|po|voucher|coupon|license|licence|passport|patent|version|build|ver|no\.)(?=\W|$)/g;

/** Digits with a leading "+" kept ("00" international prefix becomes "+"). */
function normalizePhone(raw: string): string {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return `+${digits}`;
  if (/^00[1-9]/.test(digits) && /^00/.test(s)) return `+${digits.slice(2)}`;
  return digits;
}

function looksLikeDate(groups: string[]): boolean {
  if (groups.length !== 3) return false;
  const [a, b, c] = groups;
  const n = groups.map(Number);
  if (a.length === 4) return n[1] >= 1 && n[1] <= 12 && n[2] >= 1 && n[2] <= 31;
  if (c.length === 4 || c.length === 2) {
    if (a.length > 2 || b.length > 2) return false;
    const okDM = n[0] >= 1 && n[0] <= 31 && n[1] >= 1 && n[1] <= 12;
    const okMD = n[0] >= 1 && n[0] <= 12 && n[1] >= 1 && n[1] <= 31;
    return okDM || okMD;
  }
  return false;
}

function isPhone(ctx: Context, start: number, raw: string): boolean {
  const { text } = ctx;
  const intl = raw.startsWith("+") || /^00[1-9]/.test(raw);
  const digits = raw.replace(/\D/g, "");
  const significant = intl && raw.startsWith("00") ? digits.slice(2) : digits;
  if (significant.length < 7 || significant.length > 15) return false;
  if (intl && significant.length < 9) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const groups = raw.replace(/^\+|^00/, "").split(/\D+/).filter(Boolean);
  const seps = raw.replace(/^\+/, "").match(/[^\d]+/g) ?? [];

  const before = contextBefore(text, start, 40);
  const pos = lastMatchEnd(PHONE_CUE_RE, before);
  const neg = lastMatchEnd(NOT_PHONE_CUE_RE, before);
  if (neg > pos) return false;
  const cued = pos !== -1;

  if (looksLikeDate(groups)) return false;
  // Year ranges "2019-2024".
  if (groups.length === 2 && groups.every((g) => g.length === 4 && +g >= 1900 && +g <= 2199)) return false;
  // IP addresses.
  if (groups.length === 4 && seps.every((s) => s === ".") && groups.every((g) => g.length <= 3 && +g <= 255)) return false;
  // Decimal numbers "1234567.89".
  if (!intl && groups.length === 2 && seps[0] === "." && groups[1].length <= 2) return false;
  // Every group after the first (or after the country code) needs at least two digits.
  const body = intl && groups.length > 1 ? groups.slice(1) : groups;
  if (body.slice(1).some((g) => g.length < 2)) return false;
  if (cued) return true;

  const hasParens = raw.includes("(");
  if (groups.length === 1 && !intl) {
    // Unformatted runs of digits are only phone numbers when they look like a 10-digit mobile/NANP number.
    return digits.length === 10 && /^[2-9]/.test(digits);
  }
  if (!intl && !hasParens) {
    const sizes = groups.map((g) => g.length).join("-");
    // ZIP+4 "94105-1234" and SSN-shaped "123-45-6789".
    if (sizes === "5-4" || sizes === "3-2-4") return false;
    // Card/account-like blocks of four "1234 5678 9012".
    if (groups.length >= 3 && groups.every((g) => g.length === 4)) return false;
    // "10.30-11.45", "12 34 56" — short pairs are times, scores or codes, not phone numbers.
    if (groups.every((g) => g.length <= 2)) return groups.length === 5 && groups[0].startsWith("0");
    // "1 200 000", "12.345.678" — thousands separators.
    if (
      groups.length >= 2 &&
      groups[0].length <= 3 &&
      !groups[0].startsWith("0") &&
      groups.slice(1).every((g) => g.length === 3) &&
      seps.every((s) => /^[  .,]$/.test(s))
    ) {
      return false;
    }
  }
  return true;
}

function extractPhones(ctx: Context): void {
  for (const m of ctx.text.matchAll(PHONE_RE)) {
    const raw = m[0];
    const start = m.index;
    const end = start + raw.length;
    if (!ctx.isFree(start, end)) continue;
    if (!isPhone(ctx, start, raw)) continue;
    ctx.claim(start, end);
    ctx.add("phone", raw, normalizePhone(raw), start);
  }
}

// ───────────────────────────── hashtags ─────────────────────────────

const TAG_RE = /(?<![\w&#/\\])#(\p{L}[\p{L}\p{N}_-]{0,49})/gu;

function extractTags(ctx: Context): void {
  for (const m of ctx.text.matchAll(TAG_RE)) {
    const tag = m[1].replace(/[-_]+$/, "");
    const start = m.index;
    const end = start + 1 + tag.length;
    if (!tag || !ctx.isFree(start, end)) continue;
    // CSS colours such as #a1b2c3 / #fff0 are not tags.
    if (/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(tag) && /\d/.test(tag)) continue;
    ctx.claim(start, end);
    ctx.add("tag", `#${tag}`, tag.toLowerCase(), start);
  }
}

// ───────────────────────────── words (names & topics) ─────────────────────────────

type WordClass = "cap" | "acro" | "initial" | "connector" | "lower" | "number" | "claimed";

interface Word {
  start: number;
  /** End offset, excluding a possessive "'s". */
  end: number;
  /** Surface form without possessive. */
  text: string;
  /** Lower-case form without apostrophes, for list lookups. */
  key: string;
  cls: WordClass;
  /** First word of a sentence/line/list item (capitalisation there says nothing). */
  sentenceStart: boolean;
  possessive: boolean;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const STRONG_BOUNDARY_RE = /[.!?:;\n\r•·|>"“”()[\]{}*#=~…]/;
const UPPER_RE = /^\p{Lu}/u;
const HAS_LOWER_RE = /\p{Ll}/u;
const ALL_UPPER_RE = /^\p{Lu}{2,6}$/u;

function tokenizeWords(ctx: Context): Word[] {
  const { text } = ctx;
  const words: Word[] = [];
  let prevEnd = -1;
  let prevWord: Word | undefined;
  for (const m of text.matchAll(WORD_RE)) {
    let surface = m[0].replace(/[-'’]+$/, "");
    const start = m.index;
    let possessive = false;
    if (/['’]s$/i.test(surface) && surface.length > 2) {
      surface = surface.slice(0, -2);
      possessive = true;
    }
    const end = start + surface.length;
    const key = surface.toLowerCase().replace(/['’]/g, "");
    let cls: WordClass;
    if (!ctx.isFree(start, end)) cls = "claimed";
    else if (/\d/.test(surface)) cls = "number";
    else if (NAME_CONNECTORS.has(surface)) cls = "connector";
    else if (!UPPER_RE.test(surface)) cls = "lower";
    else if (surface.length === 1) cls = "initial";
    else if (HAS_LOWER_RE.test(surface)) cls = "cap";
    else if (ALL_UPPER_RE.test(surface)) cls = "acro";
    else cls = "lower"; // long ALL-CAPS words are shouting/OCR noise, not names

    let sentenceStart = prevWord === undefined;
    if (prevWord) {
      const gap = text.slice(prevEnd, start);
      const abbrev =
        /^\.\s{0,2}$/.test(gap) && (prevWord.cls === "initial" || HONORIFICS.has(prevWord.key) || COMPANY_SUFFIXES.has(prevWord.key));
      sentenceStart = !abbrev && STRONG_BOUNDARY_RE.test(gap);
    }
    const word: Word = { start, end, text: surface, key, cls, sentenceStart, possessive };
    words.push(word);
    prevWord = word;
    prevEnd = start + m[0].length;
  }
  return words;
}

/** Whether two adjacent words can belong to the same proper-noun phrase. */
function continuesPhrase(text: string, prev: Word, next: Word): boolean {
  if (prev.possessive) return false;
  const gap = text.slice(prev.end, next.start);
  if (/^[  ]{1,2}$/.test(gap)) return true;
  if (/^ ?& ?$/.test(gap)) return prev.cls !== "connector";
  if (/^\.[  ]{0,2}$/.test(gap)) {
    if (prev.cls === "initial") return next.cls === "cap" || next.cls === "initial";
    if (HONORIFICS.has(prev.key)) return next.cls === "cap" || next.cls === "initial";
    if (COMPANY_SUFFIXES.has(prev.key)) return COMPANY_SUFFIXES.has(next.key);
  }
  return false;
}

interface NameCandidate {
  value: string;
  normalized: string;
  index: number;
  count: number;
  words: number;
  acronym: boolean;
  /** Seen at least once in the middle of a sentence (capitalisation there is meaningful). */
  midSentence: boolean;
  /** Seen after an honorific at least once ("Mr. Patel") — a person even when mentioned once. */
  titled: boolean;
}

/** Lower-case, no periods, single spaces, straight apostrophes, honorifics removed. */
export function normalizeName(raw: string): string {
  const parts = raw
    .replace(/[’]/g, "'")
    .replace(/\./g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  while (parts.length > 1 && HONORIFICS.has(parts[0])) parts.shift();
  return parts.join(" ").replace(/'s$/, "");
}

/** Words that break a name phrase even when capitalised. */
function isNameBreaker(w: Word): boolean {
  if (CALENDAR_WORDS.has(w.key) || NAME_NOISE.has(w.key)) return true;
  if (STOPWORDS.has(w.key)) return w.sentenceStart || w.key !== "will";
  return false;
}

function extractNames(ctx: Context, words: Word[], maxNames: number): Set<string> {
  const { text } = ctx;
  const lowerCounts = new Map<string, number>();
  let letterWords = 0;
  let upperWords = 0;
  for (const w of words) {
    if (w.cls === "lower" && !UPPER_RE.test(w.text)) lowerCounts.set(w.key, (lowerCounts.get(w.key) ?? 0) + 1);
    if (w.cls !== "number" && w.cls !== "claimed") {
      letterWords++;
      if (w.text.length > 1 && w.text === w.text.toUpperCase() && !HAS_LOWER_RE.test(w.text)) upperWords++;
    }
  }
  // OCR of receipts/forms is often ALL CAPS: acronyms there are noise, not organisations.
  const shouting = letterWords > 0 && upperWords / letterWords > 0.5;

  const candidates = new Map<string, NameCandidate>();
  const flush = (phrase: Word[]) => {
    const p = phrase.slice();
    while (p.length && p[p.length - 1].cls === "connector") p.pop();
    // Leading honorifics ("Dr.") and sentence-initial verbs ("Visited Paris", "Ask Priya") are not part of names.
    let titled = false;
    // An honorific inside the phrase marks where the name starts ("Met Dr. Sarah Chen" → "Sarah Chen").
    const honorificAt = p.findIndex((w, i) => i > 0 && i < p.length - 1 && HONORIFICS.has(w.key));
    if (honorificAt > 0) p.splice(0, honorificAt);
    while (p.length > 1) {
      const first = p[0];
      const verbish =
        first.sentenceStart &&
        (SENTENCE_VERBS.has(first.key) ||
          GENERIC_WORDS.has(first.key) ||
          (/(?:ed|ing|ly)$/.test(first.key) && first.key.length > 4));
      if (HONORIFICS.has(first.key)) titled = true;
      if (HONORIFICS.has(first.key) || verbish || first.cls === "connector") p.shift();
      else break;
    }
    while (p.length && p[0].cls === "connector") p.shift();
    if (!p.length) return;
    const core = p.filter((w) => w.cls !== "connector");
    if (core.length > 6) return;
    const hasCap = core.some((w) => w.cls === "cap");
    const acronym = core.length === 1 && core[0].cls === "acro";
    if (!hasCap && !acronym) return;
    if (core.length === 1 && HONORIFICS.has(core[0].key)) return;
    const first = p[0];
    const last = p[p.length - 1];
    // Long Title Case lines are headings ("Quarterly Business Review Planning Notes"), not names.
    if (core.length >= 4) {
      const line = lineAround(text, first.start, last.end);
      const lettersOnly = (s: string) => s.replace(/[^\p{L}\p{M}]+/gu, " ").trim();
      if (line !== null && lettersOnly(line) === lettersOnly(text.slice(first.start, last.end))) return;
    }
    const value = text.slice(first.start, last.end);
    const normalized = normalizeName(value);
    if (normalized.length < 2) return;
    const prev = candidates.get(normalized);
    if (prev) {
      prev.count++;
      prev.midSentence ||= !first.sentenceStart;
      prev.titled ||= titled;
    } else {
      candidates.set(normalized, {
        value,
        normalized,
        index: first.start,
        count: 1,
        words: core.length,
        acronym,
        midSentence: !first.sentenceStart,
        titled,
      });
    }
  };

  let phrase: Word[] = [];
  for (const w of words) {
    if (phrase.length && !continuesPhrase(text, phrase[phrase.length - 1], w)) {
      flush(phrase);
      phrase = [];
    }
    if (w.cls === "cap" || w.cls === "acro" || w.cls === "initial") {
      if (isNameBreaker(w) || (w.cls === "acro" && shouting)) {
        flush(phrase);
        phrase = [];
      } else {
        phrase.push(w);
      }
    } else if (w.cls === "connector" && phrase.length) {
      phrase.push(w);
    } else if (phrase.length) {
      flush(phrase);
      phrase = [];
    }
  }
  flush(phrase);

  const accepted: NameCandidate[] = [];
  for (const c of candidates.values()) {
    if (c.words > 1 || (c.titled && !c.acronym)) {
      accepted.push(c);
      continue;
    }
    if (c.count < 2 || c.normalized.length < 2) continue;
    if (c.acronym) {
      if (!shouting && !ACRONYM_NOISE.has(c.normalized)) accepted.push(c);
      continue;
    }
    if (GENERIC_WORDS.has(c.normalized) || SENTENCE_VERBS.has(c.normalized)) continue;
    if ((lowerCounts.get(c.normalized) ?? 0) >= c.count) continue;
    // Only ever seen opening a sentence: trust it unless it looks like an adverb/verb form ("Finally", "Looking").
    if (!c.midSentence && /(?:ly|ing|ed)$/.test(c.normalized)) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => b.count - a.count || a.index - b.index);

  const nameWords = new Set<string>();
  for (const c of accepted.slice(0, Math.max(0, maxNames))) {
    ctx.add("name", c.value, c.normalized, c.index, c.count);
    for (const part of c.normalized.split(" ")) nameWords.add(part.replace(/'/g, ""));
  }
  return nameWords;
}

// ───────────────────────────── topics ─────────────────────────────

const TOPIC_WORD_RE = /^[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*$/u;

function extractTopics(ctx: Context, words: Word[], nameWords: Set<string>, maxTopics: number): void {
  if (maxTopics <= 0) return;
  const counts = new Map<string, { count: number; index: number }>();
  let total = 0;
  for (const w of words) {
    if (w.cls === "claimed" || w.cls === "number") continue;
    total++;
    const k = w.key;
    if (k.length < 4 || k.length > 24) continue;
    if (!TOPIC_WORD_RE.test(k)) continue;
    if (STOPWORDS.has(k) || GENERIC_WORDS.has(k) || CALENDAR_WORDS.has(k) || nameWords.has(k)) continue;
    if (!/[aeiouy]/.test(k) || /(.)\1\1/.test(k) || count(k, "-") > 1) continue;
    const c = counts.get(k);
    if (c) c.count++;
    else counts.set(k, { count: 1, index: w.start });
  }

  // Merge plurals into their singular when both forms occur ("invoice" + "invoices").
  for (const [k, c] of [...counts]) {
    if (!k.endsWith("s")) continue;
    const singular = [k.slice(0, -1), k.slice(0, -2), `${k.slice(0, -3)}y`].find((s) => s.length >= 4 && counts.has(s));
    if (!singular) continue;
    const target = counts.get(singular);
    if (!target) continue;
    target.count += c.count;
    target.index = Math.min(target.index, c.index);
    counts.delete(k);
  }

  const minCount = total >= 150 ? 2 : 1;
  const ranked = [...counts.entries()]
    .filter(([, c]) => c.count >= minCount)
    // Frequency × length; verb and adverb forms ("discussed", "quickly") are weaker topics than nouns.
    .map(([k, c]) => ({ k, ...c, score: c.count * Math.min(k.length, 12) * (/(?:[^e]ed|ly)$/.test(k) ? 0.5 : 1) }))
    .sort((a, b) => b.score - a.score || b.count - a.count || a.index - b.index)
    .slice(0, maxTopics);
  for (const t of ranked) ctx.add("topic", t.k, t.k, t.index, t.count);
}
