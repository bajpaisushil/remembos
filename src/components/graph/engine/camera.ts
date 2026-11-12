/**
 * Pan/zoom camera for the graph canvas: screen = world × k + (x, y), in CSS pixels.
 * Pure functions so they can be unit-tested and shared by the engine and its gestures.
 */

export interface Camera {
  /** Screen offset of the world origin (CSS px). */
  x: number;
  y: number;
  /** Zoom factor. */
  k: number;
}

/** The part of the canvas not covered by floating panels. */
export interface Viewport {
  width: number;
  height: number;
  /** Covered strip on the right (desktop details drawer). */
  insetRight: number;
  /** Covered strip at the bottom (phone details sheet). */
  insetBottom: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function toWorld(cam: Camera, sx: number, sy: number): [number, number] {
  return [(sx - cam.x) / cam.k, (sy - cam.y) / cam.k];
}

export function toScreen(cam: Camera, wx: number, wy: number): [number, number] {
  return [wx * cam.k + cam.x, wy * cam.k + cam.y];
}

/** Visible area's centre in screen coordinates. */
export function viewCenter(v: Viewport): [number, number] {
  return [Math.max(1, v.width - v.insetRight) / 2, Math.max(1, v.height - v.insetBottom) / 2];
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAround(cam: Camera, sx: number, sy: number, factor: number): Camera {
  const k = clampZoom(cam.k * factor);
  const f = k / cam.k;
  return { k, x: sx - (sx - cam.x) * f, y: sy - (sy - cam.y) * f };
}

/** Camera that puts world point (wx, wy) at the centre of the visible area. */
export function centerOn(v: Viewport, wx: number, wy: number, k: number): Camera {
  const [cx, cy] = viewCenter(v);
  const kk = clampZoom(k);
  return { k: kk, x: cx - wx * kk, y: cy - wy * kk };
}

/** Camera that fits `b` inside the visible area with `padding` CSS px around it. */
export function fitBounds(v: Viewport, b: Bounds, padding = 48, maxK = 1.6): Camera {
  const vw = Math.max(1, v.width - v.insetRight - padding * 2);
  const vh = Math.max(1, v.height - v.insetBottom - padding * 2);
  const bw = Math.max(1, b.maxX - b.minX);
  const bh = Math.max(1, b.maxY - b.minY);
  const k = clampZoom(Math.min(vw / bw, vh / bh, maxK));
  return centerOn(v, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, k);
}

/**
 * Interpolate between two cameras, t in 0..1. Zoom moves geometrically and the visible centre moves
 * in world space, so zooming towards a far node feels steady instead of swinging.
 */
export function lerpCamera(v: Viewport, a: Camera, b: Camera, t: number): Camera {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const [cx, cy] = viewCenter(v);
  const [awx, awy] = toWorld(a, cx, cy);
  const [bwx, bwy] = toWorld(b, cx, cy);
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * t);
  const wx = awx + (bwx - awx) * t;
  const wy = awy + (bwy - awy) * t;
  return { k, x: cx - wx * k, y: cy - wy * k };
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Visible world rectangle (the whole canvas), with a margin in CSS px. */
export function visibleWorld(cam: Camera, width: number, height: number, margin = 0): Bounds {
  const [minX, minY] = toWorld(cam, -margin, -margin);
  const [maxX, maxY] = toWorld(cam, width + margin, height + margin);
  return { minX, minY, maxX, maxY };
}
