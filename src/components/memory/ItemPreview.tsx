"use client";

import { Clapperboard, Download, ExternalLink, FileText, Maximize2, Mic, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";
import { Button, Card, Dialog, KindIcon, Skeleton } from "@/components/ui";
import { useFileUrl, useThumbnailUrl } from "@/lib/hooks";
import type { MemoryItem } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";
import { useMediaQuery, usePdfViewerEnabled } from "./hooks";
import { Waveform } from "./Waveform";

export interface ItemPreviewProps {
  item: MemoryItem;
  /** Download the stored original (shown where the preview offers it). */
  onDownload?: () => void;
}

/** Whether a memory has something to show above its text (an image, a PDF, a video or a recording). */
export function hasVisualPreview(item: MemoryItem): boolean {
  return item.kind === "image" || item.kind === "pdf" || item.kind === "video" || item.kind === "voice";
}

/** The original, shown the best way the browser can: zoomable image, inline PDF, video or audio player. */
export function ItemPreview({ item, onDownload }: ItemPreviewProps) {
  if (item.kind === "image") return <ImagePreview item={item} onDownload={onDownload} />;
  if (item.kind === "pdf") return <PdfPreview item={item} onDownload={onDownload} />;
  if (item.kind === "video") return <VideoPreview item={item} onDownload={onDownload} />;
  if (item.kind === "voice") return <AudioPreview item={item} />;
  return null;
}

function RemovedNote({ children }: { children: string }) {
  return <p className="border-t border-zinc-200/70 px-4 py-2.5 text-xs text-muted sm:px-5 dark:border-white/10">{children}</p>;
}

// ---------------------------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------------------------

function ImagePreview({ item, onDownload }: ItemPreviewProps) {
  const fileUrl = useFileUrl(item.id, item.hasFile);
  // The small preview is only needed when the original was removed to save space.
  const thumbUrl = useThumbnailUrl(item.id, item.hasFile ? 0 : item.hasThumb);
  const src = fileUrl ?? thumbUrl;
  const [open, setOpen] = useState(false);
  const waiting = !src && (item.hasFile || item.hasThumb);
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : undefined;

  return (
    <Card padding="none" radius="3xl" className="overflow-hidden" data-testid="item-preview">
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Zoom image"
          className="group relative block w-full cursor-zoom-in bg-zinc-100/80 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 dark:bg-black/30"
          data-testid="item-image"
        >
          {/* Local object URL of the user's own file; next/image optimisation does not apply to static exports. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`Image: ${item.title}`}
            decoding="async"
            draggable={false}
            className="mx-auto block max-h-[70vh] w-auto max-w-full animate-fade-in object-contain"
            style={ratio ? { aspectRatio: ratio } : undefined}
          />
          <span className="glass absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-700 opacity-0 shadow-card transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-zinc-200 [@media(hover:none)]:opacity-100">
            <Maximize2 aria-hidden className="size-3.5" />
            Zoom
          </span>
        </button>
      ) : waiting ? (
        <div aria-hidden className="shimmer aspect-video w-full bg-zinc-200/60 dark:bg-white/[0.06]" />
      ) : (
        <NoOriginal kindLabel="image" />
      )}
      {!item.hasFile && src ? <RemovedNote>The original was removed to save space — this is a small preview.</RemovedNote> : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={item.title}
        description="Click the image to switch between fit-to-screen and full size."
        size="full"
        mobileSheet={false}
        padded={false}
        data-testid="lightbox"
        footer={
          onDownload && item.hasFile ? (
            <Button variant="secondary" leftIcon={<Download />} onClick={onDownload}>
              Download original
            </Button>
          ) : undefined
        }
      >
        {src ? <Lightbox src={src} alt={`Image: ${item.title}`} /> : null}
      </Dialog>
    </Card>
  );
}

function Lightbox({ src, alt }: { src: string; alt: string }) {
  const [actual, setActual] = useState(false);
  return (
    <div className={cn("relative bg-zinc-950", actual ? "overflow-auto" : "grid place-items-center p-2 sm:p-4")}>
      <button
        type="button"
        onClick={() => setActual((v) => !v)}
        aria-label={actual ? "Fit to screen" : "Show full size"}
        className={cn("block outline-none", actual ? "cursor-zoom-out" : "cursor-zoom-in")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn("block", actual ? "max-w-none" : "max-h-[72dvh] w-auto max-w-full object-contain")}
        />
      </button>
      <span className="pointer-events-none absolute top-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
        {actual ? <ZoomOut aria-hidden className="size-3.5" /> : <ZoomIn aria-hidden className="size-3.5" />}
        {actual ? "Full size" : "Fit"}
      </span>
    </div>
  );
}

function NoOriginal({ kindLabel }: { kindLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-white/5 dark:text-zinc-500">
        <FileText aria-hidden className="size-6" />
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        The original {kindLabel} isn&apos;t stored any more (removed to save space). Its text is kept below and is still searchable.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------

function PdfPreview({ item, onDownload }: ItemPreviewProps) {
  const fileUrl = useFileUrl(item.id, item.hasFile);
  const thumbUrl = useThumbnailUrl(item.id, item.hasThumb);
  const viewerEnabled = usePdfViewerEnabled();
  const wide = useMediaQuery("(min-width: 768px)");
  const inline = Boolean(fileUrl && viewerEnabled && wide);

  if (inline && fileUrl) {
    return (
      <Card padding="none" radius="3xl" className="overflow-hidden" data-testid="item-preview">
        <iframe
          src={`${fileUrl}#view=FitH`}
          title={`PDF: ${item.title}`}
          className="block h-[78vh] max-h-[60rem] min-h-[28rem] w-full bg-zinc-100 dark:bg-zinc-900"
          data-testid="item-pdf"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 px-4 py-2.5 dark:border-white/10">
          <p className="text-xs text-muted">Shown by your browser&apos;s own PDF viewer — the file never leaves this device.</p>
          <Button href={fileUrl} external variant="ghost" size="sm" rightIcon={<ExternalLink />} data-testid="item-pdf-open">
            Open in new tab
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card padding="none" radius="3xl" className="overflow-hidden" data-testid="item-preview">
      <div className="flex flex-col items-center gap-5 bg-linear-to-br from-rose-50 via-orange-50/50 to-transparent px-5 py-7 sm:flex-row sm:items-center sm:px-7 dark:from-rose-500/10 dark:via-orange-500/5">
        <div className="relative w-36 shrink-0 rotate-[-2deg] overflow-hidden rounded-lg bg-white shadow-lift ring-1 ring-black/5 sm:w-40 dark:bg-zinc-100">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt={`First page of ${item.title}`} decoding="async" className="block w-full" />
          ) : item.hasThumb ? (
            <div aria-hidden className="shimmer aspect-[3/4] w-full bg-zinc-200/60" />
          ) : (
            <div className="grid aspect-[3/4] place-items-center">
              <KindIcon kind="pdf" size="lg" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-base font-semibold text-zinc-900 dark:text-white">
            {item.pageCount ? `${item.pageCount} ${item.pageCount === 1 ? "page" : "pages"}` : "PDF document"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {!item.hasFile
              ? "The original PDF was removed to save space. Its text is kept below and is still searchable."
              : fileUrl
                ? "Open it in your browser's PDF viewer to read every page. It stays on this device."
                : "Getting the PDF ready…"}
          </p>
          {item.hasFile ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              {fileUrl ? (
                <Button href={fileUrl} external leftIcon={<ExternalLink />} data-testid="item-pdf-open">
                  Open PDF
                </Button>
              ) : (
                <Button loading>Open PDF</Button>
              )}
              {onDownload ? (
                <Button variant="secondary" leftIcon={<Download />} onClick={onDownload}>
                  Download
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------------------------

function VideoPreview({ item, onDownload }: ItemPreviewProps) {
  const fileUrl = useFileUrl(item.id, item.hasFile);
  const posterUrl = useThumbnailUrl(item.id, item.hasThumb);
  const [unplayable, setUnplayable] = useState(false);
  // Reserve the video's own shape before anything loads, so the page never jumps.
  const ratio = item.width && item.height ? `${item.width} / ${item.height}` : "16 / 9";
  const box = "mx-auto block max-h-[70vh] w-full bg-black";

  return (
    <Card padding="none" radius="3xl" className="overflow-hidden" data-testid="item-preview">
      <div className="relative bg-black">
        {fileUrl && !unplayable ? (
          <video
            key={fileUrl}
            src={fileUrl}
            poster={posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            onError={() => setUnplayable(true)}
            className={cn(box, "animate-fade-in object-contain")}
            style={{ aspectRatio: ratio }}
            data-testid="item-video"
          >
            Your browser can&apos;t play this video here — use Open original or Download to watch it.
          </video>
        ) : posterUrl ? (
          <div className={cn(box, "relative")} style={{ aspectRatio: ratio }}>
            {/* Local object URL of the stored poster frame; next/image optimisation does not apply to static exports. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={posterUrl} alt={`Poster frame of ${item.title}`} decoding="async" className="size-full animate-fade-in object-contain" />
          </div>
        ) : item.hasFile && !unplayable ? (
          <div aria-hidden className={cn(box, "shimmer")} style={{ aspectRatio: ratio }} />
        ) : (
          <div className={cn(box, "grid place-items-center bg-linear-to-br from-blue-600 via-indigo-700 to-slate-900")} style={{ aspectRatio: ratio }}>
            <Clapperboard aria-hidden className="size-10 text-white/70" />
          </div>
        )}
        {item.durationSec && (!fileUrl || unplayable) ? (
          <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(item.durationSec)}
          </span>
        ) : null}
      </div>
      {unplayable ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 px-4 py-2.5 sm:px-5 dark:border-white/10" role="status">
          <p className="text-xs text-muted">This browser can&apos;t play this video format here. Open the original or download it to watch.</p>
          {onDownload ? (
            <Button variant="ghost" size="sm" leftIcon={<Download />} onClick={onDownload}>
              Download
            </Button>
          ) : null}
        </div>
      ) : !item.hasFile ? (
        <RemovedNote>The original video was removed to save space. Its transcript and on-screen text are kept below.</RemovedNote>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------------------------

function isPlayable(item: MemoryItem): boolean {
  if (item.sourceName && /\.(vtt|srt)$/i.test(item.sourceName)) return false;
  return !item.mimeType || /^(audio|video)\//i.test(item.mimeType);
}

function AudioPreview({ item }: ItemPreviewProps) {
  const playable = isPlayable(item);
  const fileUrl = useFileUrl(item.id, playable ? item.hasFile : 0);
  const thumbUrl = useThumbnailUrl(item.id, item.hasThumb);

  return (
    <Card padding="none" radius="3xl" className="overflow-hidden" data-testid="item-preview">
      <div className="relative h-36 overflow-hidden bg-linear-to-br from-amber-100 via-yellow-50 to-orange-100 sm:h-44 dark:from-amber-500/20 dark:via-yellow-500/10 dark:to-orange-500/15">
        <div aria-hidden className="absolute -top-12 -right-10 size-48 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-400/20" />
        <div className="absolute inset-x-6 top-1/2 h-1/2 -translate-y-1/2 sm:inset-x-10">
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl} alt="" decoding="async" className="h-full w-full object-fill opacity-90" />
          ) : (
            <Waveform seed={item.id} bars={64} />
          )}
        </div>
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-xs font-medium text-amber-800 shadow-soft dark:bg-white/10 dark:text-amber-200">
          <Mic aria-hidden className="size-3.5" />
          {playable ? "Recording" : "Transcript file"}
        </span>
        {item.durationSec ? (
          <span className="absolute top-3 right-3 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(item.durationSec)}
          </span>
        ) : null}
      </div>
      <div className="p-4 sm:px-5">
        {!playable ? (
          <p className="text-sm text-muted">This memory came from a subtitle / transcript file, so there&apos;s no audio to play — its words are below.</p>
        ) : fileUrl ? (
          <audio controls preload="metadata" src={fileUrl} className="w-full" data-testid="item-audio">
            Your browser can&apos;t play this recording here — download it to listen.
          </audio>
        ) : item.hasFile ? (
          <Skeleton className="h-12 w-full rounded-full" />
        ) : (
          <p className="text-sm text-muted">The original recording was removed to save space. The transcript is kept below.</p>
        )}
      </div>
    </Card>
  );
}
