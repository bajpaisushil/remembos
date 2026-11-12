"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ChevronRight, Download, ExternalLink, LocateFixed, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { EXPLORER_PAGE_SIZE, logicalAddress, pageCount, pageSpan, TABLE_EXPLANATIONS, type RemembosTable } from "@/lib/storage-inspect";
import { cn, formatDate } from "@/lib/utils";
import { loadTablePage, type ExplorerRow, type TablePage } from "./data";
import { VIEW_ICONS } from "./ExplorerSidebar";
import { downloadStoredBlob, openBlobInNewTab } from "./open-blob";

/** Columns at xl: key · name · type · size · date · actions. Below xl, rows stack like cards. */
const GRID = "xl:grid-cols-[8.5rem_minmax(0,1fr)_7.5rem_5.75rem_6.5rem_6.25rem]";

const EMPTY_COPY: Record<RemembosTable, string> = {
  items: "No memories yet. Everything you add shows up here first.",
  files: "No original files yet. Screenshots, PDFs, videos and recordings you upload are kept here.",
  thumbs: "No previews yet. They're made for pictures, PDFs and videos.",
  chunks: "No search pieces yet. They're made from each memory's text.",
  entities: "Nothing found yet. Phone numbers, names, amounts and links appear here as memories are read.",
  meta: "No bookkeeping notes yet.",
};

