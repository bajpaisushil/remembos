/**
 * Draws one frame of the knowledge graph on a 2D canvas.
 *
 * Built for hundreds of nodes and thousands of links at 60 fps: links are batched into a handful
 * of paths (normal / dimmed / highlighted × mentions / similar), nodes are batched per color, glows
 * are pre-rendered sprites, off-screen work is culled, and labels are measured once and placed in
 * screen space with a greedy collision pass.
 */
import { visibleWorld, type Camera } from "./camera";
import { placeLabels, type LabelCandidate, type PlacedLabel } from "./labels";
import type { ColorGroup, GLink, GNode } from "./model";
import { hexToRgba, type Palette } from "./theme";

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the canvas. */
  width: number;
  height: number;
  dpr: number;
  cam: Camera;
  nodes: GNode[];
  links: GLink[];
  groups: ColorGroup[];
  palette: Palette;
  selected: number;
  hovered: number;
  /** Hovered node, else the selected one, else -1. Everything outside its neighbourhood is dimmed. */
  active: number;
  /** 1 for the active node and its neighbours. */
  neighbor: Uint8Array;
  fontFamily: string;
  sprites: GlowSprites;
  scratch: RenderScratch;
}

export interface RenderScratch {
  candidates: LabelCandidate[];
  placed: PlacedLabel[];
}

export const createScratch = (): RenderScratch => ({ candidates: [], placed: [] });

const ITEM_FONT_SIZE = 12;
const ENTITY_FONT_SIZE = 11;
const LABEL_PAD_X = 6;
const LABEL_HEIGHT = 19;
const MAX_LABELS = 90;

export const itemFont = (family: string) => `600 ${ITEM_FONT_SIZE}px ${family}`;
export const entityFont = (family: string) => `500 ${ENTITY_FONT_SIZE}px ${family}`;

/** Soft radial glows per color, rendered once and stamped behind memory nodes. */
export class GlowSprites {
  private cache = new Map<string, HTMLCanvasElement>();

