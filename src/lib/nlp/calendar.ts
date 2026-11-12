/**
 * Small, dependency-free calendar helpers (local time, Gregorian calendar).
 * Used by entity extraction (date normalisation) and query parsing (date ranges).
 */

export const DAY_MS = 86_400_000;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in a 0-based month. */
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m] ?? 0;
}

/** True when y/m(0-based)/d is a real calendar day within a plausible range for personal documents. */
export function isValidDay(y: number, m: number, d: number): boolean {
  return y >= 1900 && y <= 2199 && m >= 0 && m <= 11 && d >= 1 && d <= daysInMonth(y, m);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** yyyy-mm-dd (m is 0-based). */
export function isoDay(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/** yyyy-mm (m is 0-based). */
export function isoMonth(y: number, m: number): string {
  return `${y}-${pad2(m + 1)}`;
}

/** Two-digit years: 00–69 → 2000s, 70–99 → 1900s. Four-digit years pass through. */
export function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length > 2) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

/** Local midnight of the given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Calendar-safe day arithmetic (handles DST transitions). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** First day of the month `n` months away from `d`'s month. */
export function monthStart(d: Date, n = 0): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Same calendar day `n` months away, clamped to the month's length (Mar 31 − 1 month → Feb 28/29). */
export function addMonthsClamped(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const day = Math.min(d.getDate(), daysInMonth(first.getFullYear(), first.getMonth()));
  return new Date(first.getFullYear(), first.getMonth(), day);
}

/** Monday 00:00 of the week containing `d` (weeks start on Monday). */
export function startOfWeek(d: Date): Date {
  const sod = startOfDay(d);
  const offset = (sod.getDay() + 6) % 7; // Monday → 0 … Sunday → 6
  return addDays(sod, -offset);
}
