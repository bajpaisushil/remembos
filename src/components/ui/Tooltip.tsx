"use client";

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** Tooltip text (keep it short). */
  content: ReactNode;
  /** The trigger — ideally a single focusable element (button/link). */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Horizontal alignment for top/bottom tooltips (use "end" near the right edge). */
  align?: "start" | "center" | "end";
  /** Link the tooltip to the trigger via aria-describedby. Turn off when it repeats the aria-label. Default true. */
  describe?: boolean;
  className?: string;
}

const SIDE = {
  top: "bottom-full mb-2",
  bottom: "top-full mt-2",
  left: "right-full mr-2 top-1/2 -translate-y-1/2",
  right: "left-full ml-2 top-1/2 -translate-y-1/2",
} as const;

const ALIGN = {
  start: "left-0",
  center: "left-1/2 -translate-x-1/2",
  end: "right-0",
} as const;

/** Lightweight CSS tooltip: appears on hover (after a short delay) and on keyboard focus. Hidden on touch screens. */
export function Tooltip({ content, children, side = "top", align = "center", describe = true, className }: TooltipProps) {
  const id = useId();
  const trigger =
    describe && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": id })
      : children;
  const vertical = side === "top" || side === "bottom";
  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-64 rounded-lg px-2.5 py-1.5 text-xs leading-snug font-medium",
          "bg-zinc-900 text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900",
          "invisible opacity-0 transition-[opacity,visibility] duration-150",
          "group-hover/tooltip:visible group-hover/tooltip:opacity-100 group-hover/tooltip:delay-300",
          "group-has-[:focus-visible]/tooltip:visible group-has-[:focus-visible]/tooltip:opacity-100",
          "[@media(hover:none)]:hidden",
          SIDE[side],
          vertical && ALIGN[align],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
