"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Count bubble (e.g. number of memories of that kind). */
  count?: number;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Accessible name for the group, e.g. "Filter by kind". */
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch segments to fill the width. */
  fullWidth?: boolean;
  className?: string;
  /** Adds data-testid="<prefix>" to the group and "<prefix>-<value>" to each option. */
  testIdPrefix?: string;
}

/** Pill tab switcher with optional counts (role="tablist"; arrow keys move + select). Scrolls sideways on narrow screens. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  size = "md",
  fullWidth,
  className,
  testIdPrefix,
}: SegmentedProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);

  function select(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[index];
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const enabled = options.map((o, i) => ({ o, i })).filter(({ o }) => !o.disabled);
    const current = enabled.findIndex(({ o }) => o.value === value);
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(current + 1) % enabled.length]?.i ?? null;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(current - 1 + enabled.length) % enabled.length]?.i ?? null;
    else if (e.key === "Home") next = enabled[0]?.i ?? null;
    else if (e.key === "End") next = enabled[enabled.length - 1]?.i ?? null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  }

  return (
    <div className={cn("max-w-full overflow-x-auto no-scrollbar", fullWidth ? "w-full" : "w-fit", className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        data-testid={testIdPrefix}
        className={cn(
          "inline-flex min-w-full items-center gap-0.5 rounded-2xl bg-zinc-100/90 p-1 ring-1 ring-inset ring-zinc-200/70",
          "dark:bg-white/[0.05] dark:ring-white/10",
        )}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              data-testid={testIdPrefix ? `${testIdPrefix}-${o.value}` : undefined}
              className={cn(
                "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap",
                "transition-[background-color,color,box-shadow] duration-150 ease-out disabled:opacity-40",
                "focus-visible:outline-offset-0 [&_svg]:size-4",
                size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3 text-sm",
                fullWidth && "flex-1",
                selected
                  ? "bg-white text-zinc-900 shadow-[0_1px_2px_rgb(20_20_43/0.08),0_2px_8px_-2px_rgb(20_20_43/0.08)] dark:bg-white/[0.14] dark:text-white dark:shadow-none"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
              )}
            >
              {o.icon}
              {o.label}
              {typeof o.count === "number" ? (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] tabular-nums",
                    selected
                      ? "bg-brand-500/10 text-brand-700 dark:bg-brand-400/20 dark:text-brand-200"
                      : "bg-zinc-200/70 text-zinc-500 dark:bg-white/10 dark:text-zinc-400",
                  )}
                >
                  {o.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
