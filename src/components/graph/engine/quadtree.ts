/**
 * Barnes–Hut quadtree for the graph's many-body (repulsion) force.
 *
 * Cells live in flat, reusable arrays so rebuilding the tree every simulation tick allocates nothing
 * once it has warmed up. Each cell stores its bounds, its four children, and — after `accumulate()` —
 * its total charge and charge-weighted centre. Points that land on exactly the same spot (or that are
 * still together at the maximum depth) share one leaf through a linked list (`next`).
 */

const MAX_DEPTH = 32;

export class QuadTree {
  /** Number of cells in use. Cell 0 is the root. */
  count = 0;

  private x0: number[] = [];
  private y0: number[] = [];
  private size: number[] = [];
  private internal: number[] = [];
  /** Four child slots per cell (-1 = empty). */
  private child: number[] = [];
  /** First point in a leaf (-1 for empty leaves and internal cells). */
  private point: number[] = [];
  /** Per point: the next point sharing its leaf (-1 = last). */
  private next: number[] = [];

  /** Sum of the charges inside each cell. */
  value: number[] = [];
  /** Charge-weighted centre of each cell. */
  mx: number[] = [];
  my: number[] = [];

  private xs: ArrayLike<number> = [];
  private ys: ArrayLike<number> = [];

  /** Rebuild the tree for points (xs[i], ys[i]), i < n. */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number): void {
    this.xs = xs;
    this.ys = ys;
    this.count = 0;
    if (this.next.length < n) this.next.length = n;
    if (n === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    // Square root cell, padded so points on the max edge still fall inside.
    const extent = Math.max(maxX - minX, maxY - minY, 1) * 1.0001 + 1e-6;
    this.addCell(minX, minY, extent);
    for (let i = 0; i < n; i++) this.insert(i);
  }

  private addCell(x0: number, y0: number, size: number): number {
    const c = this.count++;
    this.x0[c] = x0;
    this.y0[c] = y0;
    this.size[c] = size;
    this.internal[c] = 0;
    this.point[c] = -1;
    const k = c * 4;
    this.child[k] = -1;
    this.child[k + 1] = -1;
    this.child[k + 2] = -1;
    this.child[k + 3] = -1;
    return c;
  }

  private insert(i: number): void {
    const x = this.xs[i];
    const y = this.ys[i];
    let c = 0;
    let depth = 0;
    for (;;) {
      if (this.internal[c]) {
        const h = this.size[c] / 2;
        const right = x >= this.x0[c] + h ? 1 : 0;
        const bottom = y >= this.y0[c] + h ? 2 : 0;
        const q = right | bottom;
        const slot = c * 4 + q;
        let ch = this.child[slot];
        if (ch < 0) {
          ch = this.addCell(this.x0[c] + (right ? h : 0), this.y0[c] + (bottom ? h : 0), h);
          this.child[slot] = ch;
          this.point[ch] = i;
          this.next[i] = -1;
          return;
        }
        c = ch;
        depth++;
        continue;
      }

      const p = this.point[c];
      if (p < 0) {
        this.point[c] = i;
        this.next[i] = -1;
        return;
      }
      if ((this.xs[p] === x && this.ys[p] === y) || depth >= MAX_DEPTH) {
        this.next[i] = p;
        this.point[c] = i;
        return;
      }
      // Split the leaf: its existing points move one level down, then keep descending for `i`.
      this.internal[c] = 1;
      this.point[c] = -1;
      const h = this.size[c] / 2;
      const right = this.xs[p] >= this.x0[c] + h ? 1 : 0;
      const bottom = this.ys[p] >= this.y0[c] + h ? 2 : 0;
      const ch = this.addCell(this.x0[c] + (right ? h : 0), this.y0[c] + (bottom ? h : 0), h);
      this.child[c * 4 + (right | bottom)] = ch;
      this.point[ch] = p;
    }
  }

  /** Compute each cell's total charge and charge-weighted centre (children always have higher indices). */
  accumulate(charges: ArrayLike<number>): void {
    for (let c = this.count - 1; c >= 0; c--) {
      if (this.internal[c]) {
        let v = 0;
        let w = 0;
        let sx = 0;
        let sy = 0;
        const k = c * 4;
        for (let q = 0; q < 4; q++) {
          const ch = this.child[k + q];
          if (ch < 0) continue;
          const cv = this.value[ch];
          const a = cv < 0 ? -cv : cv;
          v += cv;
          if (a) {
            w += a;
            sx += a * this.mx[ch];
            sy += a * this.my[ch];
          }
        }
        this.value[c] = v;
        this.mx[c] = w ? sx / w : this.x0[c] + this.size[c] / 2;
        this.my[c] = w ? sy / w : this.y0[c] + this.size[c] / 2;
      } else {
        const p = this.point[c];
        let v = 0;
        for (let q = p; q >= 0; q = this.next[q]) v += charges[q];
        this.value[c] = v;
        this.mx[c] = p >= 0 ? this.xs[p] : 0;
        this.my[c] = p >= 0 ? this.ys[p] : 0;
      }
    }
  }

  isInternal(c: number): boolean {
    return this.internal[c] === 1;
  }

  cellSize(c: number): number {
    return this.size[c];
  }

  childAt(c: number, q: number): number {
    return this.child[c * 4 + q];
  }

  firstPoint(c: number): number {
    return this.point[c];
  }

  nextPoint(p: number): number {
    return this.next[p];
  }
}
