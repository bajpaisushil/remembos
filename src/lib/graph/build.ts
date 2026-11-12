/**
 * Knowledge graph: memories ↔ the names, numbers, links, dates, tags and topics they mention, plus
 * (optionally) memory ↔ memory links between memories about the same thing.
 *
 * Item metadata and chunk vectors come from the in-memory search index and entities from the
 * `entities` table, so a graph over thousands of memories builds quickly; the similarity pass yields
 * to the main thread while it works.
 *
 * Defaults:
 * - Entity types: all of them, except that topics (automatic keywords) are only shown when at least
 *   two memories share them — one-off topics add clutter, not connections — and are left out
 *   entirely for libraries above 400 memories, where they would turn the graph into a hairball.
 *   Passing `entityTypes` uses exactly those types, with `minItemsPerEntity` applied to all of them.
 * - Similar links (opt-in): cosine ≥ 0.55 between the items' mean chunk vectors, top 3 per item.
 * - `focusId`: only nodes within two hops of that node, nearest first.
 * - `maxNodes` (400): keeps the most connected memories plus the entities linking them (see
 *   `selectNodes`); the focus node always stays.
 * - Weights: item = number of links it has in the returned graph, entity = number of memories
 *   mentioning it.
 */
import { db } from "../db";
import { getIndexedItems, getItemVectors } from "../search";
import { ENTITY_TYPES, type EntityType, type GraphData, type GraphLink, type GraphNode, type MemoryKind } from "../types";

export interface GraphOptions {
  entityTypes?: EntityType[];
  /** Add item↔item links for semantically similar items (cosine ≥ threshold). */
  includeSimilar?: boolean;
  /** Hide entities linked to fewer than this many items (default 1 → show all; 2 → only shared). */
  minItemsPerEntity?: number;
  /** Only the neighbourhood (≤ 2 hops) of this node id. */
  focusId?: string;
  /** Cap for performance (keeps highest-weight nodes). */
  maxNodes?: number;
}

export const GRAPH_DEFAULTS = {
  maxNodes: 400,
  similarThreshold: 0.55,
  similarPerItem: 3,
  /** Above this many memories, topics are left out unless explicitly requested. */
  topicItemLimit: 400,
  /** Topics shown by default only when shared by at least this many memories. */
  topicMinItems: 2,
  /** Most items compared pairwise for similarity (n² work). */
  similarCandidates: 1000,
  /** Share of a capped graph's node budget given to memories (the rest goes to what connects them). */
  itemShare: 0.6,
} as const;

export interface GraphItemInput {
  id: string;
  title: string;
  kind: MemoryKind;
  createdAt: number;
}

export interface GraphEntityInput {
  id: string;
  type: EntityType;
  value: string;
  itemIds: string[];
}

export interface SimilarPair {
  a: string;
  b: string;
  score: number;
}

export interface AssembleOptions {
  minItemsPerEntity?: number;
  /** Extra minimum for topic entities (applied on top of minItemsPerEntity). */
  topicMinItems?: number;
  focusId?: string;
  maxNodes?: number;
}

export async function buildGraph(opts: GraphOptions = {}): Promise<GraphData> {
  if (typeof indexedDB === "undefined") return { nodes: [], links: [] };
  const indexed = await getIndexedItems();
  const items: GraphItemInput[] = indexed
    .filter((it) => it.status === "ready")
    .map((it) => ({ id: it.id, title: it.title, kind: it.kind, createdAt: it.createdAt }));
  if (!items.length) return { nodes: [], links: [] };

  const explicitTypes = opts.entityTypes !== undefined;
  const types = explicitTypes
    ? Array.from(new Set(opts.entityTypes))
    : ENTITY_TYPES.filter((t) => t !== "topic" || items.length <= GRAPH_DEFAULTS.topicItemLimit);
  const entities: GraphEntityInput[] = types.length
    ? (await db.entities.where("type").anyOf(types).toArray()).map((e) => ({
        id: e.id,
        type: e.type,
        value: e.value,
        itemIds: e.itemIds,
      }))
    : [];

  let similar: SimilarPair[] = [];
  if (opts.includeSimilar) {
    const itemIds = new Set(items.map((i) => i.id));
    const mentionCount = new Map<string, number>();
    for (const e of entities) for (const id of e.itemIds) if (itemIds.has(id)) mentionCount.set(id, (mentionCount.get(id) ?? 0) + 1);
    const ranked = [...items].sort(
      (a, b) => (mentionCount.get(b.id) ?? 0) - (mentionCount.get(a.id) ?? 0) || b.createdAt - a.createdAt,
    );
    const candidates = ranked.slice(0, GRAPH_DEFAULTS.similarCandidates).map((i) => i.id);
    if (opts.focusId && itemIds.has(opts.focusId) && !candidates.includes(opts.focusId)) candidates.push(opts.focusId);
    const vectors = await getItemVectors(candidates);
    similar = await findSimilarPairs(vectors, GRAPH_DEFAULTS.similarThreshold, GRAPH_DEFAULTS.similarPerItem);
  }

  return assembleGraph(items, entities, similar, {
    minItemsPerEntity: opts.minItemsPerEntity,
    topicMinItems: explicitTypes ? undefined : GRAPH_DEFAULTS.topicMinItems,
    focusId: opts.focusId,
    maxNodes: opts.maxNodes,
  });
}

