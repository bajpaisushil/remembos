"use client";

import { AlertTriangle, Check, Pin, PinOff, RotateCw } from "lucide-react";
import Link from "next/link";
import { memo, useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge, Button, EntityChip, KindBadge, Spinner } from "@/components/ui";
import { itemHref } from "@/lib/config";
import { retryItemLazy as retryItem, useQueue } from "@/lib/ingest/queue-store";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { artMeta, artShowsText, MemoryArt } from "./MemoryArt";
import { setPinned, STAGE_SHORT, type CardChip, type CardItem } from "./memory-data";

export interface MemoryCardProps {
  item: CardItem;
  /** Up to three entity chips (phone, amount, name…). */
  chips?: CardChip[];
  layout?: "grid" | "list";
  /** Offer a selection checkbox. */
  selectable?: boolean;
  /** While true, clicking the card toggles selection instead of opening it. */
  selectionMode?: boolean;
  selected?: boolean;
  /** Toggle selection; `shift` extends the selection from the last clicked card. */
  onSelect?: (id: string, opts: { shift: boolean }) => void;
  /** Show the pin toggle. Default true. */
  pinnable?: boolean;
  /** Extra line under the title (e.g. why a memory is related). */
  note?: ReactNode;
  /** Heading level of the title. Default 3. */
  headingLevel?: 2 | 3 | 4;
  /** Appended to the item link (e.g. "&q=…" to carry a search). */
  hrefSuffix?: string;
  className?: string;
}

function fullDate(ms: number): string {
  return formatDate(ms, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

async function togglePin(item: CardItem) {
  const next = !item.pinned;
  const ok = await setPinned([item.id], next);
  if (ok) {
    toast.success(next ? "Pinned to the top" : "Unpinned", {
      id: "memory-pin",
      description: next ? "Pinned memories always show first in your library." : undefined,
      duration: 1800,
    });
  }
}

/** Live processing stage for a memory being read right now. */
function StagePill({ itemId, bare, className }: { itemId: string; bare?: boolean; className?: string }) {
  const jobs = useQueue();
  const job = jobs.find((j) => j.itemId === itemId && j.stage !== "done" && j.stage !== "cancelled");
  const label = job ? STAGE_SHORT[job.stage] : "Waiting…";
  const pct = job && job.progress > 0 && job.progress < 1 ? ` ${Math.round(job.progress * 100)}%` : "";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5",
        bare
          ? "text-brand-700 dark:text-brand-300"
          : "rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-card ring-1 ring-black/5 dark:bg-ink-800/90 dark:text-zinc-200 dark:ring-white/10",
        className,
      )}
      role="status"
    >
      <Spinner size="xs" className="text-brand-500" />
      <span className="truncate">
        {label}
        <span className="tabular-nums">{pct}</span>
      </span>
    </span>
  );
}

function RetryButton({ itemId, compact }: { itemId: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await retryItem(itemId);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      size={compact ? "icon-sm" : "sm"}
      variant="soft"
      loading={busy}
      onClick={retry}
      leftIcon={compact ? undefined : <RotateCw />}
      aria-label={compact ? "Try reading it again" : undefined}
      data-testid="memory-retry"
      className="relative z-10"
    >
      {compact ? <RotateCw /> : "Retry"}
    </Button>
  );
}

/**
 * Card controls that only appear on hover: faded (but still in the Tab order, and shown on focus) on
 * devices with a mouse; truly hidden on touch screens so an unseen control can't be tapped by accident.
 */
const REVEAL_ON_HOVER =
  "opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(hover:none)]:invisible";

