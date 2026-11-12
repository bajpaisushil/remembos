"use client";
/**
 * Details for the selected graph node: a right-hand drawer on larger screens and a bottom sheet on
 * phones, floating over the canvas (non-modal, so the graph stays usable).
 *
 * - Memory: kind, title, date, summary, what it mentions, similar memories, "Open memory".
 * - Thing (name, number, link, tag…): its value with copy (and call / email / open where it makes
 *   sense) plus every memory that mentions it.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, ExternalLink, Focus, LocateFixed, Mail, Phone, Search, Waypoints, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type Ref } from "react";
import {
  Button,
  buttonClasses,
  CopyButton,
  ENTITY_ICONS,
  EntityChip,
  KindBadge,
  KindIcon,
  Skeleton,
  SkeletonText,
  LoadingStatus,
} from "@/components/ui";
import { ENTITY_META, itemHref, KIND_META, searchHref } from "@/lib/config";
import { db } from "@/lib/db";
import { ENTITY_TYPES, type EntityType, type GraphData, type GraphNode, type MemoryKind } from "@/lib/types";
import { cn, formatDate, formatDuration, timeAgo } from "@/lib/utils";
import { displayLabel } from "./engine/model";
import { plural } from "./graph-utils";

const ENTITY_ID = /^(phone|email|url|money|date|name|topic|tag):/;

export interface GraphDetailsProps {
  id: string;
  /** The node as drawn (undefined when filtered out of the current view). */
  node: GraphNode | undefined;
  /** What is drawn — used for neighbours and "show in graph" buttons. */
  graph: GraphData;
  nodeById: Map<string, GraphNode>;
  focusId?: string;
  onClose: () => void;
  /** Select a node and fly to it. */
  onLocate: (id: string) => void;
  /** Show only this node's neighbourhood. */
  onFocusMode: (id: string) => void;
  onShowAll: () => void;
  ref?: Ref<HTMLElement>;
}

