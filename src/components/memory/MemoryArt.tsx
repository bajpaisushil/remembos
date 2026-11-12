"use client";

import { Play, Quote } from "lucide-react";
import { KindIcon } from "@/components/ui";
import { useThumbnailUrl } from "@/lib/hooks";
import { cn, formatDuration, truncate } from "@/lib/utils";
import { useSeen } from "./hooks";
import type { CardItem } from "./memory-data";
import { Waveform } from "./Waveform";

export interface MemoryArtProps {
  item: CardItem;
  /** "card" fills a 16:10 preview area; "thumb" is a small square for list rows. */
  variant?: "card" | "thumb";
  className?: string;
}

/** Excerpt for previews: the summary, or nothing while processing. */
function excerpt(item: CardItem, max: number): string {
  return truncate((item.summary || "").replace(/\s+/g, " ").trim(), max);
}

/**
 * The visual preview of a memory, designed per kind: screenshots and PDFs show their thumbnail
 * (or a faux screen / paper page with the text when there is none), videos show their poster frame
 * with a play badge, notes look like sticky notes, voice memories show a waveform, copied text reads
 * like a quote. Thumbnails are read from IndexedDB only once the card nears the viewport.
 */
export function MemoryArt({ item, variant = "card", className }: MemoryArtProps) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const thumbUrl = useThumbnailUrl(seen ? item.id : undefined, item.hasThumb);
  if (variant === "thumb") return <ThumbArt ref={ref} item={item} thumbUrl={thumbUrl} className={className} />;

  return (
    <div ref={ref} className={cn("relative h-full w-full overflow-hidden", className)}>
      {item.kind === "image" ? <ImageArt item={item} thumbUrl={thumbUrl} /> : null}
      {item.kind === "pdf" ? <PdfArt item={item} thumbUrl={thumbUrl} /> : null}
      {item.kind === "video" ? <VideoArt item={item} thumbUrl={thumbUrl} /> : null}
      {item.kind === "voice" ? <VoiceArt item={item} thumbUrl={thumbUrl} /> : null}
      {item.kind === "text" ? <TextArt item={item} /> : null}
      {item.kind === "note" ? <NoteArt item={item} /> : null}
    </div>
  );
}

/** True when the card art already shows the memory's words (so the card body needn't repeat them). */
export function artShowsText(item: CardItem): boolean {
  if (item.kind === "note" || item.kind === "text") return true;
  if (item.kind === "image" || item.kind === "pdf") return !item.hasThumb && Boolean(item.summary);
  return false;
}

function Photo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    // Local object URL of a small stored preview; next/image optimisation does not apply to static exports.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("h-full w-full animate-fade-in object-cover", className)}
    />
  );
}

function ShadeOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/35 via-black/0 to-black/5 dark:from-black/50"
    />
  );
}

function ImageArt({ item, thumbUrl }: { item: CardItem; thumbUrl: string | null }) {
  if (thumbUrl) {
    return (
      <>
        <Photo src={thumbUrl} alt="" />
        <ShadeOverlay />
      </>
    );
  }
  const text = excerpt(item, 220);
  return (
    <div className="absolute inset-0 bg-linear-to-br from-violet-100 via-fuchsia-50 to-indigo-100 dark:from-violet-500/20 dark:via-fuchsia-500/10 dark:to-indigo-500/20">
      <div className="absolute inset-x-5 top-5 bottom-0 overflow-hidden rounded-t-xl border border-b-0 border-white/80 bg-white/85 shadow-card dark:border-white/10 dark:bg-ink-800/90">
        <div className="flex items-center gap-1.5 border-b border-zinc-200/70 px-3 py-2 dark:border-white/10">
          <span className="size-2 rounded-full bg-rose-400/80" />
          <span className="size-2 rounded-full bg-amber-400/80" />
          <span className="size-2 rounded-full bg-emerald-400/80" />
        </div>
        {text ? (
          <p className="line-clamp-5 px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-zinc-600 dark:text-zinc-300">{text}</p>
        ) : (
          <div className="grid h-[calc(100%-2rem)] place-items-center">
            <KindIcon kind="image" size="lg" />
          </div>
        )}
      </div>
    </div>
  );
}

