/**
 * The interactive knowledge-graph canvas, framework-free.
 *
 * Owns the canvas: crisp devicePixelRatio sizing (ResizeObserver), the force simulation, the camera,
 * pointer/wheel/touch gestures and on-demand rendering. A requestAnimationFrame loop runs only while
 * something moves (layout cooling, camera animation); a settled graph costs no CPU, and the loop
 * pauses while the tab is hidden. Under prefers-reduced-motion the layout is computed in small
 * background slices and drawn once, and camera moves are instant.
 *
 * Gestures: wheel / trackpad pinch zooms around the cursor; dragging the background pans; dragging a
 * node pins it under the pointer (released on drop); two fingers pinch-zoom and pan; click selects;
 * double-click (or double-tap) zooms to a node, or into the background.
 */
import {
  centerOn,
  clampZoom,
  easeInOutCubic,
  fitBounds,
  lerpCamera,
  toScreen,
  toWorld,
  zoomAround,
  type Bounds,
  type Camera,
  type Viewport,
} from "./camera";
import { buildModel, placeNodes, type ColorGroup, type GLink, type GNode } from "./model";
import { createScratch, GlowSprites, renderGraph } from "./renderer";
import { ForceSimulation } from "./simulation";
import { readPalette, type Palette } from "./theme";
import type { GraphData } from "@/lib/types";

export interface GraphEngineCallbacks {
  /** A node was clicked/tapped (id), or the background was (null). */
  onSelect: (id: string | null) => void;
  /** The layout started moving (false) or came to rest (true). */
  onSettledChange?: (settled: boolean) => void;
}

type Gesture =
  | { type: "none" }
  | { type: "press"; pointerId: number; startX: number; startY: number; node: number; touch: boolean }
  | { type: "pan"; pointerId: number; lastX: number; lastY: number }
  | { type: "drag"; pointerId: number; node: number }
  | { type: "pinch"; startDist: number; startK: number; worldX: number; worldY: number };

interface CameraAnimation {
  from: Camera;
  /** Fixed destination, or null to follow `follow` (a node that may still be moving). */
  to: Camera | null;
  follow: number;
  followK: number;
  start: number;
  duration: number;
}