export function GraphDetails({ id, node, graph, nodeById, focusId, onClose, onLocate, onFocusMode, onShowAll, ref }: GraphDetailsProps) {
  const isEntity = node ? node.kind === "entity" : ENTITY_ID.test(id);
  const neighbours = useMemo(() => {
    const out: { id: string; kind: "mentions" | "similar" }[] = [];
    for (const l of graph.links) {
      if (l.source === id) out.push({ id: l.target, kind: l.kind });
      else if (l.target === id) out.push({ id: l.source, kind: l.kind });
    }
    return out;
  }, [graph, id]);
  const focused = focusId === id;

  return (
    <aside
      ref={ref}
      aria-label={isEntity ? "Details for this connection" : "Details for this memory"}
      data-testid="graph-panel"
      data-node-id={id}
      className={cn(
        "pointer-events-auto absolute z-20 flex flex-col overflow-hidden border shadow-pop animate-slide-up",
        "border-zinc-200/80 bg-white/[0.97] dark:border-white/10 dark:bg-ink-850/[0.97]",
        "inset-x-2 bottom-2 max-h-[min(68%,32rem)] rounded-3xl",
        "md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-[22rem] md:rounded-2xl",
      )}
    >
      <div aria-hidden className="flex justify-center pt-2 md:hidden">
        <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-white/20" />
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        data-testid="graph-panel-close"
        className="absolute top-2.5 right-2.5 z-10 grid size-8 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <X className="size-4" />
      </button>

      {isEntity ? (
        <EntityDetails id={id} node={node} nodeById={nodeById} onLocate={onLocate} />
      ) : (
        <ItemDetails id={id} node={node} neighbours={neighbours} nodeById={nodeById} onLocate={onLocate} />
      )}

      <div className="flex flex-wrap gap-2 border-t border-zinc-200/70 bg-zinc-50/70 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
        {isEntity ? (
          <Button
            href={searchHref(node ? displayLabel(node.kind, node.label, node.entityType).replace(/^#/, "") : id.replace(ENTITY_ID, ""))}
            variant="primary"
            size="sm"
            leftIcon={<Search />}
            className="flex-1"
            data-testid="graph-search-entity"
          >
            Search memories
          </Button>
        ) : (
          <Button href={itemHref(id)} variant="primary" size="sm" rightIcon={<ArrowRight />} className="flex-1" data-testid="graph-open-memory">
            Open memory
          </Button>
        )}
        {focused ? (
          <Button variant="secondary" size="sm" leftIcon={<Waypoints />} onClick={onShowAll} className="flex-1" data-testid="graph-panel-show-all">
            Show everything
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Focus />}
            onClick={() => onFocusMode(id)}
            className="flex-1"
            data-testid="graph-focus-mode"
          >
            Only its connections
          </Button>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- memory

interface ItemDetail {
  item: {
    kind: MemoryKind;
    title: string;
    summary: string;
    createdAt: number;
    sourceDate?: number;
    sourceName?: string;
    pageCount?: number;
    durationSec?: number;
    status: string;
    sample?: boolean;
  };
  entities: { id: string; type: EntityType; value: string; count: number }[];
}

const MAX_CHIPS = 18;

function ItemDetails({
  id,
  node,
  neighbours,
  nodeById,
  onLocate,
}: {
  id: string;
  node: GraphNode | undefined;
  neighbours: { id: string; kind: "mentions" | "similar" }[];
  nodeById: Map<string, GraphNode>;
  onLocate: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const detail = useLiveQuery(async (): Promise<ItemDetail | null> => {
    const it = await db.items.get(id);
    if (!it) return null;
    const ents = await db.entities.bulkGet(it.entityIds.slice(0, 80));
    const typeOrder = (t: EntityType) => ENTITY_TYPES.indexOf(t);
    return {
      item: {
        kind: it.kind,
        title: it.title,
        summary: it.summary,
        createdAt: it.createdAt,
        sourceDate: it.sourceDate,
        sourceName: it.sourceName,
        pageCount: it.pageCount,
        durationSec: it.durationSec,
        status: it.status,
        sample: it.sample,
      },
      entities: ents
        .filter((e): e is NonNullable<typeof e> => !!e)
        .map((e) => ({ id: e.id, type: e.type, value: e.value, count: e.itemIds.length }))
        .sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || b.count - a.count),
    };
  }, [id]);

  const similar = neighbours.filter((n) => n.kind === "similar" && nodeById.has(n.id));

  if (detail === undefined) {
    return (
      <div className="flex-1 px-4 pt-4 pb-4 md:pt-5">
        <LoadingStatus label="Loading memory details…" />
        <div className="flex items-start gap-3 pr-8">
          <Skeleton className="size-11 rounded-[14px]" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-4/5 rounded-full" />
            <Skeleton className="h-3 w-1/3 rounded-full" />
          </div>
        </div>
        <SkeletonText lines={4} className="mt-5" />
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="flex-1 px-4 pt-4 pb-5 md:pt-5">
        <p className="pr-8 font-semibold text-zinc-900 dark:text-white">{node?.label ?? "This memory"} was removed</p>
        <p className="mt-1 text-sm text-muted">It is no longer on this device.</p>
      </div>
    );
  }

  const { item, entities } = detail;
  const when = item.sourceDate ?? item.createdAt;
  const facts = [
    formatDate(when),
    item.pageCount ? plural(item.pageCount, "page", "pages") : null,
    item.durationSec ? formatDuration(item.durationSec) : null,
  ].filter(Boolean);
  const shown = showAll ? entities : entities.slice(0, MAX_CHIPS);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 md:pt-4">
      <div className="flex items-center gap-2 pr-9">
        <KindBadge kind={item.kind} size="sm" />
        {item.sample ? (
          <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] leading-5 font-medium text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
            Sample
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-start gap-3">
        <KindIcon kind={item.kind} size="lg" />
        <div className="min-w-0">
          <h2 className="line-clamp-3 text-[17px] leading-snug font-semibold tracking-tight break-words text-zinc-900 dark:text-white" data-testid="graph-panel-title">
            {item.title || "Untitled memory"}
          </h2>
          <p className="mt-1 text-xs text-muted" title={new Date(when).toLocaleString()}>
            {facts.join(" · ")}
            <span className="text-zinc-300 dark:text-zinc-600"> · </span>
            added {timeAgo(item.createdAt)}
          </p>
        </div>
      </div>

      <p className="mt-3.5 line-clamp-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        {item.status === "processing"
          ? "Still being read…"
          : item.summary || `No readable text was found in this ${KIND_META[item.kind].label.toLowerCase()}.`}
      </p>

      <section className="mt-5">
        <h3 className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">
          Mentions{entities.length ? ` · ${entities.length}` : ""}
        </h3>
        {entities.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shown.map((e) => {
              const inGraph = nodeById.has(e.id);
              return (
                <EntityChip
                  key={e.id}
                  type={e.type}
                  value={e.value}
                  count={e.count}
                  size="sm"
                  maxChars={30}
                  onClick={inGraph ? () => onLocate(e.id) : undefined}
                />
              );
            })}
            {entities.length > MAX_CHIPS && !showAll ? (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="h-6 rounded-full px-2 text-xs font-medium text-brand-700 hover:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-400/15"
              >
                +{entities.length - MAX_CHIPS} more
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-muted">No names, numbers, links or tags found in it yet.</p>
        )}
        {entities.some((e) => nodeById.has(e.id)) ? (
          <p className="mt-2 text-xs text-muted">Click one to find it in the graph.</p>
        ) : null}
      </section>

      {similar.length ? (
        <section className="mt-5">
          <h3 className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">Similar memories</h3>
          <ul className="mt-1.5 -mx-2">
            {similar.map((s) => {
              const n = nodeById.get(s.id)!;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onLocate(s.id)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-900/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                  >
                    <KindIcon kind={n.itemKind ?? "note"} size="xs" />
                    <span className="min-w-0 flex-1 truncate">{n.label}</span>
                    <LocateFixed aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- entity

interface MemoryRef {
  id: string;
  title: string;
  kind: MemoryKind;
  createdAt: number;
}

const MAX_MEMORIES = 60;

/** Titles/kinds for the memories that mention an entity (from the in-memory search index). */
function useMemoryRefs(ids: string[] | undefined): MemoryRef[] | undefined {
  const [state, setState] = useState<{ key: string; refs: MemoryRef[] } | null>(null);
  // Item ids never contain "|", so the joined list identifies the set (and keeps the effect stable).
  const key = ids ? ids.join("|") : null;
  useEffect(() => {
    if (key === null) return;
    const list = key ? key.split("|") : [];
    const wanted = new Set(list);
    let cancelled = false;
    const load = async (): Promise<MemoryRef[]> => {
      try {
        const { getIndexedItems } = await import("@/lib/search");
        const all = await getIndexedItems();
        return all
          .filter((it) => wanted.has(it.id) && it.status !== "error")
          .map((it) => ({ id: it.id, title: it.title, kind: it.kind, createdAt: it.createdAt }));
      } catch {
        const items = await db.items.bulkGet(list.slice(0, MAX_MEMORIES));
        return items
          .filter((it): it is NonNullable<typeof it> => !!it)
          .map((it) => ({ id: it.id, title: it.title, kind: it.kind, createdAt: it.createdAt }));
      }
    };
    load()
      .then((refs) => {
        if (!cancelled) setState({ key, refs: refs.sort((a, b) => b.createdAt - a.createdAt) });
      })
      .catch(() => {
        if (!cancelled) setState({ key, refs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state && state.key === key ? state.refs : undefined;
}

function EntityDetails({
  id,
  node,
  nodeById,
  onLocate,
}: {
  id: string;
  node: GraphNode | undefined;
  nodeById: Map<string, GraphNode>;
  onLocate: (id: string) => void;
}) {
  const entity = useLiveQuery(async () => (await db.entities.get(id)) ?? null, [id]);
  const refs = useMemoryRefs(entity ? entity.itemIds : undefined);
  const [showAll, setShowAll] = useState(false);

  if (entity === undefined) {
    return (
      <div className="flex-1 px-4 pt-4 pb-4 md:pt-5">
        <LoadingStatus label="Loading details…" />
        <div className="flex items-start gap-3 pr-8">
          <Skeleton className="size-11 rounded-[14px]" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-3 w-1/4 rounded-full" />
            <Skeleton className="h-4 w-3/4 rounded-full" />
          </div>
        </div>
        <SkeletonText lines={3} className="mt-5" />
      </div>
    );
  }

  if (entity === null) {
    return (
      <div className="flex-1 px-4 pt-4 pb-5 md:pt-5">
        <p className="pr-8 font-semibold text-zinc-900 dark:text-white">{node?.label ?? "This"} is no longer mentioned</p>
        <p className="mt-1 text-sm text-muted">The memories that mentioned it were changed or removed.</p>
      </div>
    );
  }

  const meta = ENTITY_META[entity.type];
  const Icon = ENTITY_ICONS[entity.type];
  const value = displayLabel("entity", entity.value, entity.type);
  const action = quickAction(entity.type, entity.value);
  const list = refs ? (showAll ? refs : refs.slice(0, MAX_MEMORIES)) : [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 md:pt-4">
      <div className="flex items-start gap-3 pr-9">
        <span
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-[14px] text-white ring-1 ring-white/25 ring-inset"
          style={{ backgroundColor: meta.hex, boxShadow: `0 8px 20px -8px ${meta.hex}b3` }}
        >
          <Icon className="size-5" strokeWidth={2.1} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className={cn("text-[11px] font-semibold tracking-[0.1em] uppercase", meta.color)}>{meta.label}</p>
          <h2 className="mt-0.5 text-[17px] leading-snug font-semibold tracking-tight break-words text-zinc-900 dark:text-white" data-testid="graph-panel-title">
            {value}
          </h2>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-2">
        <CopyButton value={entity.value} label={`Copy ${meta.label.toLowerCase()}`} variant="secondary" size="sm" />
        {action ? (
          <a
            href={action.href}
            {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className={buttonClasses({ variant: "secondary", size: "sm" })}
          >
            <action.icon aria-hidden />
            {action.label}
          </a>
        ) : null}
      </div>

      <section className="mt-5">
        <h3 className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">
          Mentioned in {plural(entity.itemIds.length, "memory", "memories")}
        </h3>
        {refs === undefined ? (
          <div className="mt-2 space-y-2">
            {Array.from({ length: Math.min(3, Math.max(1, entity.itemIds.length)) }, (_, i) => (
              <Skeleton key={i} className="h-10 rounded-xl" />
            ))}
          </div>
        ) : refs.length ? (
          <ul className="mt-1.5 -mx-2" data-testid="graph-panel-memories">
            {list.map((m) => {
              const inGraph = nodeById.has(m.id);
              return (
                <li key={m.id} className="flex items-center gap-1">
                  <Link
                    href={itemHref(m.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <KindIcon kind={m.kind} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">{m.title || "Untitled memory"}</span>
                      <span className="block text-xs text-muted">{formatDate(m.createdAt)}</span>
                    </span>
                  </Link>
                  {inGraph ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Show “${m.title || "Untitled memory"}” in the graph`}
                      title="Show in the graph"
                      onClick={() => onLocate(m.id)}
                    >
                      <LocateFixed />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1.5 text-sm text-muted">The memories that mention it are still being read.</p>
        )}
        {refs && refs.length > MAX_MEMORIES && !showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
          >
            Show all {refs.length}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function quickAction(
  type: EntityType,
  value: string,
): { href: string; label: string; icon: typeof Phone; external: boolean } | null {
  if (type === "phone") {
    const digits = value.replace(/[^\d+]/g, "");
    return digits.length >= 5 ? { href: `tel:${digits}`, label: "Call", icon: Phone, external: false } : null;
  }
  if (type === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return { href: `mailto:${value}`, label: "Email", icon: Mail, external: false };
  }
  if (type === "url") {
    const href = /^https?:\/\//i.test(value) ? value : /^www\./i.test(value) ? `https://${value}` : null;
    return href ? { href, label: "Open link", icon: ExternalLink, external: true } : null;
  }
  return null;
}