/**
 * For each vector, its `perItem` most similar others with cosine ≥ `threshold` (vectors must be
 * normalised). A pair is returned once if either side keeps it. Yields to the main thread regularly.
 */
export async function findSimilarPairs(
  vectors: Map<string, Float32Array>,
  threshold: number = GRAPH_DEFAULTS.similarThreshold,
  perItem: number = GRAPH_DEFAULTS.similarPerItem,
): Promise<SimilarPair[]> {
  const ids = Array.from(vectors.keys());
  const n = ids.length;
  if (n < 2) return [];
  const dim = vectors.get(ids[0])!.length;
  const matrix = new Float32Array(n * dim);
  ids.forEach((id, i) => matrix.set(vectors.get(id)!.subarray(0, dim), i * dim));

  // Per item: best neighbours so far as parallel arrays, sorted by score descending.
  const topIdx: number[][] = Array.from({ length: n }, () => []);
  const topScore: number[][] = Array.from({ length: n }, () => []);
  const offer = (i: number, j: number, s: number) => {
    const sc = topScore[i];
    if (sc.length >= perItem && s <= sc[sc.length - 1]) return;
    let pos = sc.length;
    while (pos > 0 && sc[pos - 1] < s) pos--;
    sc.splice(pos, 0, s);
    topIdx[i].splice(pos, 0, j);
    if (sc.length > perItem) {
      sc.pop();
      topIdx[i].pop();
    }
  };

  let sliceStart = Date.now();
  for (let i = 0; i < n; i++) {
    const oi = i * dim;
    for (let j = i + 1; j < n; j++) {
      const oj = j * dim;
      let s = 0;
      for (let k = 0; k < dim; k++) s += matrix[oi + k] * matrix[oj + k];
      if (s >= threshold) {
        offer(i, j, s);
        offer(j, i, s);
      }
    }
    if (Date.now() - sliceStart > 12) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }

  const pairs = new Map<string, SimilarPair>();
  for (let i = 0; i < n; i++) {
    topIdx[i].forEach((j, k) => {
      const a = i < j ? i : j;
      const b = i < j ? j : i;
      const key = `${a}|${b}`;
      if (!pairs.has(key)) pairs.set(key, { a: ids[a], b: ids[b], score: topScore[i][k] });
    });
  }
  return Array.from(pairs.values());
}

