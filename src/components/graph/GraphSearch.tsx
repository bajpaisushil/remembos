"use client";
/**
 * "Find in graph" combobox: type part of a memory title, a name, a number or a tag, pick a match
 * and the graph flies to it. Full keyboard support (arrows, Enter, Escape).
 */
import { Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ENTITY_ICONS, Input, KindIcon } from "@/components/ui";
import { ENTITY_META, KIND_META, searchHref } from "@/lib/config";
import type { GraphNode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { matchNodes, type NodeMatch } from "./graph-utils";

export interface GraphSearchProps {
  nodes: GraphNode[];
  onPick: (node: GraphNode) => void;
  disabled?: boolean;
  className?: string;
}

export function GraphSearch({ nodes, onPick, disabled, className }: GraphSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const deferred = useDeferredValue(query);
  const matches = useMemo(() => matchNodes(nodes, deferred, 8), [nodes, deferred]);
  const showList = open && query.trim().length > 0;
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  function pick(m: NodeMatch | undefined) {
    if (!m) return;
    onPick(m.node);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (matches.length ? (Math.min(a, matches.length - 1) + 1) % matches.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (matches.length ? (Math.min(a, matches.length - 1) - 1 + matches.length) % matches.length : 0));
    } else if (e.key === "Enter") {
      if (!showList) return;
      e.preventDefault();
      pick(matches[activeIndex]);
    } else if (e.key === "Escape") {
      if (showList || query) {
        e.preventDefault();
        e.stopPropagation();
        if (showList) setOpen(false);
        else setQuery("");
      }
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div
      className={cn("relative", className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <Input
        ref={inputRef}
        size="sm"
        type="search"
        role="combobox"
        aria-label="Find in graph"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && matches.length ? optionId(activeIndex) : undefined}
        placeholder="Find a memory, name or number…"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        disabled={disabled}
        value={query}
        data-testid="graph-search"
        leftIcon={<Search />}
        rightSlot={
          query ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="grid size-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              <X className="size-3.5" />
            </button>
          ) : null
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      <div
        id={listId}
        role="listbox"
        aria-label="Matches in the graph"
        hidden={!showList}
        className={cn(
          "absolute top-full right-0 left-0 z-30 mt-1.5 max-h-80 min-w-64 overflow-y-auto overscroll-contain rounded-2xl border p-1.5 shadow-pop",
          "border-zinc-200/80 bg-elevated animate-pop-in dark:border-white/10",
        )}
        data-testid="graph-search-results"
      >
        {matches.length ? (
          matches.map((m, i) => (
            <MatchRow
              key={m.node.id}
              id={optionId(i)}
              match={m}
              active={i === activeIndex}
              onHover={() => setActive(i)}
              onPick={() => pick(m)}
            />
          ))
        ) : (
          <div className="flex items-start gap-3 px-3 py-3 text-sm" role="presentation">
            <SearchX aria-hidden className="mt-0.5 size-4 shrink-0 text-zinc-400" />
            <div className="min-w-0">
              <p className="font-medium text-zinc-800 dark:text-zinc-100">Not in this graph</p>
              <p className="mt-0.5 text-[13px] text-muted">
                It may be hidden by a filter.{" "}
                <Link
                  href={searchHref(query.trim())}
                  className="font-medium text-brand-600 underline-offset-2 hover:underline dark:text-brand-300"
                >
                  Search all memories
                </Link>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({
  id,
  match,
  active,
  onHover,
  onPick,
}: {
  id: string;
  match: NodeMatch;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const { node, label, range } = match;
  const isItem = node.kind === "item";
  const type = node.entityType;
  const Icon = type ? ENTITY_ICONS[type] : null;
  const meta = isItem ? KIND_META[node.itemKind ?? "note"].label : type ? ENTITY_META[type].label : "";
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      data-testid="graph-search-option"
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm",
        active ? "bg-brand-500/10 text-zinc-900 dark:bg-brand-400/15 dark:text-white" : "text-zinc-700 dark:text-zinc-200",
      )}
    >
      {isItem ? (
        <KindIcon kind={node.itemKind ?? "note"} size="xs" />
      ) : (
        <span
          aria-hidden
          className="grid size-5 shrink-0 place-items-center rounded-md text-white"
          style={{ backgroundColor: type ? ENTITY_META[type].hex : undefined }}
        >
          {Icon ? <Icon className="size-3" strokeWidth={2.4} /> : null}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        {range ? (
          <>
            {label.slice(0, range[0])}
            <mark className="rounded-sm bg-transparent font-semibold text-brand-700 dark:text-brand-200">{label.slice(range[0], range[1])}</mark>
            {label.slice(range[1])}
          </>
        ) : (
          label
        )}
      </span>
      <span className="shrink-0 text-xs text-muted">{meta}</span>
    </div>
  );
}
