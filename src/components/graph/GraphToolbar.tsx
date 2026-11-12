"use client";
/**
 * Graph controls above the canvas: find-in-graph, the "Only shared" and "Similar memories" switches,
 * a live count, and one colored toggle chip per kind of thing memories mention.
 */
import { Link2, SlidersHorizontal, Sparkles } from "lucide-react";
import { useId } from "react";
import { buttonClasses, ENTITY_ICONS, Popover, Switch, Tooltip } from "@/components/ui";
import { ENTITY_META } from "@/lib/config";
import { ENTITY_TYPES, type EntityType, type GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { GraphCounts } from "./graph-utils";
import { plural } from "./graph-utils";
import { GraphSearch } from "./GraphSearch";

/** Plural labels for the type chips. */
export const ENTITY_PLURALS: Record<EntityType, string> = {
  phone: "Phones",
  email: "Emails",
  url: "Links",
  money: "Amounts",
  date: "Dates",
  name: "Names",
  topic: "Topics",
  tag: "Tags",
};

export interface GraphToolbarProps {
  /** Nodes currently drawn (search targets). */
  nodes: GraphNode[];
  /** Counts before type filtering (chip counts). */
  counts: GraphCounts | null;
  /** Counts of what is drawn. */
  visibleCounts: GraphCounts | null;
  hidden: ReadonlySet<EntityType>;
  onToggleType: (type: EntityType) => void;
  onShowAllTypes: () => void;
  sharedOnly: boolean;
  onSharedOnlyChange: (on: boolean) => void;
  similar: boolean;
  onSimilarChange: (on: boolean) => void;
  onPick: (node: GraphNode) => void;
  disabled?: boolean;
}

export function GraphToolbar({
  nodes,
  counts,
  visibleCounts,
  hidden,
  onToggleType,
  onShowAllTypes,
  sharedOnly,
  onSharedOnlyChange,
  similar,
  onSimilarChange,
  onPick,
  disabled,
}: GraphToolbarProps) {
  const sharedId = useId();
  const similarId = useId();
  // Show every type that exists in the graph, plus any the person has hidden.
  const types = ENTITY_TYPES.filter((t) => (counts?.byEntityType[t] ?? 0) > 0 || hidden.has(t));

  return (
    <div className="relative z-20 flex flex-col gap-3 rounded-t-3xl border-b border-zinc-200/70 bg-white/60 px-3 pt-3 pb-2.5 sm:px-4 sm:pt-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <GraphSearch nodes={nodes} onPick={onPick} disabled={disabled} className="min-w-0 flex-1 sm:w-72 sm:flex-none lg:w-80" />
          <div className="sm:hidden">
            <Popover
              label="Filters"
              trigger={
                <>
                  <SlidersHorizontal aria-hidden />
                  {sharedOnly || similar ? (
                    <span aria-hidden className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand-500 ring-2 ring-white dark:ring-ink-850" />
                  ) : null}
                </>
              }
              align="end"
              triggerClassName={buttonClasses({ variant: "secondary", size: "none", className: "size-9 rounded-lg [&_svg]:size-4" })}
              data-testid="graph-filters"
            >
              <div className="space-y-4">
                <Switch
                  label="Only shared"
                  description="Hide names, numbers and topics that appear in only one memory."
                  checked={sharedOnly}
                  onCheckedChange={onSharedOnlyChange}
                  disabled={disabled}
                  data-testid="graph-shared-toggle-mobile"
                />
                <Switch
                  label="Similar memories"
                  description="Link memories about the same thing, even without shared words."
                  checked={similar}
                  onCheckedChange={onSimilarChange}
                  disabled={disabled}
                  data-testid="graph-similar-toggle-mobile"
                />
              </div>
            </Popover>
          </div>
        </div>

        <div className="hidden flex-wrap items-center gap-x-5 gap-y-2 sm:flex">
          <Tooltip content="Hide names, numbers and topics that appear in only one memory" side="bottom" align="start" describe={false}>
            <div className="flex items-center gap-2">
              <Switch
                id={sharedId}
                size="sm"
                checked={sharedOnly}
                onCheckedChange={onSharedOnlyChange}
                disabled={disabled}
                data-testid="graph-shared-toggle"
              />
              <label htmlFor={sharedId} className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                <Link2 aria-hidden className="size-3.5 text-zinc-400" />
                Only shared
              </label>
            </div>
          </Tooltip>
          <Tooltip content="Link memories that are about the same thing, even without shared words" side="bottom" align="start" describe={false}>
            <div className="flex items-center gap-2">
              <Switch
                id={similarId}
                size="sm"
                checked={similar}
                onCheckedChange={onSimilarChange}
                disabled={disabled}
                data-testid="graph-similar-toggle"
              />
              <label htmlFor={similarId} className="inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                <Sparkles aria-hidden className="size-3.5 text-zinc-400" />
                Similar memories
              </label>
            </div>
          </Tooltip>
        </div>

        <p
          className="ml-auto hidden text-[13px] whitespace-nowrap text-muted tabular-nums lg:block"
          data-testid="graph-node-count"
          aria-live="polite"
        >
          {visibleCounts ? (
            <>
              <span className="font-semibold text-zinc-800 dark:text-zinc-100">{plural(visibleCounts.items, "memory", "memories")}</span>
              {" · "}
              {plural(visibleCounts.entities, "thing", "things")}
              {" · "}
              {plural(visibleCounts.links, "link", "links")}
            </>
          ) : (
            <span className="inline-block h-4 w-44 animate-pulse rounded-full bg-zinc-200/70 align-middle dark:bg-white/10" />
          )}
        </p>
      </div>

      <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 no-scrollbar sm:-mx-4 sm:px-4">
        <span className="mr-1 shrink-0 text-xs font-medium text-muted">Show</span>
        <div role="group" aria-label="Kinds of things to show" className="flex items-center gap-1.5">
          {types.length ? (
            types.map((t) => (
              <TypeChip
                key={t}
                type={t}
                count={counts?.byEntityType[t] ?? 0}
                on={!hidden.has(t)}
                disabled={disabled}
                onToggle={() => onToggleType(t)}
              />
            ))
          ) : (
            <span className="text-xs whitespace-nowrap text-muted">
              {counts ? "Nothing mentioned yet — connections appear as memories share names, numbers and tags." : "…"}
            </span>
          )}
        </div>
        {hidden.size ? (
          <button
            type="button"
            onClick={onShowAllTypes}
            className="ml-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap text-brand-700 transition-colors hover:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-400/15"
            data-testid="graph-show-all-types"
          >
            Show all
          </button>
        ) : null}
        {visibleCounts ? (
          <span className="ml-auto shrink-0 pl-3 text-xs whitespace-nowrap text-muted tabular-nums lg:hidden">
            {plural(visibleCounts.items, "memory", "memories")} · {plural(visibleCounts.links, "link", "links")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function TypeChip({
  type,
  count,
  on,
  disabled,
  onToggle,
}: {
  type: EntityType;
  count: number;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const meta = ENTITY_META[type];
  const Icon = ENTITY_ICONS[type];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      disabled={disabled}
      data-testid={`graph-type-${type}`}
      title={on ? `Hide ${ENTITY_PLURALS[type].toLowerCase()}` : `Show ${ENTITY_PLURALS[type].toLowerCase()}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border pr-2.5 pl-1.5 text-[13px] font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-50",
        on
          ? "border-zinc-200/90 bg-white text-zinc-800 shadow-soft hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.07] dark:text-zinc-100 dark:hover:border-white/20"
          : "border-dashed border-zinc-300 bg-transparent text-zinc-400 hover:text-zinc-600 dark:border-white/15 dark:text-zinc-500 dark:hover:text-zinc-300",
      )}
    >
      <span
        aria-hidden
        className={cn("grid size-5 place-items-center rounded-md text-white transition-opacity", on ? "opacity-100" : "opacity-35")}
        style={{ backgroundColor: meta.hex }}
      >
        <Icon className="size-3" strokeWidth={2.4} />
      </span>
      {ENTITY_PLURALS[type]}
      <span className={cn("tabular-nums", on ? "text-muted" : "")}>{count}</span>
    </button>
  );
}
