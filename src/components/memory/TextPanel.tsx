"use client";

import { ChevronDown, ChevronUp, FileSearch, Pencil, RotateCw, Save, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, CardHeader, CopyButton, EmptyState, fieldBaseClasses, Input, Kbd, SkeletonText } from "@/components/ui";
import { retryItemLazy as retryItem } from "@/lib/ingest/queue-store";
import { IngestError, isStorageError } from "@/lib/ingest/errors";
import type { MemoryItem, MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { findInText, segmentText } from "./find-text";
import { useDebounced, usePrefersReducedMotion } from "./hooks";
import { wordCount } from "./memory-data";

/** Characters rendered before "Show all" (keeps very long PDFs smooth). */
const DISPLAY_CAP = 40_000;
/** Above this, extracted text sits in its own scroll area so the page stays navigable. */
const SCROLL_AT = 2_500;

const TITLES: Record<MemoryKind, string> = {
  image: "Text in this image",
  pdf: "Text in this PDF",
  video: "What's said & shown",
  voice: "Transcript",
  text: "Text",
  note: "Note",
};

const NO_TEXT: Record<MemoryKind, string> = {
  image: "No readable text was found in this image. It's still findable by its name and date.",
  pdf: "This PDF has no text layer and nothing could be read from its pages. It's still findable by its name and date.",
  video: "No speech or on-screen text was found in this video — it may be silent or music, or transcription was turned off. It's still findable by its name and date.",
  voice: "No words were picked up in this recording — it may be silent, music, or transcription was turned off.",
  text: "This memory has no text yet.",
  note: "This note is empty.",
};

export interface TextPanelProps {
  item: MemoryItem;
  /** Pre-fill "Find in this memory" (e.g. the search that led here). */
  initialQuery?: string;
}

/**
 * The memory's words: extracted text / transcript, or the note itself. Copy, find with highlights
 * (Enter / Shift+Enter to step through matches), and edit notes and texts in place.
 */
export function TextPanel({ item, initialQuery = "" }: TextPanelProps) {
  const editable = item.kind === "note" || item.kind === "text";
  const text = item.text ?? "";
  const reducedMotion = usePrefersReducedMotion();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState(initialQuery);
  const debouncedQuery = useDebounced(query, 160);
  const found = useMemo(() => findInText(text, debouncedQuery), [text, debouncedQuery]);
  const [current, setCurrent] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Whether the last match change came from the user (then the page may scroll to it). */
  const revealRef = useRef(false);

  const count = found.ranges.length;
  const index = count ? Math.min(current, count - 1) : -1;
  const limit = expanded ? text.length : Math.min(text.length, DISPLAY_CAP);
  const segments = useMemo(() => segmentText(text, found.ranges, limit), [text, found.ranges, limit]);
  const scrolls = !editable && text.length > SCROLL_AT;
  const words = useMemo(() => wordCount(text), [text]);

  // Bring the current match into view (inside the text area; the page itself only on user action).
  useEffect(() => {
    const box = containerRef.current;
    if (!box || index < 0) return;
    const mark = box.querySelector<HTMLElement>(`[data-match="${index}"]`);
    if (!mark) return;
    const smooth: ScrollBehavior = reducedMotion ? "auto" : "smooth";
    if (box.scrollHeight > box.clientHeight + 4) {
      const top = Math.max(0, mark.offsetTop - box.clientHeight / 2);
      // Short hops glide; long jumps (far-apart matches in a big PDF) are instant.
      const far = Math.abs(top - box.scrollTop) > box.clientHeight * 2;
      box.scrollTo({ top, behavior: far ? "auto" : smooth });
      if (revealRef.current) box.scrollIntoView({ block: "nearest", behavior: smooth });
    } else if (revealRef.current) {
      mark.scrollIntoView({ block: "center", behavior: smooth });
    }
    revealRef.current = false;
  }, [index, segments, reducedMotion]);

  function goTo(next: number) {
    if (!count) return;
    const i = ((next % count) + count) % count;
    if (found.ranges[i][0] >= limit) setExpanded(true);
    revealRef.current = true;
    setCurrent(i);
  }

  function onFindKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      goTo(index + (e.shiftKey ? -1 : 1));
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
      setCurrent(0);
    }
  }

  function startEdit() {
    setDraft(text);
    setEditing(true);
  }

  async function save() {
    if (!draft.trim()) return;
    if (draft === text) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { updateItemText } = await import("@/lib/ingest/save");
      await updateItemText(item.id, draft);
      setEditing(false);
      toast.success("Saved", { id: "memory-text-saved", description: "Search and connections are updated.", duration: 2200 });
    } catch (err) {
      if (err instanceof IngestError) toast.error("Couldn't save your changes", { id: "memory-text-saved", description: err.message });
      else if (!isStorageError(err)) {
        toast.error("Couldn't save your changes", { id: "memory-text-saved", description: "Something went wrong. Please try again." });
      }
    } finally {
      setSaving(false);
    }
  }

  function onEditorKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape" && draft === text) {
      e.preventDefault();
      setEditing(false);
    }
  }

  const processing = item.status === "processing";
  const subtitle = text
    ? `${words.toLocaleString()} ${words === 1 ? "word" : "words"}${item.ocrConfidence !== undefined && !editable ? " · read on this device" : ""}`
    : undefined;

  return (
    <Card padding="none" radius="3xl" data-testid="item-text" className="overflow-hidden">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <CardHeader
          level={2}
          icon={<FileSearch />}
          title={TITLES[item.kind]}
          description={subtitle}
          actions={
            editing ? null : (
              <>
                {text ? <CopyButton value={() => text} label="Copy" data-testid="item-text-copy" /> : null}
                {editable && !processing ? (
                  <Button variant="soft" size="sm" leftIcon={<Pencil />} onClick={startEdit} data-testid="item-text-edit">
                    Edit
                  </Button>
                ) : null}
              </>
            )
          }
        />
      </div>

      {editing ? (
        <div className="px-5 pt-4 pb-5 sm:px-6 sm:pb-6">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onEditorKey}
            aria-label={item.kind === "note" ? "Edit note" : "Edit text"}
            data-testid="item-text-editor"
            className={cn(
              fieldBaseClasses,
              "block field-sizing-content min-h-64 max-h-[70vh] resize-y rounded-2xl px-4 py-3.5 text-[15px] leading-7",
            )}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="hidden items-center gap-1.5 text-xs text-muted sm:inline-flex">
              <Kbd keys={["mod", "Enter"]} /> to save
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving} leftIcon={<X />} data-testid="item-text-cancel">
                Cancel
              </Button>
              <Button onClick={save} loading={saving} disabled={!draft.trim()} leftIcon={<Save />} data-testid="item-text-save">
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : processing && !text ? (
        <div className="px-5 pt-4 pb-6 sm:px-6">
          <SkeletonText lines={5} />
          <p className="mt-4 text-sm text-muted">Reading it on this device — the text appears here in a moment.</p>
        </div>
      ) : !text ? (
        <EmptyState
          compact
          title="No text here"
          description={NO_TEXT[item.kind]}
          action={
            item.hasFile && item.kind !== "note" && item.kind !== "text" ? (
              <Button variant="secondary" leftIcon={<RotateCw />} onClick={() => void retryItem(item.id)} data-testid="item-text-retry">
                Try reading again
              </Button>
            ) : editable ? (
              <Button variant="secondary" leftIcon={<Pencil />} onClick={startEdit}>
                Write something
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <div className="px-5 pt-4 sm:px-6">
            <div className="flex items-center gap-1.5">
              <Input
                type="search"
                size="sm"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCurrent(0);
                }}
                onKeyDown={onFindKey}
                placeholder="Find in this memory"
                aria-label="Find in this memory"
                leftIcon={<Search />}
                wrapperClassName="flex-1"
                data-testid="item-find"
              />
              <span
                className="min-w-14 text-center text-xs text-muted tabular-nums"
                aria-live="polite"
                data-testid="item-find-count"
              >
                {debouncedQuery.trim() ? (count ? `${index + 1} / ${count}${found.capped ? "+" : ""}` : "No match") : ""}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Previous match" onClick={() => goTo(index - 1)} disabled={!count} data-testid="item-find-prev">
                <ChevronUp />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next match" onClick={() => goTo(index + 1)} disabled={!count} data-testid="item-find-next">
                <ChevronDown />
              </Button>
            </div>
            {found.mode === "words" && debouncedQuery.trim().includes(" ") ? (
              <p className="mt-2 text-xs text-muted">The exact phrase isn&apos;t here, so its words are highlighted instead.</p>
            ) : null}
          </div>

          <div
            ref={containerRef}
            tabIndex={scrolls ? 0 : undefined}
            aria-label={scrolls ? TITLES[item.kind] : undefined}
            role={scrolls ? "region" : undefined}
            className={cn(
              "relative mt-4 px-5 pb-6 sm:px-6",
              scrolls && "max-h-[min(70vh,44rem)] overflow-y-auto overscroll-contain border-t border-zinc-200/70 pt-4 dark:border-white/10",
            )}
          >
            <div
              className={cn(
                "break-words whitespace-pre-wrap text-zinc-800 dark:text-zinc-200",
                item.kind === "note" || item.kind === "text" ? "text-[16px] leading-[1.75]" : "text-[15px] leading-7",
                item.kind === "text" && "border-l-2 border-sky-400/50 pl-4 dark:border-sky-300/40",
              )}
              data-testid="item-text-body"
            >
              {segments.map((s, i) =>
                s.match === undefined ? (
                  <span key={i}>{s.text}</span>
                ) : (
                  <mark
                    key={i}
                    data-match={s.match}
                    data-current={s.match === index ? "true" : undefined}
                    className={cn(
                      "rounded-[4px] px-[1px] text-inherit transition-colors",
                      s.match === index
                        ? "bg-amber-400 text-zinc-950 shadow-[0_0_0_2px_rgb(251_191_36/0.45)] dark:bg-amber-300"
                        : "bg-amber-200/80 dark:bg-amber-400/30 dark:text-amber-50",
                    )}
                  >
                    {s.text}
                  </mark>
                ),
              )}
              {limit < text.length ? <span aria-hidden>…</span> : null}
            </div>
            {limit < text.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setExpanded(true)} data-testid="item-text-more">
                  Show all text
                </Button>
                <Badge tone="neutral">{Math.round((text.length - limit) / 1000).toLocaleString()}k more characters</Badge>
              </div>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
}
