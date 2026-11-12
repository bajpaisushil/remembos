"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownUp,
  ArrowRight,
  CheckSquare,
  ClipboardPaste,
  Hash,
  HardDriveDownload,
  LayoutGrid,
  LibraryBig,
  List,
  PenLine,
  Pin,
  PinOff,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accent,
  Badge,
  Button,
  ConfirmDialog,
  Container,
  Input,
  KIND_ICONS,
  Menu,
  PageHeader,
  Segmented,
  Skeleton,
  type SegmentedOption,
} from "@/components/ui";
import { openNote, openUploadPicker } from "@/lib/add-actions";
import { searchHref } from "@/lib/config";
import { deleteItems, deleteOriginals } from "@/lib/storage/clear";
import { MEMORY_KINDS, type MemoryKind } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { useDebounced, useLibraryLayout, type LibraryLayout } from "./hooks";
import { LibraryEmpty, NoMatches, usePasteNow } from "./LibraryEmpty";
import { MemoryCard } from "./MemoryCard";
import {
  KIND_FILTER_LABELS,
  LIBRARY_SORTS,
  queryLibrary,
  queryLibraryStats,
  setPinned,
  type LibraryResult,
  type LibrarySort,
  type LibraryStats,
} from "./memory-data";
import { MemoryGridSkeleton } from "./Skeletons";

const PAGE_SIZE = 60;

type KindFilter = MemoryKind | "all";

const EMPTY_RESULT: LibraryResult = { items: [], chips: {}, total: 0 };

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function readKind(value: string | null): KindFilter {
  return value && (MEMORY_KINDS as string[]).includes(value) ? (value as MemoryKind) : "all";
}

