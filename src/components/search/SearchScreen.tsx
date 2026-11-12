"use client";
/**
 * The /search/ page: one big question box with live, debounced local search (keyword + meaning),
 * autocomplete, an "understood" row (dates, things asked for, kinds), smart answers, filterable
 * results with highlighted snippets, and friendly idle / empty / no-result states.
 *
 * The query lives in the URL (`?q=…&kind=…`), updated in place so typing never piles up history.
 * Everything runs in this browser; nothing typed here leaves the device.
 */
import { Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Button, Input, Kbd, KIND_ICONS, Segmented, Spinner, type SegmentedOption } from "@/components/ui";
import { embedderStatus } from "@/lib/ai/embedder";
import { parseQuery } from "@/lib/nlp/query";
import { useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { MEMORY_KINDS, type MemoryKind, type ParsedQuery, type SearchHit } from "@/lib/types";
import { cn } from "@/lib/utils";
import { countLabel, KIND_FILTER_LABEL } from "./format";
import { MeaningStatus, QueryUnderstanding } from "./QueryUnderstanding";
import { addRecentSearch, useRecentSearches } from "./recent";
import { ResultCard } from "./ResultCard";
import { IdleState, NoMemoriesState, NoResultsState, ResultsSkeleton, SearchErrorState } from "./SearchStates";
import { SmartAnswers } from "./SmartAnswers";
import { useDebouncedValue, useMemoryStats, useSearchResults, useSettledValue, useSuggestions } from "./useSearch";

type KindFilter = "all" | MemoryKind;

/** Typing pause before searching. */
const DEBOUNCE_MS = 250;
/** Results fetched per search (kind filters and counts work within these). */
const RESULT_LIMIT = 100;
/** Results rendered at first, then per "Show more". */
const PAGE_SIZE = 20;
/** A search that stays on screen this long (with results) is remembered as a recent search. */
const REMEMBER_AFTER_MS = 3000;

const INPUT_ID = "search-page-input";

function parseKind(value: string | null): KindFilter {
  return value && (MEMORY_KINDS as string[]).includes(value) ? (value as MemoryKind) : "all";
}

function understand(q: string): ParsedQuery {
  try {
    return parseQuery(q);
  } catch {
    return { raw: q, keywords: q, semantic: q, intents: [], kindHints: [] };
  }
}

function matches(query: string): boolean {
  return typeof window !== "undefined" && window.matchMedia?.(query).matches === true;
}

const isCoarsePointer = () => matches("(pointer: coarse)");

export function SearchScreen() {
  const searchParams = useSearchParams();
  const urlQ = searchParams.get("q") ?? "";
  const urlKind = parseKind(searchParams.get("kind"));

  const [input, setInput] = useState(urlQ);
  const [query, setQuery] = useState(urlQ);
  const [kind, setKind] = useState<KindFilter>(urlKind);
  const [ignoredDate, setIgnoredDate] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [syncedUrlQ, setSyncedUrlQ] = useState(urlQ);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Navigated here with a different question (e.g. "See all results" in the palette) → adopt it.
  if (urlQ !== syncedUrlQ) {
    setSyncedUrlQ(urlQ);
    if (urlQ.trim() !== query.trim()) {
      setInput(urlQ);
      setQuery(urlQ);
      setKind(urlKind);
    }
  }

  // Debounce typing → query.
  useEffect(() => {
    if (input === query) return;
    const t = window.setTimeout(() => setQuery(input), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [input, query]);

  const q = query.trim();

  // Keep the address bar in sync without adding history entries (and without a network round trip).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (q) params.set("q", q);
    else params.delete("q");
    if (kind !== "all") params.set("kind", kind);
    else params.delete("kind");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
  }, [q, kind]);

  // Desktop: ready to type straight away.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || isCoarsePointer()) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  const parsed = useMemo(() => understand(q), [q]);
  const dateLabel = parsed.dateRange?.label;
  const anyTime = Boolean(dateLabel) && ignoredDate === dateLabel;

  const settings = useSettings();
  const model = useStore(embedderStatus);
  const stats = useMemoryStats();
  const dataVersion = useSettledValue(stats?.version, 700);
  const hasMemories = stats === null || (stats !== undefined && stats.count > 0);

  const { response, error, forQuery, loading } = useSearchResults({
    query: q,
    limit: RESULT_LIMIT,
    anyTime,
    enabled: hasMemories,
    refreshKey: `${dataVersion ?? ""}|${settings.semanticSearch}|${model.state === "ready"}|${retry}`,
  });

  const current = forQuery === q ? response : null;
  const stale = Boolean(q) && forQuery !== q;
  const hits = useMemo(() => response?.hits ?? [], [response]);
  const hasHits = Boolean(current && current.hits.length);
  // Only show the spinner when a new question takes a noticeable moment (no flicker on fast searches).
  const searching = loading && stale;
  const showSpinner = useDebouncedValue(searching, 150) && searching;

  // Remember a search the person settled on.
  useEffect(() => {
    if (!q || !hasHits) return;
    const t = window.setTimeout(() => addRecentSearch(q), REMEMBER_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [q, hasHits]);

  const recent = useRecentSearches();
  const suggestions = useSuggestions(input, hasMemories);

  const run = useCallback((value: string) => {
    setInput(value);
    setQuery(value);
    addRecentSearch(value);
  }, []);

  const pick = useCallback(
    (value: string) => {
      run(value);
      const el = inputRef.current;
      if (el && !isCoarsePointer()) el.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: matches("(prefers-reduced-motion: reduce)") ? "auto" : "smooth" });
    },
    [run],
  );

  const remember = useCallback(() => addRecentSearch(q), [q]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    run(input);
    if (isCoarsePointer()) inputRef.current?.blur();
  }

  function focusResult(index: number): boolean {
    const links = listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-result-link]");
    const link = links?.[Math.max(0, Math.min(links.length - 1, index))];
    if (!link) return false;
    link.focus();
    return true;
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && !e.altKey && !e.shiftKey && focusResult(0)) e.preventDefault();
    else if (e.key === "Escape" && input) {
      e.preventDefault();
      clear();
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLOListElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const links = Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-result-link]") ?? []);
    const i = links.findIndex((l) => l === document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === "ArrowDown") focusResult(i + 1);
    else if (i === 0) inputRef.current?.focus();
    else focusResult(i - 1);
  }

  function clear() {
    setInput("");
    setQuery("");
    inputRef.current?.focus();
  }

  const showSuggestions = suggestions.length > 0;

  return (
    <div>
      {/* Question box */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-3 -inset-y-2 rounded-[2rem] bg-linear-to-r from-indigo-500/20 via-violet-500/15 to-fuchsia-500/20 opacity-80 blur-2xl dark:from-indigo-500/25 dark:via-violet-500/20 dark:to-fuchsia-500/25"
        />
        <form role="search" onSubmit={onSubmit} className="relative" data-testid="search-form">
          <label htmlFor={INPUT_ID} className="sr-only">
            Ask your memory
          </label>
          <Input
            id={INPUT_ID}
            ref={inputRef}
            type="search"
            size="lg"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask anything… “Priya's phone number”"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={500}
            aria-describedby={suggestions.length ? undefined : "search-hint"}
            data-testid="search-input"
            data-search-page-input=""
            className="shadow-card sm:h-16 sm:text-lg"
            leftIcon={
              showSpinner ? (
                <Spinner size="md" className="text-brand-500 dark:text-brand-300" />
              ) : (
                <Search className="text-brand-500 dark:text-brand-300" />
              )
            }
            rightSlot={
              input ? (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Clear search"
                  className="grid size-9 place-items-center rounded-xl text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-white"
                  data-testid="search-clear"
                >
                  <X aria-hidden className="size-[18px]" />
                </button>
              ) : (
                <span aria-hidden className="mr-2 hidden sm:inline-flex">
                  <Kbd>/</Kbd>
                </span>
              )
            }
          />
        </form>

        {/* Suggestions (or a gentle tip) — always one line tall, so nothing jumps while typing. */}
        <div className="relative mt-3 flex h-8 min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar">
          {showSuggestions ? (
            <>
              <span className="shrink-0 pr-0.5 text-xs font-medium text-muted" id="search-suggestions-label">
                Suggestions
              </span>
              <ul aria-labelledby="search-suggestions-label" className="flex min-w-0 items-center gap-1.5">
                {suggestions.map((s) => (
                  <li key={s} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => pick(s)}
                      className={cn(
                        "inline-flex h-7 max-w-64 items-center rounded-full border border-zinc-200/90 bg-white/90 px-2.5 text-[13px] text-zinc-700 transition-colors",
                        "hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800",
                        "dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:border-brand-400/40 dark:hover:bg-brand-400/10 dark:hover:text-white",
                      )}
                      data-testid="search-suggestion"
                    >
                      <span className="truncate">{s}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p id="search-hint" className="truncate px-1 text-xs text-muted">
              {q && hasHits ? (
                <>
                  <span className="hidden sm:inline">
                    <Kbd>↓</Kbd> jump to results · <Kbd>↵</Kbd> open · <Kbd>esc</Kbd> clear
                  </span>
                  <span className="sm:hidden">Tap a memory to open it at the right spot.</span>
                </>
              ) : q ? (
                <>Fewer words often find more.</>
              ) : (
                <>Ask like you&apos;d ask a friend — names, numbers, “last month”…</>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Below the box */}
      <div className="mt-6 sm:mt-8">
        {stats === undefined ? null : !hasMemories ? (
          <NoMemoriesState />
        ) : !q ? (
          <IdleState recent={recent} onPick={pick} />
        ) : error && !loading && forQuery === q ? (
          <SearchErrorState onRetry={() => setRetry((n) => n + 1)} />
        ) : !response ? (
          <ResultsSkeleton />
        ) : (
          <Results
            query={q}
            parsed={parsed}
            response={current ?? response}
            hits={hits}
            stale={stale}
            kind={kind}
            onKindChange={setKind}
            dateIgnored={anyTime}
            onRemoveDate={() => setIgnoredDate(dateLabel ?? null)}
            onRestoreDate={() => setIgnoredDate(null)}
            meaning={!settings.semanticSearch || model.state === "disabled" ? "off" : model.state === "error" ? "unavailable" : "on"}
            onRemember={remember}
            listRef={listRef}
            onListKeyDown={onListKeyDown}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Results view ----------

interface ResultsProps {
  query: string;
  parsed: ParsedQuery;
  response: NonNullable<ReturnType<typeof useSearchResults>["response"]>;
  hits: SearchHit[];
  /** Showing the previous question's results while the new one runs. */
  stale: boolean;
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  dateIgnored: boolean;
  onRemoveDate: () => void;
  onRestoreDate: () => void;
  meaning: "on" | "off" | "unavailable";
  onRemember: () => void;
  listRef: RefObject<HTMLOListElement | null>;
  onListKeyDown: (e: KeyboardEvent<HTMLOListElement>) => void;
}

function Results({
  query,
  parsed,
  response,
  hits,
  stale,
  kind,
  onKindChange,
  dateIgnored,
  onRemoveDate,
  onRestoreDate,
  meaning,
  onRemember,
  listRef,
  onListKeyDown,
}: ResultsProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  // A new question, kind or date setting starts again from the first page of results.
  const listKey = `${query}|${kind}|${dateIgnored}`;
  const [shownFor, setShownFor] = useState(listKey);
  if (shownFor !== listKey) {
    setShownFor(listKey);
    setVisible(PAGE_SIZE);
  }

  const counts = useMemo(() => {
    const c = Object.fromEntries(MEMORY_KINDS.map((k) => [k, 0])) as Record<MemoryKind, number>;
    for (const h of hits) c[h.item.kind] += 1;
    return c;
  }, [hits]);

  const filtered = useMemo(() => (kind === "all" ? hits : hits.filter((h) => h.item.kind === kind)), [hits, kind]);
  const answers = useMemo(
    () => (kind === "all" ? response.answers : response.answers.filter((a) => a.itemKind === kind)),
    [response.answers, kind],
  );
  const words = useMemo(() => parsed.keywords.split(/\s+/).filter(Boolean), [parsed.keywords]);
  const intent = parsed.intents[0];

  const kindsWithHits = MEMORY_KINDS.filter((k) => counts[k] > 0);
  const showFilter = hits.length > 0 && (kindsWithHits.length > 1 || kind !== "all");
  const options: SegmentedOption<KindFilter>[] = [
    { value: "all", label: "All", count: hits.length },
    ...MEMORY_KINDS.filter((k) => counts[k] > 0 || k === kind).map((k) => {
      const Icon = KIND_ICONS[k];
      return { value: k as KindFilter, label: KIND_FILTER_LABEL[k], count: counts[k], icon: <Icon aria-hidden /> };
    }),
  ];

  const statusRow = (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <QueryUnderstanding parsed={parsed} dateIgnored={dateIgnored} onRemoveDate={onRemoveDate} onRestoreDate={onRestoreDate} />
      <div className="ml-auto flex items-center gap-2">
        <MeaningStatus response={response} />
      </div>
    </div>
  );

  if (!hits.length) {
    return (
      <div className={cn("space-y-4 transition-opacity duration-200", stale && "opacity-60")} aria-busy={stale || undefined}>
        {statusRow}
        <NoResultsState
          query={query}
          dateLabel={!dateIgnored ? parsed.dateRange?.label : undefined}
          onRemoveDate={onRemoveDate}
          meaning={meaning}
        />
      </div>
    );
  }

  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  return (
    <div className={cn("space-y-6 transition-opacity duration-200", stale && "opacity-60")} aria-busy={stale || undefined}>
      {statusRow}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {stale ? "" : `${countLabel(hits.length, "memory", "memories")} found${answers.length ? `, ${countLabel(answers.length, "answer", "answers")}` : ""}.`}
      </p>

      <SmartAnswers answers={answers} query={query} onUse={onRemember} />

      <section aria-labelledby="search-results-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2
            id="search-results-heading"
            className={cn("text-sm font-semibold text-zinc-900 dark:text-white", showFilter && "sr-only")}
          >
            {answers.length ? "Where it came from" : "Matching memories"}
          </h2>
          {showFilter ? (
            <Segmented<KindFilter>
              aria-label="Filter results by kind"
              size="sm"
              value={kind}
              onChange={onKindChange}
              options={options}
              testIdPrefix="kind-filter"
              className="min-w-0"
            />
          ) : null}
          <p className="ml-auto text-xs text-muted tabular-nums" data-testid="search-summary">
            {countLabel(filtered.length, "memory", "memories")}
            <span className="hidden sm:inline"> · {response.tookMs < 1 ? "<1" : response.tookMs} ms</span>
          </p>
        </div>

        {filtered.length ? (
          <ol ref={listRef} onKeyDown={onListKeyDown} className="space-y-3" data-testid="search-results">
            {shown.map((h) => (
              <li key={h.item.id} className="animate-fade-in">
                <ResultCard hit={h} query={query} words={words} intent={intent} onOpen={onRemember} />
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 px-6 py-10 text-center dark:border-white/10">
            <p className="text-sm text-muted">
              No {kind === "all" ? "memories" : KIND_FILTER_LABEL[kind].toLowerCase()} match this search.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => onKindChange("all")}>
              Show all {countLabel(hits.length, "result", "results")}
            </Button>
          </div>
        )}

        {remaining > 0 ? (
          <Button variant="secondary" fullWidth className="mt-4" onClick={() => setVisible((n) => n + PAGE_SIZE)} data-testid="search-show-more">
            Show more ({remaining} more)
          </Button>
        ) : null}

        {hits.length >= RESULT_LIMIT && remaining <= 0 ? (
          <p className="mt-4 text-center text-xs text-muted">
            Showing the {RESULT_LIMIT} best matches. Add a word or two to narrow it down.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** Static stand-in for the question box while the page hydrates (same size, so nothing shifts). */
export function SearchScreenFallback() {
  return (
    <div aria-hidden>
      <div className="relative">
        <div className="pointer-events-none absolute -inset-x-3 -inset-y-2 rounded-[2rem] bg-linear-to-r from-indigo-500/20 via-violet-500/15 to-fuchsia-500/20 opacity-80 blur-2xl dark:from-indigo-500/25 dark:via-violet-500/20 dark:to-fuchsia-500/25" />
        <div className="relative flex h-14 items-center gap-3 rounded-2xl border border-zinc-200/90 bg-white px-4 text-base text-zinc-400 shadow-card sm:h-16 sm:text-lg dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-500">
          <Search className="size-5 text-brand-500 dark:text-brand-300" />
          Ask anything… “Priya&apos;s phone number”
        </div>
      </div>
      <div className="mt-3 h-8" />
    </div>
  );
}
