// Local OCR (reading text inside images) with tesseract.js.
//
// One lazily created worker per language setting. tesseract.js downloads its worker script, WASM core and
// language data once from jsdelivr and caches the language data in IndexedDB ("keyval-store"); images
// never leave the device. The worker is terminated after 90 s without work to give memory back, and is
// recreated automatically when the OCR languages setting changes.
import type { LoggerMessage, Page, Worker as TesseractWorker } from "tesseract.js";
import { MODELS, OCR_LANG_DEFAULT, STORAGE_NAMES } from "../config";
import { getSettings } from "../settings";
import { createStore } from "../store";
import type { ModelStatus } from "../types";
import { cleanText } from "../utils";
import { IngestError, OFFLINE_WAIT_MESSAGE } from "./errors";
import { modelDownloadToast } from "./model-toast";

export const ocrStatus = createStore<ModelStatus>({ state: "idle" });

const IDLE_MS = 90_000;
/** Rough size of one extra language's data, for the download toast. */
const EXTRA_LANG_BYTES = 10_000_000;

/** Share of the loading bar for each tesseract.js start-up step. */
const LOAD_STEPS: Record<string, [number, number]> = {
  "loading tesseract core": [0, 0.35],
  "initializing tesseract": [0.35, 0.45],
  "loading language traineddata": [0.45, 0.95],
  "initializing api": [0.95, 1],
};

const LETTER_OR_DIGIT = new RegExp("[\\p{L}\\p{N}]", "gu");
const WORDISH = new RegExp("[\\p{L}\\p{N}]{3,}", "u");

let workerPromise: Promise<TesseractWorker> | null = null;
let workerLangs = "";
let generation = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeProgress: ((p: number) => void) | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Sanitised "eng+deu" style language list from settings. */
function languages(): string {
  const raw = getSettings().ocrLanguages || OCR_LANG_DEFAULT;
  const parts = raw
    .split("+")
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]{3,16}$/i.test(s));
  return parts.length ? Array.from(new Set(parts)).join("+") : OCR_LANG_DEFAULT;
}

function clearIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdle(): void {
  clearIdle();
  idleTimer = setTimeout(() => void disposeOcr(), IDLE_MS);
}

/** Can the text reader start without internet? (its worker code is in the offline cache and its language data is saved) */
async function availableOffline(): Promise<boolean> {
  try {
    const hasLangData =
      typeof indexedDB.databases === "function" && (await indexedDB.databases()).some((d) => d.name === STORAGE_NAMES.ocrDb);
    if (!hasLangData) return false;
    if (typeof caches === "undefined" || !(await caches.has(STORAGE_NAMES.cdnCache))) return !!getSettings().offlinePreparedAt;
    const keys = await (await caches.open(STORAGE_NAMES.cdnCache)).keys();
    // Set up through "Get ready for offline" / install: the browser's own cache can also serve the code.
    return keys.some((r) => /tesseract\.js@[^/]+\/dist\/worker\.min\.js/.test(r.url)) || !!getSettings().offlinePreparedAt;
  } catch {
    return false;
  }
}

async function createOcrWorker(langs: string): Promise<TesseractWorker> {
  // Offline and never downloaded: don't start a worker that can only fail — the memory waits for the internet.
  if (typeof navigator !== "undefined" && navigator.onLine === false && !(await availableOffline())) {
    throw new IngestError(OFFLINE_WAIT_MESSAGE);
  }
  const myGeneration = ++generation;
  ocrStatus.set({ state: "loading", progress: 0 });
  const notice = modelDownloadToast({
    id: "model-ocr",
    label: "the text reader",
    approxBytes: MODELS.ocr.approxBytes + (langs.split("+").length - 1) * EXTRA_LANG_BYTES,
    readyTitle: "Text reader ready",
    readyDescription: "Reading text on your device — nothing is uploaded.",
    delayMs: 1200,
  });

  const logger = (m: LoggerMessage) => {
    if (m.status === "recognizing text") {
      activeProgress?.(Math.max(0, Math.min(1, m.progress)));
      return;
    }
    const step = LOAD_STEPS[m.status];
    if (!step || myGeneration !== generation) return;
    const p = step[0] + (step[1] - step[0]) * Math.max(0, Math.min(1, m.progress || 0));
    ocrStatus.set((s) => (s.state === "loading" ? { ...s, progress: Math.max(s.progress ?? 0, p) } : s));
    notice.progress(p);
  };

  try {
    const mod = await import("tesseract.js");
    const createWorker = mod.createWorker ?? mod.default.createWorker;
    const worker = await createWorker(langs, 1, {
      logger,
      // Without a handler tesseract.js rethrows worker errors globally; the job promise still rejects.
      errorHandler: () => {},
    });
    if (myGeneration !== generation) {
      void worker.terminate();
      throw new IngestError("The text reader was stopped. Retry to read this image.");
    }
    ocrStatus.set({ state: "ready", progress: 1 });
    notice.ready();
    return worker;
  } catch (err) {
    if (err instanceof IngestError) throw err;
    console.warn("[remembos] OCR failed to start", err);
    ocrStatus.set({ state: "error", error: "Couldn't download the text reader. Check your connection, then retry." });
    notice.fail();
    throw new IngestError(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? OFFLINE_WAIT_MESSAGE
        : "Couldn't load the text reader (a one-time download). Check your connection, then retry.",
    );
  }
}

