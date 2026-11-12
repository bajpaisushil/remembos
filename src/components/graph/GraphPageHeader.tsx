"use client";
/**
 * Intro for the graph page, with a "How to explore" popover listing the gestures and shortcuts.
 * Same typography as PageHeader, but tighter on phones (no description or tips button there —
 * the graph's legend carries the tips) so the graph gets the room.
 */
import { Hand, Keyboard, MousePointerClick, Move, Search, Waypoints, ZoomIn, type LucideIcon } from "lucide-react";
import { Accent, Kbd, Popover } from "@/components/ui";

const TIPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: MousePointerClick, title: "Click a dot", text: "See what it is, what it mentions and open the memory." },
  { icon: Move, title: "Drag to explore", text: "Drag the background to move around. Drag dots to untangle them." },
  { icon: ZoomIn, title: "Zoom", text: "Scroll, pinch, or double-click a dot to zoom in on it." },
  { icon: Search, title: "Find anything", text: "Type a name, number or title in “Find in graph” to fly to it." },
];

export function GraphPageHeader() {
  return (
    <header className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-end sm:justify-between sm:pb-7">
      <div className="min-w-0">
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300 [&_svg]:size-3.5">
          <Waypoints aria-hidden /> Knowledge graph
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
          See how your memories <Accent>connect</Accent>
        </h1>
        <p className="mt-2.5 hidden max-w-2xl text-base leading-relaxed text-muted sm:block sm:text-[17px]">
          Every dot is a memory or something it mentions. Lines show what they share.
        </p>
      </div>
      <div className="hidden shrink-0 sm:block">
        <Popover
          trigger={
            <>
              <Hand aria-hidden />
              How to explore
            </>
          }
          label="How to explore the graph"
          align="end"
          variant="secondary"
          size="md"
          className="w-[22rem]"
          data-testid="graph-tips"
        >
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">How to explore</p>
          <ul className="mt-3 space-y-3">
            {TIPS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
                  <span className="block text-[13px] leading-snug text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-200/70 pt-3 text-xs text-muted dark:border-white/10">
            <Keyboard aria-hidden className="size-4" />
            <span className="inline-flex items-center gap-1">
              <Kbd>+</Kbd>
              <Kbd>−</Kbd> zoom
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>0</Kbd> fit
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>esc</Kbd> clear
            </span>
          </div>
        </Popover>
      </div>
    </header>
  );
}