/** Pure graph assembly (no database): nodes, links, focus neighbourhood and node cap. */
export function assembleGraph(
  items: GraphItemInput[],
  entities: GraphEntityInput[],
  similar: SimilarPair[],
  opts: AssembleOptions = {},
): GraphData {
  const maxNodes = Math.max(1, Math.floor(opts.maxNodes ?? GRAPH_DEFAULTS.maxNodes));
  const minItems = Math.max(1, Math.floor(opts.minItemsPerEntity ?? 1));
  const itemById = new Map(items.map((i) => [i.id, i]));

  const entityNodes = new Map<string, GraphNode>();
  const allLinks: GraphLink[] = [];
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string) => {
    let sa = adjacency.get(a);
    if (!sa) adjacency.set(a, (sa = new Set()));
    sa.add(b);
    let sb = adjacency.get(b);
    if (!sb) adjacency.set(b, (sb = new Set()));
    sb.add(a);
  };

  for (const e of entities) {
    if (entityNodes.has(e.id)) continue;
    const linked = Array.from(new Set(e.itemIds.filter((id) => itemById.has(id))));
    const min = e.type === "topic" && opts.topicMinItems ? Math.max(minItems, opts.topicMinItems) : minItems;
    if (linked.length < min) continue;
    entityNodes.set(e.id, { id: e.id, kind: "entity", label: e.value, entityType: e.type, weight: linked.length });
    for (const itemId of linked) {
      allLinks.push({ source: itemId, target: e.id, kind: "mentions", weight: 1 });
      connect(itemId, e.id);
    }
  }

  const seenPairs = new Set<string>();
  for (const p of similar) {
    if (p.a === p.b || !itemById.has(p.a) || !itemById.has(p.b)) continue;
    const key = p.a < p.b ? `${p.a}|${p.b}` : `${p.b}|${p.a}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    allLinks.push({ source: p.a, target: p.b, kind: "similar", weight: Math.round(p.score * 1000) / 1000 });
    connect(p.a, p.b);
  }

  // Which nodes are in play, and (in focus mode) how far each is from the focus.
  const distance = new Map<string, number>();
  const focusId = opts.focusId;
  if (focusId) {
    if (!itemById.has(focusId) && !entityNodes.has(focusId)) return { nodes: [], links: [] };
    distance.set(focusId, 0);
    let frontier = [focusId];
    for (let hop = 1; hop <= 2; hop++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adjacency.get(id) ?? []) {
          if (distance.has(nb)) continue;
          distance.set(nb, hop);
          next.push(nb);
        }
      }
      frontier = next;
    }
  } else {
    for (const i of items) distance.set(i.id, 0);
    for (const id of entityNodes.keys()) distance.set(id, 0);
  }

  const inPlay = Array.from(distance.keys());
  const keep =
    inPlay.length > maxNodes ? selectNodes(inPlay, maxNodes, { itemById, entityNodes, adjacency, distance, focusId }) : inPlay;
  const kept = new Set(keep);

  const links = allLinks.filter((l) => kept.has(l.source) && kept.has(l.target));
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [];
  for (const id of keep) {
    const ent = entityNodes.get(id);
    if (ent) {
      // An entity whose memories were all cut has nothing to connect — leave it out.
      if ((degree.get(id) ?? 0) === 0 && id !== focusId) continue;
      nodes.push({ ...ent });
      continue;
    }
    const item = itemById.get(id);
    if (!item) continue;
    nodes.push({ id, kind: "item", label: item.title || "Untitled memory", itemKind: item.kind, weight: degree.get(id) ?? 0 });
  }
  nodes.sort((a, b) => b.weight - a.weight || (a.kind === b.kind ? 0 : a.kind === "item" ? -1 : 1));
  return { nodes, links };
}

/**
 * Pick `budget` nodes that still tell a story: the most connected memories first (about 60% of the
 * budget, nearest to the focus first), then the entities connecting the most of those memories, then
 * more memories if slots are left. Ranking all nodes by weight alone would keep only memories (they
 * have many links, a typical entity has two) and lose every connection between them.
 */
function selectNodes(
  ids: string[],
  budget: number,
  ctx: {
    itemById: Map<string, GraphItemInput>;
    entityNodes: Map<string, GraphNode>;
    adjacency: Map<string, Set<string>>;
    distance: Map<string, number>;
    focusId?: string;
  },
): string[] {
  const { itemById, entityNodes, adjacency, distance, focusId } = ctx;
  const dist = (id: string) => distance.get(id) ?? 0;
  const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const itemIds = ids
    .filter((id) => itemById.has(id))
    .sort(
      (a, b) =>
        dist(a) - dist(b) ||
        (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) ||
        (itemById.get(b)?.createdAt ?? 0) - (itemById.get(a)?.createdAt ?? 0) ||
        byId(a, b),
    );
  const focusIsEntity = !!focusId && entityNodes.has(focusId);
  const itemBudget = Math.min(
    itemIds.length,
    Math.ceil(budget * GRAPH_DEFAULTS.itemShare),
    focusIsEntity ? budget - 1 : budget,
  );
  const chosenItems = itemIds.slice(0, itemBudget);
  const chosen = new Set(chosenItems);

  const entityRank = ids
    .filter((id) => entityNodes.has(id))
    .map((id) => {
      let linked = 0;
      for (const nb of adjacency.get(id) ?? []) if (chosen.has(nb)) linked++;
      return { id, linked };
    })
    .filter((e) => e.linked > 0 || e.id === focusId)
    .sort(
      (a, b) =>
        Number(b.id === focusId) - Number(a.id === focusId) ||
        dist(a.id) - dist(b.id) ||
        b.linked - a.linked ||
        (entityNodes.get(b.id)?.weight ?? 0) - (entityNodes.get(a.id)?.weight ?? 0) ||
        byId(a.id, b.id),
    );
  const chosenEntities = entityRank.slice(0, Math.max(0, budget - chosenItems.length)).map((e) => e.id);
  const spare = budget - chosenItems.length - chosenEntities.length;
  const extraItems = spare > 0 ? itemIds.slice(itemBudget, itemBudget + spare) : [];
  return [...chosenItems, ...extraItems, ...chosenEntities];
}