function getWorker(): Promise<TesseractWorker> {
  const langs = languages();
  if (workerPromise && workerLangs !== langs) void disposeOcr();
  if (!workerPromise) {
    workerLangs = langs;
    const p = createOcrWorker(langs);
    workerPromise = p;
    p.catch(() => {
      if (workerPromise === p) {
        workerPromise = null;
        workerLangs = "";
      }
    });
  }
  return workerPromise;
}

/** Keep real text, drop the speckle "words" Tesseract invents from photos, icons and textures. */
function keepLine(text: string, confidence: number): boolean {
  const letters = text.match(LETTER_OR_DIGIT)?.length ?? 0;
  if (letters === 0) return false;
  if (confidence >= 45) return true;
  return confidence >= 20 && WORDISH.test(text) && letters / text.length > 0.5;
}

function toResult(page: Page): { text: string; confidence: number } {
  if (!page.blocks?.length) {
    const text = cleanText(page.text || "");
    return page.confidence < 20 ? { text: "", confidence: page.confidence } : { text, confidence: page.confidence };
  }
  const blocks: string[] = [];
  let weighted = 0;
  let chars = 0;
  for (const block of page.blocks) {
    const paragraphs: string[] = [];
    for (const para of block.paragraphs) {
      const lines: string[] = [];
      for (const line of para.lines) {
        const t = line.text.replace(/\s+/g, " ").trim();
        if (!t || !keepLine(t, line.confidence)) continue;
        lines.push(t);
        weighted += line.confidence * t.length;
        chars += t.length;
      }
      if (lines.length) paragraphs.push(lines.join("\n"));
    }
    if (paragraphs.length) blocks.push(paragraphs.join("\n\n"));
  }
  return { text: cleanText(blocks.join("\n\n")), confidence: chars ? Math.round((weighted / chars) * 10) / 10 : 0 };
}

/**
 * Read the text in an image. Loads the OCR engine on first use (status in `ocrStatus`, one-time download
 * toast). Calls are serialised; `onProgress` receives 0..1 for this image.
 */
export async function recognize(
  image: Blob | HTMLCanvasElement | OffscreenCanvas,
  onProgress?: (p: number) => void,
): Promise<{ text: string; confidence: number }> {
  const run = async () => {
    clearIdle();
    try {
      const worker = await getWorker();
      activeProgress = onProgress ?? null;
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      onProgress?.(1);
      return toResult(data);
    } finally {
      activeProgress = null;
      scheduleIdle();
    }
  };
  const result = chain.then(run, run);
  chain = result.catch(() => undefined);
  return result;
}

/** Terminate the OCR worker and free its memory. Language data stays cached for next time. */
export async function disposeOcr(): Promise<void> {
  clearIdle();
  generation++;
  const pending = workerPromise;
  workerPromise = null;
  workerLangs = "";
  activeProgress = null;
  if (ocrStatus.get().state !== "error") ocrStatus.set({ state: "idle" });
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* already gone */
  }
}

/** Download and start the text reader ahead of time (e.g. "Get ready for offline"). Resolves when it's ready. */
export async function warmupOcr(): Promise<void> {
  await getWorker();
  scheduleIdle();
}
