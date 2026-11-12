"use client";

import { ClipboardPaste, FilterX, LibraryBig, Search, SearchX, Sparkles, Upload } from "lucide-react";
import { useState } from "react";
import { Button, EmptyState, Kbd, KindIcon } from "@/components/ui";
import { openNote, openUploadPicker, pasteNow } from "@/lib/add-actions";
import { loadSampleData } from "@/lib/storage/sample";
import type { MemoryKind } from "@/lib/types";

const FLOATING: { kind: MemoryKind; className: string }[] = [
  { kind: "image", className: "-rotate-12" },
  { kind: "pdf", className: "-rotate-3 -translate-y-2" },
  { kind: "video", className: "translate-y-1" },
  { kind: "voice", className: "rotate-3 -translate-y-2" },
  { kind: "note", className: "rotate-12" },
];

/** Paste whatever is on the clipboard right away, with a spinner on the button meanwhile. */
export function usePasteNow(): { pasting: boolean; paste: () => Promise<void> } {
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
  return { pasting, paste };
}

/** First-visit library: what goes here and the quickest ways to start. */
export function LibraryEmpty() {
  const [loadingSamples, setLoadingSamples] = useState(false);
  const { pasting, paste } = usePasteNow();

  async function addSamples() {
    setLoadingSamples(true);
    try {
      await loadSampleData();
    } catch {
      /* loadSampleData already explained the problem in a toast */
    } finally {
      setLoadingSamples(false);
    }
  }

  return (
    <div
      data-testid="library-empty"
      className="relative overflow-hidden rounded-3xl border-2 border-dashed border-zinc-200 bg-white/50 dark:border-white/10 dark:bg-white/[0.02]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-linear-to-b from-brand-500/[0.06] to-transparent" />
      <EmptyState
        icon={<LibraryBig />}
        title="Your library is ready for its first memory"
        description={
          <>
            Drop screenshots, PDFs, videos, voice recordings or text files anywhere on this page. Remembos reads them
            right here in your browser and keeps them in this browser&apos;s own storage — nothing leaves your device.
          </>
        }
        action={
          <>
            <Button size="lg" leftIcon={<Upload />} onClick={() => openUploadPicker()} data-testid="library-add-files">
              Upload files
            </Button>
            <Button size="lg" variant="secondary" leftIcon={<ClipboardPaste />} loading={pasting} onClick={paste} data-testid="library-paste">
              Paste
            </Button>
            <Button
              size="lg"
              variant="ghost"
              leftIcon={<Sparkles />}
              loading={loadingSamples}
              onClick={addSamples}
              data-testid="library-load-samples"
            >
              Try sample memories
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-5 pt-4">
          <div aria-hidden className="flex items-center gap-3">
            {FLOATING.map(({ kind, className }, i) => (
              <span key={kind} className={`inline-flex animate-float ${className}`} style={{ animationDelay: `${-i * 1.3}s` }}>
                <KindIcon kind={kind} size="lg" />
              </span>
            ))}
          </div>
          <p className="inline-flex flex-wrap items-center justify-center gap-1.5">
            Tip: copy something and press <Kbd keys={["mod", "v"]} /> anywhere to remember it — or{" "}
            <button
              type="button"
              onClick={openNote}
              className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
            >
              write a note
            </button>
            .
          </p>
        </div>
      </EmptyState>
    </div>
  );
}

export interface NoMatchesProps {
  onClear: () => void;
  /** Quick-filter text, if any (offers a deep search). */
  query?: string;
  deepSearchHref?: string;
}

/** Filters left nothing to show. */
export function NoMatches({ onClear, query, deepSearchHref }: NoMatchesProps) {
  return (
    <EmptyState
      data-testid="library-no-matches"
      bordered
      compact
      icon={query ? <SearchX /> : <FilterX />}
      title={query ? <>Nothing here matches “{query}”</> : "No memories match these filters"}
      description={
        query
          ? "This quick filter only looks at titles, summaries and tags. A deep search also reads the full text of every file and understands meaning."
          : "Try another kind or tag, or clear the filters to see everything again."
      }
      action={
        <>
          {query && deepSearchHref ? (
            <Button href={deepSearchHref} leftIcon={<Search />} data-testid="library-deep-search-empty">
              Deep search
            </Button>
          ) : null}
          <Button variant="secondary" leftIcon={<FilterX />} onClick={onClear} data-testid="library-clear-filters">
            Clear filters
          </Button>
        </>
      }
    />
  );
}
