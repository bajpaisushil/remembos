/**
 * Pure helpers for the graph screen: filtering by entity type, counting, and the
 * search-to-focus matcher.
 */
import { ENTITY_TYPES, MEMORY_KINDS, type EntityType, type GraphData, type GraphNode, type MemoryKind } from "@/lib/types";
import { displayLabel } from "./engine/model";

export interface GraphCounts {
  items: number;
  entities: number;
  links: number;
  similar: number;
  byEntityType: Record<EntityType, number>;
  byKind: Record<MemoryKind, number>;
}

export function countGraph(data: GraphData): GraphCounts {
  const byEntityType = Object.fromEntries(ENTITY_TYPES.map((t) => [t, 0])) as Record<EntityType, number>;
  const byKind = Object.fromEntries(MEMORY_KINDS.map((k) => [k, 0])) as Record<MemoryKind, number>;
  let items = 0;
  let entities = 0;
  for (const n of data.nodes) {
    if (n.kind === "item") {
      items++;
      if (n.itemKind) byKind[n.itemKind]++;
    } else {
      entities++;
      if (n.entityType) byEntityType[n.entityType]++;
    }
  }
  let similar = 0;
  for (const l of data.links) if (l.kind === "similar") similar++;
  return { items, entities, links: data.links.length, similar, byEntityType, byKind };
}

/**
 * Hide entity types without rebuilding the graph: drops those nodes and their links, and
 * recomputes memory weights (their link count) so node sizes match what is shown.
 */
export function filterGraph(data: GraphData, hidden: ReadonlySet<EntityType>): GraphData {
  if (!hidden.size) return data;
  const nodes = data.nodes.filter((n) => n.kind === "item" || !n.entityType || !hidden.has(n.entityType));
  const keep = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  const degree = new Map<string, number>();
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  return {
    nodes: nodes.map((n) => (n.kind === "item" ? { ...n, weight: degree.get(n.id) ?? 0 } : n)),
    links,
  };
}

/** Lowercase, accent-free text for matching. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface NodeMatch {
  node: GraphNode;
  /** Label as displayed (e.g. "#travel"). */
  label: string;
  /** [start, end) of the matched text inside `label`, for highlighting. */
  range: [number, number] | null;
}

/**
 * Nodes whose label matches `query`: exact, then prefix, then word-start, then anywhere;
 * ties go to better-connected nodes. Phone numbers also match on digits alone.
 */
export function matchNodes(nodes: GraphNode[], query: string, limit = 8): NodeMatch[] {
  const q = foldText(query.replace(/^#/, ""));
  if (!q) return [];
  const qDigits = q.replace(/\D/g, "");
  const scored: { m: NodeMatch; score: number }[] = [];
  for (const node of nodes) {
    const label = displayLabel(node.kind, node.label, node.entityType);
    const folded = foldText(label.replace(/^#/, ""));
    const offset = label.startsWith("#") ? 1 : 0;
    let score = -1;
    let at = folded.indexOf(q);
    if (folded === q) score = 400;
    else if (at === 0) score = 300;
    else if (at > 0) score = /[\s\-_/.@(]/.test(folded[at - 1]) ? 200 : 100;
    else if (qDigits.length >= 3 && node.entityType === "phone" && folded.replace(/\D/g, "").includes(qDigits)) {
      score = 150;
      at = -1;
    }
    if (score < 0) continue;
    // Folding can change lengths for a few characters; only highlight when it lines up.
    const sameLength = folded.length === label.length - offset;
    const range: [number, number] | null = at >= 0 && sameLength ? [at + offset, at + offset + q.length] : null;
    scored.push({ m: { node, label, range }, score: score + Math.min(50, node.weight) + (node.kind === "item" ? 5 : 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.m.label.length - b.m.label.length);
  return scored.slice(0, limit).map((s) => s.m);
}

/** Entity types present in a graph, in the canonical order. */
export function presentEntityTypes(counts: GraphCounts): EntityType[] {
  return ENTITY_TYPES.filter((t) => counts.byEntityType[t] > 0);
}

export function presentKinds(counts: GraphCounts): MemoryKind[] {
  return MEMORY_KINDS.filter((k) => counts.byKind[k] > 0);
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
