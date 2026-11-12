"use client";

import { AppWindow, ChevronRight, CloudOff, Database, LockKeyhole, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { DEVICE_LABELS, type DiskBrowserId } from "@/lib/storage-inspect";
import { cn } from "@/lib/utils";
import { useEnvironment } from "./use-environment";

const SHORT_BROWSER: Record<DiskBrowserId, string> = {
  chrome: "Chrome",
  edge: "Edge",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  arc: "Arc",
  chromium: "Chromium",
  firefox: "Firefox",
  safari: "Safari",
  samsung: "Samsung",
};

function Node({ icon, label, sub, vault = false }: { icon: ReactNode; label: string; sub: string; vault?: boolean }) {
  return (
    <div className="flex w-[3.9rem] shrink-0 flex-col items-center text-center sm:w-20">
      <span
        className={cn(
          "relative grid size-11 place-items-center rounded-2xl sm:size-14 [&>svg]:size-5 sm:[&>svg]:size-6",
          vault
            ? "brand-gradient animate-float text-white shadow-glow"
            : "border border-zinc-200/80 bg-white text-zinc-700 shadow-soft dark:border-white/10 dark:bg-white/10 dark:text-zinc-200",
        )}
      >
        {icon}
        {vault ? (
          <span className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full bg-emerald-500 text-white ring-2 ring-white sm:size-6 dark:ring-ink-900">
            <LockKeyhole aria-hidden className="size-3 sm:size-3.5" />
          </span>
        ) : null}
      </span>
      <span className="mt-2 w-full truncate text-[12.5px] leading-tight font-semibold text-zinc-900 sm:text-sm dark:text-white">{label}</span>
      <span className="mt-0.5 text-[10.5px] leading-tight text-muted sm:text-xs">{sub}</span>
    </div>
  );
}

/** Arrow between nodes. `grow` sets how much free width it takes (one flex class, so nothing conflicts). */
function Connector({ grow = "flex-1", className }: { grow?: string; className?: string }) {
  return (
    <div aria-hidden className={cn("relative mt-[1.375rem] flex min-w-2.5 items-center sm:mt-7", grow, className)}>
      <div className="h-0.5 w-full rounded-full bg-linear-to-r from-brand-300/30 to-brand-500/80 dark:from-brand-300/15 dark:to-brand-300/70" />
      <ChevronRight className="absolute -right-1.5 size-3.5 text-brand-500 dark:text-brand-300" strokeWidth={2.5} />
      <span className="absolute left-1/2 size-1.5 -translate-x-1/2 animate-pulse-dot rounded-full bg-brand-500 text-brand-500 dark:bg-brand-300 dark:text-brand-300" />
    </div>
  );
}

/** "You → your browser → the IndexedDB vault, all on this device — and no cloud" illustration. */
export function VaultDiagram({ className }: { className?: string }) {
  const env = useEnvironment();
  const browser = env ? SHORT_BROWSER[env.diskBrowser] : "Browser";
  const device = env ? DEVICE_LABELS[env.os] : DEVICE_LABELS.other;

  return (
    <figure className={cn("relative", className)} data-testid="storage-diagram">
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-[radial-gradient(closest-side,rgb(139_92_246/0.16),transparent)] dark:bg-[radial-gradient(closest-side,rgb(139_92_246/0.28),transparent)]"
      />
      <div
        role="img"
        aria-label={`Diagram: you add memories in ${env ? browser : "your browser"}, which keeps them in the IndexedDB vault called “remembos”, all on ${device.replace(/^This/, "this")}. Nothing goes to a cloud or server.`}
        className="glass rounded-3xl border border-white/70 p-4 shadow-card sm:p-7 dark:border-white/10"
      >
        <div className="flex items-start gap-1 sm:gap-3">
          <Node icon={<UserRound aria-hidden />} label="You" sub="add memories" />
          <Connector grow="w-5 flex-none sm:w-auto sm:max-w-24 sm:flex-[0.7]" />
          <div className="relative flex min-w-0 flex-[3] items-start gap-1 rounded-2xl border-2 border-dashed border-brand-300/70 bg-brand-500/[0.04] px-1.5 pt-8 pb-3 sm:gap-3 sm:px-4 sm:pt-9 dark:border-brand-300/25 dark:bg-brand-400/[0.05]">
            <span className="absolute top-2 left-2.5 max-w-[calc(100%-1rem)] truncate text-[10.5px] font-semibold tracking-[0.08em] text-brand-700 uppercase sm:top-2.5 sm:left-4 sm:text-[11px] dark:text-brand-200">
              {device}
            </span>
            <Node icon={<AppWindow aria-hidden />} label={browser} sub="your browser" />
            <Connector className="sm:min-w-10" />
            <Node icon={<Database aria-hidden />} label="Vault" sub="IndexedDB" vault />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-rose-500/15 bg-rose-500/[0.05] px-3 py-2.5 sm:px-3.5 dark:border-rose-400/15 dark:bg-rose-400/[0.06]">
          <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-white text-rose-500 shadow-soft dark:bg-white/10 dark:text-rose-300">
            <CloudOff aria-hidden className="size-[18px]" />
          </span>
          <p className="text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">
            <span className="font-semibold text-zinc-900 dark:text-white">No cloud, no server, no account.</span> Nothing is uploaded — not
            even to us.
          </p>
        </div>
      </div>
      <figcaption className="mt-3 px-2 text-center text-[13px] leading-relaxed text-muted">
        Browsers wall websites off from each other: only Remembos, on this exact address, can open this vault.
      </figcaption>
    </figure>
  );
}
