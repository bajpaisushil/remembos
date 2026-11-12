/**
 * Turns `GraphData` (from buildGraph) into the engine's working model: sized, colored nodes with
 * simulation state, index-based links, adjacency lists, color groups for batched drawing, and
 * starting positions (kept from the previous layout when the data changes, so the picture morphs
 * instead of jumping).
 */
import { ENTITY_META, KIND_HEX } from "@/lib/config";
import type { EntityType, GraphData, MemoryKind } from "@/lib/types";
import type { SimLink, SimNode } from "./simulation";

export interface GNode extends SimNode {
  id: string;
  index: number;
  kind: "item" | "entity";
  itemKind?: MemoryKind;
  entityType?: EntityType;
  /** Text drawn on the canvas (shortened). */
  label: string;
  weight: number;
  color: string;
  /** 0 = most connected node. */
  rank: number;
  /** Measured label width in CSS px for the current font, -1 when unknown. */
  labelWidth: number;
}

export interface GLink extends SimLink {
  kind: "mentions" | "similar";
  /** Signed curvature as a share of the link's length. */
  bend: number;
}

export interface ColorGroup {
  color: string;
  kind: "item" | "entity";
  nodes: number[];
}

export interface GraphModel {
  nodes: GNode[];
  links: GLink[];
  byId: Map<string, number>;
  /** Neighbour indices per node. */
  adjacency: number[][];
  /** Node indices grouped by fill color (entities first, so memories draw on top). */
  groups: ColorGroup[];
}

const ITEM_LABEL_MAX = 32;
const ENTITY_LABEL_MAX = 28;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function itemRadius(weight: number): number {
  return Math.min(22, 6.5 + 2.3 * Math.sqrt(Math.max(0, weight)));
}

export function entityRadius(weight: number): number {
  return Math.min(13, 4.2 + 1.5 * Math.sqrt(Math.max(0, weight)));
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).trimEnd() + "…";
}

/** Label shown for a node, e.g. "#travel" for tags. */
export function displayLabel(kind: "item" | "entity", label: string, entityType?: EntityType): string {
  if (kind === "entity" && entityType === "tag") return `#${label.replace(/^#+/, "")}`;
  return label || (kind === "item" ? "Untitled memory" : "—");
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildModel(data: GraphData): GraphModel {
  const nodes: GNode[] = [];
  const byId = new Map<string, number>();
  for (const n of data.nodes) {
    if (byId.has(n.id)) continue;
    const isItem = n.kind === "item";
    const weight = Math.max(0, n.weight || 0);
    const r = isItem ? itemRadius(weight) : entityRadius(weight);
    const color = isItem
      ? KIND_HEX[n.itemKind ?? "note"] ?? KIND_HEX.note
      : (n.entityType ? ENTITY_META[n.entityType]?.hex : undefined) ?? ENTITY_META.topic.hex;
    const text = displayLabel(n.kind, n.label, n.entityType);
    const index = nodes.length;
    byId.set(n.id, index);
    nodes.push({
      id: n.id,
      index,
      kind: n.kind,
      itemKind: n.itemKind,
      entityType: n.entityType,
      label: shorten(text, isItem ? ITEM_LABEL_MAX : ENTITY_LABEL_MAX),
      weight,
      color,
      rank: 0,
      labelWidth: -1,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      r,
      charge: isItem ? -(55 + 10 * Math.sqrt(weight)) : -(28 + 6 * Math.sqrt(weight)),
    });
  }

  const links: GLink[] = [];
  const adjacency: number[][] = nodes.map(() => []);
  const seen = new Set<string>();
  for (const l of data.links) {
    const s = byId.get(l.source);
    const t = byId.get(l.target);
    if (s === undefined || t === undefined || s === t) continue;
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const similar = l.kind === "similar";
    const h = hashString(`${l.source}>${l.target}`);
    const sign = h & 1 ? 1 : -1;
    const bend = sign * (0.05 + ((h >>> 1) % 1000) / 1000 * 0.07);
    links.push({
      source: s,
      target: t,
      kind: similar ? "similar" : "mentions",
      distance: (similar ? 44 : 22) + nodes[s].r + nodes[t].r,
      strengthScale: similar ? 0.55 : 1,
      bend,
    });
    adjacency[s].push(t);
    adjacency[t].push(s);
  }

  // Rank by importance for label priority: weight, then memories before entities.
  const order = nodes
    .map((n) => n.index)
    .sort((a, b) => nodes[b].weight - nodes[a].weight || (nodes[a].kind === nodes[b].kind ? 0 : nodes[a].kind === "item" ? -1 : 1));
  order.forEach((idx, rank) => (nodes[idx].rank = rank));

  const groupMap = new Map<string, ColorGroup>();
  for (const n of nodes) {
    const key = `${n.kind}:${n.color}`;
    let g = groupMap.get(key);
    if (!g) groupMap.set(key, (g = { color: n.color, kind: n.kind, nodes: [] }));
    g.nodes.push(n.index);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "entity" ? -1 : 1));

  return { nodes, links, byId, adjacency, groups };
}

