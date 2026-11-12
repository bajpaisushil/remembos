// Any other file (IFC, RVT, ZIP, DOCX, CAD, …): stored exactly as added; whatever text can be read cheaply is
// made searchable so the file can be found by more than its name.
//   - Office documents (DOCX/XLSX/PPTX and OpenDocument) → the words inside (they're zip archives of XML)
//   - IFC / STEP models → element types, names and property values (the quoted strings in the file)
//   - anything else that is really text (code, logs, config, XML, …) → the text itself
//   - binary files (RVT, ZIP, executables, …) → no text; found by name and date
import { LIMITS } from "../config";
import { cleanText, formatBytes } from "../utils";
import type { Extracted, ExtractContext } from "./context";
import { extensionOf } from "./detect";

const OFFICE_EXT = new Set(["docx", "docm", "dotx", "xlsx", "xlsm", "pptx", "pptm", "odt", "ods", "odp"]);
const STEP_EXT = new Set(["ifc", "stp", "step", "p21"]);
/** Zip archives above this are stored without opening (unzipping happens in memory). */
const MAX_OFFICE_BYTES = 60 * 1024 * 1024;
const SNIFF_BYTES = 64 * 1024;

export async function extractGenericFile(blob: Blob, name: string, ctx: ExtractContext): Promise<Extracted> {
  ctx.setStage("reading", "Reading file…");
  const ext = extensionOf(name);
  const label = ext ? ext.toUpperCase() : "this";
  const storedNote = `Stored as-is — ${label} file, ${formatBytes(blob.size)}. Find it by its name; Download opens it in its own app.`;

  try {
    if (OFFICE_EXT.has(ext) && blob.size <= MAX_OFFICE_BYTES) {
      const text = await officeText(blob, ext);
      return text ? { text } : { text: "", emptyNote: storedNote };
    }
    if (STEP_EXT.has(ext)) {
      const raw = await readText(blob.slice(0, LIMITS.maxGenericTextBytes));
      const text = stepText(raw);
      return text ? { text } : { text: "", emptyNote: storedNote };
    }
    const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
    if (looksLikeText(head)) {
      const text = cleanText(await readText(blob.slice(0, LIMITS.maxGenericTextBytes)));
      return text ? { text } : { text: "", emptyNote: storedNote };
    }
  } catch (err) {
    // Unreadable or unusual inside: still keep the file — it's findable by name.
    console.warn("[remembos] couldn't read text from", name, err);
  }
  return { text: "", emptyNote: storedNote };
}

async function readText(blob: Blob): Promise<string> {
  return new TextDecoder("utf-8", { fatal: false }).decode(await blob.arrayBuffer());
}

/** Mostly printable UTF-8 with no NUL bytes → text. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  let control = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) control++;
  }
  if (control / bytes.length > 0.02) return false;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const bad = decoded.split("�").length - 1;
  return bad / Math.max(1, decoded.length) < 0.02;
}

/** IFC / STEP: entity types (IFCWALL → "wall") and every quoted string (names, types, property values). */
export function stepText(raw: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    const v = s.trim();
    if (v.length < 2 || seen.has(v.toLowerCase())) return;
    // Skip IFC GUIDs (22 chars of base64-ish noise) and bare numbers.
    if (/^[0-9A-Za-z_$]{22}$/.test(v) || /^[\d.,\s-]+$/.test(v)) return;
    seen.add(v.toLowerCase());
    out.push(v);
  };
  // Entity types are written as one capitalised word (IFCWALLSTANDARDCASE) — keep them lowercase without the
  // "IFC" prefix so a search for "wall" or "door" finds them by prefix.
  for (const m of raw.matchAll(/=\s*IFC([A-Z0-9_]+)\s*\(/g)) add(m[1].toLowerCase());
  for (const m of raw.matchAll(/'((?:[^']|'')*)'/g)) add(decodeStepString(m[1]));
  return cleanText(out.join("\n"));
}

/** STEP strings: '' → ', and \X2\hhhh\X0\ unicode escapes. */
function decodeStepString(s: string): string {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_m, hex: string) => {
      let r = "";
      for (let i = 0; i + 4 <= hex.length; i += 4) r += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      return r;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Words inside an Office Open XML / OpenDocument file. */
async function officeText(blob: Blob, ext: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const wanted = (path: string): boolean => {
    if (ext.startsWith("doc") || ext === "dotx") return /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(path);
    if (ext.startsWith("xls")) return path === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(path);
    if (ext.startsWith("ppt")) return /^ppt\/(slides|notesSlides)\/\w+\d+\.xml$/.test(path);
    return path === "content.xml"; // OpenDocument
  };
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (f) => wanted(f.name) });
  const names = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const parts = names.map((n) => xmlToText(strFromU8(files[n])));
  return cleanText(parts.join("\n\n")).slice(0, LIMITS.maxTextChars);
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<(w:p|a:p|text:p|text:h|row)\b[^>]*>/g, "\n")
    .replace(/<(w:tab|text:tab)\b[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n");
}
