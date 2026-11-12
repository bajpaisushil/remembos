import type { EntityType, MemoryKind, ModelId } from "./types";

export const APP_NAME = "Remembos";
export const APP_TAGLINE = "Never forget where you saw something.";

/** Base path when hosted under a sub-folder (e.g. GitHub Pages). Empty on root hosting. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const ROUTES = {
  home: "/",
  search: "/search/",
  library: "/library/",
  item: "/item/", // ?id=<itemId>
  graph: "/graph/",
  data: "/data/",
  storage: "/storage/", // "Where your data lives" — storage mediums, on-disk locations, live inspector
  explorer: "/storage/explorer/", // in-app IndexedDB explorer; ?item=<id> opens at that memory's records
  help: "/help/",
} as const;

/**
 * Every place Remembos (and the libraries it loads) keeps anything in the browser.
 * Single source of truth for the storage guide page, clear-data logic and the inspector.
 */
export const STORAGE_NAMES = {
  /** IndexedDB database with all memories (tables: items, files, thumbs, chunks, entities, meta). */
  appDb: "remembos",
  /** localStorage key holding small preferences (Settings). */
  settingsKey: "remembos:settings:v1",
  /** localStorage/sessionStorage key prefix used by Remembos. */
  keyPrefix: "remembos:",
  /** Cache Storage caches created by transformers.js for model files. */
  modelCaches: ["transformers-cache", "experimental_transformers-hash-cache", "remembos-cdn"],
  /** IndexedDB database created by tesseract.js (idb-keyval) to cache OCR language data. */
  ocrDb: "keyval-store",
  /** Cache Storage cache where the service worker keeps the AI helpers' public code files (jsDelivr) for offline use. */
  cdnCache: "remembos-cdn",
  /** Cache Storage cache prefix used by our service worker for the offline app shell. */
  swCachePrefix: "remembos-shell-",
  /** Cache Storage cache used by the service worker to hand files shared from other apps (Android share sheet) to the page. */
  shareCache: "remembos-share",
  /** Remembos sets no cookies. */
  cookies: [] as string[],
} as const;

export const itemHref = (id: string) => `${ROUTES.item}?id=${encodeURIComponent(id)}`;
export const searchHref = (q: string) => `${ROUTES.search}?q=${encodeURIComponent(q)}`;
/** In-app IndexedDB explorer, optionally focused on one memory's stored records. */
export const explorerHref = (itemId?: string) =>
  itemId ? `${ROUTES.explorer}?item=${encodeURIComponent(itemId)}` : ROUTES.explorer;

// ---------- Local AI models (downloaded once, cached by the browser) ----------
// Only model *weights/code* are downloaded. User data never leaves the device.

export const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;
export const WHISPER_MODEL = "onnx-community/whisper-tiny.en";
export const OCR_LANG_DEFAULT = "eng";

export const MODELS: Record<ModelId, { label: string; purpose: string; approxBytes: number }> = {
  embedder: { label: "Meaning search", purpose: "Finds memories by meaning, not just exact words", approxBytes: 29_000_000 },
  ocr: { label: "Text reader (OCR)", purpose: "Reads text inside screenshots, photos and scanned PDFs", approxBytes: 15_000_000 },
  whisper: { label: "Voice transcriber", purpose: "Turns voice recordings into searchable text", approxBytes: 45_000_000 },
};

// ---------- Limits & thresholds ----------

export const LIMITS = {
  /** Warn (but allow) files above this. */
  largeFileBytes: 50 * 1024 * 1024,
  /** Refuse files above this — browsers struggle beyond it. */
  maxFileBytes: 300 * 1024 * 1024,
  /** Max PDF pages to OCR when a PDF has no text layer. */
  maxOcrPdfPages: 30,
  /** Max video frames to OCR (evenly sampled) and the longest video we OCR frames for. */
  maxVideoOcrFrames: 6,
  maxVideoOcrSeconds: 30 * 60,
  /** Longest in-app voice recording (seconds). */
  maxRecordingSeconds: 30 * 60,
  /** Max audio duration to transcribe (seconds). */
  maxAudioSeconds: 60 * 60,
  /** Max characters kept per item text. */
  maxTextChars: 2_000_000,
  chunkTargetChars: 700,
  chunkOverlapChars: 120,
} as const;

