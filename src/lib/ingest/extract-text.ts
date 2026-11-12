// Text-like files → plain text: encoding detection, HTML/XML/RTF/JSON clean-up, and .vtt/.srt transcripts.
import { LIMITS } from "../config";
import { cleanText } from "../utils";
import { extensionOf } from "./detect";
import { IngestError } from "./errors";
import type { Extracted } from "./context";

/** Decode bytes as text: BOM-aware UTF-8/UTF-16, falling back to Windows-1252 when UTF-8 is clearly wrong. */
export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  let bad = 0;
  for (let i = 0; i < utf8.length; i++) if (utf8.charCodeAt(i) === 0xfffd) bad++;
  if (bad > 0 && bad >= Math.max(1, utf8.length * 0.001)) {
    try {
      // Some runtimes decode "windows-1252" as Latin-1; map the 0x80–0x9F range explicitly.
      return new TextDecoder("windows-1252").decode(bytes).replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0)] ?? c);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

/** Normalise line endings and drop control characters; reject things that are clearly binary. */
function sanitize(text: string): string {
  const sample = text.slice(0, 20_000);
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) control++;
  }
  if (sample.length > 0 && control / sample.length > 0.1) {
    throw new IngestError("This doesn't look like a text file, so there's nothing to read in it.");
  }
  return text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, "");
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NAV", "NOSCRIPT", "TEMPLATE", "IFRAME", "SVG", "CANVAS", "OBJECT", "EMBED", "HEAD"]);
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "CAPTION", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "OL",
  "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TFOOT", "THEAD", "TR", "UL",
]);

/** Visible text of an HTML page with paragraph breaks kept (no scripts, styles or navigation). */
export function htmlToText(html: string): { text: string; title?: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = doc.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() || undefined;
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.nodeValue ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag) || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return;
    if (tag === "BR") {
      out.push("\n");
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) out.push("\n\n");
    if (tag === "LI") out.push("• ");
    if (tag === "TD" || tag === "TH") out.push(" ");
    if (tag === "PRE") {
      out.push(el.textContent ?? "");
    } else {
      for (const child of Array.from(el.childNodes)) walk(child);
    }
    if (tag === "TD" || tag === "TH") out.push(" \t");
    if (block) out.push("\n\n");
  };
  walk(doc.body ?? doc.documentElement);
  const text = out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");
  return { text: cleanText(text), title };
}

/** Text content of an XML document, one element's text per line. */
function xmlToText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    return cleanText(xml.replace(/<[^>]+>/g, "\n").replace(/\n\s*\n+/g, "\n"));
  }
  const lines: string[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (t) lines.push(t);
  }
  return cleanText(lines.join("\n"));
}

const RTF_SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr",
  "listtable", "listoverridetable", "rsidtbl", "xmlnstbl", "themedata", "colorschememapping", "datastore",
  "latentstyles", "generator", "filetbl", "revtbl", "object", "fldinst", "mmathPr", "pgdsctbl",
]);

/** Windows-1252 bytes 0x80–0x9F that differ from Latin-1. */
const CP1252: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š",
  0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

