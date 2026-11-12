"use client";
/**
 * Small floating pieces drawn over the graph canvas: the legend, the zoom controls, the
 * "showing connections of …" banner and the "updating" pill.
 */
import { Info, Maximize, Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { buttonClasses, Spinner, Tooltip } from "@/components/ui";
import { KIND_HEX, KIND_META } from "@/lib/config";
import type { MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const FLOATING =
  "border border-zinc-200/80 bg-white/90 shadow-card dark:border-white/10 dark:bg-ink-850/90";

export interface GraphLegendProps {
  kinds: MemoryKind[];
  hasSimilar: boolean;
  className?: string;
}

/** What the shapes, colors and lines mean. Collapsed by default on phones. */
export function GraphLegend({ kinds, hasSimilar, className }: GraphLegendProps) {
  // null = follow the screen size (open on desktop, closed on phones) until the person chooses.
  const [open, setOpen] = useState<boolean | null>(null);
  const panelVisibility = open === null ? "hidden md:block" : open ? "block" : "hidden";
  const buttonVisibility = open === null ? "inline-flex md:hidden" : open ? "hidden" : "inline-flex";

  return (
    <div className={cn("pointer-events-auto", className)} data-testid="graph-legend">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={cn(
          "h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-zinc-700 dark:text-zinc-200",
          FLOATING,
          buttonVisibility,
        )}
      >
        <Info aria-hidden className="size-4 text-zinc-400" />
        Legend
      </button>
      <div className={cn("w-56 rounded-2xl p-3 text-xs animate-fade-in", FLOATING, panelVisibility)}>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-semibold text-zinc-800 dark:text-zinc-100">How to read it</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Hide legend"
            aria-expanded
            className="-mr-1 grid size-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-900/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-300">
          <li className="flex items-center gap-2">
            <span aria-hidden className="flex -space-x-1">
              {(kinds.length ? kinds : (["note"] as MemoryKind[])).map((k) => (
                <span key={k} className="size-3 rounded-full ring-2 ring-white dark:ring-ink-850" style={{ backgroundColor: KIND_HEX[k] }} />
              ))}
            </span>
            <span>
              Memories <span className="text-muted">— bigger = more connected</span>
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="ml-0.5 size-2.5 rounded-[3px] bg-zinc-400 dark:bg-zinc-500" />
            <span>Names, numbers, links, tags…</span>
          </li>
          <li className="flex items-center gap-2">
            <svg aria-hidden width="20" height="6" className="text-zinc-400">
              <line x1="1" y1="3" x2="19" y2="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Mentions</span>
          </li>
          {hasSimilar ? (
            <li className="flex items-center gap-2">
              <svg aria-hidden width="20" height="6" className="text-violet-500 dark:text-violet-300">
                <line x1="1" y1="3" x2="19" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" strokeLinecap="round" />
              </svg>
              <span>Similar memories</span>
            </li>
          ) : null}
        </ul>
        <p className="mt-2.5 border-t border-zinc-200/70 pt-2.5 text-[11px] leading-snug text-muted sm:hidden dark:border-white/10">
          Tap a dot for details. Pinch or double-tap to zoom, drag to move around.
        </p>
        {kinds.length > 1 ? (
          <ul className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 border-t border-zinc-200/70 pt-2.5 dark:border-white/10">
            {kinds.map((k) => (
              <li key={k} className="inline-flex items-center gap-1 text-[11px] text-muted">
                <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: KIND_HEX[k] }} />
                {KIND_META[k].label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export interface GraphZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  className?: string;
}

export function GraphZoomControls({ onZoomIn, onZoomOut, onFit, className }: GraphZoomControlsProps) {
  const btn =
    "grid size-9 place-items-center text-zinc-600 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";
  return (
    <div className={cn("pointer-events-auto flex flex-col items-end gap-2", className)}>
      <div role="group" aria-label="Zoom" className={cn("flex flex-col overflow-hidden rounded-xl", FLOATING)}>
        <Tooltip content="Zoom in (+)" side="left" describe={false}>
          <button type="button" className={btn} onClick={onZoomIn} aria-label="Zoom in" aria-keyshortcuts="+" data-testid="graph-zoom-in">
            <Plus aria-hidden />
          </button>
        </Tooltip>
        <span aria-hidden className="mx-2 h-px bg-zinc-200/80 dark:bg-white/10" />
        <Tooltip content="Zoom out (−)" side="left" describe={false}>
          <button type="button" className={btn} onClick={onZoomOut} aria-label="Zoom out" aria-keyshortcuts="-" data-testid="graph-zoom-out">
            <Minus aria-hidden />
          </button>
        </Tooltip>
      </div>
      <Tooltip content="Fit to screen (0)" side="left" describe={false}>
        <button
          type="button"
          className={cn(btn, "rounded-xl", FLOATING)}
          onClick={onFit}
          aria-label="Fit to screen"
          aria-keyshortcuts="0"
          data-testid="graph-fit"
        >
          <Maximize aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

export interface GraphFocusBannerProps {
  label: string;
  onShowAll: () => void;
  className?: string;
}

/** "Showing what's connected to …" with a way back to the full graph. */
export function GraphFocusBanner({ label, onShowAll, className }: GraphFocusBannerProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex max-w-full items-center gap-2 rounded-full py-1 pr-1 pl-3.5 text-[13px] animate-slide-up",
        FLOATING,
        className,
      )}
      data-testid="graph-focus-banner"
    >
      <span className="min-w-0 truncate text-zinc-600 dark:text-zinc-300">
        Connections of <span className="font-semibold text-zinc-900 dark:text-white">{label}</span>
      </span>
      <button
        type="button"
        onClick={onShowAll}
        className={buttonClasses({ variant: "soft", size: "none", className: "h-8 shrink-0 rounded-full px-3 text-[13px]" })}
        data-testid="graph-show-all"
      >
        Show everything
      </button>
    </div>
  );
}

export function GraphUpdatingPill({ className }: { className?: string }) {
  return (
    <div
      role="status"
      className={cn("pointer-events-none inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-medium text-muted animate-fade-in", FLOATING, className)}
      data-testid="graph-updating"
    >
      <Spinner size="xs" className="text-brand-500" />
      Updating…
    </div>
  );
}