export interface PlacementResult {
  /** Nodes that already existed (kept their position). */
  reused: number;
  /** Nodes that were in the previous layout but are gone now. */
  removed: number;
}

/**
 * Give every node a starting position. Nodes present in `previous` keep their position and velocity;
 * new nodes start next to their already-placed neighbours, or on the outskirts when they have none.
 * With no previous layout, nodes start on a phyllotaxis spiral (biggest first, near the middle).
 */
export function placeNodes(
  model: GraphModel,
  previous: Map<string, Pick<GNode, "x" | "y" | "vx" | "vy">>,
  random: () => number = Math.random,
): PlacementResult {
  const { nodes, adjacency } = model;
  const placed = new Uint8Array(nodes.length);
  let reused = 0;
  for (const n of nodes) {
    const p = previous.get(n.id);
    if (!p) continue;
    n.x = p.x;
    n.y = p.y;
    n.vx = p.vx;
    n.vy = p.vy;
    placed[n.index] = 1;
    reused++;
  }
  let removed = 0;
  for (const id of previous.keys()) if (!model.byId.has(id)) removed++;

  if (reused === 0) {
    const order = nodes.map((n) => n.index).sort((a, b) => nodes[a].rank - nodes[b].rank);
    order.forEach((idx, i) => {
      const radius = 11 * Math.sqrt(0.5 + i);
      const angle = i * GOLDEN_ANGLE;
      nodes[idx].x = radius * Math.cos(angle);
      nodes[idx].y = radius * Math.sin(angle);
      nodes[idx].vx = 0;
      nodes[idx].vy = 0;
    });
    return { reused, removed };
  }

  // Current extent, for nodes that have no placed neighbour.
  let cx = 0;
  let cy = 0;
  for (const n of nodes) {
    if (!placed[n.index]) continue;
    cx += n.x;
    cy += n.y;
  }
  cx /= reused;
  cy /= reused;
  let extent = 60;
  for (const n of nodes) {
    if (!placed[n.index]) continue;
    extent = Math.max(extent, Math.hypot(n.x - cx, n.y - cy));
  }

  // Two passes so chains of new nodes still land next to each other.
  for (let pass = 0; pass < 2; pass++) {
    for (const n of nodes) {
      if (placed[n.index]) continue;
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const j of adjacency[n.index]) {
        if (!placed[j]) continue;
        sx += nodes[j].x;
        sy += nodes[j].y;
        count++;
      }
      if (count === 0 && pass === 0) continue;
      if (count > 0) {
        const angle = random() * Math.PI * 2;
        const dist = 14 + random() * 18;
        n.x = sx / count + Math.cos(angle) * dist;
        n.y = sy / count + Math.sin(angle) * dist;
      } else {
        const angle = random() * Math.PI * 2;
        const dist = extent * (0.85 + random() * 0.3);
        n.x = cx + Math.cos(angle) * dist;
        n.y = cy + Math.sin(angle) * dist;
      }
      n.vx = 0;
      n.vy = 0;
      placed[n.index] = 1;
    }
  }
  return { reused, removed };
}
