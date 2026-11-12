/**
 * The storage explorer's static parts — the page intro and the loading skeleton — rendered on the
 * server so the page paints instantly while the live part reads the database.
 */
import { ChevronLeft, Eye, HardDrive, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { Accent } from "@/components/ui/PageHeader";
import { ROUTES, STORAGE_NAMES } from "@/lib/config";

export function ExplorerIntro() {
  return (
    <header className="relative pb-6 sm:pb-8">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-28 -z-10 h-[24rem] overflow-hidden">
        <div className="aurora absolute inset-0" />
      </div>
      <Link
        href={ROUTES.storage}
        className="inline-flex items-center gap-1 rounded-lg text-[13px] font-medium text-zinc-600 transition-colors hover:text-brand-700 dark:text-zinc-300 dark:hover:text-brand-200"
        data-testid="explorer-back"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Where your data lives
      </Link>
      <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 max-w-2xl">
          <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300">
            <HardDrive aria-hidden className="size-3.5" />
            IndexedDB · {STORAGE_NAMES.appDb}
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-white">
            Storage <Accent>explorer</Accent>
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted sm:text-[17px]">
            Every record Remembos keeps in this browser, exactly as it&apos;s stored — your files, their text, previews and search data. Pick a
            table on the left, or follow a memory&apos;s “Where is this stored?” link to land right on it.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2 text-[13px] font-medium text-zinc-700 lg:justify-end dark:text-zinc-200">
          <Pill icon={<Eye aria-hidden />}>Read-only</Pill>
          <Pill icon={<ShieldCheck aria-hidden />}>Never leaves this device</Pill>
          <Pill icon={<Sparkles aria-hidden />}>Live</Pill>
        </ul>
      </div>
    </header>
  );
}

function Pill({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="glass inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200/80 px-3 shadow-soft dark:border-white/10 [&_svg]:size-3.5 [&_svg]:text-emerald-500">
      {icon}
      {children}
    </li>
  );
}

/** Shown while the explorer reads its address (query string) on first load. */
export function ExplorerSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <span role="status" className="sr-only">
        Opening the storage explorer…
      </span>
      <div className="space-y-2 rounded-3xl border border-zinc-200/70 p-3 dark:border-white/10">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 p-2">
            <Skeleton className="size-8 rounded-xl" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-20 rounded-md" />
              <Skeleton className="h-3 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-3xl border border-zinc-200/70 p-5 dark:border-white/10">
        <Skeleton className="h-6 w-48" />
        <SkeletonText lines={2} className="mt-3 max-w-md" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
