"use client";

import { useId } from "react";
import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";

export interface LogoMarkProps {
  /** Pixel size. Default 32. */
  size?: number;
  className?: string;
  /** Accessible name; omit when the wordmark is shown next to it. */
  title?: string;
}

/** The Remembos mark: gradient rounded square with a recall loop and a spark. */
export function LogoMark({ size = 32, className, title }: LogoMarkProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const bg = `lm-bg-${uid}`;
  const shine = `lm-shine-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0", className)}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset=".55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <radialGradient id={shine} cx="18" cy="8" r="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".38" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect width="64" height="64" rx="16" fill={`url(#${shine})`} />
      <path d="M44.26 21.72A16 16 0 1 0 48 32" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="48.2" cy="22" r="3.4" fill="#fff" />
      <path
        d="M32 23C33.1 30.9 33.1 30.9 41 32C33.1 33.1 33.1 33.1 32 41C30.9 33.1 30.9 33.1 23 32C30.9 30.9 30.9 30.9 32 23Z"
        fill="#fff"
      />
    </svg>
  );
}

export interface LogoProps {
  /** Mark size in px. Default 30. */
  size?: number;
  /** Hide the wordmark below the `sm` breakpoint. */
  compact?: boolean;
  className?: string;
}

/** Mark + "Remembos" wordmark. */
export function Logo({ size = 30, compact = false, className }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} className="drop-shadow-[0_4px_12px_rgb(139_92_246/0.35)]" />
      <span
        className={cn(
          "text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-white",
          compact && "max-sm:sr-only",
        )}
      >
        {APP_NAME}
      </span>
    </span>
  );
}