function PdfArt({ item, thumbUrl }: { item: CardItem; thumbUrl: string | null }) {
  const text = excerpt(item, 260);
  return (
    <div className="absolute inset-0 bg-linear-to-br from-rose-100 via-orange-50 to-rose-50 dark:from-rose-500/20 dark:via-orange-500/10 dark:to-rose-500/10">
      <div className="absolute inset-x-[16%] top-4 -bottom-3 rotate-[-1.5deg] overflow-hidden rounded-t-lg bg-white shadow-lift ring-1 ring-black/5 transition-transform duration-300 ease-out group-hover/card:rotate-0 dark:bg-zinc-100">
        {thumbUrl ? (
          <Photo src={thumbUrl} alt="" className="object-top" />
        ) : (
          <div className="px-4 pt-4">
            <div className="mb-2 h-2 w-2/3 rounded-full bg-zinc-800/80" />
            {text ? (
              <p className="line-clamp-6 text-[9.5px] leading-[1.6] text-zinc-500">{text}</p>
            ) : (
              <div className="space-y-1.5">
                {[100, 92, 96, 70, 88, 60].map((w, i) => (
                  <div key={i} className="h-1.5 rounded-full bg-zinc-200" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
          </div>
        )}
        <span
          aria-hidden
          className="absolute top-0 right-0 size-5 bg-linear-to-bl from-rose-200 to-white shadow-[-1px_1px_2px_rgb(0_0_0/0.08)] [clip-path:polygon(0_0,100%_100%,0_100%)]"
        />
      </div>
    </div>
  );
}

/** Round "play" badge laid over video previews. */
function PlayBadge({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid place-items-center rounded-full bg-white/90 text-blue-600 shadow-lift ring-1 ring-black/5",
        "transition-transform duration-200 ease-out group-hover/card:scale-110 motion-reduce:transition-none",
        "dark:bg-ink-800/85 dark:text-blue-200 dark:ring-white/15",
        size === "sm" ? "size-6" : "size-12",
        className,
      )}
    >
      <Play className={cn("fill-current", size === "sm" ? "ml-px size-3" : "ml-0.5 size-5")} />
    </span>
  );
}

/** Sprocket holes along a film strip edge. */
function FilmEdge({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("absolute inset-x-0 flex justify-between gap-2 px-3", className)}>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} className="h-2 w-3 shrink-0 rounded-[2px] bg-white/15" />
      ))}
    </div>
  );
}

function VideoArt({ item, thumbUrl }: { item: CardItem; thumbUrl: string | null }) {
  if (thumbUrl) {
    return (
      <div className="absolute inset-0 bg-zinc-900">
        <Photo src={thumbUrl} alt="" />
        <ShadeOverlay />
        <div className="absolute inset-0 grid place-items-center">
          <PlayBadge />
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-linear-to-br from-blue-600 via-indigo-700 to-slate-900 dark:from-blue-500/40 dark:via-indigo-600/30 dark:to-slate-950/60">
      <div aria-hidden className="absolute -top-12 -left-10 size-44 rounded-full bg-sky-300/25 blur-2xl" />
      <FilmEdge className="top-2" />
      <FilmEdge className="bottom-2" />
      <div className="absolute inset-x-0 top-6 bottom-6 grid place-items-center border-y border-white/10 bg-black/15">
        {item.status === "processing" ? null : <PlayBadge />}
      </div>
    </div>
  );
}

function VoiceArt({ item, thumbUrl }: { item: CardItem; thumbUrl: string | null }) {
  return (
    <div className="absolute inset-0 bg-linear-to-br from-amber-100 via-yellow-50 to-orange-100 dark:from-amber-500/20 dark:via-yellow-500/10 dark:to-orange-500/15">
      <div aria-hidden className="absolute -top-10 -right-8 size-36 rounded-full bg-amber-300/30 blur-2xl dark:bg-amber-400/20" />
      <div className="absolute inset-x-5 top-1/2 h-[46%] -translate-y-1/2">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-fill opacity-90" />
        ) : (
          <Waveform seed={item.id} bars={44} />
        )}
      </div>
      <span className="absolute bottom-3 left-3 grid size-9 place-items-center rounded-full bg-white/90 text-amber-600 shadow-card ring-1 ring-amber-500/20 transition-transform duration-200 group-hover/card:scale-105 dark:bg-white/15 dark:text-amber-200">
        <Play aria-hidden className="ml-0.5 size-4 fill-current" />
      </span>
    </div>
  );
}

