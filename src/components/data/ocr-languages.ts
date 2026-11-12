/**
 * Languages the text reader (Tesseract) can be set to read. Codes are Tesseract's own; each
 * language beyond the first is an extra one-time download of a few megabytes.
 */
export const OCR_LANGUAGES: { code: string; name: string }[] = [
  { code: "eng", name: "English" },
  { code: "deu", name: "German" },
  { code: "fra", name: "French" },
  { code: "spa", name: "Spanish" },
  { code: "ita", name: "Italian" },
  { code: "por", name: "Portuguese" },
  { code: "nld", name: "Dutch" },
  { code: "hin", name: "Hindi" },
  { code: "ara", name: "Arabic" },
  { code: "chi_sim", name: "Chinese (Simplified)" },
  { code: "jpn", name: "Japanese" },
  { code: "kor", name: "Korean" },
  { code: "rus", name: "Russian" },
  { code: "tur", name: "Turkish" },
];

const NAMES = new Map(OCR_LANGUAGES.map((l) => [l.code, l.name]));

/** "English", "English and German", "English, German and 2 more". */
export function ocrLanguageNames(codes: string[]): string {
  const names = codes.map((c) => NAMES.get(c) ?? c);
  if (names.length <= 1) return names[0] ?? "English";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Parse the "eng+deu" setting into a de-duplicated list (never empty). */
export function parseOcrLanguages(value: string | undefined): string[] {
  const list = (value ?? "")
    .split("+")
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]{3,16}$/i.test(s));
  return list.length ? Array.from(new Set(list)) : ["eng"];
}
