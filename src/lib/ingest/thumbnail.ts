// Canvas helpers: scaled drawing, encoding to Blob, thumbnails (webp, falling back to jpeg/png) and OCR prep.

/** Longest side of stored thumbnails, in pixels. */
export const THUMB_MAX_SIDE = 480;
/** Longest side of images handed to OCR. */
export const OCR_MAX_SIDE = 2400;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Free a canvas' backing memory right away (Safari keeps it otherwise). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function context2d(canvas: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", opts);
  if (!ctx) throw new Error("Canvas 2D is not available");
  return ctx;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))), type, quality);
  });
}

/** Fit (w, h) inside a square of `max` px, never upscaling. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/**
 * Encode a canvas as a small preview. WebP keeps transparency and is tiny; browsers that can't encode
 * WebP (older Safari) silently return PNG, so we fall back to JPEG on white (photos) or PNG (graphics).
 */
export async function encodeThumb(canvas: HTMLCanvasElement, fallback: "jpeg" | "png" = "jpeg"): Promise<Blob> {
  const webp = await canvasToBlob(canvas, "image/webp", 0.8);
  if (webp.type === "image/webp") return webp;
  if (fallback === "png") return webp.type === "image/png" ? webp : canvasToBlob(canvas, "image/png");
  const flat = createCanvas(canvas.width, canvas.height);
  const ctx = context2d(flat);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  try {
    return await canvasToBlob(flat, "image/jpeg", 0.82);
  } finally {
    releaseCanvas(flat);
  }
}

/** Thumbnail (≤ 480 px) of any drawable source. */
export async function makeThumbnail(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const size = fitWithin(width, height, THUMB_MAX_SIDE);
  const canvas = createCanvas(size.width, size.height);
  try {
    const ctx = context2d(canvas);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, size.width, size.height);
    return await encodeThumb(canvas, "jpeg");
  } finally {
    releaseCanvas(canvas);
  }
}

/**
 * Prepare an image for OCR: white background (transparent PNGs), sensible size (small screenshots are
 * upscaled for legibility, huge photos downscaled — never beyond `maxSide`), greyscale, and inverted when
 * it's mostly dark — Tesseract reads dark text on a light background far better than dark-mode screenshots.
 */
export function prepareForOcr(source: CanvasImageSource, width: number, height: number, maxSide = OCR_MAX_SIDE): HTMLCanvasElement {
  const longest = Math.max(width, height, 1);
  let scale = 1;
  if (longest > maxSide) scale = maxSide / longest;
  else if (longest < 1200) scale = Math.min(2, maxSide / longest);
  const canvas = createCanvas(width * scale, height * scale);
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = px[i + 1] = px[i + 2] = y;
    sum += y;
  }
  const mean = sum / (px.length / 4 || 1);
  if (mean < 110) {
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A soft waveform picture for voice memories (transparent background, amber bars), so recordings get a
 * recognisable preview like screenshots and PDFs do.
 */
export async function makeWaveformThumb(samples: Float32Array): Promise<Blob | undefined> {
  if (!samples.length) return undefined;
  const width = THUMB_MAX_SIDE;
  const height = 270;
  const bars = 56;
  const gap = 3;
  const barWidth = (width - gap * (bars - 1)) / bars;
  const per = Math.max(1, Math.floor(samples.length / bars));
  const levels: number[] = [];
  for (let b = 0; b < bars; b++) {
    let acc = 0;
    const start = b * per;
    const end = Math.min(samples.length, start + per);
    const step = Math.max(1, Math.floor((end - start) / 2000));
    let n = 0;
    for (let i = start; i < end; i += step) {
      acc += samples[i] * samples[i];
      n++;
    }
    levels.push(Math.sqrt(acc / Math.max(1, n)));
  }
  const peak = Math.max(...levels, 1e-6);
  const canvas = createCanvas(width, height);
  try {
    const ctx = context2d(canvas);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#f59e0b");
    gradient.addColorStop(1, "#facc15");
    ctx.fillStyle = gradient;
    const mid = height / 2;
    const maxBar = height * 0.78;
    for (let b = 0; b < bars; b++) {
      const level = Math.pow(levels[b] / peak, 0.7);
      const h = Math.max(barWidth, level * maxBar);
      const x = b * (barWidth + gap);
      const r = barWidth / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, mid - h / 2);
      ctx.arcTo(x + barWidth, mid - h / 2, x + barWidth, mid + h / 2, r);
      ctx.arcTo(x + barWidth, mid + h / 2, x, mid + h / 2, r);
      ctx.arcTo(x, mid + h / 2, x, mid - h / 2, r);
      ctx.arcTo(x, mid - h / 2, x + barWidth, mid - h / 2, r);
      ctx.closePath();
      ctx.fill();
    }
    return await encodeThumb(canvas, "png");
  } finally {
    releaseCanvas(canvas);
  }
}
