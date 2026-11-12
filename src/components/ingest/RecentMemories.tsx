"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Check, CircleAlert, Copy, Download, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { KindIcon } from "@/components/ui/KindIcon";
import { LoadingStatus, Skeleton } from "@/components/ui/Skeleton";
import { Spinner } from "@/components/ui/Spinner";
import { itemHref, KIND_META, ROUTES } from "@/lib/config";
import { db } from "@/lib/db";
import { useThumbnailUrl } from "@/lib/hooks";
import { useQueue } from "@/lib/ingest/queue-store";
import { useSettings } from "@/lib/settings";
import type { MemoryItem, QueueJob } from "@/lib/types";
import { cn, copyToClipboard, formatDuration, timeAgo } from "@/lib/utils";
import { InstallTip } from "./InstallTip";
import { isFinished, stageLabel, steadyProgress } from "./queue-labels";
import { trySampleMemories } from "./samples";

const RECENT_LIMIT = 8;

/** Only what a card shows — never keep `item.text` (it can be megabytes) in React state. */
type RecentItem = Pick<
  MemoryItem,
  "id" | "kind" | "title" | "summary" | "createdAt" | "status" | "hasThumb" | "hasFile" | "sample" | "durationSec" | "pageCount"
>;

interface RecentData {
  count: number;
  items: RecentItem[];
  failed?: boolean;
}

function slim(item: MemoryItem): RecentItem {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    createdAt: item.createdAt,
    status: item.status,
    hasThumb: item.hasThumb,
    hasFile: item.hasFile,
    sample: item.sample,
    durationSec: item.durationSec,
    pageCount: item.pageCount,
  };
}

/** Narrow, indexed reads: the newest 8 by `createdAt` plus the table count (no full-table scans). */
async function queryRecent(): Promise<RecentData> {
  try {
    const [count, items] = await Promise.all([
      db.items.count(),
      db.items.orderBy("createdAt").reverse().limit(RECENT_LIMIT).toArray(),
    ]);
    return { count, items: items.map(slim) };
  } catch (err) {
    console.warn("[remembos] could not read recent memories", err);
    return { count: 0, items: [], failed: true };
  }
}

/** "2 pages · 3 days ago" — the kind itself is shown by the icon next to it. */
function metaLine(item: RecentItem): string {
  const parts: string[] = [];
  if ((item.kind === "voice" || item.kind === "video") && item.durationSec) parts.push(formatDuration(item.durationSec));
  else if (item.kind === "pdf" && item.pageCount) parts.push(`${item.pageCount} page${item.pageCount === 1 ? "" : "s"}`);
  parts.push(timeAgo(item.createdAt));
  return parts.join(" · ");
}

// Phones: one swipeable row. sm+: a 4-column grid (8 cards = two rows).
const STRIP =
  "no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 " +
  "sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0";
/** Same geometry as STRIP, but never scrolls (placeholder rows). */
const STRIP_STATIC =
  "-mx-4 flex gap-3 overflow-hidden px-4 pt-1 pb-3 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0 sm:pb-0";
const CELL = "w-[46%] shrink-0 snap-start min-[480px]:w-[31%] sm:w-auto";
/** Every card body reserves two title lines + one meta line, so skeleton → cards → empty never shifts. */
const TITLE_BOX = "min-h-[2lh] text-[13px] leading-snug sm:text-sm";
const META_ROW = "flex h-5.5 min-w-0 items-center gap-1.5 text-xs";
/** Opaque backing so tinted badges stay readable on top of thumbnails. */
const BADGE_BACKING = "inline-flex rounded-full bg-white/95 shadow-soft dark:bg-ink-800/95";

interface Progressing {
  label: string;
  /** 0..1, or null when waiting (indeterminate). */
  value: number | null;
}

function progressFor(item: RecentItem, job: QueueJob | undefined): Progressing | null {
  if (item.status !== "processing") return null;
  if (!job || isFinished(job)) return { label: "Waiting to be read…", value: null };
  return { label: stageLabel(job), value: job.stage === "queued" ? null : steadyProgress(job) };
}

