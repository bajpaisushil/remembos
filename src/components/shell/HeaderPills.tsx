"use client";

import { ArrowRight, CloudDownload, Cpu, HardDrive, Search, ShieldCheck, UserX, WifiOff } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { ProgressRing } from "@/components/ui/Progress";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import { ROUTES, STORAGE_THRESHOLDS } from "@/lib/config";
import { useStorageInfo } from "@/lib/storage/monitor";
import { cn, formatBytes } from "@/lib/utils";

/** "On-device" shield pill with a popover explaining that nothing leaves the browser. */
export function PrivacyPill() {
  return (
    <Popover
      label="Privacy: everything stays on this device"
      align="end"
      data-testid="privacy-pill"
      triggerClassName={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border text-[13px] font-medium whitespace-nowrap transition-colors",
        "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-700 hover:bg-emerald-500/15",
        "dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/15",
        "w-9 justify-center",
      )}
      trigger={<ShieldCheck aria-hidden className="size-4 shrink-0" />}
      className="w-[22rem]"
      padded={false}
    >
      {({ close }) => (
        <div className="overflow-hidden rounded-2xl">
          <div className="relative overflow-hidden border-b border-zinc-200/70 bg-linear-to-br from-emerald-500/10 via-teal-500/5 to-transparent px-5 pt-5 pb-4 dark:border-white/10">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-emerald-500 text-white shadow-[0_8px_20px_-8px_rgb(16_185_129/0.7)]">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <p className="text-[15px] font-semibold text-zinc-900 dark:text-white">Private by design</p>
                <p className="text-xs text-muted">No uploads. No account. No tracking.</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              Your memories are stored only in this browser — nothing is uploaded.
            </p>
          </div>
          <ul className="space-y-2.5 px-5 py-4 text-[13px] text-zinc-600 dark:text-zinc-300">
            <li className="flex gap-2.5">
              <Cpu aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              Reading text, transcribing voice and searching all happen on your device.
            </li>
            <li className="flex gap-2.5">
              <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              AI helpers download once from public servers, then work offline.
            </li>
            <li className="flex gap-2.5">
              <UserX aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
              No sign-up and no cookies. Back up your memories to keep a copy.
            </li>
          </ul>
          <div className="flex flex-col gap-2 border-t border-zinc-200/70 bg-zinc-50/70 px-5 py-4 sm:flex-row dark:border-white/10 dark:bg-white/[0.02]">
            <Button href={ROUTES.storage} size="sm" variant="primary" rightIcon={<ArrowRight />} onClick={close} className="sm:flex-1">
              Where your data lives
            </Button>
            <Button href={ROUTES.data} size="sm" variant="secondary" onClick={close} className="sm:flex-1">
              Your data
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Compact storage usage pill (ring + used bytes) linking to the Data page. Amber ≥ 70%, red ≥ 90%. */
export function StoragePill({ className }: { className?: string }) {
  const info = useStorageInfo();

  if (!info) return <Skeleton className={cn("h-9 w-[5.5rem] rounded-full", className)} />;
  if (!info.supported) return null;

  const ratio = info.ratio;
  const pct = Math.round(ratio * 100);
  const level = ratio >= STORAGE_THRESHOLDS.critical ? "critical" : ratio >= STORAGE_THRESHOLDS.warn ? "warn" : "ok";
  const summary = info.quota
    ? `${formatBytes(info.usage)} used of the ${formatBytes(info.quota)} this browser allows this site (${pct < 1 && info.usage > 0 ? "<1" : pct}%)`
    : `${formatBytes(info.usage)} used`;

  return (
    <Tooltip content={`${summary} — manage your data`} align="end" side="bottom" describe={false}>
      <Link
        href={ROUTES.data}
        aria-label={`Storage: ${summary}. Manage your data`}
        data-testid="storage-pill"
        data-level={level}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border pr-3 pl-2 text-[13px] font-medium whitespace-nowrap tabular-nums transition-colors",
          level === "critical"
            ? "border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/15 dark:text-rose-300"
            : level === "warn"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300"
              : "border-zinc-200/90 bg-white/70 text-zinc-700 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:bg-white/10",
          className,
        )}
      >
        {info.quota ? (
          <ProgressRing value={Math.max(ratio, info.usage > 0 ? 0.02 : 0)} size={18} stroke={3} tone="auto" />
        ) : (
          <HardDrive aria-hidden className="size-4" />
        )}
        {formatBytes(info.usage)}
      </Link>
    </Tooltip>
  );
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** navigator.onLine, live (true while prerendering). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );
}

const OFFLINE_SUMMARY = "Offline — everything still works except first-time model downloads";

/** Shown only while the device is offline: reassures that Remembos keeps working. */
export function OfflinePill() {
  const online = useOnline();
  if (online) return null;
  return (
    <Popover
      label={OFFLINE_SUMMARY}
      data-testid="offline-pill"
      triggerClassName={cn(
        "inline-flex h-8 max-w-full animate-slide-up items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium shadow-card transition-colors",
        "border-amber-500/30 bg-amber-50 text-amber-900 hover:bg-amber-100",
        "dark:border-amber-400/25 dark:bg-ink-800 dark:text-amber-200 dark:hover:bg-ink-700",
      )}
      trigger={
        <>
          <WifiOff aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            Offline<span className="hidden sm:inline"> — everything still works except first-time model downloads</span>
          </span>
        </>
      }
      className="w-[20rem]"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200">
          <WifiOff aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-zinc-900 dark:text-white">You&apos;re offline</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">Everything still works except first-time model downloads.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2.5 text-[13px] text-zinc-600 dark:text-zinc-300">
        <li className="flex gap-2.5">
          <HardDrive aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Adding, browsing and searching your memories keeps working — they live on this device.
        </li>
        <li className="flex gap-2.5">
          <Search aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          AI helpers you&apos;ve already used (text reading, transcription, meaning search) work offline.
        </li>
        <li className="flex gap-2.5">
          <CloudDownload aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          A helper you haven&apos;t used yet downloads once you&apos;re back online.
        </li>
      </ul>
    </Popover>
  );
}
