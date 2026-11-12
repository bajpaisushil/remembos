/**
 * Pure helpers shared by the storage modules (monitor, backup, clear, sample).
 *
 * Nothing in this file touches browser APIs at import time, so every function here can be
 * unit-tested in Node: file naming, MIME/extension mapping, archive paths, Markdown rendering,
 * browser classification and storage-error classification.
 */
import { isQuotaError } from "../db";
import type { BrowserId, MemoryItem } from "../types";

export const DAY_MS = 86_400_000;

/** `meta` table key listing the ids of demo items created by "Try sample memories". */
export const SAMPLE_IDS_META_KEY = "storage:sampleItemIds";

// ---------- Dates & file names ----------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar date as YYYY-MM-DD (what people expect to see in a file name). */
export function localDateStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Local date + time as "YYYY-MM-DD HH:mm" — unambiguous in any language. */
export function localDateTime(ms: number): string {
  const d = new Date(ms);
  return `${localDateStamp(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function backupFilename(d: Date = new Date()): string {
  return `remembos-backup-${localDateStamp(d)}.zip`;
}

export function markdownFilename(d: Date = new Date()): string {
  return `remembos-memories-${localDateStamp(d)}.md`;
}

/** Whole days between two instants (floored, never negative). */
export function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// ---------- MIME types & extensions ----------

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "application/pdf": "pdf",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "audio/flac": "flac",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "text/tab-separated-values": "tsv",
  "application/json": "json",
  "text/html": "html",
  "application/xml": "xml",
  "text/xml": "xml",
  "text/vtt": "vtt",
  "application/x-subrip": "srt",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  webm: "audio/webm",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  flac: "audio/flac",
  txt: "text/plain",
  log: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  vtt: "text/vtt",
  srt: "application/x-subrip",
  rtf: "application/rtf",
};

const baseMime = (mime?: string) => (mime ? mime.split(";")[0].trim().toLowerCase() : "");

/** File extension for a stored blob: the original name's extension wins, then the MIME type. */
export function extensionFor(mime?: string, name?: string): string {
  const fromName = name?.match(/\.([a-z0-9]{1,10})$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return MIME_TO_EXT[baseMime(mime)] ?? "bin";
}

/** Best MIME type for an extension (used when restoring blobs from a backup). */
export function mimeForExtension(ext: string): string {
  return EXT_TO_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}

/**
 * True when deflating the blob would waste time for (almost) no gain — JPEG/PNG/WebP, PDF,
 * compressed audio/video, archives. Those are stored as-is (zip method 0).
 */
export function isAlreadyCompressed(mime?: string, ext?: string): boolean {
  const m = baseMime(mime);
  const e = (ext ?? "").toLowerCase();
  if (m === "image/bmp" || m === "image/svg+xml" || m === "image/tiff" || ["bmp", "svg", "tif", "tiff"].includes(e)) return false;
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave" || e === "wav") return false;
  if (m.startsWith("image/") || m.startsWith("audio/") || m.startsWith("video/")) return true;
  if (m === "application/pdf" || m === "application/zip" || m === "application/gzip") return true;
  return ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif", "pdf", "mp3", "m4a", "aac", "ogg", "opus", "webm", "mp4", "mov", "m4v", "mkv", "ogv", "flac", "zip", "gz"].includes(e);
}

// ---------- Archive paths ----------

export type MediaFolder = "files" | "thumbs";

/** Path of an original/thumbnail inside a backup archive, e.g. `files/abc123.pdf`. */
export function mediaPath(folder: MediaFolder, itemId: string, ext: string): string {
  return `${folder}/${encodeURIComponent(itemId)}.${ext}`;
}

/** Inverse of {@link mediaPath}. Returns null for anything else in the archive. */
export function parseMediaPath(path: string): { folder: MediaFolder; itemId: string; ext: string } | null {
  const m = /^(files|thumbs)\/([^/]+)\.([a-z0-9]{1,10})$/i.exec(path);
  if (!m) return null;
  try {
    return { folder: m[1] as MediaFolder, itemId: decodeURIComponent(m[2]), ext: m[3].toLowerCase() };
  } catch {
    return null;
  }
}

// ---------- Markdown export ----------

const KIND_LABELS: Record<MemoryItem["kind"], string> = {
  image: "Screenshot / photo",
  pdf: "PDF",
  video: "Video",
  file: "File",
  voice: "Voice recording",
  text: "Copied text",
  note: "Note",
};

function formatDurationShort(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}

/** One memory as a Markdown section (heading, details list, full text). */
export function itemToMarkdown(item: MemoryItem): string {
  const title = (item.title || "Untitled memory").replace(/\s+/g, " ").trim();
  const lines: string[] = [`## ${title.replace(/^#+\s*/, "")}`, ""];
  const details: string[] = [`- **Type:** ${KIND_LABELS[item.kind] ?? item.kind}`, `- **Added:** ${localDateTime(item.createdAt)}`];
  if (item.sourceDate) details.push(`- **Original date:** ${localDateTime(item.sourceDate)}`);
  if (item.sourceName) details.push(`- **File:** ${item.sourceName}`);
  if (item.pageCount) details.push(`- **Pages:** ${item.pageCount}`);
  if (item.durationSec) details.push(`- **Length:** ${formatDurationShort(item.durationSec)}`);
  if (item.tags?.length) details.push(`- **Tags:** ${item.tags.map((t) => `#${t}`).join(" ")}`);
  if (item.pinned) details.push(`- **Pinned:** yes`);
  if (item.sample) details.push(`- **Sample memory:** yes`);
  lines.push(...details, "");
  const text = (item.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (text) lines.push(text);
  else if (item.status === "error") lines.push(`_No text could be read from this memory${item.error ? ` (${item.error})` : ""}._`);
  else lines.push("_No text._");
  return lines.join("\n");
}

export function markdownHeader(count: number, exportedAt: number): string {
  return [
    "# Remembos — all memories",
    "",
    `Exported ${localDateTime(exportedAt)} · ${plural(count, "memory", "memories")}`,
    "",
    "This file holds the text of every memory, newest first. Original files (screenshots, PDFs, recordings) are not included — use “Back up” in Remembos for a complete copy you can restore.",
  ].join("\n");
}

// ---------- Browser detection ----------

export interface BrowserHints {
  userAgent: string;
  /** navigator.userAgentData.brands (Chromium only). */
  brands?: string[];
  /** navigator.brave exists (Brave hides itself from the user agent). */
  isBrave?: boolean;
  platform?: string;
  maxTouchPoints?: number;
}

/** iPhone / iPad / iPod — including iPadOS, which pretends to be a Mac. */
export function isAppleMobile(h: BrowserHints): boolean {
  if (/iPad|iPhone|iPod/.test(h.userAgent)) return true;
  return (h.platform === "MacIntel" || /Macintosh/.test(h.userAgent)) && (h.maxTouchPoints ?? 0) > 1;
}

export function classifyBrowser(h: BrowserHints): BrowserId {
  const ua = h.userAgent || "";
  const brands = h.brands ?? [];
  if (h.isBrave || brands.includes("Brave")) return "brave";
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  if (/\bEdg(e|A|iOS)?\//.test(ua) || brands.includes("Microsoft Edge")) return "edge";
  if (/\bOPR\/|\bOPT\/|\bOpera\b/.test(ua) || brands.includes("Opera")) return "opera";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "firefox";
  if (/\bCriOS\/|\bChrome\/|\bChromium\//.test(ua) || brands.includes("Google Chrome")) return "chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return isAppleMobile(h) ? "ios-safari" : "safari";
  if (isAppleMobile(h) && /AppleWebKit/.test(ua)) return "ios-safari";
  return "other";
}

export function isChromiumFamily(b: BrowserId): boolean {
  return b === "chrome" || b === "edge" || b === "brave" || b === "opera" || b === "samsung";
}

// ---------- Storage errors ----------

export type StorageErrorKind =
  | "quota"
  | "unavailable" // IndexedDB missing or blocked by browser settings
  | "version" // another tab upgraded the database
  | "blocked" // another tab holds the database open / database closed
  | "invalid-state"
  | "unknown"
  | "clone" // value (usually a file) can't be stored here
  | "aborted"
  | "other";

/** The error plus everything nested in it (Dexie wraps native errors in `inner` / `failures`). */
export function flattenErrors(err: unknown, depth = 0): unknown[] {
  if (!err || typeof err !== "object" || depth > 4) return err ? [err] : [];
  const out: unknown[] = [err];
  const e = err as { inner?: unknown; failures?: unknown; cause?: unknown };
  if (e.inner) out.push(...flattenErrors(e.inner, depth + 1));
  if (e.cause) out.push(...flattenErrors(e.cause, depth + 1));
  if (Array.isArray(e.failures)) for (const f of e.failures) out.push(...flattenErrors(f, depth + 1));
  else if (e.failures && typeof e.failures === "object") for (const f of Object.values(e.failures)) out.push(...flattenErrors(f, depth + 1));
  return out;
}

/** isQuotaError on one level only (nesting is walked by flattenErrors, safely bounded). */
function isQuotaShallow(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const { name, code, message } = x as { name?: unknown; code?: unknown; message?: unknown };
  return isQuotaError({ name, code, message });
}

export function classifyStorageError(err: unknown): StorageErrorKind {
  const all = flattenErrors(err);
  if (all.some(isQuotaShallow)) return "quota";
  const names = new Set<string>();
  const messages: string[] = [];
  for (const x of all) {
    if (x && typeof x === "object") {
      const { name, message } = x as { name?: unknown; message?: unknown };
      if (typeof name === "string") names.add(name);
      if (typeof message === "string") messages.push(message);
    } else if (typeof x === "string") messages.push(x);
  }
  const msg = messages.join(" ");
  if (names.has("MissingAPIError") || names.has("SecurityError") || /indexedDB API missing|access to the indexeddb api is denied/i.test(msg)) return "unavailable";
  if (names.has("VersionError") || names.has("VersionChangeError") || names.has("UpgradeError")) return "version";
  if (names.has("DatabaseClosedError") || /\bblocked\b/i.test(msg)) return "blocked";
  if (names.has("InvalidStateError") || names.has("TransactionInactiveError")) return "invalid-state";
  if (names.has("UnknownError")) return "unknown";
  if (names.has("DataCloneError")) return "clone";
  if (names.has("AbortError")) return "aborted";
  if (names.has("OpenFailedError")) return "unavailable";
  return "other";
}

/** Gerund phrases ("saving your note") read well inside a sentence; anything else is left out. */
export function describeContext(context?: string): string | null {
  const c = context?.trim();
  if (!c || c.length > 80) return null;
  return /^[a-z]+ing\b/i.test(c) ? c.charAt(0).toLowerCase() + c.slice(1) : null;
}
