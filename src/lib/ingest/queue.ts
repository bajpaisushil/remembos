// Background processing queue: two files at a time, one AI model job at a time (OCR / transcription share a
// lock), live per-job stage + progress in `queueStore`, one friendly toast per batch, cancel / retry / resume.
import { toast } from "sonner";
import { embedderStatus } from "../ai/embedder";
import { itemHref, ROUTES } from "../config";
import { db, deleteItemsCascade } from "../db";
import { embedItem, removeFromIndex } from "../search";
import { getSettings } from "../settings";
import { handleStorageError } from "../storage/monitor";
import { queueStore } from "./queue-store";
import type { JobStage, MemoryItem, MemoryKind, QueueJob } from "../types";
import { formatDuration, uid } from "../utils";
import type { ExtractContext } from "./context";
import { shortName } from "./detect";
import { abortError, friendlyError, IngestError, isStorageError, throwIfAborted } from "./errors";
import { navigate } from "./nav";
import { processStoredItem, type ProcessOutcome } from "./process";
import { updateItemText } from "./save";

export { queueStore };

const CONCURRENCY = 2;
const DONE_TTL_MS = 60_000;
const ERROR_TTL_MS = 5 * 60_000;
const PROGRESS_INTERVAL_MS = 120;
const FINISHED_STAGES: JobStage[] = ["done", "error", "cancelled"];

export interface QueueEntry {
  itemId: string;
  name: string;
  kind: MemoryKind;
  size: number;
}

interface Batch {
  toastId: string;
  loadingTitle: string;
  total: number;
  ready: number;
  failed: number;
  cancelled: number;
  tasks: Task[];
  firstError?: string;
}

interface Task {
  jobId: string;
  itemId: string;
  name: string;
  kind: MemoryKind;
  controller: AbortController;
  batch: Batch;
  phase: "pending" | "running" | "embedding" | "finished";
  settled: boolean;
  result?: "ready" | "error" | "cancelled";
  lastProgressAt: number;
  outcome?: ProcessOutcome;
  error?: string;
  /** The failure was the browser refusing to store data (not the file itself). */
  storageFailure?: boolean;
}

/** Live (unfinished) tasks by job id. */
const tasks = new Map<string, Task>();
const waiting: Task[] = [];
/** Items created but not yet queued (so resumeInterrupted won't double-queue them). */
const reserved = new Set<string>();
let running = 0;
let pruneTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- one-model-at-a-time lock ----------

class Mutex {
  private busy = false;
  private waiters: Array<() => void> = [];

  get locked(): boolean {
    return this.busy;
  }

  async acquire(signal: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    if (this.busy) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const i = this.waiters.indexOf(grant);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(abortError());
        };
        const grant = () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        this.waiters.push(grant);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    } else {
      this.busy = true;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.busy = false;
    };
  }
}

const heavyLock = new Mutex();

// ---------- job list ----------

function patchJob(jobId: string, patch: Partial<QueueJob>): void {
  queueStore.set((list) => {
    const i = list.findIndex((j) => j.id === jobId);
    if (i < 0) return list;
    const next = list.slice();
    next[i] = { ...list[i], ...patch };
    return next;
  });
}

function removeJob(jobId: string): void {
  queueStore.set((list) => (list.some((j) => j.id === jobId) ? list.filter((j) => j.id !== jobId) : list));
}

function isExpired(job: QueueJob, now: number): boolean {
  if (!job.finishedAt) return false;
  if (job.stage === "error") return now - job.finishedAt > ERROR_TTL_MS;
  return (job.stage === "done" || job.stage === "cancelled") && now - job.finishedAt > DONE_TTL_MS;
}

function schedulePrune(): void {
  if (pruneTimer || typeof window === "undefined") return;
  pruneTimer = setTimeout(() => {
    pruneTimer = null;
    const now = Date.now();
    queueStore.set((list) => {
      const next = list.filter((j) => !isExpired(j, now));
      return next.length === list.length ? list : next;
    });
    if (queueStore.get().some((j) => FINISHED_STAGES.includes(j.stage))) schedulePrune();
  }, 5_000);
}

function finishJob(task: Task, stage: "done" | "error" | "cancelled", error?: string): void {
  task.phase = "finished";
  tasks.delete(task.jobId);
  patchJob(task.jobId, {
    stage,
    progress: stage === "done" ? 1 : (queueStore.get().find((j) => j.id === task.jobId)?.progress ?? 0),
    message: undefined,
    error,
    finishedAt: Date.now(),
  });
  schedulePrune();
}

/** Remove a finished job from the list (keeps the memory). */
export function dismissJob(jobId: string): void {
  if (tasks.has(jobId)) return;
  removeJob(jobId);
}

