import { Container, LoadingStatus, Skeleton, SkeletonText } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Placeholder card shaped exactly like a grid MemoryCard (no layout shift when data arrives). */
export function MemoryCardSkeleton({ layout = "grid" }: { layout?: "grid" | "list" }) {
  if (layout === "list") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-zinc-200/70 bg-white p-2.5 pr-3 shadow-soft sm:gap-4 dark:border-white/10 dark:bg-white/[0.04]">
        <Skeleton className="size-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5 rounded-full" />
          <Skeleton className="h-3 w-3/4 rounded-full" />
        </div>
        <div className="hidden w-28 flex-col items-end gap-1.5 sm:flex">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3 w-14 rounded-full" />
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-3xl border border-zinc-200/70 bg-white shadow-card dark:border-white/10 dark:bg-white/[0.04]">
      <div aria-hidden className="shimmer aspect-[16/10] w-full bg-zinc-200/60 dark:bg-white/[0.06]" />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-3 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-4/5 rounded-full" />
        <SkeletonText lines={2} />
      </div>
    </div>
  );
}

export function MemoryGridSkeleton({ count = 6, layout = "grid" }: { count?: number; layout?: "grid" | "list" }) {
  return (
    <div
      aria-hidden
      className={cn(layout === "grid" ? "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3" : "flex flex-col gap-2")}
    >
      {Array.from({ length: count }, (_, i) => (
        <MemoryCardSkeleton key={i} layout={layout} />
      ))}
    </div>
  );
}

/** Library page placeholder (prerendered, shown until the browser reads the URL and the database). */
export function LibrarySkeleton() {
  return (
    <Container className="py-8 sm:py-12">
      <LoadingStatus label="Loading your library…" />
      <div className="pb-6 sm:pb-8">
        <Skeleton className="mb-3 h-3 w-20 rounded-full" />
        <Skeleton className="h-9 w-72 max-w-full rounded-2xl sm:h-10" />
        <Skeleton className="mt-3 h-4 w-64 max-w-full rounded-full" />
      </div>
      <div className="mb-6 space-y-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-2xl" />
        <Skeleton className="h-9 w-full rounded-xl" />
      </div>
      <MemoryGridSkeleton />
    </Container>
  );
}

/** Item page placeholder. */
export function ItemSkeleton() {
  return (
    <Container className="py-6 sm:py-10">
      <LoadingStatus label="Opening memory…" />
      <Skeleton className="mb-6 h-8 w-28 rounded-xl" />
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-3">
          <Skeleton className="h-4 w-40 rounded-full" />
          <Skeleton className="h-9 w-3/4 rounded-2xl" />
          <Skeleton className="h-4 w-1/2 rounded-full" />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-36 rounded-xl" />
        <Skeleton className="h-10 w-28 rounded-xl" />
        <Skeleton className="h-10 w-24 rounded-xl" />
      </div>
      <Skeleton className="mt-6 h-28 w-full rounded-3xl sm:h-24" />
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Skeleton className="h-72 w-full rounded-3xl" />
          <div className="rounded-3xl border border-zinc-200/70 bg-white p-6 dark:border-white/10 dark:bg-white/[0.04]">
            <SkeletonText lines={6} />
          </div>
        </div>
        <div className="space-y-6">
          <Skeleton className="h-48 w-full rounded-3xl" />
          <Skeleton className="h-32 w-full rounded-3xl" />
        </div>
      </div>
    </Container>
  );
}