export const STORAGE_THRESHOLDS = {
  /** Show a gentle heads-up. */
  warn: 0.7,
  /** Show a strong warning. */
  critical: 0.9,
  /** Block new imports (would likely fail). */
  block: 0.97,
  /** Quota below this suggests a private/incognito window. */
  privateQuotaBytes: 400 * 1024 * 1024,
  /** Nudge to back up after this many days without a backup (if ≥ backupNudgeMinItems). */
  backupNudgeDays: 14,
  backupNudgeMinItems: 10,
  /** How often the watcher re-checks storage (ms). */
  pollMs: 60_000,
} as const;

// ---------- Visual language per kind / entity ----------
// Tailwind class names are spelled out literally so Tailwind can detect them.

export const KIND_META: Record<
  MemoryKind,
  { label: string; plural: string; blurb: string; accept: string; color: string; bg: string; ring: string; gradient: string }
> = {
  image: {
    label: "Screenshot",
    plural: "Screenshots & photos",
    blurb: "Reads every word inside images",
    accept: "PNG, JPG, WEBP, GIF, BMP",
    color: "text-violet-600 dark:text-violet-300",
    bg: "bg-violet-500/10",
    ring: "ring-violet-500/30",
    gradient: "from-violet-500 to-fuchsia-500",
  },
  pdf: {
    label: "PDF",
    plural: "PDFs & documents",
    blurb: "Text layer + OCR for scans",
    accept: "PDF",
    color: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-500/10",
    ring: "ring-rose-500/30",
    gradient: "from-rose-500 to-orange-500",
  },
  video: {
    label: "Video",
    plural: "Videos & screen recordings",
    blurb: "Speech transcribed, on-screen text read",
    accept: "MP4, MOV, WEBM, M4V",
    color: "text-blue-600 dark:text-blue-300",
    bg: "bg-blue-500/10",
    ring: "ring-blue-500/30",
    gradient: "from-blue-500 to-indigo-500",
  },
  voice: {
    label: "Voice",
    plural: "Voice & transcripts",
    blurb: "Transcribed on your device",
    accept: "MP3, M4A, WAV, WEBM, OGG, VTT, SRT",
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/30",
    gradient: "from-amber-500 to-yellow-400",
  },
  text: {
    label: "Text",
    plural: "Copied text & files",
    blurb: "Paste anything, or drop TXT/MD/CSV/HTML",
    accept: "TXT, MD, CSV, JSON, HTML",
    color: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/30",
    gradient: "from-sky-500 to-cyan-400",
  },
  note: {
    label: "Note",
    plural: "Notes & decisions",
    blurb: "Jot thoughts you want to find later",
    accept: "Typed in Remembos",
    color: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/30",
    gradient: "from-emerald-500 to-teal-400",
  },
};

export const ENTITY_META: Record<EntityType, { label: string; color: string; hex: string }> = {
  phone: { label: "Phone", color: "text-emerald-600 dark:text-emerald-300", hex: "#10b981" },
  email: { label: "Email", color: "text-sky-600 dark:text-sky-300", hex: "#0ea5e9" },
  url: { label: "Link", color: "text-indigo-600 dark:text-indigo-300", hex: "#6366f1" },
  money: { label: "Amount", color: "text-amber-600 dark:text-amber-300", hex: "#f59e0b" },
  date: { label: "Date", color: "text-pink-600 dark:text-pink-300", hex: "#ec4899" },
  name: { label: "Name", color: "text-violet-600 dark:text-violet-300", hex: "#8b5cf6" },
  topic: { label: "Topic", color: "text-slate-600 dark:text-slate-300", hex: "#64748b" },
  tag: { label: "Tag", color: "text-teal-600 dark:text-teal-300", hex: "#14b8a6" },
};

/** Hex colors for kinds — for canvas drawing (graph). */
export const KIND_HEX: Record<MemoryKind, string> = {
  image: "#8b5cf6",
  pdf: "#f43f5e",
  video: "#3b82f6",
  voice: "#f59e0b",
  text: "#0ea5e9",
  note: "#10b981",
};
