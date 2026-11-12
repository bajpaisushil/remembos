// File type detection for ingest: which memory kind a file becomes, and friendly reasons when it can't.
import type { MemoryKind } from "../types";

/** Image formats every modern browser decodes. */
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp", "webp", "gif", "bmp", "avif"]);
/** Image formats only some browsers decode (Safari reads HEIC/TIFF, Chrome does not) — checked by trying. */
const MAYBE_IMAGE_EXT = new Set(["heic", "heif", "tif", "tiff"]);
const AUDIO_EXT = new Set(["m4a", "mp3", "wav", "ogg", "oga", "opus", "weba", "flac", "aac"]);
/** Video containers browsers play. ".webm"/".mp4" can also hold sound only — see detectKind. */
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "ogv"]);
/** Video formats browsers can't play (no way to read their frames or sound here). */
const UNPLAYABLE_VIDEO_EXT = new Set(["avi", "wmv", "flv", "f4v", "3gp", "3g2", "mpg", "mpeg", "m2ts", "vob", "asf", "rm", "rmvb", "divx"]);
const TRANSCRIPT_EXT = new Set(["vtt", "srt"]);
const TEXT_EXT = new Set(["txt", "text", "md", "markdown", "csv", "tsv", "json", "html", "htm", "xml", "log", "rtf", "vcf"]);

const TEXT_MIME = new Set([
  "application/json",
  "application/xml",
  "application/rtf",
  "application/x-rtf",
  "application/xhtml+xml",
]);

/** Value for <input type="file" accept=...>. */
export const ACCEPTED_FILE_TYPES = [
  "image/*",
  "application/pdf",
  "audio/*",
  "video/*",
  ".heic,.heif",
  ".m4a,.mp3,.wav,.ogg,.oga,.opus,.weba,.flac,.aac",
  ".mp4,.mov,.m4v,.webm,.mkv,.ogv",
  ".txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.xml,.log,.vcf",
  ".vtt,.srt,.rtf",
].join(",");

/** Lower-case extension without the dot ("" when none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** File name without its extension, trimmed; falls back to the full name. */
export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return base.trim() || name.trim() || "Untitled";
}

/** Shorten long file names for toasts, keeping the extension visible: "Very long na…me.png". */
export function shortName(name: string, max = 36): string {
  if (name.length <= max) return name;
  const ext = extensionOf(name);
  const tail = ext ? `.${ext}` : "";
  const keep = Math.max(8, max - tail.length - 1);
  const head = Math.ceil(keep * 0.7);
  const end = keep - head;
  const base = tail ? name.slice(0, name.length - tail.length) : name;
  return `${base.slice(0, head).trimEnd()}…${base.slice(base.length - end)}${tail}`;
}

/** Subtitle files that are already transcripts (no audio to decode). */
export function isTranscriptName(name: string): boolean {
  return TRANSCRIPT_EXT.has(extensionOf(name));
}

/** True when the image type must be test-decoded before accepting it (HEIC, TIFF, unknown image/*). */
export function needsDecodeCheck(file: File): boolean {
  const ext = extensionOf(file.name);
  if (IMAGE_EXT.has(ext)) return false;
  if (MAYBE_IMAGE_EXT.has(ext)) return true;
  const mime = file.type.toLowerCase();
  return mime.startsWith("image/") && !/^image\/(png|jpe?g|pjpeg|webp|gif|bmp|x-ms-bmp|avif)$/.test(mime);
}

/** HEIC/HEIF specifically (for the "export as JPG" guidance). */
export function isHeic(file: File): boolean {
  const ext = extensionOf(file.name);
  return ext === "heic" || ext === "heif" || /^image\/hei[cf]/i.test(file.type);
}

/** Try decoding an image the browser may not support. */
export async function canDecodeImage(file: Blob): Promise<boolean> {
  if (typeof createImageBitmap !== "function") return false;
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Which kind a file would become, or null if unsupported. Extension wins over MIME (MIME is often missing or
 * wrong) — except for video containers, which also carry sound-only recordings: an "audio/…" type there
 * (e.g. the in-app recorder's audio/webm, Safari's audio/mp4) means a voice memo. Video files that turn out
 * to have no picture are re-filed as voice while processing.
 */
export function detectKind(file: File): MemoryKind | null {
  const ext = extensionOf(file.name);
  const mime = (file.type || "").toLowerCase();

  if (TRANSCRIPT_EXT.has(ext)) return "voice";
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.has(ext) || MAYBE_IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return mime.startsWith("audio/") ? "voice" : "video";
  if (AUDIO_EXT.has(ext)) return "voice";
  if (TEXT_EXT.has(ext)) return "text";
  if (ext === "svg" || UNPLAYABLE_VIDEO_EXT.has(ext)) return null;

  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf";
  if (mime === "text/vtt" || mime === "application/x-subrip" || mime === "text/srt") return "voice";
  if (mime.startsWith("image/")) return mime.includes("svg") ? null : "image";
  // (macOS labels TypeScript ".ts" files video/mp2t — those aren't videos either.)
  if (mime.startsWith("video/")) return /x-msvideo|x-ms-wmv|x-ms-asf|x-flv|3gpp|mpeg$|mp2t/.test(mime) ? null : "video";
  if (mime.startsWith("audio/")) return "voice";
  if (mime.startsWith("text/") || TEXT_MIME.has(mime)) return "text";
  return null;
}

/** Short reason + longer hint for a file that detectKind rejected. */
export function unsupportedReason(file: File): { reason: string; hint: string } {
  const ext = extensionOf(file.name);
  const mime = (file.type || "").toLowerCase();
  if (ext === "svg" || mime.includes("svg")) {
    return { reason: "SVG drawings aren't supported", hint: "Export the drawing as PNG and drop that instead." };
  }
  if (ext === "remembos") {
    return { reason: "it's a backup file", hint: "Restore backups from Your data → Backup & restore." };
  }
  if (["doc", "docx", "odt", "pages", "ppt", "pptx", "key", "odp", "xls", "xlsx", "numbers", "ods"].includes(ext)) {
    return { reason: "office files aren't supported yet", hint: "Save or export it as PDF, then drop the PDF." };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return { reason: "archives aren't supported", hint: "Unzip it first, then drop the files inside." };
  }
  if (UNPLAYABLE_VIDEO_EXT.has(ext) || (mime.startsWith("video/") && ext !== "ts")) {
    return {
      reason: "browsers can't play this video format",
      hint: "Convert it to MP4 (most phones and screen recorders already save MP4), then add it again.",
    };
  }
  return {
    reason: "this file type isn't supported",
    hint: "Remembos reads screenshots and photos, PDFs, videos, voice recordings and text files.",
  };
}

/**
 * Names that say nothing about the content ("image.png" from the clipboard, random hashes from downloads).
 * For these, the title is derived from the extracted text instead.
 */
export function isGenericName(name: string): boolean {
  const base = baseName(name).trim();
  if (/^(image|img|blob|untitled|unknown|file|clipboard|photo|picture|download)(\s*\(\d+\))?$/i.test(base)) return true;
  if (/^pasted (image|screenshot|file)\b/i.test(base)) return true;
  if (/^[0-9a-f-]{16,}$/i.test(base)) return true;
  return false;
}
