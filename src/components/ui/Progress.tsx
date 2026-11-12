"use client";

import { useId, type ReactNode } from "react";
import { STORAGE_THRESHOLDS } from "@/lib/config";
import { cn } from "@/lib/utils";

/** brand = gradient · auto = brand → amber (≥70%) → red (≥90%), handy for storage meters. */
export type ProgressTone = "brand" | "success" | "warning" | "danger" | "neutral" | "auto";

function clamp01(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function resolveTone(tone: ProgressTone, value: number): Exclude<ProgressTone, "auto"> {
  if (tone !== "auto") return tone;
  if (value >= STORAGE_THRESHOLDS.critical) return "danger";
  if (value >= STORAGE_THRESHOLDS.warn) return "warning";
  return "brand";
}

const BAR_FILL: Record<Exclude<ProgressTone, "auto">, string> = {
  brand: "bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  neutral: "bg-zinc-500 dark:bg-zinc-400",
};

const BAR_HEIGHT = { xs: "h-1", sm: "h-1.5", md: "h-2", lg: "h-3" } as const;

export interface ProgressProps {
  /** 0..1 (fraction, like QueueJob.progress and StorageInfo.ratio). */
  value?: number;
  /** Unknown duration: shows a moving sweep. */
  indeterminate?: boolean;
  tone?: ProgressTone;
  size?: keyof typeof BAR_HEIGHT;
  /** Accessible label (e.g. "Storage used"). */
  label?: string;
  className?: string;
  "data-testid"?: string;
}

/** Horizontal progress bar. */
export function Progress({ value, indeterminate = false, tone = "brand", size = "md", label, className, "data-testid": testId }: ProgressProps) {
  const v = clamp01(value);
  const t = resolveTone(tone, v);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v * 100)}
      data-testid={testId}
      className={cn("relative w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-white/10", BAR_HEIGHT[size], className)}
    >
      {indeterminate ? (
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-1/3 rounded-full animate-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50",
            BAR_FILL[t],
          )}
        />
      ) : (
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out-soft", BAR_FILL[t])}
          style={{ width: `${v * 100}%`, minWidth: v > 0 ? "0.375rem" : undefined }}
        />
      )}
    </div>
  );
}

const RING_STROKE: Record<Exclude<ProgressTone, "auto" | "brand">, string> = {
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#f43f5e",
  neutral: "#71717a",
};

export interface ProgressRingProps {
  /** 0..1 */
  value?: number;
  indeterminate?: boolean;
  /** Diameter in px. Default 40. */
  size?: number;
  /** Stroke width in px. Default 4. */
  stroke?: number;
  tone?: ProgressTone;
  label?: string;
  /** Centered content (e.g. a percentage or icon). */
  children?: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** Circular progress. */
export function ProgressRing({
  value,
  indeterminate = false,
  size = 40,
  stroke = 4,
  tone = "brand",
  label,
  children,
  className,
  "data-testid": testId,
}: ProgressRingProps) {
  const gradientId = `ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const v = clamp01(value);
  const t = resolveTone(tone, v);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = indeterminate ? 0.28 : v;
  const strokeColor = t === "brand" ? `url(#${gradientId})` : RING_STROKE[t];

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(v * 100)}
      data-testid={testId}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("-rotate-90", indeterminate && "animate-spin motion-reduce:animate-none")}
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="55%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#d946ef" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-zinc-200 dark:stroke-white/10" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          style={{ transition: "stroke-dashoffset 500ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          opacity={shown > 0 ? 1 : 0}
        />
      </svg>
      {children ? <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold tabular-nums">{children}</span> : null}
    </span>
  );
}