/** Remove every finished job from the list. */
export function clearFinishedJobs(): void {
  queueStore.set((list) => list.filter((j) => !FINISHED_STAGES.includes(j.stage)));
}

/** Item ids that are queued, processing, or about to be queued. */
export function liveItemIds(): Set<string> {
  const ids = new Set(reserved);
  for (const t of tasks.values()) if (t.phase === "pending" || t.phase === "running") ids.add(t.itemId);
  return ids;
}

/** Mark freshly created items as owned by an upcoming enqueue (or release them with `false`). */
export function reserveItems(ids: string[], on = true): void {
  for (const id of ids) {
    if (on) reserved.add(id);
    else reserved.delete(id);
  }
}

// ---------- batch toasts ----------

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function describeOutcome(task: Task): string {
  const o = task.outcome;
  if (!o) return "Saved on this device.";
  if (o.empty) {
    const note = o.emptyNote ?? "No text found";
    return /turn it on/i.test(note) ? `${note}.` : `${note} — still findable by name and date.`;
  }
  const words = plural(o.words, "word", "words");
  if (o.item.kind === "pdf" && o.item.pageCount) return `${plural(o.item.pageCount, "page", "pages")} · ${words} — searchable now.`;
  if (o.item.kind === "voice" && o.item.durationSec) return `${formatDuration(o.item.durationSec)} transcribed · ${words} — searchable now.`;
  if (o.item.kind === "video" && o.item.durationSec) return `${formatDuration(o.item.durationSec)} video · ${words} — searchable now.`;
  if (o.item.kind === "image") return `Found ${words} — searchable now.`;
  return `${words} — searchable now.`;
}

function finalizeBatch(b: Batch): void {
  if (b.ready === 0 && b.failed === 0) {
    toast.dismiss(b.toastId);
    return;
  }
  const kept = b.tasks.filter((t) => t.result === "ready" || t.result === "error");
  if (kept.length === 1) {
    const t = kept[0];
    const name = shortName(t.name);
    if (t.result === "ready") {
      toast.success(`Remembered “${name}”`, {
        id: b.toastId,
        description: describeOutcome(t),
        action: { label: "View", onClick: () => navigate(itemHref(t.itemId)) },
        duration: 6000,
      });
    } else {
      toast.error(t.storageFailure ? `Couldn't save “${name}”` : `Couldn't read “${name}”`, {
        id: b.toastId,
        description: t.error ?? "Something went wrong.",
        action: { label: "Retry", onClick: () => void retryItem(t.itemId) },
        duration: 12_000,
      });
    }
    return;
  }
  const view = { label: "View", onClick: () => navigate(ROUTES.library) };
  if (b.ready > 0) {
    toast.success(`${plural(b.ready, "memory", "memories")} saved`, {
      id: b.toastId,
      description: b.failed
        ? `${b.failed} need${b.failed === 1 ? "s" : ""} attention — open the Library to retry.`
        : "Search them any time — they stay on this device.",
      action: view,
      duration: b.failed ? 12_000 : 6000,
    });
  } else {
    toast.error(`${plural(b.failed, "file needs", "files need")} attention`, {
      id: b.toastId,
      description: b.firstError ?? "Something went wrong while reading them.",
      action: view,
      duration: 12_000,
    });
  }
}

function settle(task: Task, outcome: "ready" | "error" | "cancelled"): void {
  if (task.settled) return;
  task.settled = true;
  task.result = outcome;
  const b = task.batch;
  if (outcome === "ready") b.ready++;
  else if (outcome === "error") {
    b.failed++;
    if (!b.firstError && task.error) b.firstError = task.error;
  } else b.cancelled++;
  const done = b.ready + b.failed + b.cancelled;
  if (done < b.total) {
    toast.loading(b.loadingTitle, { id: b.toastId, description: `${done} of ${b.total} done`, duration: Infinity });
    return;
  }
  finalizeBatch(b);
}

// ---------- running ----------

function makeContext(task: Task): ExtractContext {
  const signal = task.controller.signal;
  const setStage = (stage: JobStage, message?: string) => {
    if (signal.aborted || task.phase !== "running") return;
    task.lastProgressAt = Date.now();
    patchJob(task.jobId, { stage, progress: 0, message });
  };
  const setProgress = (progress: number, message?: string) => {
    if (signal.aborted || task.phase !== "running") return;
    const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    const now = Date.now();
    if (p < 1 && now - task.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    task.lastProgressAt = now;
    patchJob(task.jobId, message === undefined ? { progress: p } : { progress: p, message });
  };
  const heavy = async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (heavyLock.locked) patchJob(task.jobId, { message: "Waiting for the previous file to finish…" });
    const release = await heavyLock.acquire(signal);
    try {
      throwIfAborted(signal);
      const result = await fn();
      // Model work is done; show the next step before the next job takes the lock, so the list
      // never shows two files "reading" at once.
      setStage("extracting", "Finding names, dates and links…");
      return result;
    } finally {
      release();
    }
  };
  return { signal, name: task.name, setStage, setProgress, heavy };
}

