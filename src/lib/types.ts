// Shared domain types for Remembos. This file is the contract between modules —
// change it only deliberately; every module imports from here.

/** What kind of memory an item is. Drives icon, color, extractor and filters. */
export type MemoryKind =
  | "image" // screenshots, photos (png, jpg, webp, gif, bmp, heic?) → OCR
  | "pdf" // PDFs → text layer, OCR fallback for scanned pages
  | "voice" // audio files + in-app voice recordings (→ local Whisper) and transcript files (.vtt/.srt)
  | "video" // videos & screen recordings (mp4/mov/webm/m4v) → transcript + OCR of sampled frames
  | "text" // copied/pasted text, .txt/.md/.csv/.json/.html files
  | "note" // notes typed inside Remembos
  | "file"; // any other file (IFC, RVT, ZIP, DOCX, CAD…) — stored as-is; text-based formats are also searched

export const MEMORY_KINDS: MemoryKind[] = ["image", "pdf", "video", "voice", "text", "note", "file"];

export type ItemStatus = "processing" | "ready" | "error";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  /** Full extracted/plain text. May be "" while processing or if nothing found. */
  text: string;
  /** Short cleaned preview (≤ 280 chars). */
  summary: string;
  /** When it was added to Remembos (ms epoch). */
  createdAt: number;
  updatedAt: number;
  /** Original file's lastModified (ms epoch), if known. */
  sourceDate?: number;
  /** Original file name, if it came from a file. */
  sourceName?: string;
  mimeType?: string;
  /** Bytes of the original file, or text length for text/notes. */
  size: number;
  status: ItemStatus;
  error?: string;
  /** Original blob stored in `files` table. */
  hasFile: 0 | 1;
  /** Small preview image stored in `thumbs` table. */
  hasThumb: 0 | 1;
  pageCount?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  /** Mean OCR confidence 0..100, when OCR was used. */
  ocrConfidence?: number;
  /** User tags (lowercase, no '#'). */
  tags: string[];
  /** Entity ids mentioned by this item (see Entity.id). */
  entityIds: string[];
  pinned: 0 | 1;
  /** 1 when all chunks have embeddings (semantic search ready). */
  embedded: 0 | 1;
  /** true for demo items created by "Try sample memories". */
  sample?: boolean;
}

export interface StoredFile {
  itemId: string;
  blob: Blob;
}

export interface StoredThumb {
  itemId: string;
  /** Small webp/jpeg, ≤ 480px longest side. */
  blob: Blob;
}

export interface Chunk {
  /** `${itemId}:${index}` */
  id: string;
  itemId: string;
  index: number;
  text: string;
  /** 1-based page number for PDFs. */
  page?: number;
  /** Character offsets into item.text. */
  start: number;
  end: number;
  /** L2-normalised embedding (length = EMBEDDING_DIM), absent until embedded. */
  embedding?: Float32Array;
}

export type EntityType =
  | "phone"
  | "email"
  | "url"
  | "money"
  | "date"
  | "name" // proper-noun phrase: person / company / product / place (heuristic)
  | "topic" // salient keyword for the item
  | "tag"; // #hashtag or user tag

export const ENTITY_TYPES: EntityType[] = ["phone", "email", "url", "money", "date", "name", "topic", "tag"];

