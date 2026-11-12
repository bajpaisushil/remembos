"use client";

import { ArrowRight, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ROUTES, STORAGE_NAMES } from "@/lib/config";
import type { StorageInspection } from "@/lib/storage-inspect";
import { plural } from "@/lib/storage/helpers";
import { cn, formatBytes } from "@/lib/utils";
import { MEDIA, VAULT_TABLES, type ClearImpact, type MediumCopy, type MediumId, type MediumTone } from "./content";
import { useInspection } from "./use-inspection";

const TONE_CHIP: Record<MediumTone, string> = {
  brand: "brand-gradient text-white shadow-[0_8px_20px_-8px_rgb(124_58_237/0.7)]",
  violet: "bg-violet-500/10 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
  sky: "bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300",
  teal: "bg-teal-500/10 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300",
  amber: "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
  zinc: "bg-zinc-500/10 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  rose: "bg-rose-500/10 text-rose-600 dark:bg-rose-400/15 dark:text-rose-300",
};

const IMPACT: Record<ClearImpact, { icon: LucideIcon; strip: string; iconClass: string }> = {
  danger: {
    icon: TriangleAlert,
    strip: "border-rose-500/15 bg-rose-500/[0.06] text-rose-900 dark:border-rose-400/15 dark:bg-rose-400/[0.07] dark:text-rose-100",
    iconClass: "text-rose-600 dark:text-rose-300",
  },
  caution: {
    icon: Info,
    strip: "border-amber-500/20 bg-amber-500/[0.07] text-amber-950 dark:border-amber-400/15 dark:bg-amber-400/[0.07] dark:text-amber-100",
    iconClass: "text-amber-600 dark:text-amber-300",
  },
  safe: {
    icon: CircleCheck,
    strip: "border-emerald-500/15 bg-emerald-500/[0.06] text-emerald-950 dark:border-emerald-400/15 dark:bg-emerald-400/[0.06] dark:text-emerald-100",
    iconClass: "text-emerald-600 dark:text-emerald-300",
  },
};

interface Live {
  tone: BadgeTone;
  text: string;
  title?: string;
}

/** The live size/count badge for each medium, from the inspection snapshot. */
function liveFor(id: MediumId, r: StorageInspection): Live {
  switch (id) {
    case "vault": {
      const t = r.indexedDB.tables;
      if (!t) return { tone: "warning", text: "Can't open right now", title: r.indexedDB.error };
      return t.items ? { tone: "brand", text: plural(t.items, "memory", "memories") } : { tone: "neutral", text: "Empty so far" };
    }
    case "ocr": {
      const db = r.indexedDB.databases.find((d) => d.role === "ocr");
      if (!db || db.exists === null) return { tone: "neutral", text: "Can't check here", title: "This browser can't list its databases without creating them." };
      if (!db.exists) return { tone: "neutral", text: "Not downloaded yet" };
      return { tone: "success", text: db.records !== null ? plural(db.records, "language file", "language files") : "Downloaded" };
    }
    case "models": {
      if (!r.cacheStorage.supported) return { tone: "neutral", text: "Not available here" };
      const caches = r.cacheStorage.caches.filter((c) => c.role === "models");
      const files = caches.reduce((n, c) => n + (c.entries ?? 0), 0);
      return caches.length && files ? { tone: "success", text: `${plural(files, "file", "files")} saved` } : { tone: "neutral", text: "Not downloaded yet" };
    }
    case "shell": {
      if (!r.cacheStorage.supported || !r.serviceWorker.supported) return { tone: "neutral", text: "Not available here" };
      const caches = r.cacheStorage.caches.filter((c) => c.role === "shell");
      const files = caches.reduce((n, c) => n + (c.entries ?? 0), 0);
      if (files) return { tone: "success", text: `${plural(files, "file", "files")} saved` };
      return { tone: "neutral", text: r.serviceWorker.registrations.some((w) => w.ours) ? "Setting up…" : "Not set up yet" };
    }
    case "local": {
      const s = r.localStorage;
      if (!s.supported) return { tone: "warning", text: "Blocked", title: s.error };
      return s.ours.count ? { tone: "info", text: `${plural(s.ours.count, "key", "keys")} · ${formatBytes(s.ours.bytes)}` } : { tone: "neutral", text: "Empty (defaults)" };
    }
    case "session": {
      const s = r.sessionStorage;
      if (!s.supported) return { tone: "warning", text: "Blocked", title: s.error };
      return s.ours.count ? { tone: "neutral", text: plural(s.ours.count, "key", "keys") } : { tone: "neutral", text: "Empty" };
    }
    case "cookies": {
      if (!r.cookies.supported) return { tone: "neutral", text: "Can't read" };
      const n = r.cookies.names.length;
      return n
        ? { tone: "warning", text: plural(n, "cookie", "cookies"), title: "Set by something other than Remembos, e.g. the hosting service." }
        : { tone: "success", text: "No cookies" };
    }
    case "http":
      return { tone: "neutral", text: "Not inspectable", title: "Web pages can't read the browser's HTTP cache." };
  }
}

