// Is a PDF page's text layer trustworthy? Many PDFs store Indian-language text badly:
//   - Unicode text with vowel signs / joined letters missing ("बजली" instead of "बिजली"), or
//   - old non-Unicode fonts (Kruti Dev, DevLys, Chanakya…) that store Hindi as English letters ("jktLFkku").
// Such pages are read from their image instead (OCR in the right language), so the text is exactly what the
// page shows. No language processing — just cheap character checks.

/** Unicode blocks of Indian scripts (each 0x80 wide) → Tesseract language that reads that script. */
const INDIC_BLOCKS: { start: number; lang: string }[] = [
  { start: 0x0900, lang: "hin" }, // Devanagari (Hindi, Marathi, Nepali, Sanskrit…)
  { start: 0x0980, lang: "ben" }, // Bengali / Assamese
  { start: 0x0a00, lang: "pan" }, // Gurmukhi
  { start: 0x0a80, lang: "guj" }, // Gujarati
  { start: 0x0b00, lang: "ori" }, // Odia
  { start: 0x0b80, lang: "tam" }, // Tamil
  { start: 0x0c00, lang: "tel" }, // Telugu
  { start: 0x0c80, lang: "kan" }, // Kannada
  { start: 0x0d00, lang: "mal" }, // Malayalam
];

function block(cp: number): { start: number; lang: string } | undefined {
  return INDIC_BLOCKS.find((b) => cp >= b.start && cp < b.start + 0x80);
}

/** Dependent vowel signs, virama, nukta and nasal marks — they can never start a word. */
function isSign(cp: number): boolean {
  const b = block(cp);
  if (!b) return false;
  const o = cp - b.start;
  return (o >= 0x01 && o <= 0x03) || o === 0x3c || (o >= 0x3e && o <= 0x4d) || o === 0x62 || o === 0x63;
}

function isConsonant(cp: number): boolean {
  const b = block(cp);
  if (!b) return false;
  const o = cp - b.start;
  return o >= 0x15 && o <= 0x39;
}

/** Tesseract languages for the Indian scripts present in `text` (most frequent first). */
export function indicLangs(text: string): string[] {
  const counts = new Map<string, number>();
  for (const ch of text) {
    const b = block(ch.codePointAt(0)!);
    if (b) counts.set(b.lang, (counts.get(b.lang) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).map(([lang]) => lang);
}

/**
 * Indian-script text whose vowel signs / conjuncts were lost when the PDF was made: words that start with a
 * vowel sign, or lone consonants standing as "words" ("क  गई", "ह ").
 */
export function brokenIndicText(text: string): boolean {
  const words = text.split(/[\s ।,.;:!?()"'“”‘’\-–—]+/).filter((w) => w && block(w.codePointAt(0)!));
  if (words.length < 4) return false;
  let bad = 0;
  for (const w of words) {
    const cps = [...w].map((c) => c.codePointAt(0)!);
    if (isSign(cps[0]) || (cps.length === 1 && isConsonant(cps[0]))) bad++;
  }
  return bad / words.length >= 0.08;
}

/**
 * Hindi typed in an old non-Unicode font: the PDF holds English letters that only look like Hindi on screen
 * ("jktLFkku ljdkj }kjk tkjh vkns'k"). Real English rarely has many vowel-less words, mid-word brackets or
 * lower-Upper-lower letter mixes; this text is full of them.
 */
export function legacyFontText(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => /[A-Za-z]/.test(w) && w.length >= 3);
  if (words.length < 15) return false;
  let odd = 0;
  for (const w of words) {
    const letters = w.replace(/[^A-Za-z]/g, "");
    if (
      /[A-Za-z][;~\]}{[^`|]+[A-Za-z]/.test(w) || // brackets / semicolons inside a word
      /[a-z][A-Z]+[a-z]/.test(w) || // "jktLFkku", "vkSj"
      (letters.length >= 3 && !/[aeiouAEIOU]/.test(letters) && letters !== letters.toUpperCase()) // "ljdkj", not "PDF"
    ) {
      odd++;
    }
  }
  return odd / words.length >= 0.35;
}

/**
 * Placeholders a PDF reader emits for glyphs the PDF has no character code for (NUL / U+FFFD) — the
 * clearest sign, in any language, that the text layer lost letters.
 */
export function missingGlyphs(text: string): boolean {
  const n = text.match(/[\u0000\uFFFD]/g)?.length ?? 0;
  return n >= 3 && n / Math.max(1, text.length) >= 0.005;
}

/**
 * Languages to read a page with, when its text layer can't be trusted; null = the text layer is fine.
 * An empty list means "read it with the usual languages".
 */
export function pageNeedsReading(text: string): string[] | null {
  const indic = indicLangs(text);
  if (missingGlyphs(text)) return indic;
  if (indic.length && brokenIndicText(text)) return indic;
  if (!indic.length && legacyFontText(text)) return ["hin"];
  return null;
}
