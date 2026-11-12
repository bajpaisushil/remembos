/**
 * In-memory vector index for meaning search.
 *
 * Chunk embeddings are L2-normalised, so cosine similarity is a plain dot product. All vectors live in
 * one contiguous, growable Float32Array (row-major, `dim` floats per row) so a full scan over ~10k
 * chunks stays in the low milliseconds. Rows are addressed by chunk id; removing a row moves the last
 * row into its slot, keeping the matrix dense.
 */
import { EMBEDDING_DIM } from "../config";

export interface VectorMatch {
  chunkId: string;
  itemId: string;
  /** Cosine similarity, -1..1. */
  score: number;
}

export interface VectorSearchOptions {
  /** Ignore rows below this similarity. */
  minScore?: number;
  /** Also ignore rows more than this far below the best match (keeps weak tails out). */
  window?: number;
  /** Maximum number of matches returned. */
  limit?: number;
  /** Only consider rows whose item passes this test. */
  filter?: (itemId: string) => boolean;
}

export class VectorIndex {
  readonly dim: number;
  private data: Float32Array;
  private capacity: number;
  private chunkIds: string[] = [];
  private itemIds: string[] = [];
  private rowOf = new Map<string, number>();
  private byItem = new Map<string, Set<string>>();

  constructor(dim: number = EMBEDDING_DIM, initialRows = 256) {
    this.dim = dim;
    this.capacity = Math.max(1, initialRows);
    this.data = new Float32Array(this.capacity * dim);
  }

  /** Number of stored vectors. */
  get size(): number {
    return this.chunkIds.length;
  }

  has(chunkId: string): boolean {
    return this.rowOf.has(chunkId);
  }

  /** Item ids that have at least one vector. */
  items(): IterableIterator<string> {
    return this.byItem.keys();
  }

  /** Insert or replace the vector of a chunk. Vectors with the wrong length are ignored. */
  upsert(chunkId: string, itemId: string, vector: ArrayLike<number>): boolean {
    if (!vector || vector.length !== this.dim) return false;
    let row = this.rowOf.get(chunkId);
    if (row === undefined) {
      row = this.chunkIds.length;
      this.ensureCapacity(row + 1);
      this.chunkIds.push(chunkId);
      this.itemIds.push(itemId);
      this.rowOf.set(chunkId, row);
    } else if (this.itemIds[row] !== itemId) {
      const previous = this.itemIds[row];
      const old = this.byItem.get(previous);
      old?.delete(chunkId);
      if (old && old.size === 0) this.byItem.delete(previous);
      this.itemIds[row] = itemId;
    }
    this.data.set(vector, row * this.dim);
    let set = this.byItem.get(itemId);
    if (!set) {
      set = new Set();
      this.byItem.set(itemId, set);
    }
    set.add(chunkId);
    return true;
  }

  removeChunk(chunkId: string): void {
    const row = this.rowOf.get(chunkId);
    if (row === undefined) return;
    const itemId = this.itemIds[row];
    const set = this.byItem.get(itemId);
    if (set) {
      set.delete(chunkId);
      if (set.size === 0) this.byItem.delete(itemId);
    }
    const last = this.chunkIds.length - 1;
    if (row !== last) {
      // Move the last row into the freed slot.
      const lastId = this.chunkIds[last];
      this.data.copyWithin(row * this.dim, last * this.dim, (last + 1) * this.dim);
      this.chunkIds[row] = lastId;
      this.itemIds[row] = this.itemIds[last];
      this.rowOf.set(lastId, row);
    }
    this.chunkIds.pop();
    this.itemIds.pop();
    this.rowOf.delete(chunkId);
  }

  removeItem(itemId: string): void {
    const set = this.byItem.get(itemId);
    if (!set) return;
    for (const chunkId of Array.from(set)) this.removeChunk(chunkId);
    this.byItem.delete(itemId);
  }

  clear(): void {
    this.chunkIds = [];
    this.itemIds = [];
    this.rowOf.clear();
    this.byItem.clear();
    this.capacity = 256;
    this.data = new Float32Array(this.capacity * this.dim);
  }

  /** Copy of one chunk's vector, or null. */
  get(chunkId: string): Float32Array | null {
    const row = this.rowOf.get(chunkId);
    if (row === undefined) return null;
    return this.data.slice(row * this.dim, (row + 1) * this.dim);
  }

  /** Normalised mean of an item's chunk vectors (its overall "meaning"), or null if none. */
  itemMean(itemId: string): Float32Array | null {
    const set = this.byItem.get(itemId);
    if (!set || set.size === 0) return null;
    const dim = this.dim;
    const out = new Float32Array(dim);
    for (const chunkId of set) {
      const off = (this.rowOf.get(chunkId) as number) * dim;
      for (let j = 0; j < dim; j++) out[j] += this.data[off + j];
    }
    return normalize(out);
  }

  /** Rows most similar to `query` (which must be normalised), best first. */
  search(query: ArrayLike<number>, opts: VectorSearchOptions = {}): VectorMatch[] {
    const dim = this.dim;
    const n = this.chunkIds.length;
    if (!n || query.length !== dim) return [];
    const minScore = opts.minScore ?? -1;
    const filter = opts.filter;
    const data = this.data;
    const q = query instanceof Float32Array ? query : Float32Array.from(query);
    const rows: number[] = [];
    const scores: number[] = [];
    let best = -Infinity;
    for (let r = 0; r < n; r++) {
      if (filter && !filter(this.itemIds[r])) continue;
      const off = r * dim;
      let dot = 0;
      for (let j = 0; j < dim; j++) dot += data[off + j] * q[j];
      if (dot < minScore) continue;
      rows.push(r);
      scores.push(dot);
      if (dot > best) best = dot;
    }
    if (!rows.length) return [];
    const floor = opts.window !== undefined ? Math.max(minScore, best - opts.window) : minScore;
    const order: number[] = [];
    for (let i = 0; i < rows.length; i++) if (scores[i] >= floor) order.push(i);
    order.sort((a, b) => scores[b] - scores[a]);
    const limit = Math.min(order.length, opts.limit ?? order.length);
    const out: VectorMatch[] = new Array(limit);
    for (let i = 0; i < limit; i++) {
      const r = rows[order[i]];
      out[i] = { chunkId: this.chunkIds[r], itemId: this.itemIds[r], score: scores[order[i]] };
    }
    return out;
  }

  private ensureCapacity(rows: number): void {
    if (rows <= this.capacity) return;
    let next = this.capacity;
    while (next < rows) next *= 2;
    const grown = new Float32Array(next * this.dim);
    grown.set(this.data.subarray(0, this.chunkIds.length * this.dim));
    this.data = grown;
    this.capacity = next;
  }
}

/** Scale a vector to unit length in place (returns it). Zero vectors are left as they are. */
export function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  if (sum > 0) {
    const inv = 1 / Math.sqrt(sum);
    for (let i = 0; i < v.length; i++) v[i] *= inv;
  }
  return v;
}

/** Dot product of two equal-length vectors. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