async function purge(itemId: string): Promise<void> {
  try {
    await deleteItemsCascade([itemId]);
  } catch (err) {
    console.warn("[remembos] could not remove a cancelled memory", err);
  }
  try {
    removeFromIndex([itemId]);
  } catch {
    /* index rebuilt on next start */
  }
}

function startEmbedding(task: Task): void {
  if (!getSettings().semanticSearch) {
    finishJob(task, "done");
    return;
  }
  task.phase = "embedding";
  patchJob(task.jobId, { stage: "embedding", progress: 0, message: "Preparing meaning search…" });
  let last = 0;
  const report = (p: number, message?: string) => {
    const now = Date.now();
    if (task.phase !== "embedding" || (p < 1 && now - last < PROGRESS_INTERVAL_MS)) return;
    last = now;
    const progress = Math.max(0, Math.min(1, p));
    patchJob(task.jobId, message === undefined ? { progress } : { progress, message });
  };
  // On first use the meaning-search model is downloaded; show that instead of a stuck 0%.
  const stopFollowing = embedderStatus.subscribe(() => {
    const s = embedderStatus.get();
    if (s.state === "loading") report(s.progress ?? 0, "Getting meaning search ready (one time)…");
  });
  embedItem(task.itemId, (p) => report(p, "Preparing meaning search…"))
    .catch(() => {
      /* keyword search already works; embeddings are back-filled later */
    })
    .finally(() => {
      stopFollowing();
      if (task.phase === "embedding") finishJob(task, "done");
    });
}

async function markError(itemId: string, message: string): Promise<boolean> {
  try {
    const count = await db.items.update(itemId, { status: "error", error: message, updatedAt: Date.now() });
    return count > 0;
  } catch {
    return true;
  }
}

async function runTask(task: Task): Promise<void> {
  const signal = task.controller.signal;
  patchJob(task.jobId, { stage: "reading", progress: 0, message: undefined });
  try {
    task.outcome = await processStoredItem(task.itemId, makeContext(task));
    throwIfAborted(signal);
    // e.g. a ".webm video" that turned out to be a voice recording
    if (task.outcome.item.kind !== task.kind) {
      task.kind = task.outcome.item.kind;
      patchJob(task.jobId, { kind: task.kind });
    }
    settle(task, "ready");
    startEmbedding(task);
  } catch (err) {
    if (signal.aborted) {
      await purge(task.itemId);
      settle(task, "cancelled");
      return;
    }
    const message = friendlyError(err);
    if (isStorageError(err)) handleStorageError(err, `Saving “${shortName(task.name)}”`);
    else if (!(err instanceof IngestError) && (err as { name?: string } | null)?.name !== "AbortError") {
      console.warn("[remembos] processing failed:", task.name, err);
    }
    const stillThere = await markError(task.itemId, message);
    if (!stillThere) {
      // Deleted from elsewhere while it was being processed.
      finishJob(task, "cancelled");
      settle(task, "cancelled");
      return;
    }
    task.error = message;
    task.storageFailure = isStorageError(err);
    finishJob(task, "error", message);
    settle(task, "error");
  }
}

function pump(): void {
  while (running < CONCURRENCY && waiting.length) {
    const task = waiting.shift();
    if (!task || task.phase !== "pending") continue;
    running++;
    task.phase = "running";
    void runTask(task).finally(() => {
      running--;
      pump();
    });
  }
}

