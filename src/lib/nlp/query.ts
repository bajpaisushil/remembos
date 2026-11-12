/**
 * Natural-language query understanding — pure functions, no DOM.
 *
 * Turns a question such as "what was that person's phone number in the screenshot last month?" into
 *   - `dateRange`  calendar-correct, local time, weeks start on Monday ("last month" → previous calendar month)
 *   - `intents`    entity types the person is after (phone, email, url, money, date, name)
 *   - `kindHints`  memory kinds mentioned (screenshot → image, document → pdf, screen recording / clip → video,
 *                  recording → voice, …)
 *   - `keywords`   content words only, for keyword search
 *   - `semantic`   the question minus its time phrase, for meaning search
 */
import type { DateRange, EntityType, MemoryKind, ParsedQuery } from "../types";
import { addDays, addMonthsClamped, daysInMonth, startOfDay, startOfWeek } from "./calendar";
import { MONTH_LONG, MONTH_PATTERN, MONTH_SHORT, MONTHS, NUMBER_WORDS, STOPWORDS, WEEKDAY_LONG, WEEKDAYS } from "./lexicon";

/**
 * Understand a natural question like "what was that person's phone number in the screenshot last month?"
 * → intents ["phone"], kindHints ["image"], dateRange (last calendar month), keywords "person".
 */
