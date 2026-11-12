/**
 * Force-directed layout for the knowledge graph.
 *
 * Velocity Verlet integration with a cooling `alpha` (like d3-force): every tick the forces nudge
 * each node's velocity, velocities are damped, positions advance, and alpha decays towards
 * `alphaTarget`. Once alpha drops below `alphaMin` the layout is settled and callers stop ticking,
 * so a finished graph costs no CPU at all.
 *
 * Forces:
 * - many-body repulsion — Barnes–Hut quadtree above `bhThreshold` nodes, exact O(n²) below it;
 * - link springs — rest length per link, strength 1/min(degree) with a degree-based bias;
 * - gentle gravity towards the origin (keeps lone memories and separate clusters on screen);
 * - centring — shifts the whole layout so its mean stays at the origin (skipped while dragging);
 * - collision — keeps node discs (plus padding) from overlapping, via a uniform grid.
 */
import { QuadTree } from "./quadtree";

export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned position (set while dragging), or null. */
  fx: number | null;
  fy: number | null;
  /** Disc radius in world units (collision). */
  r: number;
  /** Many-body strength; negative repels. */
  charge: number;
}

export interface SimLink {
  source: number;
  target: number;
  /** Rest length in world units. */
  distance: number;
  /** Multiplier on top of the degree-based default strength. */
  strengthScale?: number;
}

export interface SimulationOptions {
  /** Barnes–Hut accuracy (lower = more exact). */
  theta: number;
  /** Use the quadtree when there are more nodes than this. */
  bhThreshold: number;
  /** Share of velocity removed every tick (0..1). */
  velocityDecay: number;
  alphaMin: number;
  /** Ticks for alpha to cool from 1 to alphaMin. */
  coolingTicks: number;
  gravity: number;
  collidePadding: number;
  collideStrength: number;
  /** Seed for the tiny random nudges used when two nodes sit on the same spot. */
  seed: number;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  theta: 0.9,
  bhThreshold: 300,
  velocityDecay: 0.4,
  alphaMin: 0.001,
  coolingTicks: 260,
  gravity: 0.045,
  collidePadding: 3,
  collideStrength: 0.75,
  seed: 0x5eed,
};

const DISTANCE_MIN2 = 1;

export class ForceSimulation<N extends SimNode = SimNode> {
  nodes: N[] = [];
  links: SimLink[] = [];
  alpha = 1;
  alphaTarget = 0;
  readonly options: SimulationOptions;
  readonly alphaDecay: number;

  private strengths: number[] = [];
  private bias: number[] = [];
  private px: number[] = [];
  private py: number[] = [];
  private charges: number[] = [];
  private tree = new QuadTree();
  private grid = new Map<number, number[]>();
  private gridPool: number[][] = [];
  private seed: number;

  constructor(options: Partial<SimulationOptions> = {}) {
    this.options = { ...DEFAULT_SIMULATION_OPTIONS, ...options };
    this.alphaDecay = 1 - Math.pow(this.options.alphaMin, 1 / this.options.coolingTicks);
    this.seed = this.options.seed;
  }

  /** Replace nodes and links. Link endpoints are node indices. */
  setGraph(nodes: N[], links: SimLink[]): void {
    this.nodes = nodes;
    this.links = links.filter((l) => l.source !== l.target && nodes[l.source] && nodes[l.target]);
    const degree = new Array<number>(nodes.length).fill(0);
    for (const l of this.links) {
      degree[l.source]++;
      degree[l.target]++;
    }
    this.strengths = this.links.map((l) => (l.strengthScale ?? 1) / Math.max(1, Math.min(degree[l.source], degree[l.target])));
    this.bias = this.links.map((l) => degree[l.source] / Math.max(1, degree[l.source] + degree[l.target]));
  }

  /** Restart cooling from `alpha` (never lowers a hotter simulation). */
  reheat(alpha: number): void {
    this.alpha = Math.max(this.alpha, Math.min(1, alpha));
  }