/** Queue stored items for processing, with one batch toast. */
export function enqueue(entries: QueueEntry[], opts: { loadingTitle?: string } = {}): void {
  if (!entries.length) return;
  const single = entries.length === 1;
  const batch: Batch = {
    toastId: uid("batch"),
    loadingTitle:
      opts.loadingTitle ?? (single ? `Remembering “${shortName(entries[0].name)}”…` : `Remembering ${entries.length} files…`),
    total: entries.length,
    ready: 0,
    failed: 0,
    cancelled: 0,
    tasks: [],
  };
  toast.loading(batch.loadingTitle, {
    id: batch.toastId,
    description: single ? "Reading it on this device — nothing is uploaded." : `0 of ${entries.length} done`,
    duration: Infinity,
  });
  const now = Date.now();
  const jobs: QueueJob[] = [];
  for (const e of entries) {
    const task: Task = {
      jobId: uid("job"),
      itemId: e.itemId,
      name: e.name,
      kind: e.kind,
      controller: new AbortController(),
      batch,
      phase: "pending",
      settled: false,
      lastProgressAt: 0,
    };
    batch.tasks.push(task);
    tasks.set(task.jobId, task);
    waiting.push(task);
    reserved.delete(e.itemId);
    jobs.push({ id: task.jobId, itemId: e.itemId, name: e.name, kind: e.kind, size: e.size, stage: "queued", progress: 0, startedAt: now });
  }
  queueStore.set((list) => [...jobs, ...list]);
  pump();
}

/**
 * Cancel a job: stops processing and deletes the half-made memory ("Cancelled" toast). For a memory
 * that is already saved (only meaning search still running) or a finished job, it just hides the row.
 */
export function cancelJob(jobId: string): void {
  const task = tasks.get(jobId);
  if (!task) {
    removeJob(jobId);
    return;
  }
  if (task.phase === "embedding") {
    task.phase = "finished";
    tasks.delete(jobId);
    removeJob(jobId);
    toast.info(`“${shortName(task.name)}” is already saved`, {
      description: "Meaning search for it will finish later on its own.",
    });
    return;
  }
  const wasPending = task.phase === "pending";
  task.controller.abort();
  if (wasPending) {
    const i = waiting.indexOf(task);
    if (i >= 0) waiting.splice(i, 1);
  }
  finishJob(task, "cancelled");
  toast("Cancelled", { description: `“${shortName(task.name)}” wasn't saved.` });
  void purge(task.itemId);
  if (wasPending) settle(task, "cancelled");
}

/** Re-run processing for an item that errored or was interrupted (needs its stored original). */
export async function retryItem(itemId: string): Promise<void> {
  if (liveItemIds().has(itemId)) return;
  let item: MemoryItem | undefined;
  try {
    item = await db.items.get(itemId);
  } catch (err) {
    handleStorageError(err, "Retrying");
    return;
  }
  if (!item) return;
  const name = item.sourceName ?? item.title;

  if (!item.hasFile && (item.kind === "text" || item.kind === "note")) {
    try {
      await updateItemText(itemId, item.text);
      toast.success(`Remembered “${shortName(item.title)}”`, { description: "It's searchable again." });
    } catch (err) {
      if (!isStorageError(err)) toast.error(`Couldn't update “${shortName(item.title)}”`, { description: friendlyError(err) });
    }
    return;
  }

  const stored = item.hasFile ? await db.files.get(itemId).catch(() => undefined) : undefined;
  if (!stored) {
    toast.error(`Can't retry “${shortName(name)}”`, {
      description: "Its original file isn't stored any more. Drop the file again to re-add it.",
    });
    return;
  }
  try {
    await db.items.update(itemId, { status: "processing", error: undefined, updatedAt: Date.now() });
  } catch (err) {
    handleStorageError(err, `Retrying “${shortName(name)}”`);
    return;
  }
  enqueue([{ itemId, name, kind: item.kind, size: item.size }]);
}

/** On startup: items left in "processing" (tab closed mid-way) are re-queued if possible, else marked error. */
export async function resumeInterrupted(): Promise<void> {
  let stuck: MemoryItem[];
  try {
    stuck = await db.items.where("status").equals("processing").toArray();
  } catch {
    return;
  }
  const live = liveItemIds();
  const entries: QueueEntry[] = [];
  for (const item of stuck) {
    if (live.has(item.id)) continue;
    const original = item.hasFile ? await db.files.get(item.id).catch(() => undefined) : undefined;
    if (original) {
      entries.push({ itemId: item.id, name: item.sourceName ?? item.title, kind: item.kind, size: item.size });
    } else if ((item.kind === "text" || item.kind === "note") && item.text) {
      await updateItemText(item.id, item.text).catch(() => {});
    } else {
      await db.items
        .update(item.id, { status: "error", error: "Interrupted — the tab was closed while processing", updatedAt: Date.now() })
        .catch(() => {});
    }
  }
  if (!entries.length) return;
  // Something may have been queued while we looked; don't process anything twice.
  const nowLive = liveItemIds();
  const fresh = entries.filter((e) => !nowLive.has(e.itemId));
  if (!fresh.length) return;
  enqueue(fresh, {
    loadingTitle:
      fresh.length === 1 ? `Finishing “${shortName(fresh[0].name)}”…` : `Finishing ${fresh.length} files from last time…`,
  });
}
