// PDFs → text with pdf.js: the text layer page by page (lines rebuilt from positions), and local OCR for
// scanned pages without one. Also renders page 1 as the thumbnail.
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import { toast } from "sonner";
import { LIMITS } from "../config";
import { PAGE_SEPARATOR } from "../nlp/chunk";
import { assetUrl, cleanText } from "../utils";
import type { Extracted, ExtractContext } from "./context";
import { shortName } from "./detect";
import { throwIfAborted } from "./errors";
import { followOcrDownload } from "./extract-image";
import { recognize } from "./ocr";
import { canvasToBlob, createCanvas, encodeThumb, OCR_MAX_SIDE, releaseCanvas, THUMB_MAX_SIDE } from "./thumbnail";

/** Pages with less text than this (ignoring whitespace) are treated as scanned and OCR'd. */
const MIN_TEXT_CHARS = 25;
/** Render scale for OCR (≈ 144 dpi), capped by OCR_MAX_SIDE. */
const OCR_SCALE = 2;

/** Rebuild readable lines from pdf.js text items using end-of-line flags and baseline jumps. */
export function pageText(items: Array<TextItem | TextMarkedContent>): string {
  const lines: string[] = [];
  let line = "";
  let lineY: number | null = null;
  let prevLineY: number | null = null;
  let lastEndX: number | null = null;
  let lastHeight = 0;

  const flush = () => {
    const t = line.replace(/[ \t]+/g, " ").trim();
    if (t) {
      lines.push(t);
      prevLineY = lineY;
    }
    line = "";
    lineY = null;
    lastEndX = null;
  };

  for (const it of items) {
    if (!("str" in it)) continue;
    const x = Number(it.transform[4]) || 0;
    const y = Number(it.transform[5]) || 0;
    const h = Math.abs(it.height) || Math.hypot(Number(it.transform[2]) || 0, Number(it.transform[3]) || 0) || lastHeight || 10;
    if (line && lineY !== null && Math.abs(y - lineY) > Math.max(2, Math.min(h, lastHeight || h) * 0.6)) flush();
    if (it.str) {
      if (!line.trim() && it.str.trim()) {
        if (prevLineY !== null && lines.length && Math.abs(y - prevLineY) > Math.max(h, lastHeight) * 1.9) {
          if (lines[lines.length - 1] !== "") lines.push("");
        }
        lineY = y;
      }
      if (line && lastEndX !== null && !/\s$/.test(line) && !/^\s/.test(it.str) && x - lastEndX > h * 0.18) line += " ";
      line += it.str;
      lastEndX = x + (Number(it.width) || 0);
      lastHeight = h;
    }
    if (it.hasEOL) flush();
  }
  flush();
  return cleanText(lines.join("\n"));
}

const compactLength = (s: string) => s.replace(/\s+/g, "").length;

async function renderPage(doc: PDFDocumentProxy, pageNo: number, maxSide: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNo);
  try {
    const base = page.getViewport({ scale: 1 });
    const s = Math.min(scale, maxSide / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale: s });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    page.cleanup();
  }
}

async function renderThumb(doc: PDFDocumentProxy): Promise<Blob | undefined> {
  try {
    const canvas = await renderPage(doc, 1, THUMB_MAX_SIDE, 10);
    try {
      return await encodeThumb(canvas, "jpeg");
    } finally {
      releaseCanvas(canvas);
    }
  } catch {
    return undefined;
  }
}

export async function extractPdf(blob: Blob, ctx: ExtractContext): Promise<Extracted> {
  ctx.setStage("reading", "Opening PDF…");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl("/vendor/pdf.worker.min.mjs");
  // Decoder/font/CMap files that pdf.js fetches only when a PDF needs them (scans, CJK text, …). They are
  // self-hosted under /vendor/pdfjs/ (copied by scripts/copy-vendor.mjs). Absolute URLs let the pdf.js
  // worker fetch them directly.
  const vendor = (dir: string) => new URL(assetUrl(`/vendor/pdfjs/${dir}/`), window.location.href).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: vendor("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: vendor("standard_fonts"),
    wasmUrl: vendor("wasm"),
    iccUrl: vendor("iccs"),
  });
  const onAbort = () => void task.destroy();
  ctx.signal.addEventListener("abort", onAbort, { once: true });

  try {
    const doc = await task.promise;
    throwIfAborted(ctx.signal);
    const count = doc.numPages;
    const pages: string[] = new Array<string>(count).fill("");
    const scanned: number[] = [];

    for (let n = 1; n <= count; n++) {
      throwIfAborted(ctx.signal);
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        pages[n - 1] = pageText(content.items);
      } finally {
        page.cleanup();
      }
      if (compactLength(pages[n - 1]) < MIN_TEXT_CHARS) scanned.push(n);
      ctx.setProgress(n / count, count > 1 ? `Reading page ${n} of ${count}…` : "Reading…");
    }

    const thumb = await renderThumb(doc);
    throwIfAborted(ctx.signal);

    let ocrConfidence: number | undefined;
    if (scanned.length) {
      const toRead = scanned.slice(0, LIMITS.maxOcrPdfPages);
      if (scanned.length > toRead.length) {
        toast.info(`Read the first ${toRead.length} scanned pages`, {
          description: `“${shortName(ctx.name)}” has ${scanned.length} scanned pages. Only the first ${toRead.length} were read to keep your browser responsive.`,
        });
      }
      let weighted = 0;
      let chars = 0;
      await ctx.heavy(async () => {
        ctx.setStage("ocr", "Reading scanned pages…");
        const stop = followOcrDownload(ctx);
        try {
          for (let k = 0; k < toRead.length; k++) {
            throwIfAborted(ctx.signal);
            const pageNo = toRead[k];
            const label = toRead.length > 1 ? `Reading scanned page ${k + 1} of ${toRead.length}…` : "Reading scanned page…";
            const canvas = await renderPage(doc, pageNo, OCR_MAX_SIDE, OCR_SCALE);
            let png: Blob;
            try {
              png = await canvasToBlob(canvas, "image/png");
            } finally {
              releaseCanvas(canvas);
            }
            const r = await recognize(png, (p) => ctx.setProgress((k + p) / toRead.length, label));
            if (compactLength(r.text) > compactLength(pages[pageNo - 1])) {
              pages[pageNo - 1] = r.text;
              weighted += r.confidence * r.text.length;
              chars += r.text.length;
            }
          }
        } finally {
          stop();
        }
      });
      if (chars) ocrConfidence = Math.round((weighted / chars) * 10) / 10;
    }

    return {
      text: pages.join(PAGE_SEPARATOR),
      pages,
      pageCount: count,
      ocrConfidence,
      thumb,
      emptyNote: "No text found in this PDF",
    };
  } finally {
    ctx.signal.removeEventListener("abort", onAbort);
    void task.destroy();
  }
}
