import { cn } from "@/lib/utils";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<SpinnerSize, number> = { xs: 12, sm: 16, md: 20, lg: 28 };

export interface SpinnerProps {
  /** Preset size or a pixel value. Default "sm" (16px). */
  size?: SpinnerSize | number;
  /** Screen-reader label. When set the spinner is announced as a status; otherwise it is decorative. */
  label?: string;
  className?: string;
}

/** Small circular loading indicator. Inherits `currentColor`. */
export function Spinner({ size = "sm", label, className }: SpinnerProps) {
  const px = typeof size === "number" ? size : SIZES[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0 animate-spin", className)}
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