/** Update ?kind= / ?tag= in place (no navigation, no new history entry). */
function replaceParams(patch: Record<string, string | null>): void {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

/**
 * The library: every memory, filterable by kind and tag, quick-filtered by title, sorted, shown as a
 * grid or a list, with multi-select for deleting memories or freeing space.
 * Reads `?kind=` and `?tag=` so other pages can link to a filtered view.
 */
export function LibraryView() {
  const router = useRouter();
  const params = useSearchParams();
  const kind = readKind(params.get("kind"));
  const tag = params.get("tag")?.trim().toLowerCase() || null;

  const [sort, setSort] = useState<LibrarySort>("newest");
  const [filterInput, setFilterInput] = useState("");
  const filterText = useDebounced(filterInput.trim(), 180);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [layout, setLayout] = useLibraryLayout();

  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const orderRef = useRef<string[]>([]);
  const [confirm, setConfirm] = useState<null | "delete" | "originals">(null);
  const { pasting, paste } = usePasteNow();

  const stats = useLiveQuery<LibraryStats | null>(async () => {
    try {
      return await queryLibraryStats();
    } catch (err) {
      console.warn("[remembos] could not count memories", err);
      return null;
    }
  }, []);

  const result = useLiveQuery<LibraryResult>(async () => {
    try {
      return await queryLibrary({ kind, tag, text: filterText, sort, limit });
    } catch (err) {
      console.warn("[remembos] could not list memories", err);
      return EMPTY_RESULT;
    }
  }, [kind, tag, filterText, sort, limit]);

  const items = useMemo(() => result?.items ?? [], [result]);
  const visibleIds = useMemo(() => items.map((i) => i.id), [items]);
  useEffect(() => {
    orderRef.current = visibleIds;
  }, [visibleIds]);

  // Only what's on screen can be acted on (things deleted elsewhere drop out on their own).
  const selectedIds = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const withOriginals = useMemo(() => selectedItems.filter((i) => i.hasFile && i.status !== "processing"), [selectedItems]);
  const originalsBytes = withOriginals.reduce((sum, i) => sum + (i.size || 0), 0);
  const allPinned = selectedItems.length > 0 && selectedItems.every((i) => i.pinned);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    clearSelection();
  }, [clearSelection]);

  const onSelect = useCallback((id: string, opts: { shift: boolean }) => {
    const anchor = anchorRef.current;
    const order = orderRef.current;
    let range: string[] | null = null;
    if (opts.shift && anchor && anchor !== id) {
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      if (a >= 0 && b >= 0) range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    anchorRef.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (range) range.forEach((x) => next.add(x));
      else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectionMode(true);
  }, []);

  // Esc leaves selection mode (dialogs and menus handle their own Esc first).
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) exitSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectionMode, exitSelection]);

  function resetPaging() {
    setLimit(PAGE_SIZE);
    clearSelection();
  }

  function changeKind(next: KindFilter) {
    resetPaging();
    replaceParams({ kind: next === "all" ? null : next });
  }

  function toggleTag(next: string) {
    resetPaging();
    replaceParams({ tag: tag === next ? null : next });
  }

  function changeSort(next: LibrarySort) {
    resetPaging();
    setSort(next);
  }

  function changeFilter(value: string) {
    resetPaging();
    setFilterInput(value);
  }

  function clearFilters() {
    resetPaging();
    setFilterInput("");
    replaceParams({ kind: null, tag: null });
  }

  function changeLayout(next: LibraryLayout) {
    setLayout(next);
  }

  async function confirmDelete() {
    const ids = selectedIds;
    await deleteItems(ids);
    exitSelection();
  }

  async function confirmRemoveOriginals() {
    await deleteOriginals(withOriginals.map((i) => i.id));
    exitSelection();
  }

  async function pinSelected() {
    const ok = await setPinned(selectedIds, !allPinned);
    if (ok) clearSelection();
  }

  // ---------- derived view state ----------

  const total = stats?.total;
  const loading = result === undefined || stats === undefined;
  const isEmptyLibrary = stats !== undefined && stats !== null && stats.total === 0;
  const filtersActive = kind !== "all" || Boolean(tag) || Boolean(filterText);
  const query = filterInput.trim();
  const deepHref = query ? searchHref(query) : undefined;
  const remaining = result ? Math.max(0, result.total - items.length) : 0;
  const loadingMore = Boolean(result && items.length < Math.min(limit, result.total));
  const sortLabel = LIBRARY_SORTS.find((s) => s.value === sort)?.label ?? "Newest first";
  const processing = stats?.processing ?? 0;

  // Once counts are known, only kinds that have memories get a tab (plus the one being shown).
  const shownKinds = stats ? MEMORY_KINDS.filter((k) => stats.byKind[k] > 0 || k === kind) : MEMORY_KINDS;
  const kindOptions: SegmentedOption<KindFilter>[] = [
    { value: "all", label: "All", count: stats?.total },
    ...shownKinds.map((k) => {
      const Icon = KIND_ICONS[k];
      return {
        value: k,
        label: KIND_FILTER_LABELS[k],
        icon: <Icon aria-hidden />,
        count: stats?.byKind[k],
      };
    }),
  ];

  const tagList = useMemo(() => {
    const list = stats?.tags ?? [];
    if (tag && !list.some((t) => t.tag === tag)) return [{ tag, count: 0 }, ...list];
    return list;
  }, [stats, tag]);

  return (
    <Container className="py-8 sm:py-12">
      <div data-testid="library-page">
        <PageHeader
          eyebrow={
            <>
              <LibraryBig aria-hidden />
              Library
            </>
          }
          title={
            <>
              Everything you&apos;ve <Accent>remembered</Accent>
            </>
          }
          description={
            total === undefined ? (
              <Skeleton className="mt-1 h-5 w-64 max-w-full rounded-full" />
            ) : (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="library-count">
                {total ? (
                  <span>{plural(total, "memory", "memories")}, kept privately in this browser.</span>
                ) : (
                  <span>Everything you save shows up here — private to this browser.</span>
                )}
                {processing ? (
                  <Badge tone="brand" dot pulse>
                    {processing} being read
                  </Badge>
                ) : null}
              </span>
            )
          }
          actions={
            isEmptyLibrary ? null : (
              <>
                <Button variant="ghost" leftIcon={<PenLine />} onClick={openNote} data-testid="library-new-note">
                  <span className="sr-only sm:not-sr-only">New note</span>
                </Button>
                <Button variant="secondary" leftIcon={<ClipboardPaste />} loading={pasting} onClick={paste} data-testid="library-paste">
                  Paste
                </Button>
                <Button leftIcon={<Upload />} onClick={() => openUploadPicker()} data-testid="library-add">
                  Upload
                </Button>
              </>
            )
          }
        />

        {isEmptyLibrary ? (
          <LibraryEmpty />
        ) : (
          <>
            {/* ---------- toolbar ---------- */}
            <div className="mb-5 flex flex-col gap-3">
              <Segmented<KindFilter>
                aria-label="Show kind"
                value={kind}
                onChange={changeKind}
                options={kindOptions}
                testIdPrefix="library-kind"
              />

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="search"
                  size="sm"
                  value={filterInput}
                  onChange={(e) => changeFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && filterInput) {
                      e.preventDefault();
                      changeFilter("");
                    } else if (e.key === "Enter" && deepHref && result && result.total === 0) {
                      router.push(deepHref);
                    }
                  }}
                  placeholder="Filter by title, words or tag…"
                  aria-label="Filter memories"
                  leftIcon={<Search />}
                  rightSlot={
                    filterInput ? (
                      <button
                        type="button"
                        onClick={() => changeFilter("")}
                        aria-label="Clear filter"
                        className="grid size-6 place-items-center rounded-md text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                      >
                        <X aria-hidden className="size-3.5" />
                      </button>
                    ) : null
                  }
                  wrapperClassName="min-w-[12rem] flex-1 sm:max-w-sm"
                  data-testid="library-filter"
                />
                <Menu
                  label={`Sort: ${sortLabel}`}
                  variant="secondary"
                  size="sm"
                  align="end"
                  data-testid="library-sort"
                  items={LIBRARY_SORTS.map((s) => ({
                    label: s.label,
                    description: s.description,
                    checked: s.value === sort,
                    onSelect: () => changeSort(s.value),
                    "data-testid": `library-sort-${s.value}`,
                  }))}
                >
                  <ArrowDownUp aria-hidden />
                  <span className="hidden sm:inline">{sortLabel}</span>
                </Menu>
                <Segmented<LibraryLayout>
                  aria-label="Layout"
                  size="sm"
                  value={layout}
                  onChange={changeLayout}
                  testIdPrefix="library-view"
                  options={[
                    { value: "grid", label: <span className="sr-only">Grid</span>, icon: <LayoutGrid aria-hidden /> },
                    { value: "list", label: <span className="sr-only">List</span>, icon: <List aria-hidden /> },
                  ]}
                />
                <Button
                  variant={selectionMode ? "soft" : "ghost"}
                  size="sm"
                  leftIcon={<CheckSquare />}
                  aria-pressed={selectionMode}
                  onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
                  data-testid="library-select-toggle"
                  disabled={!items.length}
                >
                  {selectionMode ? "Done" : "Select"}
                </Button>
              </div>

              {tagList.length ? (
                <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Filter by tag">
                  <span className="mr-1 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted">
                    <Hash aria-hidden className="size-3.5" />
                    Tags
                  </span>
                  {tagList.map((t) => {
                    const active = tag === t.tag;
                    return (
                      <button
                        key={t.tag}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTag(t.tag)}
                        data-testid="library-tag"
                        data-tag={t.tag}
                        className={cn(
                          "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition-[background-color,border-color,color] duration-150",
                          active
                            ? "border-transparent bg-teal-600 text-white shadow-soft dark:bg-teal-500"
                            : "border-zinc-200/90 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white",
                        )}
                      >
                        <span className={cn(active ? "text-white/80" : "text-teal-600 dark:text-teal-300")}>#</span>
                        {t.tag}
                        {t.count ? (
                          <span className={cn("ml-0.5 text-[11px] tabular-nums", active ? "text-white/80" : "text-muted")}>{t.count}</span>
                        ) : null}
                        {active ? <X aria-hidden className="ml-0.5 size-3" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* ---------- selection bar ---------- */}
            {selectionMode ? (
              <div className="sticky top-[calc(var(--header-h)+0.75rem)] z-30 mb-4" data-testid="selection-bar">
                {/* The entrance animation sits on the frosted panel itself: on an ancestor it would stop the blur from seeing the cards behind. */}
                <div className="glass flex animate-pop-in flex-wrap items-center gap-2 rounded-2xl border border-brand-500/20 p-2 pl-3.5 shadow-pop dark:border-brand-400/25">
                  <span className="text-sm font-semibold text-zinc-900 tabular-nums dark:text-white" aria-live="polite">
                    {selectedIds.length ? `${selectedIds.length} selected` : "Tap memories to select"}
                  </span>
                  {items.length ? (
                    selectedIds.length === items.length ? (
                      <Button variant="ghost" size="sm" onClick={clearSelection} data-testid="selection-none">
                        Select none
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(new Set(visibleIds))}
                        data-testid="selection-select-all"
                      >
                        Select all {items.length < (result?.total ?? 0) ? `${items.length} shown` : items.length}
                      </Button>
                    )
                  ) : null}
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={allPinned ? <PinOff /> : <Pin />}
                      disabled={!selectedIds.length}
                      onClick={pinSelected}
                      data-testid="selection-pin"
                    >
                      {allPinned ? "Unpin" : "Pin"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<HardDriveDownload />}
                      disabled={!withOriginals.length}
                      onClick={() => setConfirm("originals")}
                      title={withOriginals.length ? undefined : "None of the selected memories keep an original file"}
                      data-testid="selection-remove-originals"
                    >
                      <span className="sm:hidden">Free space</span>
                      <span className="hidden sm:inline">Remove originals</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 />}
                      disabled={!selectedIds.length}
                      onClick={() => setConfirm("delete")}
                      data-testid="selection-delete"
                    >
                      Delete
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label="Done selecting" onClick={exitSelection} data-testid="selection-done">
                      <X />
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---------- results ---------- */}
            {loading ? (
              <MemoryGridSkeleton layout={layout} />
            ) : !items.length ? (
              <NoMatches onClear={clearFilters} query={filterText || undefined} deepSearchHref={deepHref} />
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                  <p aria-live="polite" data-testid="library-showing">
                    {result.total > items.length
                      ? `Showing ${items.length.toLocaleString()} of ${result.total.toLocaleString()}`
                      : filtersActive
                        ? `${plural(result.total, "match", "matches")}`
                        : `${plural(result.total, "memory", "memories")}`}
                    {sort === "newest" ? "" : ` · ${sortLabel.toLowerCase()}`}
                  </p>
                  {deepHref ? (
                    <Link
                      href={deepHref}
                      data-testid="library-deep-search"
                      className="group inline-flex items-center gap-1 rounded-lg font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
                    >
                      Deep search for “{query.length > 32 ? `${query.slice(0, 31)}…` : query}”
                      <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ) : null}
                </div>

                <ul
                  role="list"
                  className={cn(layout === "grid" ? "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3" : "flex flex-col gap-2")}
                  aria-label="Memories"
                >
                  {items.map((item) => (
                    <li key={item.id} className="min-w-0">
                      <MemoryCard
                        item={item}
                        chips={result.chips[item.id]}
                        layout={layout}
                        selectable
                        selectionMode={selectionMode}
                        selected={selected.has(item.id)}
                        onSelect={onSelect}
                        className={layout === "grid" ? "h-full" : undefined}
                      />
                    </li>
                  ))}
                </ul>

                {remaining > 0 ? (
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <Button
                      variant="secondary"
                      size="lg"
                      loading={loadingMore}
                      onClick={() => setLimit((l) => l + PAGE_SIZE)}
                      data-testid="library-load-more"
                    >
                      Show {Math.min(PAGE_SIZE, remaining).toLocaleString()} more
                    </Button>
                    <p className="text-xs text-muted">{remaining.toLocaleString()} more to see</p>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        danger
        title={selectedIds.length === 1 ? "Delete this memory?" : `Delete ${selectedIds.length.toLocaleString()} memories?`}
        description={
          <>
            {selectedIds.length === 1 ? "It" : "They"}&apos;ll be removed from this device for good — the original file, its text and
            everything found in it. Back up first if you might need {selectedIds.length === 1 ? "it" : "them"} again.
          </>
        }
        requireText={selectedIds.length >= 10 ? "DELETE" : undefined}
        confirmLabel={selectedIds.length === 1 ? "Delete memory" : `Delete ${selectedIds.length.toLocaleString()}`}
        onConfirm={confirmDelete}
        data-testid="library-delete-dialog"
      />
      <ConfirmDialog
        open={confirm === "originals"}
        onClose={() => setConfirm(null)}
        icon={
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
            <HardDriveDownload aria-hidden className="size-5" />
          </span>
        }
        title="Remove the original files?"
        description={
          <>
            Frees about <strong className="font-semibold text-zinc-900 dark:text-white">{formatBytes(originalsBytes)}</strong> by deleting the
            stored {withOriginals.length === 1 ? "file" : `files of ${withOriginals.length.toLocaleString()} memories`}. Text, previews and
            search keep working — you just won&apos;t be able to open or download the original{withOriginals.length === 1 ? "" : "s"} any more.
          </>
        }
        confirmLabel="Remove originals"
        onConfirm={confirmRemoveOriginals}
        data-testid="library-originals-dialog"
      />
    </Container>
  );
}