function SelectBox({
  item,
  selected,
  visible,
  onSelect,
  className,
}: {
  item: CardItem;
  selected: boolean;
  visible: boolean;
  onSelect: MemoryCardProps["onSelect"];
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select “${item.title}”`}
      data-testid="memory-select"
      onClick={(e) => onSelect?.(item.id, { shift: e.shiftKey })}
      className={cn(
        "z-10 grid size-7 shrink-0 place-items-center rounded-lg border-2 shadow-sm transition-[opacity,background-color,border-color,transform] duration-150 active:scale-95",
        selected
          ? "brand-gradient border-transparent text-white"
          : "border-zinc-300 bg-white/90 text-transparent hover:border-brand-400 dark:border-white/30 dark:bg-ink-800/80",
        visible || selected ? "opacity-100" : REVEAL_ON_HOVER,
        className,
      )}
    >
      <Check aria-hidden className="size-4" strokeWidth={3} />
    </button>
  );
}

function PinButton({ item, className }: { item: CardItem; className?: string }) {
  const pinned = Boolean(item.pinned);
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin “${item.title}”` : `Pin “${item.title}” to the top`}
      title={pinned ? "Unpin" : "Pin to the top"}
      data-testid="memory-pin"
      onClick={() => void togglePin(item)}
      className={cn(
        "group/pin z-10 grid size-8 shrink-0 place-items-center rounded-full transition-[opacity,background-color,color,transform] duration-150 active:scale-95",
        pinned
          ? "bg-white/95 text-brand-600 opacity-100 shadow-card ring-1 ring-brand-500/25 dark:bg-ink-800/90 dark:text-brand-300"
          : cn(
              "bg-white/90 text-zinc-500 shadow-card ring-1 ring-black/5 hover:text-brand-600 dark:bg-ink-800/80 dark:text-zinc-300 dark:ring-white/10 dark:hover:text-brand-300",
              REVEAL_ON_HOVER,
            ),
        className,
      )}
    >
      {pinned ? (
        <>
          <Pin aria-hidden className="size-4 fill-current group-hover/pin:hidden" />
          <PinOff aria-hidden className="hidden size-4 group-hover/pin:block" />
        </>
      ) : (
        <Pin aria-hidden className="size-4" />
      )}
    </button>
  );
}