export function parseQuery(raw: string, now: Date = new Date()): ParsedQuery {
  const input = (raw ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const lower = input.toLowerCase();
  const ref = Number.isNaN(now.getTime()) ? new Date() : now;

  const time = findTimePhrases(lower, ref);
  const cues = findCues(time.rest);

  const keywords = dedupe(tokenize(cues.rest).filter((t) => !QUERY_FILLER.has(t))).join(" ");
  const semanticSource = lower.length === input.length ? input : lower;
  const semantic = tidy(blank(semanticSource, time.spans));

  const parsed: ParsedQuery = { raw, keywords, semantic, intents: cues.intents, kindHints: cues.kinds };
  if (time.range) parsed.dateRange = time.range;
  return parsed;
}

/** Lowercased word tokens without stopwords — shared by search highlighting. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const clean = (text ?? "").toLowerCase().replace(/['’]s\b/g, "").replace(/['’]/g, "");
  for (const m of clean.matchAll(TOKEN_RE)) {
    const w = m[0];
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

const TOKEN_RE = /[\p{L}\p{N}]+/gu;

/** Question scaffolding that never helps keyword search ("where did I see…", "what was mentioned…"). */
const QUERY_FILLER: ReadonlySet<string> = new Set(
  `see saw seen find found finding show shows showed remember remembered recall mention mentioned mentions
  mentioning talk talked talking said say says tell told look looking looked wrote written thing things stuff
  something anything info information kind sort saved save stored added get got give gave know knew want need
  needed somewhere someone anyone exactly help search searching searched remembos memory memories again ever
  earlier please there`
    .trim()
    .split(/\s+/),
);

function dedupe<T>(list: T[]): T[] {
  return [...new Set(list)];
}

/** Replace [start, end) spans with spaces (keeps offsets stable). */
function blank(s: string, spans: [number, number][]): string {
  let out = s;
  for (const [a, b] of spans) out = out.slice(0, a) + " ".repeat(b - a) + out.slice(b);
  return out;
}

/** Collapse whitespace, re-attach punctuation and drop prepositions left dangling by a removed time phrase. */
function tidy(s: string): string {
  let out = s.replace(/\s+/g, " ").replace(/\s+([?.!,;:])/g, "$1").trim();
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/(?:^|\s)(?:in|on|from|during|since|of|at|for|over|within|around|by|between|and|the)([?.!,;:]*)$/i, "$1")
      .replace(/^(?:in|on|from|during|since|of|at|for|over|within|around|by)\s+/i, "")
      .replace(/^[,;:]\s*/, "")
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

// ───────────────────────────── time phrases ─────────────────────────────

interface TimeMatch {
  start: number;
  end: number;
  range: DateRange;
}

type Unit = "minute" | "hour" | "day" | "week" | "month" | "year";

const PREP = String.raw`(?:\b(since|after|before|until|till|in|on|during|from|over|within|for|of|at|around|by)\s+)?`;
const PREP_THE = String.raw`${PREP}(?:the\s+)?`;
const COUNT = String.raw`(\d{1,4}|(?:a\s+)?(?:couple|few)(?:\s+of)?|several|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty)`;
const UNIT = String.raw`(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)`;
const MON = String.raw`(${MONTH_PATTERN})\.?`;
const WEEKDAY = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
const DAYPART = String.raw`(?:\s+(?:morning|afternoon|evening|night))?`;
const END = String.raw`(?![\w])`;

interface TimeRule {
  re: RegExp;
  make: (m: RegExpExecArray, now: Date) => DateRange | null;
}

const rule = (core: string, make: TimeRule["make"], prefix = PREP_THE): TimeRule => ({
  re: new RegExp(String.raw`(?<![\w])${prefix}(?:${core})(?:'s)?${END}`, "g"),
  make,
});

function parseCount(s: string): number {
  const t = s.replace(/^a\s+/, "").replace(/\s+of$/, "").trim();
  const n = /^\d+$/.test(t) ? Number(t) : (NUMBER_WORDS[t] ?? 1);
  return Math.min(Math.max(n, 1), 3650);
}

function parseUnit(s: string): Unit {
  if (s.startsWith("mi")) return "minute";
  if (s.startsWith("h")) return "hour";
  if (s.startsWith("d")) return "day";
  if (s.startsWith("w")) return "week";
  if (s.startsWith("mo")) return "month";
  return "year";
}

const plural = (n: number, unit: Unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const fmtDay = (d: Date) => `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const fmtMonth = (y: number, m: number) => `${MONTH_LONG[m]} ${y}`;

function range(from: Date | number, to: Date | number, label: string): DateRange {
  return { from: +from, to: +to, label };
}

/** Rolling window ending at the end of today ("past 3 weeks"). */
function rolling(now: Date, n: number, unit: Unit, label: string): DateRange {
  const sod = startOfDay(now);
  const end = addDays(sod, 1);
  switch (unit) {
    case "minute":
      return range(+now - n * 60_000, end, label);
    case "hour":
      return range(+now - n * 3_600_000, end, label);
    case "day":
      return range(addDays(sod, -n), end, label);
    case "week":
      return range(addDays(sod, -7 * n), end, label);
    case "month":
      return range(addMonthsClamped(sod, -n), end, label);
    default:
      return range(addMonthsClamped(sod, -12 * n), end, label);
  }
}

/** "N units ago": a window around that moment, wider for vaguer distances; never extends past today. */
function ago(now: Date, n: number, unit: Unit): DateRange {
  const sod = startOfDay(now);
  const endOfToday = +addDays(sod, 1);
  const label = n === 1 ? `${unit === "hour" ? "an" : "a"} ${unit} ago` : `${plural(n, unit)} ago`;
  if (unit === "minute" || unit === "hour") {
    const ms = unit === "minute" ? 60_000 : 3_600_000;
    const slack = Math.max(ms, n * ms * 0.25);
    return range(+now - n * ms - slack, Math.min(+now - n * ms + slack, +now), label);
  }
  let center: Date;
  let w: number;
  if (unit === "day") {
    center = addDays(sod, -n);
    w = n <= 1 ? 0 : Math.max(1, Math.round(n * 0.2));
  } else if (unit === "week") {
    center = addDays(sod, -7 * n);
    w = Math.max(3, Math.round(n * 7 * 0.2));
  } else if (unit === "month") {
    center = addMonthsClamped(sod, -n);
    w = Math.max(7, Math.round(n * 30 * 0.2));
  } else {
    center = addMonthsClamped(sod, -12 * n);
    w = Math.max(30, Math.round(n * 365 * 0.15));
  }
  return range(addDays(center, -w), Math.min(+addDays(center, w + 1), endOfToday), label);
}

function dayRange(d: Date, label = fmtDay(d)): DateRange {
  return range(d, addDays(d, 1), label);
}

function monthRange(y: number, m: number, label = fmtMonth(y, m)): DateRange {
  return range(new Date(y, m, 1), new Date(y, m + 1, 1), label);
}

/** Most recent occurrence of month `m` (this year if it has started, else last year). */
function recentMonth(now: Date, m: number, strictlyPast: boolean): DateRange {
  const cm = now.getMonth();
  const y = (strictlyPast ? m < cm : m <= cm) ? now.getFullYear() : now.getFullYear() - 1;
  return monthRange(y, m);
}

/** A specific calendar day; without a year, the most recent such day up to today. */
function specificDay(now: Date, y: number | null, m: number, d: number): DateRange | null {
  if (m < 0 || m > 11 || d < 1) return null;
  let year = y ?? now.getFullYear();
  if (y === null && new Date(year, m, d) > startOfDay(now)) year--;
  if (d > daysInMonth(year, m)) return null;
  return dayRange(new Date(year, m, d));
}

/** The most recent weekday strictly before today ("on Monday" said on a Wednesday → two days ago). */
function pastWeekday(now: Date, day: number): Date {
  const sod = startOfDay(now);
  const diff = (sod.getDay() - day + 7) % 7 || 7;
  return addDays(sod, -diff);
}

const monthIndex = (s: string) => MONTHS[s.replace(/\.$/, "")] ?? -1;

const TIME_RULES: TimeRule[] = [
  // "in the last week" / "over the past month" → rolling window.
  rule(String.raw`the\s+(?:last|past)\s+(week|month|year)`, (m, now) => {
    const unit = parseUnit(m[2]);
    return rolling(now, 1, unit, `past ${unit}`);
  }, PREP),
  rule(String.raw`(?:this\s+)?(?:past|last|previous|prior|recent)\s+${COUNT}\s+${UNIT}`, (m, now) => {
    const n = parseCount(m[2]);
    const unit = parseUnit(m[3]);
    return rolling(now, n, unit, `past ${plural(n, unit)}`);
  }),
  rule(String.raw`${COUNT}\s+${UNIT}\s+(?:ago|back|before)`, (m, now) => ago(now, parseCount(m[2]), parseUnit(m[3]))),
  rule(String.raw`day\s+before\s+yesterday`, (_m, now) => {
    const sod = startOfDay(now);
    return range(addDays(sod, -2), addDays(sod, -1), "day before yesterday");
  }),
  rule(String.raw`last\s+night`, (_m, now) => {
    const sod = startOfDay(now);
    return range(+addDays(sod, -1) + 12 * 3_600_000, +sod + 6 * 3_600_000, "last night");
  }),
  rule(String.raw`(?:earlier\s+)?today|this\s+(?:morning|afternoon|evening)|tonight`, (_m, now) =>
    dayRange(startOfDay(now), "today"),
  ),
  rule(String.raw`yesterday${DAYPART}`, (_m, now) => dayRange(addDays(startOfDay(now), -1), "yesterday")),
  // Specific days: "March 14", "14th of March 2025", "2026-03-14", "14/03/2026".
  rule(String.raw`${MON}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, (m, now) =>
    specificDay(now, m[4] ? Number(m[4]) : null, monthIndex(m[2]), Number(m[3])),
  ),
  rule(String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MON}(?:,?\s+(\d{4}))?`, (m, now) =>
    specificDay(now, m[4] ? Number(m[4]) : null, monthIndex(m[3]), Number(m[2])),
  ),
  rule(String.raw`(\d{4})-(\d{1,2})-(\d{1,2})`, (m, now) => specificDay(now, Number(m[2]), Number(m[3]) - 1, Number(m[4]))),
  rule(String.raw`(\d{1,2})[/.](\d{1,2})[/.](\d{4})`, (m, now) => {
    const a = Number(m[2]);
    const b = Number(m[3]);
    const dayFirst = a > 12 || (b <= 12 && m[0].includes("."));
    return specificDay(now, Number(m[4]), (dayFirst ? b : a) - 1, dayFirst ? a : b);
  }),
  // Months: "March 2025", "last March", "this June", "in March", "since May".
  rule(String.raw`${MON},?\s+(?:of\s+)?(\d{4})`, (m) => {
    const mi = monthIndex(m[2]);
    return mi < 0 ? null : monthRange(Number(m[3]), mi);
  }),
  rule(String.raw`(last|this)\s+${MON}`, (m, now) => {
    const mi = monthIndex(m[3]);
    if (mi < 0) return null;
    return m[2] === "this" ? monthRange(now.getFullYear(), mi) : recentMonth(now, mi, true);
  }),
  rule(
    String.raw`(?:the\s+month\s+of\s+)?${MON}`,
    (m, now) => {
      const mi = monthIndex(m[2]);
      return mi < 0 ? null : recentMonth(now, mi, false);
    },
    String.raw`\b(since|after|before|until|till|in|during|from|of|over|around)\s+`,
  ),
  rule(
    String.raw`(\d{4})`,
    (m) => {
      const y = Number(m[2]);
      if (y < 1970 || y > 2199) return null;
      return range(new Date(y, 0, 1), new Date(y + 1, 0, 1), String(y));
    },
    String.raw`\b(since|after|before|until|till|in|during|from|of)\s+(?:the\s+year\s+)?`,
  ),
  // Weekends and weeks.
  rule(String.raw`(?:(this|last|past|previous)\s+)?weekend`, (m, now) => {
    const sow = startOfWeek(now);
    const today = startOfDay(now).getDay();
    const inWeekend = today === 0 || today === 6;
    const useThis = m[2] === "this" || (!m[2] && inWeekend);
    return useThis
      ? range(addDays(sow, 5), addDays(sow, 7), "this weekend")
      : range(addDays(sow, -2), sow, "last weekend");
  }),
  rule(String.raw`(?:earlier\s+)?(?:this|current)\s+week`, (_m, now) => {
    const sow = startOfWeek(now);
    return range(sow, addDays(sow, 7), "this week");
  }),
  rule(String.raw`(?:last|previous|prior)\s+week`, (_m, now) => {
    const sow = startOfWeek(now);
    return range(addDays(sow, -7), sow, "last week");
  }),
  rule(String.raw`(?:this\s+)?past\s+week`, (_m, now) => rolling(now, 1, "week", "past week")),
  // Months and years.
  rule(String.raw`(?:earlier\s+)?(?:this|current)\s+month`, (_m, now) => {
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    return range(ms, new Date(now.getFullYear(), now.getMonth() + 1, 1), "this month");
  }),
  rule(String.raw`(?:last|previous|prior)\s+month`, (_m, now) => {
    const ms = new Date(now.getFullYear(), now.getMonth(), 1);
    return range(new Date(now.getFullYear(), now.getMonth() - 1, 1), ms, "last month");
  }),
  rule(String.raw`past\s+month`, (_m, now) => rolling(now, 1, "month", "past month")),
  rule(String.raw`(?:earlier\s+)?(?:this|current)\s+year`, (_m, now) =>
    range(new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1), "this year"),
  ),
  rule(String.raw`(?:last|previous|prior)\s+year`, (_m, now) =>
    range(new Date(now.getFullYear() - 1, 0, 1), new Date(now.getFullYear(), 0, 1), "last year"),
  ),
  rule(String.raw`past\s+year`, (_m, now) => rolling(now, 1, "year", "past year")),
  // Weekdays: "on Monday", "last Friday", "this Tuesday", "monday morning".
  rule(String.raw`(?:(last|this|past|previous)\s+)?${WEEKDAY}${DAYPART}`, (m, now) => {
    const day = WEEKDAYS[m[3]];
    let d = pastWeekday(now, day);
    if (m[2] === "this") {
      const sow = startOfWeek(now);
      const inWeek = addDays(sow, (day + 6) % 7);
      if (inWeek <= startOfDay(now)) d = inWeek;
    }
    return dayRange(d, `${WEEKDAY_LONG[day]}, ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`);
  }),
  rule(String.raw`(?:recently|recent|lately|of\s+late)`, (_m, now) => rolling(now, 30, "day", "last 30 days")),
  rule(String.raw`the\s+other\s+day`, (_m, now) => rolling(now, 14, "day", "past 2 weeks"), PREP),
];

/** Apply "since"/"after"/"before"/"until" to a matched period. */
function applyPreposition(prep: string | undefined, r: DateRange, now: Date): DateRange {
  const endOfToday = +addDays(startOfDay(now), 1);
  switch (prep) {
    case "since":
      return { from: r.from, to: Math.max(endOfToday, r.to), label: `since ${r.label}` };
    case "after":
      return { from: r.to, to: Math.max(endOfToday, r.to), label: `after ${r.label}` };
    case "before":
      return { from: 0, to: r.from, label: `before ${r.label}` };
    case "until":
    case "till":
      return { from: 0, to: r.to, label: `until ${r.label}` };
    default:
      return r;
  }
}

function findTimePhrases(lower: string, now: Date): { range?: DateRange; spans: [number, number][]; rest: string } {
  let work = lower;
  const found: TimeMatch[] = [];
  for (const { re, make } of TIME_RULES) {
    re.lastIndex = 0;
    for (let m = re.exec(work); m; m = re.exec(work)) {
      const r = make(m, now);
      if (r && r.to > r.from) {
        const start = m.index;
        const end = start + m[0].length;
        found.push({ start, end, range: applyPreposition(m[1], r, now) });
      }
    }
    for (const f of found) work = work.slice(0, f.start) + " ".repeat(f.end - f.start) + work.slice(f.end);
  }
  if (!found.length) return { spans: [], rest: lower };
  // The most specific period wins ("on Monday last week" → Monday); ties go to the earliest mention.
  const best = found.reduce((a, b) => {
    const wa = a.range.to - a.range.from;
    const wb = b.range.to - b.range.from;
    return wb < wa || (wb === wa && b.start < a.start) ? b : a;
  });
  return { range: best.range, spans: found.map((f) => [f.start, f.end]), rest: work };
}

// ───────────────────────────── intents & kind hints ─────────────────────────────

interface Cue {
  re: RegExp;
  intent?: EntityType;
  kind?: MemoryKind;
  /** Remove the words from keyword search (they describe what is wanted, not what the memory says). */
  drop: boolean;
}

const cue = (pattern: string, target: { intent?: EntityType; kind?: MemoryKind }, drop = true): Cue => ({
  re: new RegExp(String.raw`(?<![\w])(?:${pattern})(?![\w])`, "g"),
  drop,
  ...target,
});

const NOT_PHONE_NUMBER =
  "order|invoice|account|tracking|reference|ref|policy|serial|confirmation|booking|ticket|case|customer|id|card|flight|model|part|version|page|room|seat|table|item|roll|registration|license|licence|passport|pnr|gst|pan|bank|routing|member|membership|employee|vehicle|plate|house|street|apartment|unit|lot|batch|tax";

/**
 * Ordered: multi-word phrases first so "call recording" is voice (not phone), "screen recording" is video (not
 * voice) and "voice note" is not a note.
 */
const CUES: Cue[] = [
  cue(String.raw`screen\s*(?:recordings?|recorded|records?)|screen\s*casts?|video\s*(?:clips?|recordings?)|videos?|clips?`, { kind: "video" }),
  cue(String.raw`reels?|movies?|films?|you\s?tube|vlogs?|tiktoks?`, { kind: "video" }, false),
  cue(String.raw`call\s+recordings?|voice\s*(?:memos?|notes?|messages?|recordings?|mails?)|voicemails?`, { kind: "voice" }),
  cue(String.raw`recordings?|recorded|audio|voice|transcripts?`, { kind: "voice" }),
  cue(String.raw`memos?|podcasts?`, { kind: "voice" }, false),
  cue(String.raw`screen\s*shots?|screen\s*grabs?|screen\s*caps?|images?|photos?|pictures?|pics?`, { kind: "image" }),
  cue(String.raw`scans?|scanned`, { kind: "image" }, false),
  cue(String.raw`pdfs?|documents?|docs?|files?`, { kind: "pdf" }),
  cue(String.raw`reports?|statements?`, { kind: "pdf" }, false),
  cue(String.raw`copied|copy[-\s]?pasted|clipboard|snippets?|pasted|paste`, { kind: "text" }),
  cue(String.raw`email\s+(?:address(?:es)?|ids?)|e-?mail\s+(?:address(?:es)?|ids?)|mail\s+(?:ids?|address(?:es)?)|e-?mails?`, { intent: "email" }),
  cue(String.raw`(?:phone|mobile|cell|contact|telephone|tel|whats\s?app)\s+(?:numbers?|no\.?|nos\.?|details?|info)`, { intent: "phone" }),
  cue(String.raw`phones?|telephone|tel|mobile|cell\s?phone|cell|contacts?|dial`, { intent: "phone" }),
  cue(String.raw`whats\s?app|calls?|called`, { intent: "phone" }, false),
  // "the number of the dentist" is a phone number; "the number of people" is a count.
  cue(
    String.raw`(?<!\b(?:${NOT_PHONE_NUMBER})\s)numbers?(?!\s+of\s+(?!(?:the|my|our|his|her|their|that|this|a|an)\b))`,
    { intent: "phone" },
  ),
  cue(String.raw`web\s?sites?|web\s?pages?|web\s+address(?:es)?|home\s?pages?|links?|urls?|sites?|domains?`, { intent: "url" }),
  cue(String.raw`how\s+much|invoice\s+amounts?|amounts?|prices?|priced|costs?|costed|paid|pay|payments?|totals?|spent|spend|spending|charged|charges?`, { intent: "money" }),
  cue(String.raw`pricing|budget|salary|fees?|refunds?|bill`, { intent: "money" }, false),
  cue(String.raw`due\s+dates?|dates?|dated|when`, { intent: "date" }),
  cue(String.raw`deadlines?|due|birthdays?|anniversary|expiry|expires|expiration`, { intent: "date" }, false),
  cue(String.raw`(?:person|people|contact)'?s?\s+names?|full\s+names?|names?|who|whom|whose|compan(?:y|ies)|organi[sz]ations?|firms?`, { intent: "name" }),
  cue(String.raw`notes?`, { kind: "note" }),
  cue(String.raw`decided|decide|deciding|decisions?|ideas?|to-?dos?|to\s+do\s+list|jotted`, { kind: "note" }, false),
];