function TextArt({ item }: { item: CardItem }) {
  const text = excerpt(item, 240);
  return (
    <div className="absolute inset-0 bg-linear-to-br from-sky-50 via-white to-cyan-50 dark:from-sky-500/15 dark:via-transparent dark:to-cyan-500/10">
      <Quote aria-hidden className="absolute top-3 left-3 size-9 -scale-x-100 fill-sky-400/25 text-sky-400/40 dark:fill-sky-300/20 dark:text-sky-300/30" />
      <div className="absolute inset-0 flex items-center px-6 pt-4 pb-3">
        {text ? (
          <p className="line-clamp-4 border-l-2 border-sky-400/60 pl-3 font-serif text-[17px] leading-snug text-zinc-700 dark:border-sky-300/50 dark:text-zinc-200">
            {text}
          </p>
        ) : (
          <div className="w-full space-y-2 border-l-2 border-sky-400/50 pl-3">
            <div className="h-2.5 w-11/12 rounded-full bg-sky-200/70 dark:bg-sky-300/20" />
            <div className="h-2.5 w-4/5 rounded-full bg-sky-200/70 dark:bg-sky-300/20" />
            <div className="h-2.5 w-2/3 rounded-full bg-sky-200/70 dark:bg-sky-300/20" />
          </div>
        )}
      </div>
      {item.sourceName ? (
        <span className="absolute right-3 bottom-3 max-w-[60%] truncate rounded-md bg-white/80 px-1.5 py-0.5 font-mono text-[10.5px] text-sky-700 ring-1 ring-sky-500/20 dark:bg-white/10 dark:text-sky-200">
          {item.sourceName}
        </span>
      ) : null}
    </div>
  );
}

function NoteArt({ item }: { item: CardItem }) {
  const text = excerpt(item, 220);
  return (
    <div className="absolute inset-0 bg-linear-to-br from-emerald-50 via-teal-50/60 to-lime-50 dark:from-emerald-500/15 dark:via-teal-500/5 dark:to-lime-500/10">
      <div className="absolute inset-x-6 top-5 -bottom-2 rotate-[1.2deg] rounded-md bg-linear-to-b from-[#fdfbe7] to-[#f7f3cf] px-4 pt-5 shadow-lift ring-1 ring-black/5 transition-transform duration-300 ease-out group-hover/card:rotate-0 dark:from-emerald-200/15 dark:to-emerald-200/10 dark:ring-white/10">
        <span
          aria-hidden
          className="absolute -top-2 left-1/2 h-4 w-16 -translate-x-1/2 -rotate-2 rounded-[3px] bg-emerald-300/50 backdrop-blur-[1px] dark:bg-emerald-300/30"
        />
        {text ? (
          <p className="line-clamp-5 text-[13px] leading-[1.6] text-zinc-700 dark:text-emerald-50/90">{text}</p>
        ) : (
          <div className="space-y-2 pt-1">
            <div className="h-2 w-11/12 rounded-full bg-zinc-800/10 dark:bg-white/15" />
            <div className="h-2 w-3/4 rounded-full bg-zinc-800/10 dark:bg-white/15" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Small square preview for list rows. */
function ThumbArt({
  ref,
  item,
  thumbUrl,
  className,
}: {
  ref: (el: HTMLDivElement | null) => void;
  item: CardItem;
  thumbUrl: string | null;
  className?: string;
}) {
  if (thumbUrl && (item.kind === "image" || item.kind === "pdf" || item.kind === "video")) {
    return (
      <div ref={ref} className={cn("relative overflow-hidden bg-zinc-100 dark:bg-white/5", className)}>
        <Photo src={thumbUrl} alt="" className={item.kind === "pdf" ? "object-top" : undefined} />
        {item.kind === "video" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/10">
            <PlayBadge size="sm" />
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div ref={ref} className={cn("grid place-items-center", className)}>
      <KindIcon kind={item.kind} size="md" />
    </div>
  );
}

/** Duration / page-count pill shown on top of card art. */
export function artMeta(item: CardItem): string | null {
  if ((item.kind === "voice" || item.kind === "video") && item.durationSec) return formatDuration(item.durationSec);
  if (item.kind === "pdf" && item.pageCount) return `${item.pageCount} ${item.pageCount === 1 ? "page" : "pages"}`;
  return null;
}