function MemoryCardImpl({
  item,
  chips = [],
  layout = "grid",
  selectable = false,
  selectionMode = false,
  selected = false,
  onSelect,
  pinnable = true,
  note,
  headingLevel = 3,
  hrefSuffix = "",
  className,
}: MemoryCardProps) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const processing = item.status === "processing";
  const failed = item.status === "error";
  const href = `${itemHref(item.id)}${hrefSuffix}`;

  function onLinkClick(e: MouseEvent<HTMLAnchorElement>) {
    if (!selectionMode || !onSelect) return;
    e.preventDefault();
    onSelect(item.id, { shift: e.shiftKey });
  }

  const time = (
    <time dateTime={new Date(item.createdAt).toISOString()} title={`Added ${fullDate(item.createdAt)}`} className="truncate">
      {timeAgo(item.createdAt)}
    </time>
  );

  const link = (
    <Link
      href={href}
      onClick={onLinkClick}
      data-testid="memory-card-link"
      className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-[inherit] after:content-['']"
    >
      {item.title || "Untitled memory"}
    </Link>
  );

  const shared = {
    "data-testid": "memory-card",
    "data-item-id": item.id,
    "data-kind": item.kind,
    "data-status": item.status,
    "data-pinned": item.pinned ? "true" : "false",
    "data-selected": selected ? "true" : undefined,
  };

  if (layout === "list") {
    return (
      <article
        {...shared}
        className={cn(
          "group/card relative flex items-center gap-3 rounded-2xl border bg-white p-2.5 pr-3 shadow-soft sm:gap-4",
          "transition-[border-color,box-shadow,background-color] duration-150 ease-out",
          "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-brand-500",
          "dark:bg-white/[0.04]",
          selected
            ? "border-brand-400 bg-brand-50/60 ring-1 ring-brand-400/40 dark:border-brand-400/50 dark:bg-brand-400/10"
            : "border-zinc-200/70 hover:border-zinc-300 hover:shadow-card dark:border-white/10 dark:hover:border-white/20",
          className,
        )}
      >
        {selectable ? <SelectBox item={item} selected={selected} visible onSelect={onSelect} className="relative" /> : null}
        <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-zinc-200/60 dark:border-white/10">
          <MemoryArt item={item} variant="thumb" className="size-full" />
          {processing ? (
            <div className="absolute inset-0 grid place-items-center bg-white/60 dark:bg-black/50">
              <Spinner size="sm" className="text-brand-600 dark:text-brand-300" />
            </div>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <H className="min-w-0 truncate text-[15px] font-semibold text-zinc-900 dark:text-white">{link}</H>
            {item.pinned ? <Pin aria-label="Pinned" className="size-3.5 shrink-0 fill-current text-brand-500 dark:text-brand-300" /> : null}
          </div>
          <p className="truncate text-[13px] text-muted">
            {failed ? (
              <span className="text-rose-600 dark:text-rose-300">{item.error || "Couldn't read this one."}</span>
            ) : processing ? (
              <StagePill itemId={item.id} bare />
            ) : (
              item.summary || note || "No text found — still findable by name and date."
            )}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted sm:hidden">
            <KindBadge kind={item.kind} size="sm" />
            {time}
          </div>
        </div>
        {chips.length ? (
          <div className="relative z-10 hidden max-w-[34%] shrink items-center gap-1.5 overflow-hidden lg:flex">
            {chips.slice(0, 2).map((c) => (
              <EntityChip key={c.id} type={c.type} value={c.value} size="sm" maxChars={22} />
            ))}
          </div>
        ) : null}
        <div className="hidden w-28 shrink-0 flex-col items-end gap-1 text-xs text-muted sm:flex">
          <KindBadge kind={item.kind} size="sm" />
          {time}
        </div>
        {failed ? <RetryButton itemId={item.id} compact /> : null}
        {pinnable ? <PinButton item={item} className="relative" /> : null}
      </article>
    );
  }

  const meta = artMeta(item);
  const showSummary = !artShowsText(item) && Boolean(item.summary) && !failed;

  return (
    <article
      {...shared}
      className={cn(
        "group/card relative flex flex-col overflow-hidden rounded-3xl border bg-white shadow-card",
        "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lift",
        "has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-brand-500",
        "dark:bg-white/[0.04]",
        selected
          ? "border-brand-400 ring-2 ring-brand-500/50 dark:border-brand-400/60"
          : "border-zinc-200/70 hover:border-zinc-300/80 dark:border-white/10 dark:hover:border-white/20",
        className,
      )}
    >
      <div className="relative aspect-[16/10] shrink-0 overflow-hidden border-b border-zinc-200/60 dark:border-white/[0.07]">
        <MemoryArt item={item} />
        {processing ? (
          <div aria-hidden className="absolute inset-0">
            <div className="shimmer h-full w-full bg-white/30 dark:bg-black/30" />
          </div>
        ) : null}
        {failed ? <div aria-hidden className="absolute inset-0 bg-rose-500/10 dark:bg-rose-500/15" /> : null}

        {selectable ? (
          <SelectBox item={item} selected={selected} visible={selectionMode} onSelect={onSelect} className="absolute top-3 left-3" />
        ) : null}
        {pinnable ? <PinButton item={item} className="absolute top-3 right-3" /> : null}

        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[2] flex items-end justify-between gap-2">
          {processing ? (
            <StagePill itemId={item.id} />
          ) : failed ? (
            <Badge tone="danger" icon={<AlertTriangle />} className="bg-white/95 shadow-card dark:bg-ink-800/95">
              Couldn&apos;t read
            </Badge>
          ) : (
            <span />
          )}
          {meta ? (
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums backdrop-blur-sm">
              {meta}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <KindBadge kind={item.kind} size="sm" />
          <span aria-hidden>·</span>
          {time}
        </div>
        <H className="line-clamp-2 text-[15px] leading-snug font-semibold tracking-tight text-zinc-900 dark:text-white">{link}</H>
        {showSummary ? <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{item.summary}</p> : null}
        {note ? <div className="text-[13px] leading-relaxed text-muted">{note}</div> : null}
        {failed ? (
          <div className="flex items-start gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-relaxed text-rose-700 dark:text-rose-300">
              {item.error || "Something went wrong while reading this."}
            </p>
            <RetryButton itemId={item.id} />
          </div>
        ) : null}
        {chips.length ? (
          <div className="relative z-10 mt-auto flex flex-wrap gap-1.5 pt-1">
            {chips.map((c) => (
              <EntityChip key={c.id} type={c.type} value={c.value} size="sm" maxChars={24} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function sameChips(a: CardChip[] | undefined, b: CardChip[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((c, i) => c.id === b[i].id && c.value === b[i].value);
}

function sameItem(a: CardItem, b: CardItem): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.updatedAt === b.updatedAt &&
      a.title === b.title &&
      a.summary === b.summary &&
      a.status === b.status &&
      a.error === b.error &&
      a.pinned === b.pinned &&
      a.hasThumb === b.hasThumb &&
      a.hasFile === b.hasFile &&
      a.kind === b.kind &&
      a.createdAt === b.createdAt &&
      a.durationSec === b.durationSec &&
      a.pageCount === b.pageCount &&
      a.sourceName === b.sourceName)
  );
}

/**
 * A memory in the library: a per-kind preview, title, kind, time, a few found details and status.
 * The whole card opens the memory; checkbox, pin, chips and Retry stay independently clickable.
 * Memoised so big grids only re-render the cards that changed.
 */
export const MemoryCard = memo(MemoryCardImpl, (prev, next) => {
  return (
    sameItem(prev.item, next.item) &&
    sameChips(prev.chips, next.chips) &&
    prev.layout === next.layout &&
    prev.selectable === next.selectable &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected &&
    prev.onSelect === next.onSelect &&
    prev.pinnable === next.pinnable &&
    prev.note === next.note &&
    prev.headingLevel === next.headingLevel &&
    prev.hrefSuffix === next.hrefSuffix &&
    prev.className === next.className
  );
});