const FILTERED_EMPTY: Record<RemembosTable, string> = {
  items: "This memory has no record here.",
  files: "No original is kept for this memory (it's text only, or the original was removed to save space).",
  thumbs: "This memory has no preview picture.",
  chunks: "This memory has no search pieces yet — it may still be processing.",
  entities: "Nothing was found in this memory yet.",
  meta: "",
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

type Loaded = TablePage | { error: string; request: string };

async function safeLoad(table: RemembosTable, page: number | "auto", focusId: string, only: boolean): Promise<Loaded> {
  try {
    return await loadTablePage(table, page, focusId, only);
  } catch (err) {
    return { request: `${table}|${page}|${focusId}|${only ? 1 : 0}`, error: err instanceof Error ? err.message : "The database couldn't be read." };
  }
}

export interface TableViewProps {
  table: RemembosTable;
  /** Memory the explorer is focused on ("" for none). */
  focusId: string;
  /** Title of the focused memory, for the filter label. */
  focusTitle?: string;
  /** Focus the explorer on another memory. */
  onFocus: (itemId: string) => void;
}

/** One table of the "remembos" database, 50 rows a page, with the focused memory's rows highlighted. */
export function TableView({ table, focusId, focusTitle, onFocus }: TableViewProps) {
  const [page, setPage] = useState<number | "auto">("auto");
  const [only, setOnly] = useState(false);
  const request = `${table}|${page}|${focusId}|${only ? 1 : 0}`;
  const data = useLiveQuery(() => safeLoad(table, page, focusId, only), [table, page, focusId, only]);
  const stale = !!data && data.request !== request;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<string | null>(null);

  const Icon = VIEW_ICONS[table];
  const explain = TABLE_EXPLANATIONS[table];
  const result = data && !("error" in data) ? data : null;
  const canFilter = !!focusId && table !== "meta" && !result?.focusMissing;

  // Bring the focused memory's first row into view inside the table (never scrolls the page).
  useEffect(() => {
    if (!result || stale || !focusId) return;
    const target = `${table}|${focusId}|${only ? 1 : 0}`;
    if (scrolledFor.current === target) return;
    const container = scrollRef.current;
    const row = container?.querySelector<HTMLElement>("[data-highlight='true']");
    if (!container || !row) return;
    scrolledFor.current = target;
    const top = row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [result, stale, focusId, table, only]);

  const total = result?.total ?? 0;
  const current = result?.page ?? 0;
  const pages = pageCount(total);
  const span = pageSpan(current, total);

  function go(next: number) {
    setPage(next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  return (
    <Card
      as="section"
      padding="none"
      id="explorer-table"
      aria-labelledby="explorer-table-title"
      data-testid="explorer-table"
      data-table={table}
      className="min-w-0 scroll-mt-24 overflow-hidden"
    >
      <header className="flex flex-col gap-3 border-b border-zinc-200/70 p-4 sm:p-5 dark:border-white/10">
        <div className="flex flex-wrap items-start gap-3">
          <span className="brand-gradient grid size-10 shrink-0 place-items-center rounded-2xl text-white shadow-glow [&>svg]:size-5">
            <Icon aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-52">
            <h2 id="explorer-table-title" className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
              <code className="font-mono">{table}</code>
              <span className="text-sm font-medium text-muted">{explain.title}</span>
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{explain.explain}</p>
          </div>
          <Badge tone="brand" className="mt-1" data-testid="explorer-table-count">
            {result ? `${total.toLocaleString()} ${total === 1 ? "record" : "records"}${result.filtered ? " for this memory" : ""}` : "Counting…"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 max-w-full items-center gap-1 rounded-xl border border-zinc-200/70 bg-zinc-50 py-1 pr-1 pl-2.5 dark:border-white/[0.08] dark:bg-black/20">
            <code className="min-w-0 truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-300" data-testid="explorer-table-address">
              {logicalAddress(table)}
            </code>
            <CopyButton value={logicalAddress(table)} iconOnly label="Copy table address" />
          </div>
          {canFilter ? (
            <Switch
              size="sm"
              checked={only}
              onCheckedChange={(v) => {
                setOnly(v);
                setPage("auto");
              }}
              label={<span className="text-[13px]">Only this memory&apos;s rows</span>}
              className="ml-auto"
              data-testid="explorer-only-focus"
            />
          ) : null}
        </div>
        {focusId && result && !result.filtered && !result.focusMissing && table !== "meta" ? (
          <p className="flex items-start gap-2 text-[12.5px] text-muted">
            <span aria-hidden className="mt-[3px] size-2.5 shrink-0 rounded-sm bg-fuchsia-500/70" />
            <span className="min-w-0">
              Highlighted rows belong to{" "}
              {focusTitle ? <span className="font-medium text-zinc-800 dark:text-zinc-200">“{focusTitle}”</span> : "this memory"}.
              {table === "entities" ? " They're spread through the table — turn on “Only this memory's rows” to list them together." : null}
            </span>
          </p>
        ) : null}
      </header>

      <div role="table" aria-label={`${table} table`} aria-rowcount={result ? total + 1 : undefined} aria-busy={!data || stale || undefined}>
        <div role="rowgroup" className="hidden border-b border-zinc-200/70 bg-zinc-50/80 xl:block dark:border-white/[0.08] dark:bg-white/[0.02]">
          <div role="row" className={cn("grid items-center gap-3 px-5 py-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase", GRID)}>
            <span role="columnheader">Key</span>
            <span role="columnheader">Name</span>
            <span role="columnheader">Type</span>
            <span role="columnheader">Size</span>
            <span role="columnheader">Date</span>
            <span role="columnheader" className="text-right">
              <span className="sr-only">Actions</span>
            </span>
          </div>
        </div>
        <div
          ref={scrollRef}
          role="rowgroup"
          tabIndex={0}
          aria-label="Rows"
          className={cn(
            "relative max-h-[34rem] overflow-y-auto overscroll-contain transition-opacity duration-150 focus-visible:outline-none sm:max-h-[40rem]",
            stale && "opacity-60",
          )}
          data-testid="explorer-rows"
        >
          {!data ? (
            <RowsSkeleton />
          ) : "error" in data ? (
            <div className="flex items-start gap-3 p-5 text-sm text-rose-700 dark:text-rose-300" role="alert">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <p>Couldn&apos;t read this table right now ({data.error}). Try reloading the page.</p>
            </div>
          ) : data.rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted" data-testid="explorer-empty">
              {data.filtered ? FILTERED_EMPTY[table] : EMPTY_COPY[table]}
            </p>
          ) : (
            <div className="divide-y divide-zinc-200/70 dark:divide-white/[0.06]">
              {data.rows.map((row, i) => (
                <Row key={row.key} row={row} index={data.page * EXPLORER_PAGE_SIZE + i + 2} table={table} focusId={focusId} onFocus={onFocus} />
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/70 px-4 py-3 sm:px-5 dark:border-white/10">
        <p className="text-[13px] text-muted tabular-nums" aria-live="polite" data-testid="explorer-page-status">
          {result ? (total ? `Showing ${span.first.toLocaleString()}–${span.last.toLocaleString()} of ${total.toLocaleString()}` : "No rows") : "Loading…"}
          {result && pages > 1 ? <span className="hidden sm:inline"> · page {current + 1} of {pages}</span> : null}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ChevronLeft />}
            disabled={!result || current === 0}
            onClick={() => go(current - 1)}
            data-testid="explorer-prev"
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            rightIcon={<ChevronRight />}
            disabled={!result || current >= pages - 1}
            onClick={() => go(current + 1)}
            data-testid="explorer-next"
          >
            Next
          </Button>
        </div>
      </footer>
    </Card>
  );
}

function Row({ row, index, table, focusId, onFocus }: { row: ExplorerRow; index: number; table: RemembosTable; focusId: string; onFocus: (id: string) => void }) {
  const isFocus = !!row.itemId && row.itemId === focusId;
  return (
    <div
      role="row"
      aria-rowindex={index}
      data-testid="explorer-row"
      data-key={row.key}
      data-highlight={row.highlight ? "true" : "false"}
      className={cn(
        "relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5 xl:py-2.5",
        GRID,
        row.highlight
          ? "bg-fuchsia-500/[0.07] before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-r-full before:bg-linear-to-b before:from-indigo-500 before:to-fuchsia-500 dark:bg-fuchsia-400/[0.09]"
          : "hover:bg-zinc-50/80 dark:hover:bg-white/[0.025]",
      )}
    >
      <span role="cell" className="col-start-1 row-start-2 min-w-0 xl:col-start-auto xl:row-start-auto">
        <code className="block truncate font-mono text-[11.5px] text-zinc-500 xl:text-[12px] xl:text-zinc-700 dark:text-zinc-400 xl:dark:text-zinc-300" title={row.key}>
          {row.key}
        </code>
      </span>
      <span role="cell" className="col-start-1 row-start-1 min-w-0 xl:col-start-auto xl:row-start-auto">
        <span
          className={cn(
            "line-clamp-2 text-sm text-zinc-900 xl:line-clamp-1 dark:text-zinc-100",
            row.monoName ? "font-mono text-[12.5px]" : "font-medium",
            row.highlight && "text-fuchsia-950 dark:text-white",
          )}
          title={row.name}
        >
          {row.name}
        </span>
      </span>
      <span className="col-start-1 row-start-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted xl:contents">
        <span role="cell" className="min-w-0 truncate xl:text-[12.5px]" title={row.type}>
          {row.type}
        </span>
        <span aria-hidden className="xl:hidden">
          ·
        </span>
        <span role="cell" className="tabular-nums xl:text-[12.5px] xl:text-zinc-700 xl:dark:text-zinc-300" title={row.sizeTitle}>
          {row.size}
        </span>
        {row.date ? (
          <span aria-hidden className="xl:hidden">
            ·
          </span>
        ) : null}
        <span role="cell" className="tabular-nums xl:text-[12.5px]">
          {row.date ? formatDate(row.date) : <span className="hidden xl:inline">—</span>}
        </span>
      </span>
      <span role="cell" className="col-start-2 row-span-3 row-start-1 flex items-center justify-end gap-0.5 xl:col-start-auto xl:row-span-1 xl:row-start-auto">
        {row.blob ? (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${row.fileName ?? row.key} in a new tab`}
              title="Open in a new tab"
              onClick={() => row.blob && openBlobInNewTab(row.blob)}
              data-testid="explorer-row-open"
            >
              <ExternalLink />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Download ${row.fileName ?? row.key}`}
              title="Download"
              onClick={() => row.blob && downloadStoredBlob(row.blob, row.fileName ?? `${row.key}.bin`)}
              data-testid="explorer-row-download"
            >
              <Download />
            </Button>
          </>
        ) : null}
        {row.itemId && table !== "meta" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isFocus ? "This memory is shown above" : "Show where this memory is stored"}
            title={isFocus ? "Shown above" : "Where is this memory stored?"}
            aria-pressed={isFocus}
            className={isFocus ? "text-fuchsia-600 dark:text-fuchsia-300" : undefined}
            onClick={() => onFocus(row.itemId as string)}
            data-testid="explorer-row-focus"
          >
            <LocateFixed />
          </Button>
        ) : null}
      </span>
    </div>
  );
}

function RowsSkeleton() {
  return (
    <div aria-hidden className="divide-y divide-zinc-200/70 dark:divide-white/[0.06]">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 sm:px-5", GRID)}>
          <Skeleton className="hidden h-3.5 w-24 rounded-md xl:block" />
          <div className="space-y-2 xl:space-y-0">
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="h-3 w-1/2 rounded-md xl:hidden" />
          </div>
          <Skeleton className="hidden h-3.5 w-16 rounded-md xl:block" />
          <Skeleton className="hidden h-3.5 w-12 rounded-md xl:block" />
          <Skeleton className="hidden h-3.5 w-16 rounded-md xl:block" />
          <Skeleton className="size-8 justify-self-end rounded-lg" />
        </div>
      ))}
    </div>
  );
}
