"use client";

import {
  ArrowRight,
  Banknote,
  Brain,
  CalendarDays,
  Clock,
  ImageIcon,
  KeyRound,
  ClipboardPaste,
  Lightbulb,
  Phone,
  RotateCcw,
  SearchX,
  ShieldCheck,
  Sparkles,
  TextSearch,
  TriangleAlert,
  Upload,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, EmptyState, LoadingStatus } from "@/components/ui";
import { openNote, openUploadPicker, pasteNow } from "@/lib/add-actions";
import { ROUTES } from "@/lib/config";
import { cn } from "@/lib/utils";
import { clearRecentSearches, removeRecentSearch } from "./recent";
import { ResultCardSkeleton } from "./ResultCard";

// ---------- Idle: nothing typed yet ----------

const EXAMPLES: { q: string; icon: LucideIcon; hint: string }[] = [
  { q: "What's Priya's phone number?", icon: Phone, hint: "Pulls the number out for you" },
  { q: "wifi password", icon: KeyRound, hint: "Finds it in any note" },
  { q: "What did we decide last month?", icon: CalendarDays, hint: "Understands dates" },
  { q: "invoice total", icon: Banknote, hint: "Amounts inside PDFs" },
  { q: "screenshots from last month", icon: ImageIcon, hint: "Knows kinds of memories" },
  { q: "easy dinner idea", icon: Lightbulb, hint: "Finds similar meaning" },
];

const HOW_IT_WORKS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: TextSearch, title: "Exact words", body: "Every word in your screenshots, PDFs, videos, voice notes and text — typos forgiven." },
  { icon: Sparkles, title: "Similar meaning", body: "“dinner idea” also finds the lemon chicken recipe, even without those words." },
  { icon: CalendarDays, title: "Dates & details", body: "Say “last month”, “phone number” or “invoice” and get the exact answer." },
];

export interface IdleStateProps {
  recent: string[];
  onPick: (query: string) => void;
}

