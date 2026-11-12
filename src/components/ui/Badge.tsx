import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: "sm" | "md";
  /** Leading icon (lucide element). */
  icon?: ReactNode;
  /** Leading colored dot; `pulse` animates it (e.g. "Processing"). */
  dot?: boolean;
  pulse?: boolean;
}

const TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: {
    chip: "bg-zinc-100 text-zinc-700 ring-zinc-200/80 dark:bg-white/[0.07] dark:text-zinc-300 dark:ring-white/10",
    dot: "bg-zinc-400 text-zinc-400",
  },
  brand: {
    chip: "bg-brand-500/10 text-brand-700 ring-brand-500/20 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/25",
    dot: "bg-brand-500 text-brand-500",
  },
  success: {
    chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    dot: "bg-emerald-500 text-emerald-500",
  },
  warning: {
    chip: "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
    dot: "bg-amber-500 text-amber-500",
  },
  danger: {
    chip: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/20",
    dot: "bg-rose-500 text-rose-500",
  },
  info: {
    chip: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20",
    dot: "bg-sky-500 text-sky-500",
  },
};

/** Small status/label pill. */
export function Badge({ tone = "neutral", size = "md", icon, dot, pulse, className, children, ...rest }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "h-5 px-1.5 text-[11px] [&_svg]:size-3" : "h-6 px-2 text-xs [&_svg]:size-3.5",
        t.chip,
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", t.dot, pulse && "animate-pulse-dot")} /> : null}
      {icon}
      {children}
    </span>
  );
}