const RecentCard = memo(function RecentCard({ item, progress }: { item: RecentItem; progress: Progressing | null }) {
  const thumb = useThumbnailUrl(item.id, item.hasThumb);
  const meta = KIND_META[item.kind];
  const processing = item.status === "processing";
  const failed = item.status === "error";

  return (
    <div className="relative h-full">
    <Link
      href={itemHref(item.id)}
      data-testid="recent-card"
      data-status={item.status}
      aria-busy={processing || undefined}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-soft",
        "transition-[transform,box-shadow,border-color,opacity,translate] duration-300 ease-out motion-reduce:transition-none",
        "starting:translate-y-1.5 starting:opacity-0",
        "hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift active:translate-y-0",
        "dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20",
        processing && "border-brand-300/60 dark:border-brand-400/30",
      )}
    >
      <div
        className={cn(
          "relative aspect-[4/3] overflow-hidden",
          thumb ? "bg-zinc-100 dark:bg-white/[0.04]" : meta.bg,
          processing && "shimmer",
        )}
      >
        {thumb ? (
          // Thumbnails are local blob: URLs, so next/image has nothing to optimise here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full transition-transform duration-300 ease-out group-hover:scale-[1.03] motion-reduce:transition-none",
              item.kind === "voice" ? "object-contain p-3" : item.kind === "video" ? "object-cover" : "object-cover object-top",
            )}
          />
        ) : item.summary && !processing ? (
          // A sheet of "paper" peeking out of a kind-tinted tray.
          <div
            className={cn(
              "absolute inset-x-3 top-3 -bottom-3 rounded-xl bg-white p-3 shadow-soft ring-1 ring-zinc-900/[0.06]",
              "transition-transform duration-300 ease-out group-hover:-translate-y-1 motion-reduce:transition-none",
              "dark:bg-ink-800 dark:ring-white/10",
            )}
          >
            <p className="line-clamp-6 text-[11.5px] leading-[1.5] text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
              {item.summary}
            </p>
          </div>
        ) : (
          <div className="grid size-full place-items-center">
            <KindIcon kind={item.kind} size="lg" className={processing ? "animate-float" : undefined} />
          </div>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-black/[0.04] to-transparent dark:from-black/20" />

        {item.kind === "video" && thumb && !processing ? (
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white shadow-soft ring-1 ring-white/30"
          >
            <Play className="size-4 translate-x-px fill-current" />
          </span>
        ) : null}

        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
          {processing ? (
            <span className={BADGE_BACKING}>
              <Badge tone="brand" size="sm" icon={<Spinner size="xs" />}>
                Reading…
              </Badge>
            </span>
          ) : failed ? (
            <span className={BADGE_BACKING}>
              <Badge tone="danger" size="sm" icon={<CircleAlert />}>
                Needs attention
              </Badge>
            </span>
          ) : null}
        </div>

        {progress ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-brand-500/15" aria-hidden>
            {progress.value === null ? (
              <div className="brand-gradient h-full w-1/3 animate-indeterminate rounded-full motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />
            ) : (
              <div
                className="brand-gradient h-full rounded-r-full transition-[width] duration-500 ease-out-soft"
                style={{ width: `${Math.max(4, progress.value * 100)}%` }}
              />
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p
          className={cn(
            TITLE_BOX,
            "line-clamp-2 font-medium text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100",
          )}
        >
          {item.title || "Untitled"}
        </p>
        <p className={cn(META_ROW, "mt-auto text-muted")}>
          <KindIcon kind={item.kind} size="xs" label={meta.label} />
          {progress ? (
            <span className="truncate font-medium text-brand-700 dark:text-brand-300" title={progress.label}>
              {progress.label}
            </span>
          ) : (
            <span className="truncate">{metaLine(item)}</span>
          )}
          {item.sample && !progress ? (
            <Badge tone="neutral" size="sm" className="ml-auto">
              Sample
            </Badge>
          ) : null}
        </p>
      </div>
    </Link>
    {!processing ? <QuickAction item={item} /> : null}
    </div>
  );
});

/**
 * One-tap action on a recent card, so the most common next step needs no page visit: memories with a stored
 * file get Download (the original, under its own name); text-only memories (copied text, notes) get Copy.
 * Sits outside the card link (a button can't live inside a link) and reads the data only when tapped.
 */
function QuickAction({ item }: { item: RecentItem }) {
  const [copied, setCopied] = useState(false);
  const download = item.hasFile === 1;
  const label = download ? `Download ${item.title || "file"}` : `Copy text of ${item.title || "memory"}`;

  async function run() {
    try {
      const full = await db.items.get(item.id);
      if (!full) return;
      if (download) {
        const { downloadOriginal } = await import("@/components/memory/original");
        await downloadOriginal(full);
        return;
      }
      if (!full.text.trim()) {
        toast.info("Nothing to copy yet", { description: "No text was found in this memory." });
        return;
      }
      if (await copyToClipboard(full.text)) {
        setCopied(true);
        toast.success("Copied", { id: "recent-copy", description: item.title || undefined });
        window.setTimeout(() => setCopied(false), 1500);
      } else {
        toast.error("Couldn't copy", { description: "Your browser blocked the clipboard. Open the memory and copy from there." });
      }
    } catch (err) {
      console.warn("[remembos] quick action failed", err);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      aria-label={label}
      title={download ? "Download" : "Copy text"}
      data-testid={download ? "recent-download" : "recent-copy"}
      className={cn(
        "absolute top-2 right-2 z-10 grid size-8 place-items-center rounded-full",
        "bg-white/90 text-zinc-700 shadow-soft ring-1 ring-zinc-900/10 backdrop-blur-sm",
        "transition-[background-color,color,transform] duration-150 ease-out hover:bg-white hover:text-zinc-950 active:scale-95",
        "dark:bg-ink-800/90 dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-ink-700 dark:hover:text-white",
        "[&_svg]:size-4",
      )}
    >
      {copied ? <Check aria-hidden /> : download ? <Download aria-hidden /> : <Copy aria-hidden />}
    </button>
  );
}

/** Card-shaped frame shared by the loading skeleton and the empty placeholders. */
function CardFrame({ dashed, media, children }: { dashed?: boolean; media: ReactNode; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl",
        dashed
          ? "border border-dashed border-zinc-300/80 bg-white/40 dark:border-white/15 dark:bg-white/[0.02]"
          : "border border-zinc-200/70 bg-white dark:border-white/10 dark:bg-white/[0.04]",
      )}
    >
      <div className="aspect-[4/3]">{media}</div>
      <div className="flex flex-1 flex-col gap-1 p-3">{children}</div>
    </div>
  );
}

