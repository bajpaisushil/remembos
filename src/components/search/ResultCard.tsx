"use client";

import { ArrowUpRight, Play, Sparkles, TextSearch } from "lucide-react";
import Link from "next/link";
import { memo, type MouseEvent } from "react";
import { useSeen } from "@/components/memory/hooks";
import { Badge, ENTITY_ICONS, KindBadge, KindIcon, Skeleton, SkeletonText } from "@/components/ui";
import { useThumbnailUrl } from "@/lib/hooks";
import type { EntityType, SearchHit } from "@/lib/types";
import { cn, formatDuration, timeAgo } from "@/lib/utils";
import { HAS_ENTITY_LABEL, memoryHref, termRanges } from "./format";
import { Highlight } from "./Highlight";

export interface ResultCardProps {
  hit: SearchHit;
  /** The question (carried to the memory page for in-memory highlighting). */
  query: string;
  /** Query words used to highlight the title. */
  words: readonly string[];
  /** First entity type the question asked for (labels the "has phone number" badge). */
  intent?: EntityType;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

const CARD =
  "group relative flex gap-3.5 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-soft outline-none sm:gap-4 sm:rounded-3xl sm:p-5 " +
  "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift " +
  "focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-500/15 focus-visible:outline-none " +
  "dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20 dark:focus-visible:border-brand-400/70 dark:focus-visible:ring-brand-400/20";

/** One memory in the search results: preview, title, highlighted snippets, why it matched. */
export const ResultCard = memo(function ResultCard({ hit, query, words, intent, onOpen }: ResultCardProps) {
  const { item, snippets, matched } = hit;
  const when = item.sourceDate ?? item.createdAt;
  const titleRanges = termRanges(item.title, words);
  const pages = Array.from(new Set(snippets.map((s) => s.page).filter((p): p is number => typeof p === "number")));
  const EntityIcon = intent ? ENTITY_ICONS[intent] : null;

  return (
    <Link
      href={memoryHref(item.id, query)}
      onClick={onOpen}
      className={CARD}
      data-testid="search-result"
      data-result-link=""
      data-item-id={item.id}
    >
      <ResultThumb itemId={item.id} kind={item.kind} hasThumb={item.hasThumb} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold tracking-tight text-zinc-900 sm:text-base dark:text-white">
            <Highlight text={item.title || "Untitled memory"} ranges={titleRanges} className="line-clamp-2" />
          </h3>
          <ArrowUpRight
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-zinc-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand-500 group-focus-visible:text-brand-500 dark:text-zinc-600 dark:group-hover:text-brand-300"
          />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
          <KindBadge kind={item.kind} size="sm" />
          <time dateTime={new Date(when).toISOString()} title={new Date(when).toLocaleString()}>
            {timeAgo(when)}
          </time>
          {pages.length ? (
            <span className="tabular-nums">
              · {pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(", ")}`}
              {item.pageCount ? ` of ${item.pageCount}` : ""}
            </span>
          ) : null}
          {(item.kind === "voice" || item.kind === "video") && item.durationSec ? (
            <span className="tabular-nums">· {formatDuration(item.durationSec)}</span>
          ) : null}
          {item.status === "processing" ? (
            <Badge tone="info" size="sm" dot pulse>
              Still reading
            </Badge>
          ) : null}
          <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {matched.includes("entity") && intent && EntityIcon ? (
              <Badge tone="success" size="sm" icon={<EntityIcon aria-hidden />} data-testid="match-entity">
                {HAS_ENTITY_LABEL[intent]}
              </Badge>
            ) : null}
            {matched.includes("keyword") ? (
              <Badge tone="neutral" size="sm" icon={<TextSearch aria-hidden />} data-testid="match-keyword">
                Exact words
              </Badge>
            ) : null}
            {matched.includes("semantic") ? (
              <Badge tone="brand" size="sm" icon={<Sparkles aria-hidden />} data-testid="match-semantic">
                Similar meaning
              </Badge>
            ) : null}
          </span>
        </div>

        {snippets.length ? (
          <div className="mt-2.5 space-y-1.5">
            {snippets.map((s) => (
              <p
                key={s.chunkId}
                className={cn(
                  "text-[13.5px] leading-relaxed break-words text-zinc-600 sm:text-sm dark:text-zinc-300",
                  snippets.length > 1 ? "line-clamp-2" : "line-clamp-3",
                )}
              >
                {s.page !== undefined && pages.length > 1 ? (
                  <span className="mr-1.5 rounded-md bg-zinc-100 px-1.5 py-px text-[11px] font-medium text-zinc-500 tabular-nums dark:bg-white/[0.07] dark:text-zinc-400">
                    p.{s.page}
                  </span>
                ) : null}
                <Highlight text={s.text} ranges={s.highlights} />
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
});

function ResultThumb({ itemId, kind, hasThumb }: { itemId: string; kind: SearchHit["item"]["kind"]; hasThumb: 0 | 1 }) {
  // Read the thumbnail only once the result is about to scroll into view.
  const [ref, seen] = useSeen<HTMLDivElement>();
  const url = useThumbnailUrl(seen ? itemId : undefined, hasThumb);
  if (!hasThumb) {
    return (
      <div className="hidden shrink-0 pt-0.5 min-[400px]:block">
        <KindIcon kind={kind} size="lg" />
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-900/5 ring-inset sm:size-16 dark:bg-white/[0.06] dark:ring-white/10"
    >
      {url ? (
        // Object URLs from IndexedDB can't go through next/image (static export, no optimisation).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover animate-fade-in" />
      ) : (
        <div className="grid size-full place-items-center">
          <KindIcon kind={kind} size="sm" />
        </div>
      )}
      {url && kind === "video" ? (
        <span aria-hidden className="absolute inset-0 grid place-items-center bg-black/15">
          <span className="grid size-6 place-items-center rounded-full bg-white/90 text-blue-600 shadow-card dark:bg-ink-800/85 dark:text-blue-200">
            <Play className="ml-px size-3 fill-current" />
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** Placeholder shaped like a result card. */
export function ResultCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex gap-4 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-soft sm:rounded-3xl sm:p-5 dark:border-white/10 dark:bg-white/[0.04]"
    >
      <Skeleton className="hidden size-11 shrink-0 rounded-[14px] min-[400px]:block" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-2/3 rounded-full" />
        <div className="mt-2.5 flex gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <SkeletonText lines={2} className="mt-3.5" />
      </div>
    </div>
  );
}