  get(color: string, alpha: number): HTMLCanvasElement | null {
    const key = `${color}|${alpha}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (typeof document === "undefined") return null;
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d");
    if (!g) return null;
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, hexToRgba(color, alpha));
    grad.addColorStop(0.45, hexToRgba(color, alpha * 0.45));
    grad.addColorStop(1, hexToRgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    this.cache.set(key, canvas);
    return canvas;
  }

  clear(): void {
    this.cache.clear();
  }
}

function roundedSquare(path: Path2D, x: number, y: number, half: number, radius: number): void {
  const l = x - half;
  const t = y - half;
  const r = x + half;
  const b = y + half;
  path.moveTo(l + radius, t);
  path.arcTo(r, t, r, b, radius);
  path.arcTo(r, b, l, b, radius);
  path.arcTo(l, b, l, t, radius);
  path.arcTo(l, t, r, t, radius);
  path.closePath();
}

function roundedRect(path: Path2D, x: number, y: number, w: number, h: number, radius: number): void {
  const r = Math.min(radius, h / 2, w / 2);
  path.moveTo(x + r, y);
  path.arcTo(x + w, y, x + w, y + h, r);
  path.arcTo(x + w, y + h, x, y + h, r);
  path.arcTo(x, y + h, x, y, r);
  path.arcTo(x, y, x + w, y, r);
  path.closePath();
}

function addShape(path: Path2D, n: GNode): void {
  if (n.kind === "item") {
    path.moveTo(n.x + n.r, n.y);
    path.arc(n.x, n.y, n.r, 0, Math.PI * 2);
  } else {
    const half = n.r * 0.9;
    roundedSquare(path, n.x, n.y, half, half * 0.42);
  }
}

export function renderGraph(input: RenderInput): void {
  const { ctx, width, height, dpr, cam, nodes, links, groups, palette, selected, hovered, active, neighbor } = input;
  const k = cam.k;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!nodes.length) return;

  ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * cam.x, dpr * cam.y);
  const view = visibleWorld(cam, width, height, 40);
  const inView = (n: GNode) => n.x + n.r >= view.minX && n.x - n.r <= view.maxX && n.y + n.r >= view.minY && n.y - n.r <= view.maxY;
  const hasActive = active >= 0;

  // ---- Links ----
  const curved = k >= 0.35;
  const normal = new Path2D();
  const normalSimilar = new Path2D();
  const dim = new Path2D();
  const dimSimilar = new Path2D();
  const hi = new Path2D();
  const hiSimilar = new Path2D();
  let anyNormal = false;
  let anyNormalSimilar = false;
  let anyDim = false;
  let anyDimSimilar = false;
  let anyHi = false;
  let anyHiSimilar = false;

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const s = nodes[l.source];
    const t = nodes[l.target];
    if (
      (s.x < view.minX && t.x < view.minX) ||
      (s.x > view.maxX && t.x > view.maxX) ||
      (s.y < view.minY && t.y < view.minY) ||
      (s.y > view.maxY && t.y > view.maxY)
    ) {
      continue;
    }
    const similar = l.kind === "similar";
    let path: Path2D;
    if (!hasActive) {
      path = similar ? normalSimilar : normal;
      if (similar) anyNormalSimilar = true;
      else anyNormal = true;
    } else if (l.source === active || l.target === active) {
      path = similar ? hiSimilar : hi;
      if (similar) anyHiSimilar = true;
      else anyHi = true;
    } else {
      path = similar ? dimSimilar : dim;
      if (similar) anyDimSimilar = true;
      else anyDim = true;
    }
    path.moveTo(s.x, s.y);
    if (curved) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const mx = (s.x + t.x) / 2 - dy * l.bend;
      const my = (s.y + t.y) / 2 + dx * l.bend;
      path.quadraticCurveTo(mx, my, t.x, t.y);
    } else {
      path.lineTo(t.x, t.y);
    }
  }

  ctx.lineCap = "round";
  const px = 1 / k;
  const dash = [4 * px, 4 * px];
  const strokeLinks = (path: Path2D, color: string, widthPx: number, dashed: boolean) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = widthPx * px;
    ctx.setLineDash(dashed ? dash : []);
    ctx.stroke(path);
  };
  if (anyDim) strokeLinks(dim, palette.linkDim, 1, false);
  if (anyDimSimilar) strokeLinks(dimSimilar, palette.linkDim, 1, true);
  if (anyNormal) strokeLinks(normal, palette.link, 1, false);
  if (anyNormalSimilar) strokeLinks(normalSimilar, palette.linkSimilar, 1.2, true);
  if (anyHi) strokeLinks(hi, palette.linkHighlight, 1.75, false);
  if (anyHiSimilar) strokeLinks(hiSimilar, palette.linkSimilarHighlight, 1.75, true);
  ctx.setLineDash([]);

  // ---- Glows behind memories ----
  if (k * 6 >= 2.5) {
    for (const g of groups) {
      if (g.kind !== "item") continue;
      const sprite = input.sprites.get(g.color, palette.glowAlpha);
      if (!sprite) continue;
      for (const idx of g.nodes) {
        const n = nodes[idx];
        if ((hasActive && !neighbor[idx]) || !inView(n)) continue;
        const R = n.r * 2.7;
        ctx.drawImage(sprite, n.x - R, n.y - R, R * 2, R * 2);
      }
    }
  }

  // ---- Nodes, batched per color; dimmed ones first ----
  const outlineWidth = Math.min(1.5 * px, 2.5);
  ctx.lineWidth = outlineWidth;
  ctx.strokeStyle = palette.outline;
  for (let pass = 0; pass < (hasActive ? 2 : 1); pass++) {
    const dimPass = hasActive && pass === 0;
    ctx.globalAlpha = dimPass ? palette.dimAlpha : 1;
    for (const g of groups) {
      const path = new Path2D();
      let any = false;
      for (const idx of g.nodes) {
        if (hasActive && (neighbor[idx] === 1) === dimPass) continue;
        const n = nodes[idx];
        if (!inView(n)) continue;
        addShape(path, n);
        any = true;
      }
      if (!any) continue;
      ctx.fillStyle = g.color;
      ctx.fill(path);
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;

  // ---- Hover and selection rings ----
  if (hovered >= 0 && hovered !== selected) {
    const n = nodes[hovered];
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r + 3 * px, 0, Math.PI * 2);
    ctx.strokeStyle = palette.hoverRing;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
  }
  if (selected >= 0) {
    const n = nodes[selected];
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r + 7 * px, 0, Math.PI * 2);
    ctx.strokeStyle = palette.ringSoft;
    ctx.lineWidth = 5 * px;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r + 3.5 * px, 0, Math.PI * 2);
    ctx.strokeStyle = palette.ring;
    ctx.lineWidth = 2.25 * px;
    ctx.stroke();
  }

  drawLabels(input);
}

function drawLabels(input: RenderInput): void {
  const { ctx, width, height, dpr, cam, nodes, palette, selected, hovered, active, neighbor, fontFamily, scratch } = input;
  const k = cam.k;
  const hasActive = active >= 0;
  const topCount = Math.round(Math.min(28, Math.max(6, 4 + 12 * k)));
  const fontItem = itemFont(fontFamily);
  const fontEntity = entityFont(fontFamily);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const candidates = scratch.candidates;
  candidates.length = 0;
  let measuringFont = "";

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const sx = n.x * k + cam.x;
    const sy = n.y * k + cam.y;
    const sr = n.r * k;
    if (sx < -200 || sx > width + 200 || sy < -40 || sy > height + 40) continue;
    const isItem = n.kind === "item";
    let priority: number;
    let force = false;
    if (i === selected) {
      priority = 1e9;
      force = true;
    } else if (i === hovered) {
      priority = 1e8;
      force = true;
    } else if (hasActive) {
      if (!neighbor[i]) continue;
      priority = 1e6 + (isItem ? 1e4 : 0) + n.weight * 10 + sr;
    } else {
      const big = isItem ? sr >= 10.5 || k >= 1.15 : sr >= 8.5 || k >= 1.9;
      if (!big && n.rank >= topCount) continue;
      priority = (isItem ? 2000 : 0) + n.weight * 10 + sr - n.rank * 0.01;
    }
    if (n.labelWidth < 0) {
      const font = isItem ? fontItem : fontEntity;
      if (measuringFont !== font) {
        ctx.font = font;
        measuringFont = font;
      }
      n.labelWidth = ctx.measureText(n.label).width;
    }
    candidates.push({
      index: i,
      priority,
      x: sx,
      y: sy,
      r: sr,
      width: n.labelWidth + LABEL_PAD_X * 2,
      height: LABEL_HEIGHT,
      force,
    });
  }

  const placed = placeLabels(candidates, width, height, MAX_LABELS, scratch.placed);
  if (!placed.length) return;

  const pills = new Path2D();
  for (const p of placed) roundedRect(pills, p.x, p.y, p.width, p.height, 7);
  ctx.fillStyle = palette.labelBg;
  ctx.fill(pills);
  ctx.strokeStyle = palette.labelBorder;
  ctx.lineWidth = 1;
  ctx.stroke(pills);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let pass = 0; pass < 2; pass++) {
    const items = pass === 0;
    ctx.font = items ? fontItem : fontEntity;
    ctx.fillStyle = items ? palette.text : palette.textMuted;
    for (const p of placed) {
      const n = nodes[p.index];
      if ((n.kind === "item") !== items) continue;
      ctx.fillText(n.label, p.x + p.width / 2, p.y + p.height / 2 + 0.5);
    }
  }
}