export interface Entity {
  /** `${type}:${normalized}` */
  id: string;
  type: EntityType;
  /** Display value (first-seen original casing/format). */
  value: string;
  normalized: string;
  itemIds: string[];
  /** Total mentions across items. */
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** An entity as produced by the extractor for a single text (before DB upsert). */
export interface ExtractedEntity {
  type: EntityType;
  value: string;
  normalized: string;
  /** Mentions within this text. */
  count: number;
  /** Character offset of first mention in the text, for context snippets. */
  index: number;
}

export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

/** Output of a file extractor (image/pdf/voice/text). */
export interface ExtractionResult {
  text: string;
  /** For paged sources (PDF), the text per page; chunker keeps page numbers. */
  pages?: string[];
  title?: string;
  pageCount?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  ocrConfidence?: number;
  thumb?: Blob;
}

/** A chunk before it is stored (no id/itemId yet). */
export interface ChunkDraft {
  index: number;
  text: string;
  page?: number;
  start: number;
  end: number;
}

// ---------- Query / search ----------

export interface DateRange {
  from: number; // inclusive ms epoch
  to: number; // exclusive ms epoch
  label: string; // e.g. "last month"
}

export interface ParsedQuery {
  raw: string;
  /** Query with time phrases / filler / intent words removed — for keyword search. */
  keywords: string;
  /** Natural-language query for semantic search (time phrases removed). */
  semantic: string;
  dateRange?: DateRange;
  /** Entity types the user is asking for, e.g. "phone number" → ["phone"]. */
  intents: EntityType[];
  /** Kinds hinted by the query, e.g. "screenshot" → ["image"]. Used as a boost, not a hard filter. */
  kindHints: MemoryKind[];
}

export interface Snippet {
  chunkId: string;
  text: string;
  /** [start, end) ranges within `text` to highlight. */
  highlights: [number, number][];
  page?: number;
}

export interface SearchHit {
  item: MemoryItem;
  score: number;
  snippets: Snippet[];
  matched: ("keyword" | "semantic" | "entity")[];
}

export interface SmartAnswer {
  type: EntityType;
  value: string;
  itemId: string;
  itemTitle: string;
  itemKind: MemoryKind;
  /** ~120 chars of surrounding text. */
  context: string;
}

export interface SearchOptions {
  /** Hard filter by kind. */
  kinds?: MemoryKind[];
  limit?: number;
  /** Force semantic on/off (defaults to settings + model availability). */
  semantic?: boolean;
  dateRange?: DateRange;
}

export interface SearchResponse {
  query: ParsedQuery;
  hits: SearchHit[];
  answers: SmartAnswer[];
  tookMs: number;
  semanticUsed: boolean;
  /** Why semantic wasn't used, if it wasn't (e.g. "model loading"). */
  semanticNote?: string;
}

// ---------- Graph ----------

export interface GraphNode {
  id: string; // item id or entity id
  kind: "item" | "entity";
  label: string;
  itemKind?: MemoryKind;
  entityType?: EntityType;
  /** Degree or importance, used for radius. */
  weight: number;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: "mentions" | "similar";
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

// ---------- Background work / models ----------

export type JobStage =
  | "queued"
  | "reading"
  | "ocr"
  | "transcribing"
  | "extracting"
  | "indexing"
  | "embedding"
  | "done"
  | "error"
  | "cancelled";

export interface QueueJob {
  id: string;
  itemId: string;
  name: string;
  kind: MemoryKind;
  size: number;
  stage: JobStage;
  /** 0..1 within the current stage (or overall when stage is simple). */
  progress: number;
  message?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type ModelId = "embedder" | "ocr" | "whisper";

export interface ModelStatus {
  state: "idle" | "loading" | "ready" | "error" | "disabled";
  /** 0..1 download/init progress while loading. */
  progress?: number;
  loadedBytes?: number;
  totalBytes?: number;
  error?: string;
  device?: "webgpu" | "wasm";
}

// ---------- Storage ----------

export type BrowserId = "chrome" | "edge" | "firefox" | "safari" | "ios-safari" | "samsung" | "brave" | "opera" | "other";

export interface StorageInfo {
  supported: boolean;
  /** Bytes used by this origin (all storage incl. model caches). */
  usage: number;
  /** Bytes the browser allows this origin. */
  quota: number;
  /** usage / quota, 0..1 */
  ratio: number;
  /** Whether the browser promised not to evict data. null = unknown/unsupported. */
  persisted: boolean | null;
  /** Very small quota → probably a private/incognito window. */
  likelyPrivate: boolean;
  /** Counts from IndexedDB. */
  itemCount: number;
  /** Sum of item.size for stored originals. */
  filesBytes: number;
  checkedAt: number;
}