const MAX_DPR = 2;
const DOUBLE_TAP_MS = 320;
const FOCUS_ZOOM = 1.6;
const FIT_MAX_ZOOM = 1.6;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class GraphEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly callbacks: GraphEngineCallbacks;
  private readonly sim = new ForceSimulation<GNode>();
  private readonly sprites = new GlowSprites();
  private readonly scratch = createScratch();
  private readonly cleanups: Array<() => void> = [];

  private nodes: GNode[] = [];
  private links: GLink[] = [];
  private groups: ColorGroup[] = [];
  private adjacency: number[][] = [];
  private byId = new Map<string, number>();
  private neighbor = new Uint8Array(0);

  private width = 0;
  private height = 0;
  private dpr = 1;
  private insetRight = 0;
  private insetBottom = 0;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private camAnim: CameraAnimation | null = null;
  /** Keep the whole graph framed while it unfolds, until the person takes control of the camera. */
  private autoFit = true;

  private palette: Palette;
  private fontFamily = "system-ui, sans-serif";
  private reducedMotion = false;
  private pageHidden = false;
  private destroyed = false;

  private selectedId: string | null = null;
  private selected = -1;
  private hovered = -1;

  private raf = 0;
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  private settled = true;

  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = { type: "none" };
  private lastTap: { time: number; x: number; y: number; node: number } | null = null;
  /** Touch: the details sheet opens after the double-tap window, so it can't swallow a second tap. */
  private pendingSelect: ReturnType<typeof setTimeout> | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: GraphEngineCallbacks) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D is not available in this browser.");
    this.canvas = canvas;
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.palette = readPalette();
    this.readFont();

    const rect = canvas.getBoundingClientRect();
    this.resize(rect.width, rect.height);
    this.cam = { x: this.width / 2, y: this.height / 2, k: 1 };

    this.listen();
    this.setDataset();
  }

  // ---------------------------------------------------------------- public API

  setData(data: GraphData): void {
    const previous = new Map(this.nodes.map((n) => [n.id, n] as const));
    const model = buildModel(data);
    const placement = placeNodes(model, previous);
    const sameNodes = placement.reused === model.nodes.length && placement.removed === 0;
    const sameLinks = sameNodes && model.links.length === this.links.length;

    this.nodes = model.nodes;
    this.links = model.links;
    this.groups = model.groups;
    this.adjacency = model.adjacency;
    this.byId = model.byId;
    this.neighbor = new Uint8Array(model.nodes.length);
    this.sim.setGraph(model.nodes, model.links);
    // Node indices changed: a camera move that follows a node would now follow the wrong one.
    if (this.camAnim && this.camAnim.follow >= 0) this.camAnim = null;
    this.selected = this.selectedId ? (this.byId.get(this.selectedId) ?? -1) : -1;
    this.hovered = -1;
    this.updateHighlight();
    this.setDataset();
    this.setCursor("grab");

    if (!this.nodes.length) {
      this.sim.alpha = 0;
      this.camAnim = null;
      this.draw();
      this.setSettled(true);
      return;
    }

    if (placement.reused === 0) {
      // Fresh layout: unfold from the middle and keep it framed.
      this.sim.alpha = 1;
      this.autoFit = true;
      this.cam = centerOn(this.viewport(), 0, 0, 1.4);
    } else if (!sameLinks) {
      const changed = (model.nodes.length - placement.reused + placement.removed) / Math.max(1, Math.max(previous.size, model.nodes.length));
      this.sim.reheat(Math.min(0.85, 0.22 + changed * 0.7));
      if (changed > 0.35) this.autoFit = true;
    } else {
      this.draw();
      return;
    }
    this.startLayout();
  }

  setSelected(id: string | null): void {
    if (this.pendingSelect && id !== this.selectedId) {
      // The parent changed the selection itself (search, Esc…) before a pending tap was reported.
      this.cancelPendingSelect();
    } else if (this.pendingSelect) {
      return;
    }
    this.selectedId = id;
    const idx = id ? (this.byId.get(id) ?? -1) : -1;
    if (idx === this.selected) return;
    this.selected = idx;
    this.updateHighlight();
    this.setDataset();
    if (idx >= 0) this.ensureVisible(idx);
    this.requestFrame();
  }

  /** Space covered by floating panels, so fitting and focusing aim at the visible part. */
  setInsets(right: number, bottom: number): void {
    const r = Math.max(0, Math.round(right));
    const b = Math.max(0, Math.round(bottom));
    if (r === this.insetRight && b === this.insetBottom) return;
    this.insetRight = r;
    this.insetBottom = b;
    if (this.selected >= 0) this.ensureVisible(this.selected);
    else if (this.autoFit) this.animateTo(this.fitCamera(), 260);
  }

  hasNode(id: string): boolean {
    return this.byId.has(id);
  }

  /** Zoom by `factor` around the centre of the visible area. */
  zoomBy(factor: number): void {
    this.autoFit = false;
    const v = this.viewport();
    const base = this.camAnim?.to ?? this.cam;
    const target = zoomAround(base, (v.width - v.insetRight) / 2, (v.height - v.insetBottom) / 2, factor);
    this.animateTo(target, 200);
  }

  panBy(dx: number, dy: number): void {
    this.autoFit = false;
    const base = this.camAnim?.to ?? this.cam;
    this.animateTo({ k: base.k, x: base.x + dx, y: base.y + dy }, 160);
  }

  /** Frame the whole graph (and keep it framed while the layout is still moving). */
  fit(): void {
    this.autoFit = true;
    this.animateTo(this.fitCamera(), 420);
  }

  /** Centre and zoom to a node. Returns false when it isn't in the graph. */
  focusNode(id: string, zoom = FOCUS_ZOOM): boolean {
    const idx = this.byId.get(id);
    if (idx === undefined) return false;
    this.autoFit = false;
    this.animateFollow(idx, Math.max(this.cam.k, zoom), 520);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    this.cancelPendingSelect();
    for (const fn of this.cleanups.splice(0)) fn();
    this.sprites.clear();
  }

  // ---------------------------------------------------------------- layout loop

  private startLayout(): void {
    this.setSettled(false);
    if (this.reducedMotion) this.settleQuietly();
    else this.requestFrame();
  }

  /** Reduced motion: compute the layout in short slices without drawing, then draw it once. */
  private settleQuietly(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    let total = 0;
    const step = () => {
      this.quietTimer = null;
      if (this.destroyed) return;
      total += this.sim.run(600, 8);
      if (!this.sim.settled && total < 600) {
        this.quietTimer = setTimeout(step, 0);
        return;
      }
      this.sim.alpha = 0;
      if (this.autoFit) this.cam = this.fitCamera();
      this.draw();
      this.setSettled(true);
    };
    step();
  }

  private requestFrame(): void {
    if (this.raf || this.destroyed || this.pageHidden) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (time: number) => {
    this.raf = 0;
    if (this.destroyed) return;
    let again = false;

    if (!this.reducedMotion && !this.sim.settled && this.nodes.length) {
      this.sim.tick();
      if (this.sim.settled) {
        this.setSettled(true);
        if (this.autoFit) this.animateTo(this.fitCamera(), 380);
      } else {
        again = true;
      }
    }

    const anim = this.camAnim;
    if (anim) {
      const t = Math.min(1, (time - anim.start) / anim.duration);
      const target = anim.to ?? this.followCamera(anim.follow, anim.followK);
      this.cam = lerpCamera(this.viewport(), anim.from, target, easeInOutCubic(t));
      if (t >= 1) this.camAnim = null;
      else again = true;
    } else if (this.autoFit && again) {
      this.cam = lerpCamera(this.viewport(), this.cam, this.fitCamera(), 0.12);
    }

    this.draw();
    if (again) this.requestFrame();
  };

  private setSettled(settled: boolean): void {
    if (this.settled === settled) return;
    this.settled = settled;
    this.canvas.dataset.settled = settled ? "true" : "false";
    this.callbacks.onSettledChange?.(settled);
  }

  // ---------------------------------------------------------------- camera

  private viewport(): Viewport {
    // Ignore insets that would leave almost nothing visible (tiny screens).
    const right = this.insetRight < this.width * 0.7 ? this.insetRight : 0;
    const bottom = this.insetBottom < this.height * 0.75 ? this.insetBottom : 0;
    return { width: this.width, height: this.height, insetRight: right, insetBottom: bottom };
  }

  private bounds(): Bounds {
    const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const n of this.nodes) {
      if (n.x - n.r < b.minX) b.minX = n.x - n.r;
      if (n.y - n.r < b.minY) b.minY = n.y - n.r;
      if (n.x + n.r > b.maxX) b.maxX = n.x + n.r;
      if (n.y + n.r > b.maxY) b.maxY = n.y + n.r;
    }
    if (!Number.isFinite(b.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return b;
  }

  private fitCamera(): Camera {
    const v = this.viewport();
    const pad = Math.max(20, Math.min(64, Math.min(v.width, v.height) * 0.08));
    // Leave room for labels under the lowest nodes.
    const b = this.bounds();
    b.maxY += 14 / Math.max(0.2, this.cam.k);
    return fitBounds(v, b, pad, FIT_MAX_ZOOM);
  }

  private followCamera(idx: number, k: number): Camera {
    const n = this.nodes[idx];
    if (!n) return this.cam;
    return centerOn(this.viewport(), n.x, n.y, k);
  }

  private animateTo(target: Camera, duration: number): void {
    if (this.reducedMotion) {
      this.camAnim = null;
      this.cam = target;
      this.requestFrame();
      return;
    }
    this.camAnim = { from: { ...this.cam }, to: target, follow: -1, followK: target.k, start: now(), duration };
    this.requestFrame();
  }

  private animateFollow(idx: number, k: number, duration: number): void {
    const kk = clampZoom(k);
    if (this.reducedMotion) {
      this.camAnim = null;
      this.cam = this.followCamera(idx, kk);
      this.requestFrame();
      return;
    }
    this.camAnim = { from: { ...this.cam }, to: null, follow: idx, followK: kk, start: now(), duration };
    this.requestFrame();
  }

  /** Pan a node into the visible area when it sits off-screen or under a panel. */
  private ensureVisible(idx: number): void {
    const n = this.nodes[idx];
    if (!n) return;
    // Already flying there, or the layout is still unfolding and being framed as a whole.
    if ((this.camAnim && this.camAnim.follow === idx) || (this.autoFit && !this.sim.settled)) return;
    const v = this.viewport();
    const [sx, sy] = toScreen(this.cam, n.x, n.y);
    const margin = Math.min(64, Math.min(v.width - v.insetRight, v.height - v.insetBottom) * 0.15);
    const inside = sx >= margin && sx <= v.width - v.insetRight - margin && sy >= margin && sy <= v.height - v.insetBottom - margin;
    if (inside) return;
    this.autoFit = false;
    this.animateFollow(idx, this.cam.k, 420);
  }

  // ---------------------------------------------------------------- drawing

  private draw(): void {
    if (this.destroyed || !this.width || !this.height) return;
    renderGraph({
      ctx: this.ctx,
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      cam: this.cam,
      nodes: this.nodes,
      links: this.links,
      groups: this.groups,
      palette: this.palette,
      selected: this.selected,
      hovered: this.hovered,
      active: this.hovered >= 0 ? this.hovered : this.selected,
      neighbor: this.neighbor,
      fontFamily: this.fontFamily,
      sprites: this.sprites,
      scratch: this.scratch,
    });
  }

  private updateHighlight(): void {
    this.neighbor.fill(0);
    const active = this.hovered >= 0 ? this.hovered : this.selected;
    if (active < 0 || active >= this.nodes.length) return;
    this.neighbor[active] = 1;
    for (const j of this.adjacency[active]) this.neighbor[j] = 1;
  }

  private resize(cssWidth: number, cssHeight: number): void {
    const w = Math.max(0, Math.round(cssWidth));
    const h = Math.max(0, Math.round(cssHeight));
    const dpr = Math.min(MAX_DPR, Math.max(1, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    const dw = w - this.width;
    const dh = h - this.height;
    const hadSize = this.width > 0 && this.height > 0;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    if (hadSize) {
      // Keep what was in the middle in the middle.
      this.cam = { ...this.cam, x: this.cam.x + dw / 2, y: this.cam.y + dh / 2 };
    }
    if (this.autoFit && this.nodes.length && this.settled) this.cam = this.fitCamera();
    // Resizing clears the canvas: redraw right away to avoid a blank frame.
    this.draw();
  }

  private readFont(): void {
    try {
      const root = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-sans").trim();
      const own = getComputedStyle(this.canvas).fontFamily;
      const family = root ? `${root}, ui-sans-serif, system-ui, sans-serif` : own || "ui-sans-serif, system-ui, sans-serif";
      if (family !== this.fontFamily) {
        this.fontFamily = family;
        for (const n of this.nodes) n.labelWidth = -1;
      }
    } catch {
      /* keep the default font */
    }
  }

  private setDataset(): void {
    const d = this.canvas.dataset;
    d.nodeCount = String(this.nodes.length);
    d.linkCount = String(this.links.length);
    d.settled = this.settled ? "true" : "false";
    if (this.selectedId && this.selected >= 0) d.selected = this.selectedId;
    else delete d.selected;
  }

  private setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ---------------------------------------------------------------- input

  private local(e: { clientX: number; clientY: number }): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private hitTest(sx: number, sy: number, slopPx: number): number {
    const [wx, wy] = toWorld(this.cam, sx, sy);
    const slop = slopPx / this.cam.k;
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const dx = wx - n.x;
      const dy = wy - n.y;
      const reach = n.r + slop;
      if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
      const d = Math.sqrt(dx * dx + dy * dy) - n.r;
      if (d > slop) continue;
      // Prefer memories (drawn on top) and the closest edge.
      const score = d - (n.kind === "item" ? 0.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private setHovered(idx: number): void {
    if (idx === this.hovered) return;
    this.hovered = idx;
    this.updateHighlight();
    this.requestFrame();
  }

  private listen(): void {
    const c = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    on(c, "pointerdown", this.onPointerDown);
    on(c, "pointermove", this.onPointerMove);
    on(c, "pointerup", this.onPointerUp);
    on(c, "pointercancel", this.onPointerCancel);
    on(c, "pointerleave", this.onPointerLeave);
    on(c, "wheel", this.onWheel, { passive: false });
    on(c, "contextmenu", (e) => {
      if (this.gesture.type !== "none") e.preventDefault();
    });

    const ro = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      this.resize(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(c);
    this.cleanups.push(() => ro.disconnect());

    // Theme changes (html.dark toggles).
    const mo = new MutationObserver(() => {
      const next = readPalette();
      if (next === this.palette) return;
      this.palette = next;
      this.sprites.clear();
      this.requestFrame();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.cleanups.push(() => mo.disconnect());

    // Web fonts finishing loading change label widths.
    if (document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (this.destroyed) return;
        this.readFont();
        for (const n of this.nodes) n.labelWidth = -1;
        this.requestFrame();
      });
    }

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = motion.matches;
    const onMotion = () => {
      this.reducedMotion = motion.matches;
      if (this.reducedMotion && !this.sim.settled) {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.settleQuietly();
      }
    };
    motion.addEventListener("change", onMotion);
    this.cleanups.push(() => motion.removeEventListener("change", onMotion));

    // Moving the window to a screen with a different pixel density.
    let dprQuery: MediaQueryList | null = null;
    const onDpr = () => {
      const rect = c.getBoundingClientRect();
      this.resize(rect.width, rect.height);
      watchDpr();
    };
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener("change", onDpr);
    };
    watchDpr();
    this.cleanups.push(() => dprQuery?.removeEventListener("change", onDpr));

    const onVisibility = () => {
      this.pageHidden = document.visibilityState === "hidden";
      if (this.pageHidden) {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
      } else if (!this.sim.settled || this.camAnim) {
        this.requestFrame();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    if (e.pointerType === "mouse") this.canvas.focus({ preventScroll: true });

    if (this.pointers.size === 1) {
      const touch = e.pointerType !== "mouse";
      const node = this.hitTest(x, y, touch ? 12 : 4);
      this.gesture = { type: "press", pointerId: e.pointerId, startX: x, startY: y, node, touch };
      return;
    }
    if (this.pointers.size === 2) {
      this.endDrag();
      const [a, b] = Array.from(this.pointers.values());
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const [worldX, worldY] = toWorld(this.cam, midX, midY);
      this.autoFit = false;
      this.camAnim = null;
      this.gesture = { type: "pinch", startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), startK: this.cam.k, worldX, worldY };
      this.setHovered(-1);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    const tracked = this.pointers.get(e.pointerId);
    if (tracked) {
      tracked.x = x;
      tracked.y = y;
    }
    const g = this.gesture;

    if (g.type === "pinch") {
      if (this.pointers.size < 2) return;
      const [a, b] = Array.from(this.pointers.values());
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const k = clampZoom((g.startK * dist) / g.startDist);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.cam = { k, x: midX - g.worldX * k, y: midY - g.worldY * k };
      this.requestFrame();
      return;
    }

    if (g.type === "press" && g.pointerId === e.pointerId) {
      const threshold = g.touch ? 8 : 3;
      if (Math.hypot(x - g.startX, y - g.startY) < threshold) return;
      this.autoFit = false;
      this.camAnim = null;
      if (g.node >= 0) {
        this.gesture = { type: "drag", pointerId: e.pointerId, node: g.node };
        const n = this.nodes[g.node];
        n.fx = n.x;
        n.fy = n.y;
        if (!this.reducedMotion) {
          this.sim.alphaTarget = 0.3;
          this.sim.reheat(0.3);
          this.setSettled(false);
        }
        this.setHovered(g.node);
      } else {
        this.gesture = { type: "pan", pointerId: e.pointerId, lastX: g.startX, lastY: g.startY };
        this.setHovered(-1);
      }
      this.setCursor("grabbing");
    }

    const cur = this.gesture;
    if (cur.type === "drag" && cur.pointerId === e.pointerId) {
      const n = this.nodes[cur.node];
      if (!n) return;
      const [wx, wy] = toWorld(this.cam, x, y);
      n.fx = wx;
      n.fy = wy;
      if (this.reducedMotion) {
        n.x = wx;
        n.y = wy;
      }
      this.requestFrame();
      return;
    }
    if (cur.type === "pan" && cur.pointerId === e.pointerId) {
      this.cam = { ...this.cam, x: this.cam.x + x - cur.lastX, y: this.cam.y + y - cur.lastY };
      cur.lastX = x;
      cur.lastY = y;
      this.requestFrame();
      return;
    }

    if (cur.type === "none" && e.pointerType === "mouse") {
      const idx = this.hitTest(x, y, 4);
      this.setHovered(idx);
      this.setCursor(idx >= 0 ? "pointer" : "grab");
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const [x, y] = this.local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;

    if (g.type === "press" && g.pointerId === e.pointerId) {
      this.gesture = { type: "none" };
      this.tap(x, y, g.node, g.touch);
      return;
    }
    if (g.type === "drag" && g.pointerId === e.pointerId) {
      this.endDrag();
      this.gesture = { type: "none" };
      this.setCursor(e.pointerType === "mouse" && this.hitTest(x, y, 4) >= 0 ? "pointer" : "grab");
      if (e.pointerType !== "mouse") this.setHovered(-1);
      return;
    }
    if (g.type === "pinch") {
      // One finger still down: carry on panning with it.
      const rest = Array.from(this.pointers.entries())[0];
      this.gesture = rest ? { type: "pan", pointerId: rest[0], lastX: rest[1].x, lastY: rest[1].y } : { type: "none" };
      return;
    }
    if (g.type === "pan" && g.pointerId === e.pointerId) {
      this.gesture = { type: "none" };
      this.setCursor("grab");
    }
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.endDrag();
    this.gesture = { type: "none" };
    this.setHovered(-1);
    this.setCursor("grab");
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && this.gesture.type === "none") this.setHovered(-1);
  };

  private endDrag(): void {
    const g = this.gesture;
    if (g.type !== "drag") return;
    const n = this.nodes[g.node];
    if (n) {
      if (this.reducedMotion && n.fx !== null && n.fy !== null) {
        n.x = n.fx;
        n.y = n.fy;
      }
      n.fx = null;
      n.fy = null;
    }
    this.sim.alphaTarget = 0;
    if (this.reducedMotion) this.draw();
    else this.requestFrame();
  }

  private tap(x: number, y: number, node: number, touch: boolean): void {
    const t = now();
    const last = this.lastTap;
    // A second tap in the same spot. The first tap may have moved the camera (e.g. a details sheet
    // opened), so a second tap that lands on background still counts for the node tapped first.
    const quick = !!last && t - last.time < DOUBLE_TAP_MS && Math.hypot(x - last.x, y - last.y) < (touch ? 28 : 12);
    const isDouble = quick && (last.node === node || (node < 0 && last.node >= 0));
    if (isDouble && node < 0) node = last.node;
    this.lastTap = isDouble ? null : { time: t, x, y, node };

    this.cancelPendingSelect();
    if (node >= 0) {
      const id = this.nodes[node].id;
      this.selectedId = id;
      if (this.selected !== node) {
        this.selected = node;
        this.updateHighlight();
        this.setDataset();
        this.requestFrame();
      }
      if (touch && !isDouble) {
        this.pendingSelect = setTimeout(() => {
          this.pendingSelect = null;
          if (!this.destroyed && this.selectedId === id) this.callbacks.onSelect(id);
        }, DOUBLE_TAP_MS);
      } else {
        this.callbacks.onSelect(id);
      }
      if (isDouble) {
        this.autoFit = false;
        this.animateFollow(node, Math.max(this.cam.k * 1.6, FOCUS_ZOOM + 0.4), 480);
      }
      return;
    }

    if (isDouble) {
      this.autoFit = false;
      this.animateTo(zoomAround(this.camAnim?.to ?? this.cam, x, y, 2), 260);
      return;
    }
    if (this.selected >= 0 || this.selectedId) {
      this.selectedId = null;
      this.selected = -1;
      this.updateHighlight();
      this.setDataset();
      this.requestFrame();
    }
    this.callbacks.onSelect(null);
  }

  private cancelPendingSelect(): void {
    if (this.pendingSelect) clearTimeout(this.pendingSelect);
    this.pendingSelect = null;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.autoFit = false;
    this.camAnim = null;
    const [x, y] = this.local(e);
    const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
    const pinch = e.ctrlKey;
    // Trackpads send horizontal deltas for sideways two-finger swipes: pan with those.
    if (!pinch && e.deltaMode === 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.cam = { ...this.cam, x: this.cam.x - e.deltaX };
      this.requestFrame();
      return;
    }
    const delta = -e.deltaY * unit * (pinch ? 10 : 1);
    this.cam = zoomAround(this.cam, x, y, Math.pow(2, Math.max(-1, Math.min(1, delta))));
    this.requestFrame();
  };
}
