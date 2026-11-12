import { cn } from "@/lib/utils";

export interface SkeletonProps {
  /** Size/shape via classes, e.g. "h-4 w-32" or "size-10 rounded-full". */
  className?: string;
}

/** Shimmering placeholder block. Render while live queries return `undefined`. */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn("shimmer rounded-xl bg-zinc-200/60 dark:bg-white/[0.06]", className)} />;
}

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

/** A few lines of placeholder text with natural ragged widths. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-2/3", "w-3/4"];
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn("h-3 rounded-full", i === lines - 1 && lines > 1 ? "w-1/2" : widths[i % widths.length])} />
      ))}
    </div>
  );
}

/** Screen-reader-only "Loading…" status to pair with skeletons. */
export function LoadingStatus({ label = "Loading…" }: { label?: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}