  /** True once the layout has cooled down and nothing keeps it warm. */
  get settled(): boolean {
    return this.alpha < this.options.alphaMin && this.alphaTarget <= 0;
  }

  private random(): number {
    // Linear congruential generator: deterministic layouts for the same data.
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private jiggle(): number {
    return (this.random() - 0.5) * 1e-6;
  }

  /** Advance the layout by one step. */
  tick(): void {
    const nodes = this.nodes;
    const n = nodes.length;
    if (n === 0) {
      this.alpha = 0;
      return;
    }
    this.alpha += (this.alphaTarget - this.alpha) * this.alphaDecay;
    const alpha = this.alpha;

    this.applyLinks(alpha);
    if (n > this.options.bhThreshold) this.applyManyBodyTree(alpha);
    else this.applyManyBodyExact(alpha);
    this.applyGravity(alpha);
    this.applyCollision();

    const keep = 1 - this.options.velocityDecay;
    let pinned = false;
    for (let i = 0; i < n; i++) {
      const d = nodes[i];
      if (d.fx !== null) {
        d.x = d.fx;
        d.vx = 0;
        pinned = true;
      } else {
        d.vx *= keep;
        d.x += d.vx;
      }
      if (d.fy !== null) {
        d.y = d.fy;
        d.vy = 0;
        pinned = true;
      } else {
        d.vy *= keep;
        d.y += d.vy;
      }
    }
    if (!pinned) this.center();
  }

  /** Run ticks until settled, at most `maxTicks`, or until `budgetMs` has passed. Returns ticks run. */
  run(maxTicks: number, budgetMs = Infinity): number {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    let ticks = 0;
    while (ticks < maxTicks && !this.settled) {
      this.tick();
      ticks++;
      if (budgetMs !== Infinity) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - start >= budgetMs) break;
      }
    }
    return ticks;
  }

  private applyLinks(alpha: number): void {
    const nodes = this.nodes;
    const links = this.links;
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const s = nodes[l.source];
      const t = nodes[l.target];
      let x = t.x + t.vx - s.x - s.vx || this.jiggle();
      let y = t.y + t.vy - s.y - s.vy || this.jiggle();
      let len = Math.sqrt(x * x + y * y);
      len = ((len - l.distance) / len) * alpha * this.strengths[i];
      x *= len;
      y *= len;
      const b = this.bias[i];
      t.vx -= x * b;
      t.vy -= y * b;
      s.vx += x * (1 - b);
      s.vy += y * (1 - b);
    }
  }

  private applyManyBodyExact(alpha: number): void {
    const nodes = this.nodes;
    const n = nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let x = b.x - a.x;
        let y = b.y - a.y;
        let l = x * x + y * y;
        if (x === 0) {
          x = this.jiggle();
          l += x * x;
        }
        if (y === 0) {
          y = this.jiggle();
          l += y * y;
        }
        if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l);
        // b pushes a (b.charge) and a pushes b (a.charge), in opposite directions.
        const fa = (b.charge * alpha) / l;
        const fb = (a.charge * alpha) / l;
        a.vx += x * fa;
        a.vy += y * fa;
        b.vx -= x * fb;
        b.vy -= y * fb;
      }
    }
  }

  private applyManyBodyTree(alpha: number): void {
    const nodes = this.nodes;
    const n = nodes.length;
    const px = this.px;
    const py = this.py;
    const charges = this.charges;
    px.length = n;
    py.length = n;
    charges.length = n;
    for (let i = 0; i < n; i++) {
      px[i] = nodes[i].x;
      py[i] = nodes[i].y;
      charges[i] = nodes[i].charge;
    }
    const tree = this.tree;
    tree.build(px, py, n);
    tree.accumulate(charges);
    const theta2 = this.options.theta * this.options.theta;
    const stack: number[] = [];

    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const xi = px[i];
      const yi = py[i];
      stack.length = 0;
      stack.push(0);
      while (stack.length) {
        const c = stack.pop()!;
        const v = tree.value[c];
        if (!v) continue;
        let x = tree.mx[c] - xi;
        let y = tree.my[c] - yi;
        let l = x * x + y * y;
        const w = tree.cellSize(c);

        if ((w * w) / theta2 < l) {
          // Far enough away: treat the whole cell as one body.
          if (x === 0) {
            x = this.jiggle();
            l += x * x;
          }
          if (y === 0) {
            y = this.jiggle();
            l += y * y;
          }
          if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l);
          const f = (v * alpha) / l;
          node.vx += x * f;
          node.vy += y * f;
          continue;
        }
        if (tree.isInternal(c)) {
          for (let q = 0; q < 4; q++) {
            const ch = tree.childAt(c, q);
            if (ch >= 0) stack.push(ch);
          }
          continue;
        }
        // Leaf: apply each point directly.
        const first = tree.firstPoint(c);
        if (first !== i || tree.nextPoint(first) >= 0) {
          if (x === 0) {
            x = this.jiggle();
            l += x * x;
          }
          if (y === 0) {
            y = this.jiggle();
            l += y * y;
          }
          if (l < DISTANCE_MIN2) l = Math.sqrt(DISTANCE_MIN2 * l);
        }
        for (let p = first; p >= 0; p = tree.nextPoint(p)) {
          if (p === i) continue;
          const f = (charges[p] * alpha) / l;
          node.vx += x * f;
          node.vy += y * f;
        }
      }
    }
  }

  private applyGravity(alpha: number): void {
    const k = this.options.gravity * alpha;
    if (!k) return;
    for (const d of this.nodes) {
      d.vx -= d.x * k;
      d.vy -= d.y * k;
    }
  }

  private center(): void {
    const nodes = this.nodes;
    let sx = 0;
    let sy = 0;
    for (const d of nodes) {
      sx += d.x;
      sy += d.y;
    }
    sx /= nodes.length;
    sy /= nodes.length;
    if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) return;
    for (const d of nodes) {
      d.x -= sx;
      d.y -= sy;
    }
  }

  private applyCollision(): void {
    const nodes = this.nodes;
    const n = nodes.length;
    const pad = this.options.collidePadding;
    const strength = this.options.collideStrength;
    let maxR = 0;
    for (const d of nodes) if (d.r > maxR) maxR = d.r;
    const cell = Math.max(1, (maxR + pad) * 2);

    const grid = this.grid;
    for (const bucket of grid.values()) {
      bucket.length = 0;
      this.gridPool.push(bucket);
    }
    grid.clear();
    const px = this.px;
    const py = this.py;
    px.length = n;
    py.length = n;
    for (let i = 0; i < n; i++) {
      const d = nodes[i];
      px[i] = d.x + d.vx;
      py[i] = d.y + d.vy;
      const key = cellKey(Math.floor(px[i] / cell), Math.floor(py[i] / cell));
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = this.gridPool.pop() ?? [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }

    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const ra = a.r + pad;
      const ra2 = ra * ra;
      const cx = Math.floor(px[i] / cell);
      const cy = Math.floor(py[i] / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(cellKey(gx, gy));
          if (!bucket) continue;
          for (let m = 0; m < bucket.length; m++) {
            const j = bucket[m];
            if (j <= i) continue;
            const b = nodes[j];
            const rb = b.r + pad;
            const r = ra + rb;
            let x = px[i] - px[j];
            let y = py[i] - py[j];
            let l = x * x + y * y;
            if (l >= r * r) continue;
            if (x === 0) {
              x = this.jiggle();
              l += x * x;
            }
            if (y === 0) {
              y = this.jiggle();
              l += y * y;
            }
            l = Math.sqrt(l);
            const f = ((r - l) / l) * strength;
            x *= f;
            y *= f;
            const rb2 = rb * rb;
            const share = rb2 / (ra2 + rb2);
            a.vx += x * share;
            a.vy += y * share;
            b.vx -= x * (1 - share);
            b.vy -= y * (1 - share);
          }
        }
      }
    }
  }
}

function cellKey(gx: number, gy: number): number {
  return (gx + 0x8000) * 0x10000 + (gy + 0x8000);
}