/** Before anything is typed: recent searches, example questions and how search works. */
export function IdleState({ recent, onPick }: IdleStateProps) {
  return (
    <div className="space-y-10 animate-fade-in" data-testid="search-idle">
      {recent.length ? (
        <section aria-labelledby="recent-searches-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="recent-searches-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
              <Clock aria-hidden className="size-4 text-zinc-400" />
              Recent searches
            </h2>
            <Button variant="ghost" size="sm" onClick={clearRecentSearches} data-testid="recent-clear">
              Clear
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <li key={q} className="min-w-0 max-w-full">
                <span
                  className={cn(
                    "group inline-flex h-9 max-w-full min-w-0 items-center rounded-full border border-zinc-200/90 bg-white pr-1 shadow-soft transition-colors",
                    "hover:border-zinc-300 dark:border-white/10 dark:bg-white/[0.05] dark:hover:border-white/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPick(q)}
                    className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-full pl-3 pr-1.5 text-sm text-zinc-700 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
                    data-testid="recent-search"
                  >
                    <Clock aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">{q}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRecentSearch(q)}
                    aria-label={`Remove “${q}” from recent searches`}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-white"
                    data-testid="recent-search-remove"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-xs text-muted">Kept only in this browser.</p>
        </section>
      ) : null}

      <section aria-labelledby="examples-heading">
        <h2 id="examples-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
          <WandSparkles aria-hidden className="size-4 text-brand-500 dark:text-brand-300" />
          Try asking
        </h2>
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {EXAMPLES.map(({ q, icon: Icon, hint }) => (
            <li key={q} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(q)}
                className={cn(
                  "group flex w-full items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white/80 p-3 text-left shadow-soft",
                  "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift",
                  "dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20",
                )}
                data-testid="example-question"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/15 ring-inset dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/20">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{q}</span>
                  <span className="block truncate text-xs text-muted">{hint}</span>
                </span>
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-zinc-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-brand-500 dark:text-zinc-600 dark:group-hover:text-brand-300"
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how-search-works-heading">
        <h2 id="how-search-works-heading" className="sr-only">
          How search works
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="min-w-0 rounded-2xl border border-zinc-200/60 bg-zinc-50/70 p-4 dark:border-white/[0.07] dark:bg-white/[0.025]"
            >
              <Icon aria-hidden className="size-5 text-brand-600 dark:text-brand-300" />
              <p className="mt-2.5 text-sm font-semibold text-zinc-900 dark:text-white">{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
          <ShieldCheck aria-hidden className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Searching happens on this device. Nothing you type is sent anywhere.
        </p>
      </section>
    </div>
  );
}

// ---------- Loading ----------

export function ResultsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" data-testid="search-loading">
      <LoadingStatus label="Searching your memories…" />
      {Array.from({ length: count }, (_, i) => (
        <ResultCardSkeleton key={i} />
      ))}
    </div>
  );
}

// ---------- Empty memory ----------

/** Nothing stored yet: explain, then offer to add something right here (upload, paste) or load the samples. */
export function NoMemoriesState() {
  const [loading, setLoading] = useState(false);
  const [pasting, setPasting] = useState(false);

  async function paste() {
    setPasting(true);
    try {
      await pasteNow();
    } catch {
      /* pasting explains clipboard problems in its own toast */
    } finally {
      setPasting(false);
    }
  }

  async function trySamples() {
    setLoading(true);
    try {
      const { loadSampleData } = await import("@/lib/storage/sample");
      await loadSampleData();
    } catch {
      /* loadSampleData already explained the problem in a toast */
    } finally {
      setLoading(false);
    }
  }

  return (
    <EmptyState
      icon={<Brain />}
      title="Nothing to search yet"
      description="Upload screenshots, PDFs, videos, voice notes or text and Remembos reads them on this device, so you can ask questions later."
      bordered
      data-testid="search-no-memories"
      action={
        <>
          <Button leftIcon={<Upload />} onClick={() => openUploadPicker()} data-testid="search-upload">
            Upload files
          </Button>
          <Button variant="secondary" leftIcon={<ClipboardPaste />} loading={pasting} onClick={paste} data-testid="search-paste">
            Paste
          </Button>
          <Button variant="ghost" leftIcon={<WandSparkles />} loading={loading} onClick={trySamples} data-testid="search-try-samples">
            Try sample memories
          </Button>
        </>
      }
    >
      Or{" "}
      <button
        type="button"
        onClick={openNote}
        className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
      >
        write a quick note
      </button>{" "}
      — it&apos;s searchable instantly.
    </EmptyState>
  );
}

// ---------- No results ----------

export interface NoResultsStateProps {
  query: string;
  /** Active date phrase that could be removed. */
  dateLabel?: string;
  onRemoveDate?: () => void;
  /** Whether meaning search is helping: switched off, failed to load, or on. */
  meaning: "on" | "off" | "unavailable";
}

/** Nothing matched: friendly tips that each lead somewhere. */
export function NoResultsState({ query, dateLabel, onRemoveDate, meaning }: NoResultsStateProps) {
  const tips: ReactNode[] = [];
  if (dateLabel && onRemoveDate) {
    tips.push(
      <>
        Widen the time:{" "}
        <button
          type="button"
          onClick={onRemoveDate}
          className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
          data-testid="no-results-remove-date"
        >
          remove “{dateLabel}”
        </button>
      </>,
    );
  }
  tips.push(<>Use fewer or different words — “Priya phone” works as well as a full sentence.</>);
  tips.push(<>Check the spelling of names, places and brands.</>);
  tips.push(
    meaning === "off" ? (
      <>
        <Link href={ROUTES.data} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
          Turn on meaning search
        </Link>{" "}
        to also find memories that say it differently.
      </>
    ) : meaning === "unavailable" ? (
      <>
        Meaning search couldn&apos;t load, so only exact words are matched — try the words you remember seeing.{" "}
        <Link href={ROUTES.data} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
          Check AI models
        </Link>
      </>
    ) : (
      <>Describe it in your own words — meaning search looks for similar ideas too.</>
    ),
  );

  return (
    <EmptyState
      icon={<SearchX />}
      title={
        <>
          No memories match <span className="break-words">“{query}”</span>
        </>
      }
      description="Here are a few things to try:"
      compact
      data-testid="search-no-results"
    >
      <ul className="mx-auto max-w-md space-y-2 text-left">
        {tips.map((tip, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-400" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </EmptyState>
  );
}

// ---------- Error ----------

export function SearchErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Search ran into a problem"
      description="Your memories are safe. Try again — if it keeps happening, reload the page."
      compact
      data-testid="search-error"
      action={
        <Button variant="secondary" leftIcon={<RotateCcw />} onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
