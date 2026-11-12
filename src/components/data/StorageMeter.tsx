"use client";

/**
 * Storage meter for the Data page: how much this browser lets Remembos keep, what is using it
 * (original files · AI models · text, previews & app), whether the browser promised to keep the
 * data, a private-window warning and memory counts by kind.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { EyeOff, HardDrive, RefreshCw, Shield, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { KindIcon } from "@/components/ui/KindIcon";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import { KIND_META, ROUTES, STORAGE_THRESHOLDS } from "@/lib/config";
import { db } from "@/lib/db";
import { refreshStorage, requestPersistence, useStorageInfo, type StorageSnapshot } from "@/lib/storage/monitor";
import { useStore } from "@/lib/store";
import { MEMORY_KINDS, type MemoryKind } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { modelCacheStore, refreshModelCaches } from "./model-cache";
import { Callout, InlineSkeleton, percentLabel } from "./shared";

type Level = "ok" | "warn" | "critical";

function levelFor(ratio: number): Level {
  if (ratio >= STORAGE_THRESHOLDS.critical) return "critical";
  if (ratio >= STORAGE_THRESHOLDS.warn) return "warn";
  return "ok";
}

const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-zinc-900 dark:text-white",
  warn: "text-amber-600 dark:text-amber-300",
  critical: "text-rose-600 dark:text-rose-300",
};

interface Segment {
  key: string;
  label: string;
  hint: string;
  bytes: number;
  fill: string;
  dot: string;
}

/** Split `usage` into originals · models · everything else, never adding up to more than usage. */
function segmentsFor(info: StorageSnapshot, modelBytes: number | null): Segment[] {
  const usage = Math.max(0, info.usage);
  const originals = Math.min(Math.max(0, info.filesBytes), usage);
  const models = Math.min(Math.max(0, modelBytes ?? 0), usage - originals);
  const other = Math.max(0, usage - originals - models);
  return [
    {
      key: "originals",
      label: "Original files",
      hint: "Screenshots, PDFs, videos and recordings as you added them",
      bytes: originals,
      fill: "bg-linear-to-r from-violet-500 to-fuchsia-500",
      dot: "bg-fuchsia-500",
    },
    {
      key: "models",
      label: "AI models",
      hint: "Text reader, voice transcriber and meaning search",
      bytes: models,
      fill: "bg-linear-to-r from-sky-400 to-indigo-500",
      dot: "bg-sky-500",
    },
    {
      key: "other",
      label: "Text, previews & app",
      hint: "Extracted text, search data, thumbnails and the offline app",
      bytes: other,
      fill: "bg-linear-to-r from-slate-400 to-slate-500 dark:from-slate-400 dark:to-slate-300",
      dot: "bg-slate-400",
    },
  ];
}

async function countByKind(): Promise<Record<MemoryKind, number> | null> {
  try {
    const counts = await Promise.all(MEMORY_KINDS.map((k) => db.items.where("kind").equals(k).count()));
    return Object.fromEntries(MEMORY_KINDS.map((k, i) => [k, counts[i]])) as Record<MemoryKind, number>;
  } catch {
    return null;
  }
}

export function StorageMeter() {
  const info = useStorageInfo();
  const models = useStore(modelCacheStore);
  const counts = useLiveQuery(countByKind, []);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([refreshStorage(), refreshModelCaches()]);
    } finally {
      setRefreshing(false);
    }
  }

  const total = counts ? MEMORY_KINDS.reduce((sum, k) => sum + counts[k], 0) : null;

  return (
    <Card as="section" id="storage" aria-labelledby="storage-title" data-testid="storage-meter" data-level={info ? levelFor(info.ratio) : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="storage-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
            <HardDrive aria-hidden className="size-5 text-brand-500 dark:text-brand-300" />
            Storage on this device
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {total === null ? (
              <InlineSkeleton className="h-3.5 w-40" />
            ) : total === 0 ? (
              "No memories yet — everything you add is kept right here."
            ) : (
              `${total.toLocaleString()} ${total === 1 ? "memory" : "memories"} kept in this browser`
            )}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />}
          onClick={refresh}
          disabled={refreshing}
          data-testid="storage-refresh"
        >
          {refreshing ? "Checking…" : "Refresh"}
        </Button>
      </div>

      {info ? <MeterBody info={info} modelBytes={models.bytes} measuringModels={models.bytes === null && models.checking} /> : <MeterSkeleton />}

      <KindCounts counts={counts} />
    </Card>
  );
}