/** Crude but robust RTF → text: drops formatting groups, keeps paragraphs, decodes \'hh and \uN escapes. */
export function rtfToText(rtf: string): string {
  const out: string[] = [];
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkipChars = 0;
  let i = 0;
  const emit = (s: string) => {
    if (pendingSkipChars > 0) {
      pendingSkipChars--;
      return;
    }
    if (!skip) out.push(s);
  };
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === "{") {
      stack.push({ skip, uc });
      i++;
      if (rtf.startsWith("\\*", i)) skip = true;
      continue;
    }
    if (ch === "}") {
      const prev = stack.pop();
      if (prev) {
        skip = prev.skip;
        uc = prev.uc;
      }
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = rtf[i + 1];
      if (next === undefined) break;
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
        continue;
      }
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        if (!Number.isNaN(code)) emit(CP1252[code] ?? String.fromCharCode(code));
        i += 4;
        continue;
      }
      if (next === "~") {
        emit(" ");
        i += 2;
        continue;
      }
      if (next === "-" || next === "*") {
        i += 2;
        continue;
      }
      if (next === "_") {
        emit("-");
        i += 2;
        continue;
      }
      if (next === "\n" || next === "\r") {
        emit("\n");
        i += 2;
        continue;
      }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
      if (!m) {
        i += 2;
        continue;
      }
      const word = m[1];
      const param = m[2] !== undefined ? parseInt(m[2], 10) : undefined;
      i += 1 + m[0].length;
      if (RTF_SKIP_DESTINATIONS.has(word)) skip = true;
      else if (word === "par" || word === "line" || word === "sect" || word === "page") emit("\n");
      else if (word === "row") emit("\n");
      else if (word === "tab" || word === "cell") emit("\t");
      else if (word === "emdash") emit("—");
      else if (word === "endash") emit("–");
      else if (word === "bullet") emit("•");
      else if (word === "lquote") emit("‘");
      else if (word === "rquote") emit("’");
      else if (word === "ldblquote") emit("“");
      else if (word === "rdblquote") emit("”");
      else if (word === "uc" && param !== undefined) uc = param;
      else if (word === "u" && param !== undefined) {
        emit(String.fromCharCode(param < 0 ? param + 65536 : param));
        pendingSkipChars = uc;
      }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    emit(ch);
    i++;
  }
  return cleanText(out.join("").split("\n").map((l) => l.trim()).join("\n"));
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Seconds from "01:02:03.456", "02:03,456" or "02:03". */
function parseTimestamp(ts: string): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(ts.trim());
  if (!m) return undefined;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const ms = m[4] ? parseInt(m[4].padEnd(3, "0"), 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + ms / 1000;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * Subtitles/transcripts (.vtt, .srt) → readable text: no cue numbers, timestamps, styling or position tags.
 * Voice tags become "Speaker: …"; rolling-caption repeats are removed.
 */
export function parseTranscript(raw: string): { text: string; durationSec?: number } {
  const blocks = raw.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split(/\n{2,}/);
  const lines: string[] = [];
  let duration: number | undefined;
  for (const block of blocks) {
    const rows = block.split("\n").map((r) => r.trim()).filter(Boolean);
    if (!rows.length) continue;
    if (/^WEBVTT\b/.test(rows[0]) && !rows.some((r) => r.includes("-->"))) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(rows[0])) continue;
    let textRows = rows;
    const arrow = rows.findIndex((r) => r.includes("-->"));
    if (arrow >= 0) {
      const end = rows[arrow].split("-->")[1]?.trim().split(/\s+/)[0];
      const endSec = end ? parseTimestamp(end) : undefined;
      if (endSec !== undefined) duration = Math.max(duration ?? 0, endSec);
      textRows = rows.slice(arrow + 1);
    } else if (/^WEBVTT\b/.test(rows[0]) || /^\d+$/.test(rows[0])) {
      textRows = rows.slice(1);
    }
    for (const row of textRows) {
      let t = row
        .replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>/gi, "$1: ")
        .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, "")
        .replace(/<\/?[a-z][^>]*>/gi, "")
        .replace(/\{\\[^}]*\}/g, "")
        .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e: string) => ENTITIES[e] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!t) continue;
      if (/^\[[^\]]*\]$/.test(t) && /music|applause|laugh|silence|noise|inaudible/i.test(t)) continue;
      t = t.replace(/^-\s+/, "");
      if (lines.length && lines[lines.length - 1] === t) continue;
      lines.push(t);
    }
  }
  return { text: cleanText(lines.join("\n")), durationSec: duration };
}

/** Read a dropped text-like file into plain text. */
export async function extractTextFile(blob: Blob, name: string, mimeType?: string): Promise<Extracted> {
  const ext = extensionOf(name);
  const mime = (mimeType || blob.type || "").toLowerCase();
  const raw = sanitize(decodeText(await blob.arrayBuffer()));
  let text: string;
  let title: string | undefined;
  if (ext === "html" || ext === "htm" || mime === "text/html" || mime === "application/xhtml+xml") {
    const res = htmlToText(raw);
    text = res.text;
    title = res.title;
  } else if (ext === "json" || mime === "application/json") {
    text = prettyJson(raw).trim();
  } else if (ext === "rtf" || mime.includes("rtf") || raw.startsWith("{\\rtf")) {
    text = rtfToText(raw);
  } else if (ext === "xml" || mime.endsWith("/xml")) {
    text = xmlToText(raw);
  } else {
    text = raw.trim();
  }
  return { text: text.slice(0, LIMITS.maxTextChars), title, emptyNote: "This file has no text in it" };
}

/** Read a .vtt/.srt transcript (no audio involved). */
export async function extractTranscriptFile(blob: Blob): Promise<Extracted> {
  const raw = sanitize(decodeText(await blob.arrayBuffer()));
  const { text, durationSec } = parseTranscript(raw);
  return { text, durationSec, emptyNote: "This transcript has no text in it" };
}
