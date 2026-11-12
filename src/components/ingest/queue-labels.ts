// Plain-language wording and progress maths for the processing dock. Pure functions (no React, no DOM),
// so the dock stays a thin view over `queueStore`.
import type { JobStage, MemoryKind, QueueJob } from "@/lib/types";

const FINISHED: ReadonlySet<JobStage> = new Set<JobStage>(["done", "error", "cancelled"]);

/** The job has stopped for good (saved, failed or cancelled). */
export function isFinished(job: Pick<QueueJob, "stage">): boolean {
  return FINISHED.has(job.stage);
}

/** The memory is already saved; only meaning search is still being prepared in the background. */
export function isSavedButEmbedding(job: Pick<QueueJob, "stage">): boolean {
  return job.stage === "embedding";
}

/** The memory exists and can be opened (saved, or saved and finishing meaning search). */
export function canOpen(job: Pick<QueueJob, "stage">): boolean {
  return job.stage === "done" || job.stage === "embedding";
}

function percent(progress: number): string {
  const p = Math.round(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100);
  return `${Math.min(p, 99)}%`;
}

/** Messages that already count something ("Reading page 3 of 10…") don't need a percentage too. */
function alreadyCounts(message: string): boolean {
  return /\d+\s*(of|\/)\s*\d+/.test(message);
}

function withPercent(text: string, progress: number): string {
  if (!(progress > 0) || progress >= 1 || alreadyCounts(text)) return text;
  return `${text} ${percent(progress)}`;
}

const READING_FALLBACK: Record<MemoryKind, string> = {
  image: "Opening image…",
  pdf: "Opening PDF…",
  video: "Opening video…",
  file: "Saving file…",
  voice: "Checking the recording…",
  text: "Reading text…",
  note: "Reading text…",
};

/**
 * One short, human line describing what is happening to a job right now, e.g.
 * "Reading text in image… 42%", "Reading page 3 of 10…", "Transcribing… 30%", "Reading video frames…",
 * "Understanding meaning…".
 */
export function stageLabel(job: Pick<QueueJob, "stage" | "kind" | "progress" | "message" | "error">): string {
  const message = job.message?.trim();
  switch (job.stage) {
    case "queued":
      return "Waiting in line…";
    case "reading":
      return withPercent(message || READING_FALLBACK[job.kind], job.progress);
    case "ocr": {
      // The text reader may first need its one-time download; the queue says so in the message.
      if (message && /ready|download|waiting/i.test(message)) return withPercent(message, job.progress);
      if (job.kind === "image") return withPercent("Reading text in image…", job.progress);
      if (job.kind === "video") return withPercent(message || "Reading video frames…", job.progress);
      return withPercent(message || "Reading scanned pages…", job.progress);
    }
    case "transcribing":
      return withPercent(message || (job.kind === "video" ? "Transcribing video…" : "Transcribing…"), job.progress);
    case "extracting":
      return message && /waiting/i.test(message) ? message : "Finding names, dates and links…";
    case "indexing":
      return "Making it searchable…";
    case "embedding":
      return withPercent("Understanding meaning…", job.progress);
    case "done":
      return "Remembered";
    case "error":
      return job.error?.trim() || "Couldn't read this file";
    case "cancelled":
      return "Cancelled";
  }
}

/** Where each stage sits on one overall 0..1 bar, so progress only ever moves forward. */
const STAGE_RANGE: Record<JobStage, [number, number]> = {
  queued: [0, 0],
  reading: [0.03, 0.35],
  ocr: [0.35, 0.82],
  transcribing: [0.35, 0.82],
  extracting: [0.82, 0.88],
  indexing: [0.88, 0.93],
  embedding: [0.93, 0.99],
  done: [1, 1],
  error: [1, 1],
  cancelled: [0, 0],
};

/** Videos pass through two heavy stages (speech, then on-screen text), so they share the middle of the bar. */
const VIDEO_RANGE: Partial<Record<JobStage, [number, number]>> = {
  transcribing: [0.3, 0.58],
  ocr: [0.58, 0.82],
};

/** Overall 0..1 progress of a job across all its stages. */
export function overallProgress(job: Pick<QueueJob, "stage" | "progress"> & { kind?: MemoryKind }): number {
  const [from, to] = (job.kind === "video" ? VIDEO_RANGE[job.stage] : undefined) ?? STAGE_RANGE[job.stage];
  const p = Math.max(0, Math.min(1, Number.isFinite(job.progress) ? job.progress : 0));
  return from + (to - from) * p;
}

/** Highest progress shown so far per running job. */
const peaks = new Map<string, number>();

/**
 * Overall progress that never moves backwards while a job runs (a stage may restart at 0, or a video may
 * read frames before transcribing). Finished jobs report their real value and are forgotten.
 */
export function steadyProgress(job: Pick<QueueJob, "id" | "stage" | "progress" | "kind">): number {
  const value = overallProgress(job);
  if (isFinished(job)) {
    peaks.delete(job.id);
    return value;
  }
  const peak = Math.max(peaks.get(job.id) ?? 0, value);
  peaks.set(job.id, peak);
  return peak;
}

export interface QueueSummary {
  total: number;
  /** Still queued or being read (not counting background meaning search). */
  active: number;
  /** Saved (including those still preparing meaning search). */
  saved: number;
  failed: number;
  cancelled: number;
  /** Everything has stopped (meaning search included). */
  allFinished: boolean;
  /** Average overall progress 0..1 across non-cancelled jobs. */
  progress: number;
  /** Headline for the dock, e.g. "Remembering 2 of 5" or "All done — 5 remembered". */
  title: string;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** Counts, overall progress and the dock headline for a list of jobs. */
export function summarize(jobs: ReadonlyArray<Pick<QueueJob, "id" | "stage" | "progress" | "kind">>): QueueSummary {
  let active = 0;
  let saved = 0;
  let failed = 0;
  let cancelled = 0;
  let embedding = 0;
  let progressSum = 0;
  let progressCount = 0;
  for (const job of jobs) {
    if (job.stage === "done") saved++;
    else if (job.stage === "embedding") {
      saved++;
      embedding++;
    } else if (job.stage === "error") failed++;
    else if (job.stage === "cancelled") cancelled++;
    else active++;
    if (job.stage !== "cancelled") {
      progressSum += steadyProgress(job);
      progressCount++;
    }
  }
  const total = jobs.length;
  const allFinished = active === 0 && embedding === 0;
  const progress = progressCount ? progressSum / progressCount : allFinished ? 1 : 0;

  let title: string;
  if (active > 0) {
    const started = total - active;
    title = total === 1 ? "Remembering…" : `Remembering ${Math.min(started + 1, total)} of ${total}`;
  } else if (embedding > 0) {
    title = "Understanding meaning…";
  } else if (failed > 0 && saved > 0) {
    title = `${plural(saved, "memory", "memories")} saved · ${failed} need${failed === 1 ? "s" : ""} attention`;
  } else if (failed > 0) {
    title = `${plural(failed, "file needs", "files need")} attention`;
  } else if (saved > 0) {
    title = `All done — ${plural(saved, "memory", "memories")} saved`;
  } else {
    title = cancelled === 1 ? "Cancelled" : "All cancelled";
  }

  return { total, active, saved, failed, cancelled, allFinished, progress, title };
}