function RecentSkeleton() {
  return (
    <ul className={STRIP_STATIC} aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className={CELL}>
          <CardFrame media={<div className="shimmer size-full bg-zinc-200/60 dark:bg-white/[0.06]" />}>
            <div className={cn(TITLE_BOX, "flex flex-col justify-center gap-1.5")}>
              <Skeleton className="h-3 w-4/5 rounded-full" />
              <Skeleton className="h-3 w-1/2 rounded-full" />
            </div>
            <div className={cn(META_ROW, "mt-auto")}>
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-2.5 w-16 rounded-full" />
            </div>
          </CardFrame>
        </li>
      ))}
    </ul>
  );
}

/** No memories yet: ghost cards where they will appear, plus a quiet way to try the samples. */
function EmptyRecent({ offerSamples }: { offerSamples: boolean }) {
  const [loading, setLoading] = useState(false);

  async function trySamples() {
    setLoading(true);
    try {
      await trySampleMemories();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative" data-testid="home-empty">
      <ul className={STRIP_STATIC} aria-hidden>
        {(["image", "pdf", "video", "voice"] as const).map((kind) => (
          <li key={kind} className={CELL}>
            <CardFrame
              dashed
              media={
                <div className="grid size-full place-items-center opacity-40 grayscale-[35%]">
                  <KindIcon kind={kind} size="md" />
                </div>
              }
            >
              <div className={cn(TITLE_BOX, "flex flex-col justify-center gap-1.5")}>
                <span className="h-2.5 w-3/4 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.06]" />
                <span className="h-2.5 w-1/2 rounded-full bg-zinc-900/[0.05] dark:bg-white/[0.06]" />
              </div>
              <div className={cn(META_ROW, "mt-auto")} />
            </CardFrame>
          </li>
        ))}
      </ul>
      <div className="absolute inset-0 grid place-items-center px-2 pb-3 sm:pb-0">
        <div className="glass max-w-sm rounded-2xl border border-zinc-200/80 px-5 py-4 text-center shadow-card dark:border-white/10">
          <p className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">Nothing here yet</p>
          <p className="mt-1 text-[13px] leading-snug text-muted">
            Your newest memories show up here the moment you add them.
          </p>
          {offerSamples ? (
            <Button
              size="sm"
              variant="soft"
              leftIcon={<Sparkles />}
              loading={loading}
              onClick={() => void trySamples()}
              data-testid="try-samples"
              className="mt-3"
            >
              {loading ? "Adding samples…" : "Try sample memories"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * "Recent memories": the 8 newest, live. New files appear the instant they are added — with a shimmer and
 * the current step from the processing queue ("Reading text in image… 42%") — then settle into a normal card.
 * Below it, a gentle "install as an app" tip once there is something worth keeping.
 */
export function RecentMemories() {
  const data = useLiveQuery(queryRecent, []);
  const jobs = useQueue();
  const { onboarded } = useSettings();
  const stripRef = useRef<HTMLUListElement>(null);
  const newestId = data?.items[0]?.id;

  // A new memory arrived at the front: show it. (Scroll snapping would otherwise keep the old card in view.)
  useEffect(() => {
    const strip = stripRef.current;
    if (newestId && strip && strip.scrollLeft > 0) strip.scrollTo({ left: 0 });
  }, [newestId]);

  const jobByItem = new Map<string, QueueJob>();
  // Newest first: keep the most recent job for an item (a retry replaces an older failed one).
  for (const job of jobs) if (!jobByItem.has(job.itemId)) jobByItem.set(job.itemId, job);

  const count = data?.count ?? 0;
  const empty = data !== undefined && !data.failed && count === 0;

  return (
    <section aria-labelledby="recent-title" data-testid="recent-memories">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="recent-title" className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
            Recent memories
          </h2>
          <p className="mt-1 truncate text-sm text-muted">
            {data === undefined ? (
              <span className="inline-block h-4" aria-hidden />
            ) : data.failed ? (
              "Your memories couldn't be read right now. Reload the page to try again."
            ) : empty ? (
              "Stored only on this device"
            ) : (
              `${count.toLocaleString()} ${count === 1 ? "memory" : "memories"} · stored only on this device`
            )}
          </p>
        </div>
        {count > 0 ? (
          <Button href={ROUTES.library} variant="ghost" size="sm" rightIcon={<ArrowRight />} data-testid="see-all" className="shrink-0">
            See all
          </Button>
        ) : null}
      </div>

      {data === undefined ? (
        <>
          <LoadingStatus label="Loading recent memories…" />
          <RecentSkeleton />
        </>
      ) : empty ? (
        // While the first-visit tip is showing, it already offers the samples.
        <EmptyRecent offerSamples={onboarded} />
      ) : (
        <ul ref={stripRef} className={STRIP}>
          {data.items.map((item) => (
            <li key={item.id} className={CELL}>
              <RecentCard item={item} progress={progressFor(item, jobByItem.get(item.id))} />
            </li>
          ))}
        </ul>
      )}

      <InstallTip hasMemories={count > 0} />
    </section>
  );
}
