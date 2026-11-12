/**
 * Small building blocks shared by the "Your data" panels, the Help page and the welcome tour:
 * a titled panel card, tinted icon chips, inline callouts and numbered steps. No hooks here, so
 * Server Components (the Help page) can use them too.
 */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export type ChipTone = "brand" | "emerald" | "amber" | "rose" | "sky" | "violet" | "neutral";

const CHIP_TONES: Record<ChipTone, string> = {
  brand: "bg-brand-500/10 text-brand-600 ring-brand-500/15 dark:bg-brand-400/15 dark:text-brand-300 dark:ring-brand-400/20",
  emerald: "bg-emerald-500/10 text-emerald-600 ring-emerald-500/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  amber: "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
  rose: "bg-rose-500/10 text-rose-600 ring-rose-500/15 dark:bg-rose-400/10 dark:text-rose-300 dark:ring-rose-400/20",
  sky: "bg-sky-500/10 text-sky-600 ring-sky-500/15 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20",
  violet: "bg-violet-500/10 text-violet-600 ring-violet-500/15 dark:bg-violet-400/15 dark:text-violet-300 dark:ring-violet-400/20",
  neutral: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/15 dark:bg-white/10 dark:text-zinc-300 dark:ring-white/10",
};

/** Rounded square with a tinted background holding a lucide icon. */
export function IconChip({ children, tone = "brand", size = "md", className }: { children: ReactNode; tone?: ChipTone; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center ring-1 ring-inset",
        size === "sm" ? "size-8 rounded-lg [&>svg]:size-4" : size === "md" ? "size-10 rounded-xl [&>svg]:size-5" : "size-12 rounded-2xl [&>svg]:size-6",
        CHIP_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface PanelProps {
  /** Anchor id (also used to label the section). */
  id: string;
  icon: ReactNode;
  tone?: ChipTone;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "default" | "danger";
  "data-testid"?: string;
}

/** A titled card section on the Data page (h2 + description + body). */
export function Panel({ id, icon, tone = "brand", title, description, actions, children, className, variant = "default", "data-testid": testId }: PanelProps) {
  return (
    <Card
      as="section"
      id={id}
      aria-labelledby={`${id}-title`}
      data-testid={testId}
      className={cn(variant === "danger" && "border-rose-300/70 dark:border-rose-400/25", className)}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <IconChip tone={tone}>{icon}</IconChip>
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm leading-relaxed text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </Card>
  );
}

const CALLOUT_TONES = {
  info: "border-sky-500/20 bg-sky-500/[0.06] text-sky-900 dark:border-sky-400/20 dark:bg-sky-400/[0.07] dark:text-sky-100 [&_[data-callout-icon]]:text-sky-600 dark:[&_[data-callout-icon]]:text-sky-300",
  warning:
    "border-amber-500/25 bg-amber-500/[0.07] text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/[0.07] dark:text-amber-100 [&_[data-callout-icon]]:text-amber-600 dark:[&_[data-callout-icon]]:text-amber-300",
  danger:
    "border-rose-500/25 bg-rose-500/[0.06] text-rose-950 dark:border-rose-400/20 dark:bg-rose-400/[0.07] dark:text-rose-100 [&_[data-callout-icon]]:text-rose-600 dark:[&_[data-callout-icon]]:text-rose-300",
  success:
    "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-400/20 dark:bg-emerald-400/[0.07] dark:text-emerald-100 [&_[data-callout-icon]]:text-emerald-600 dark:[&_[data-callout-icon]]:text-emerald-300",
  brand:
    "border-brand-500/20 bg-brand-500/[0.06] text-zinc-900 dark:border-brand-400/20 dark:bg-brand-400/[0.08] dark:text-zinc-100 [&_[data-callout-icon]]:text-brand-600 dark:[&_[data-callout-icon]]:text-brand-300",
} as const;

export interface CalloutProps {
  tone?: keyof typeof CALLOUT_TONES;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons under the text. */
  actions?: ReactNode;
  className?: string;
  role?: "status" | "alert" | "note";
  "data-testid"?: string;
}

/** Inline tinted message box (tips, warnings). */
export function Callout({ tone = "info", icon, title, children, actions, className, role, "data-testid": testId }: CalloutProps) {
  return (
    <div role={role} data-testid={testId} className={cn("flex gap-3 rounded-2xl border px-4 py-3.5", CALLOUT_TONES[tone], className)}>
      {icon ? (
        <span data-callout-icon aria-hidden className="mt-0.5 flex shrink-0 [&>svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : null, "opacity-90")}>{children}</div> : null}
        {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** Numbered step list used in how-to guides. */
export function StepList({ steps, className }: { steps: ReactNode[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-2.5", className)}>
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          <span
            aria-hidden
            className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-700 tabular-nums dark:bg-brand-400/15 dark:text-brand-200"
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Percentage label that never shows a misleading "0%" for a little data. */
export function percentLabel(ratio: number, hasData: boolean): string {
  const pct = ratio * 100;
  if (hasData && pct > 0 && pct < 1) return "<1%";
  if (pct >= 99.5 && ratio < 1) return "99%";
  return `${Math.round(pct)}%`;
}

/** Inline shimmering placeholder (a <span>, so it can sit inside text and paragraphs). */
export function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn("shimmer inline-block rounded-md bg-zinc-200/60 align-middle dark:bg-white/[0.06]", className)} />;
}