function findCues(text: string): { intents: EntityType[]; kinds: MemoryKind[]; rest: string } {
  let work = text;
  const intents: { at: number; v: EntityType }[] = [];
  const kinds: { at: number; v: MemoryKind }[] = [];
  for (const c of CUES) {
    c.re.lastIndex = 0;
    const spans: [number, number][] = [];
    for (let m = c.re.exec(work); m; m = c.re.exec(work)) {
      if (c.intent) intents.push({ at: m.index, v: c.intent });
      if (c.kind) kinds.push({ at: m.index, v: c.kind });
      spans.push([m.index, m.index + m[0].length]);
    }
    // Matched phrases are always consumed so shorter cues don't re-match inside them; dropped ones also
    // disappear from keywords (kept ones are restored below).
    if (spans.length) work = blank(work, spans);
    if (!c.drop) for (const [a, b] of spans) work = work.slice(0, a) + text.slice(a, b) + work.slice(b);
  }
  const symbol = /[$€£₹¥]/.exec(text);
  if (symbol) intents.push({ at: symbol.index, v: "money" });
  const at = /[\w.]@[\w-]+\.\w/.exec(text);
  if (at) intents.push({ at: at.index, v: "email" });
  const order = <T>(list: { at: number; v: T }[]) => dedupe(list.sort((a, b) => a.at - b.at).map((x) => x.v));
  return { intents: order(intents), kinds: order(kinds), rest: work };
}