function MeterSkeleton() {
  return (
    <div className="mt-6" aria-busy="true">
      <span role="status" className="sr-only">
        Checking storage…
      </span>
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-3.5 w-52 rounded-full" />
        </div>
        <Skeleton className="h-10 w-16" />
      </div>
      <Skeleton className="mt-5 h-4 w-full rounded-full" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
      <Skeleton className="mt-5 h-16 w-full rounded-2xl" />
    </div>
  );
}

function MeterBody({ info, modelBytes, measuringModels }: { info: StorageSnapshot; modelBytes: number | null; measuringModels: boolean }) {
  const level = levelFor(info.ratio);
  const segments = segmentsFor(info, modelBytes);
  const free = Math.max(0, info.quota - info.usage);

  if (!info.supported || info.quota <= 0) {
    return (
      <div className="mt-6 space-y-4">
        <Callout tone="info" icon={<HardDrive />} title="This browser doesn't share storage numbers">
          Your memories are still saved on this device — the browser just doesn&apos;t say how much room is left. Download a backup now
          and then to be safe.
        </Callout>
        <PersistenceRow persisted={info.persisted} />
        {info.likelyPrivate ? <PrivateWarning /> : null}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums sm:text-4xl dark:text-white" data-testid="storage-used">
            {formatBytes(info.usage)}
            <span className="ml-2 text-base font-medium tracking-normal text-muted sm:text-lg">used</span>
          </p>
          <p className="mt-1 text-sm text-muted tabular-nums">
            {formatBytes(free)} free of {formatBytes(info.quota)} this browser allows
          </p>
          <p className="mt-1 max-w-prose text-xs text-muted" data-testid="storage-quota-explainer">
            That {formatBytes(info.quota)} is a ceiling, not space taken: it&apos;s the most this browser lets this one website
            keep, shared by IndexedDB (your memories) and the cache (AI models, offline app). localStorage and
            sessionStorage have their own tiny limits (about 5&nbsp;MB) and Remembos sets no cookies. Browsers size the
            ceiling from your free disk space, so it can change.
          </p>
        </div>
        <div className="flex items-baseline gap-2 sm:block sm:text-right">
          <p className={cn("text-2xl font-semibold tracking-tight tabular-nums sm:text-4xl", LEVEL_TEXT[level])} data-testid="storage-percent">
            {percentLabel(info.ratio, info.usage > 0)}
          </p>
          <p className="text-xs font-medium text-muted">{level === "critical" ? "Almost full" : level === "warn" ? "Getting full" : "of your space"}</p>
        </div>
      </div>

      <SegmentBar segments={segments} quota={info.quota} level={level} usage={info.usage} />

      <ul className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="What is using the space">
        {segments.map((s) => (
          <li key={s.key} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-zinc-50/80 px-3 py-2.5 dark:bg-white/[0.03]">
            <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", s.dot)} />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{s.label}</span>
              <span className="block text-sm font-semibold text-zinc-900 tabular-nums dark:text-white">
                {s.key === "models" && measuringModels ? <InlineSkeleton className="h-3.5 w-14" /> : formatBytes(s.bytes)}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">{s.hint}</span>
            </span>
          </li>
        ))}
      </ul>

      {level !== "ok" ? (
        <Callout
          tone={level === "critical" ? "danger" : "warning"}
          icon={<HardDrive />}
          title={level === "critical" ? "Storage is almost full" : "Storage is filling up"}
          className="mt-4"
          role="status"
        >
          New memories may soon fail to save. Free up space below — remove original files you don&apos;t need or downloaded AI models — or back
          up and delete older memories.
        </Callout>
      ) : null}

      <div className="mt-5 space-y-3">
        <PersistenceRow persisted={info.persisted} />
        {info.likelyPrivate ? <PrivateWarning /> : null}
      </div>
    </div>
  );
}

function SegmentBar({ segments, quota, level, usage }: { segments: Segment[]; quota: number; level: Level; usage: number }) {
  const ratio = quota > 0 ? usage / quota : 0;
  return (
    <div className="relative mt-5">
      <div
        role="meter"
        aria-label="Storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={`${formatBytes(usage)} of ${formatBytes(quota)} used`}
        className={cn(
          "flex h-4 w-full gap-0.5 overflow-hidden rounded-full p-0.5 ring-inset",
          level === "critical"
            ? "bg-rose-500/15 ring-2 ring-rose-500/70 dark:bg-rose-400/15"
            : level === "warn"
              ? "bg-amber-500/15 ring-2 ring-amber-500/70 dark:bg-amber-400/15"
              : "bg-zinc-200/70 ring-1 ring-transparent dark:bg-white/10",
        )}
      >
        {segments.map((s) =>
          s.bytes > 0 ? (
            <span
              key={s.key}
              className={cn("h-full min-w-1.5 rounded-full transition-[width] duration-500 ease-out-soft", s.fill)}
              style={{ width: `${(s.bytes / quota) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      {/* Warning thresholds */}
      {[STORAGE_THRESHOLDS.warn, STORAGE_THRESHOLDS.critical].map((t) => (
        <span
          key={t}
          aria-hidden
          className={cn("absolute top-[-3px] h-[22px] w-px", t === STORAGE_THRESHOLDS.warn ? "bg-amber-500/60" : "bg-rose-500/60")}
          style={{ left: `${t * 100}%` }}
        />
      ))}
      <div aria-hidden className="relative mt-1.5 h-4 text-[10px] font-medium text-muted">
        <span className="absolute -translate-x-1/2" style={{ left: `${STORAGE_THRESHOLDS.warn * 100}%` }}>
          {Math.round(STORAGE_THRESHOLDS.warn * 100)}%
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${STORAGE_THRESHOLDS.critical * 100}%` }}>
          {Math.round(STORAGE_THRESHOLDS.critical * 100)}%
        </span>
      </div>
    </div>
  );
}

function PersistenceRow({ persisted }: { persisted: boolean | null }) {
  const [asking, setAsking] = useState(false);

  async function ask() {
    setAsking(true);
    try {
      await requestPersistence();
    } finally {
      setAsking(false);
    }
  }

  if (persisted === true) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3.5 sm:flex-row sm:items-center dark:border-emerald-400/20 dark:bg-emerald-400/[0.06]">
        <Badge tone="success" icon={<ShieldCheck />} data-testid="persist-status" data-state="persisted">
          Protected
        </Badge>
        <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          Your browser promised not to clear Remembos when your device runs low on space. A backup now and then is still a good idea.
        </p>
      </div>
    );
  }

  if (persisted === false) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3.5 dark:border-amber-400/20 dark:bg-amber-400/[0.06]">
        <div className="flex flex-col items-start gap-2 sm:flex-row">
          <Badge tone="warning" icon={<Shield />} data-testid="persist-status" data-state="not-persisted">
            Not protected yet
          </Badge>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            If your device runs low on space, the browser may clear website data — including your memories — without asking. You can ask
            it to keep them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" leftIcon={<ShieldCheck />} loading={asking} onClick={ask} data-testid="persist-button">
            Ask browser to keep my data
          </Button>
          <Tooltip content="Chrome and Edge say yes once you use a site often or install it. Firefox shows a small pop-up. Safari decides on its own.">
            <span tabIndex={0} className="cursor-help text-xs font-medium text-muted underline decoration-dotted underline-offset-2">
              Why might it say no?
            </span>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 rounded-2xl border border-zinc-200/70 bg-zinc-50/80 px-4 py-3.5 sm:flex-row sm:items-center dark:border-white/10 dark:bg-white/[0.03]">
      <Badge tone="neutral" icon={<ShieldQuestion />} data-testid="persist-status" data-state="unknown">
        Browser decides
      </Badge>
      <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        This browser doesn&apos;t let websites ask to keep their data. Download a backup now and then so nothing is lost.
      </p>
    </div>
  );
}

function PrivateWarning() {
  return (
    <Callout
      tone="warning"
      icon={<EyeOff />}
      title="This looks like a private window"
      role="alert"
      data-testid="private-warning"
      actions={
        <>
          <Button size="sm" variant="secondary" href="#backup">
            Back up before leaving
          </Button>
          <Button size="sm" variant="ghost" href={ROUTES.storage}>
            Learn more
          </Button>
        </>
      }
    >
      Everything you add here disappears when you close this window. Open Remembos in a normal window to keep your memories.
    </Callout>
  );
}

function KindCounts({ counts }: { counts: Record<MemoryKind, number> | null | undefined }) {
  return (
    <div className="mt-6 border-t border-zinc-200/70 pt-5 dark:border-white/10">
      <h3 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">Memories by kind</h3>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="kind-counts">
        {MEMORY_KINDS.map((k) => (
          <li key={k} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-zinc-200/70 px-3 py-2.5 dark:border-white/[0.08]" data-testid={`kind-count-${k}`}>
            <KindIcon kind={k} size="sm" />
            <span className="min-w-0">
              <span className="block text-base leading-tight font-semibold text-zinc-900 tabular-nums dark:text-white">
                {counts ? counts[k].toLocaleString() : counts === null ? "–" : <InlineSkeleton className="h-4 w-6" />}
              </span>
              <span className="block text-xs leading-snug text-muted">{KIND_META[k].plural}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
