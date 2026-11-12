import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatTone = "brand" | "violet" | "rose" | "amber" | "sky" | "emerald" | "neutral";

const TONE: Record<StatTone, string> = {
  brand: "bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300",
  violet: "bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  rose: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
  amber: "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  sky: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
  neutral: "bg-zinc-500/10 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
};

export interface StatTileProps {
  label: ReactNode;
  /** The big number/text (formatted already, e.g. formatBytes(…)). */
  value: ReactNode;
  /** Small line under the value. */
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  /** Extra content at the bottom (e.g. a <Progress />). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** Compact metric card: icon chip, label, big value, hint. */
export function StatTile({ label, value, hint, icon, tone = "brand", children, className, "data-testid": testId }: StatTileProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "relative flex min-w-0 flex-col gap-1 rounded-2xl border border-zinc-200/70 bg-white p-4 shadow-soft sm:p-5",
        "dark:border-white/10 dark:bg-white/[0.04]",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon ? <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&>svg]:size-4", TONE[tone])}>{icon}</span> : null}
        <span className="min-w-0 truncate text-[13px] font-medium text-muted">{label}</span>
      </div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-white">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
