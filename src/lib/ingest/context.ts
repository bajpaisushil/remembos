// Shared internal types for the ingest pipeline.
import type { ExtractionResult, JobStage, MemoryKind } from "../types";

/** What an extractor returns: the shared ExtractionResult plus a summary to show when no text was found. */
export interface Extracted extends ExtractionResult {
  /** Summary used when `text` is empty, e.g. "No text found in this image". */
  emptyNote?: string;
  /**
   * Something worth knowing about a partial result when there IS text (e.g. "Sound not transcribed: this
   * video's audio couldn't be read"). Shown in front of the summary.
   */
  summaryNote?: string;
  /** The file turned out to be another kind than its name suggested (a .webm/.mp4 with no picture → "voice"). */
  kind?: MemoryKind;
}

/** Handed to extractors by the queue: progress reporting, cancellation and the one-model-at-a-time lock. */
export interface ExtractContext {
  readonly signal: AbortSignal;
  /** File name, for messages. */
  readonly name: string;
  /** Move to a new stage (progress resets to 0). */
  setStage(stage: JobStage, message?: string): void;
  /** Progress 0..1 within the current stage. */
  setProgress(progress: number, message?: string): void;
  /** Run heavy model work (OCR, transcription) while holding the shared lock — one model job at a time. */
  heavy<T>(fn: () => Promise<T>): Promise<T>;
}