function TechNames({ copy }: { copy: MediumCopy }) {
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex h-6 items-center rounded-md bg-zinc-900/[0.05] px-2 text-xs font-semibold text-zinc-700 dark:bg-white/[0.08] dark:text-zinc-200">
        {copy.tech}
      </span>
      {copy.names.length ? (
        copy.names.map((name) => (
          <code
            key={name}
            className="inline-flex h-6 max-w-full items-center truncate rounded-md border border-zinc-200/80 px-2 font-mono text-[11.5px] text-zinc-600 dark:border-white/10 dark:text-zinc-300"
          >
            {name}
          </code>
        ))
      ) : (
        <span className="text-xs text-muted">none set</span>
      )}
    </p>
  );
}

function MediumCard({ copy, live, className, children }: { copy: MediumCopy; live: Live | null; className?: string; children?: ReactNode }) {
  const Icon = copy.icon;
  const impact = IMPACT[copy.ifCleared.impact];
  const ImpactIcon = impact.icon;
  return (
    <Card as="article" padding="none" className={cn("flex flex-col overflow-hidden", className)} data-testid={`storage-medium-${copy.id}`} aria-labelledby={`medium-${copy.id}`}>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl [&>svg]:size-5", TONE_CHIP[copy.tone])}>
            <Icon aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <h3 id={`medium-${copy.id}`} className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
                {copy.title}
              </h3>
              {live ? (
                <Badge tone={live.tone} title={live.title} data-testid={`storage-medium-${copy.id}-live`}>
                  {live.text}
                </Badge>
              ) : (
                <Skeleton className="h-6 w-24 rounded-full" />
              )}
            </div>
            <TechNames copy={copy} />
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{copy.summary}</p>
        {children}
      </div>
      <div className={cn("flex items-start gap-2.5 border-t px-5 py-3.5 text-[13px] leading-relaxed sm:px-6", impact.strip)}>
        <ImpactIcon aria-hidden className={cn("mt-0.5 size-4 shrink-0", impact.iconClass)} />
        <p>
          <span className="font-semibold">If it&apos;s cleared: </span>
          {copy.ifCleared.text}
        </p>
      </div>
    </Card>
  );
}

function VaultTables({ data }: { data: StorageInspection | null }) {
  const tables = data?.indexedDB.tables;
  const idbBytes = data?.estimate.usageDetails?.indexedDB;
  return (
    <div className="mt-5">
      <p className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">Inside the “{STORAGE_NAMES.appDb}” database</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {VAULT_TABLES.map(({ table, title, text, icon: Icon }) => (
          <li key={table} data-testid={`vault-table-${table}`}>
            <Link
              href={`${ROUTES.explorer}?table=${table}`}
              className="group flex h-full gap-3 rounded-2xl border border-zinc-200/70 bg-zinc-50/70 p-3.5 transition-[border-color,background-color,transform] duration-150 ease-out hover:-translate-y-px hover:border-brand-400/50 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-brand-300/40 dark:hover:bg-white/[0.06]"
              aria-label={`${title} (${table}) — browse in the storage explorer`}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">
                    {title} <code className="ml-1 font-mono text-[11px] font-normal text-muted">{table}</code>
                  </p>
                  {tables ? (
                    <span className="shrink-0 text-sm font-semibold text-zinc-900 tabular-nums dark:text-white">{tables[table].toLocaleString()}</span>
                  ) : data ? (
                    <span className="shrink-0 text-sm text-muted">—</span>
                  ) : (
                    <Skeleton className="h-4 w-8 rounded-md" />
                  )}
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-muted">{text}</p>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 opacity-80 transition-opacity group-hover:opacity-100 dark:text-brand-300">
                  Browse
                  <ArrowRight aria-hidden className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {data?.estimate.supported && data.estimate.usage > 0 ? (
        <p className="mt-3 text-[13px] text-muted">
          {typeof idbBytes === "number"
            ? `All IndexedDB data for this site takes about ${formatBytes(idbBytes)} on this device (including the text-reader files).`
            : `Everything this site stores, all mediums together, takes about ${formatBytes(data.estimate.usage)}.`}
        </p>
      ) : null}
    </div>
  );
}

/** "What's stored where": one card per storage medium with a live badge and what clearing it means. */
export function MediumCards() {
  const { data } = useInspection();
  const live = (id: MediumId) => (data ? liveFor(id, data) : null);

  return (
    <div className="grid gap-4 md:grid-cols-2" aria-busy={!data || undefined}>
      {MEDIA.map((copy) => {
        if (copy.id === "vault") {
          return (
            <MediumCard key={copy.id} copy={copy} live={live("vault")} className="md:col-span-2">
              <VaultTables data={data} />
            </MediumCard>
          );
        }
        if (copy.id === "cookies") {
          return (
            <MediumCard key={copy.id} copy={copy} live={live("cookies")} className="md:col-span-2">
              <div
                role="note"
                className="mt-4 flex gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/[0.07] dark:text-amber-100"
              >
                <TriangleAlert aria-hidden className="mt-0.5 size-[18px] shrink-0 text-amber-600 dark:text-amber-300" />
                <p>
                  <span className="font-semibold">The catch:</span> browsers bundle cookies with all other site data. Ticking “Cookies and
                  other site data” (or “Cookies and site data”) when you clear your browser erases the memory vault and everything above —
                  even though Remembos has no cookies at all.
                </p>
              </div>
            </MediumCard>
          );
        }
        return <MediumCard key={copy.id} copy={copy} live={live(copy.id)} />;
      })}
    </div>
  );
}
