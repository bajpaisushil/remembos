// Screenshots & photos → text via local OCR, plus a small preview thumbnail.
import type { Extracted, ExtractContext } from "./context";
import { IngestError, throwIfAborted } from "./errors";
import { ocrStatus, recognize } from "./ocr";
import { canvasToBlob, makeThumbnail, prepareForOcr, releaseCanvas } from "./thumbnail";

async function openImage(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(blob);
    } catch {
      throw new IngestError("This image couldn't be opened — it may be damaged or in a format this browser can't read.");
    }
  }
}

/** Mirror the OCR engine's one-time download into the job's progress while it loads. */
export function followOcrDownload(ctx: ExtractContext): () => void {
  return ocrStatus.subscribe(() => {
    const s = ocrStatus.get();
    if (s.state === "loading") ctx.setProgress(s.progress ?? 0, "Getting the text reader ready…");
  });
}

export async function extractImage(blob: Blob, ctx: ExtractContext): Promise<Extracted> {
  ctx.setStage("reading", "Opening image…");
  const bitmap = await openImage(blob);
  const { width, height } = bitmap;
  let thumb: Blob | undefined;
  let ocrInput: Blob;
  try {
    thumb = await makeThumbnail(bitmap, width, height).catch(() => undefined);
    const canvas = prepareForOcr(bitmap, width, height);
    try {
      ocrInput = await canvasToBlob(canvas, "image/png");
    } finally {
      releaseCanvas(canvas);
    }
  } finally {
    bitmap.close();
  }
  throwIfAborted(ctx.signal);

  const result = await ctx.heavy(async () => {
    ctx.setStage("ocr", "Reading text…");
    const stop = followOcrDownload(ctx);
    try {
      return await recognize(ocrInput, (p) => ctx.setProgress(p, "Reading text…"));
    } finally {
      stop();
    }
  });

  return {
    text: result.text,
    width,
    height,
    ocrConfidence: result.text ? result.confidence : undefined,
    thumb,
    emptyNote: "No text found in this image",
  };
}
