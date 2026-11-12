"use client";

import { ArrowRight, Cookie, Database, Globe, HardDrive, Layers, NotebookPen, RefreshCw, ScanSearch, Server, SlidersHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Progress } from "@/components/ui/Progress";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { ROUTES, STORAGE_NAMES } from "@/lib/config";
import {
  describeUsageDetails,
  formatInspectionReport,
  REMEMBOS_TABLES,
  type CacheRole,
  type DatabaseRole,
  type StorageInspection,
  type WebStorageReport,
} from "@/lib/storage-inspect";
import { plural } from "@/lib/storage/helpers";
import { formatBytes } from "@/lib/utils";
import { refreshAll, useInspection } from "./use-inspection";

const DB_ROLE: Record<DatabaseRole, { label: string; tone: BadgeTone }> = {
  app: { label: "Your memories", tone: "brand" },
  ocr: { label: "Text reader", tone: "info" },
  helper: { label: "Database helper", tone: "neutral" },
  other: { label: "Not Remembos", tone: "neutral" },
};

const CACHE_ROLE: Record<CacheRole, { label: string; tone: BadgeTone }> = {
  models: { label: "AI models", tone: "info" },
  shell: { label: "Offline copy", tone: "success" },
  share: { label: "Shared from apps", tone: "brand" },
  other: { label: "Not Remembos", tone: "neutral" },
};

function Panel({
  title,
  icon: Icon,
  summary,
  children,
  testId,
}: {
  title: string;
  icon: LucideIcon;
  summary?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="min-w-0 rounded-2xl border border-zinc-200/70 bg-zinc-50/60 p-3.5 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.025]"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Icon aria-hidden className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
        <h4 className="min-w-0 flex-1 text-sm font-semibold text-zinc-900 dark:text-white">{title}</h4>
        {summary ? <span className="ml-auto shrink-0 text-xs font-medium text-muted tabular-nums">{summary}</span> : null}
      </div>
      <div className="mt-3 text-[13px] text-zinc-600 dark:text-zinc-300">{children}</div>
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="leading-relaxed text-muted">{children}</p>;
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-zinc-200/70 dark:divide-white/[0.07]">{children}</ul>;
}

function Row({ name, mono = true, right, tag }: { name: string; mono?: boolean; right?: ReactNode; tag?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
      <span
        className={
          mono
            ? "min-w-0 flex-[1_1_8rem] truncate font-mono text-[12.5px] text-zinc-800 dark:text-zinc-200"
            : "min-w-0 flex-[1_1_8rem] truncate"
        }
        title={name}
      >
        {name}
      </span>
      {tag || right !== undefined ? (
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {tag}
          {right !== undefined ? <span className="text-muted tabular-nums">{right}</span> : null}
        </span>
      ) : null}
    </li>
  );
}

function SpacePanel({ r }: { r: StorageInspection }) {
  const e = r.estimate;
  const details = describeUsageDetails(e.usageDetails);
  const pct = e.quota ? (e.usage / e.quota) * 100 : 0;
  return (
    <Panel title="Space" icon={HardDrive} testId="inspector-space" summary={e.supported ? formatBytes(e.usage) : undefined}>
      {e.supported ? (
        <>
          {e.quota ? (
            <>
              <Progress value={e.usage / e.quota} tone="auto" size="sm" label="Storage used" />
              <p className="mt-2">
                {formatBytes(e.usage)} of {formatBytes(e.quota)} allowed ({pct > 0 && pct < 1 ? "<1" : Math.round(pct)}%)
              </p>
            </>
          ) : (
            <p>{formatBytes(e.usage)} used</p>
          )}
          {details.length ? (
            <div className="mt-3">
              <Rows>
                {details.map((d) => (
                  <Row key={d.key} name={d.label} mono={false} right={formatBytes(d.bytes)} />
                ))}
              </Rows>
            </div>
          ) : null}
        </>
      ) : (
        <Quiet>This browser doesn&apos;t report how much space sites use.</Quiet>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-2">
        Protected from automatic clean-up:
        {r.persisted === null ? (
          <Badge size="sm">Unknown</Badge>
        ) : r.persisted ? (
          <Badge size="sm" tone="success">
            Yes
          </Badge>
        ) : (
          <Badge size="sm" tone="warning">
            Not yet
          </Badge>
        )}
      </p>
    </Panel>
  );
}

function IndexedDBPanel({ r }: { r: StorageInspection }) {
  const idb = r.indexedDB;
  const present = idb.databases.filter((d) => d.exists !== false);
  return (
    <Panel title="IndexedDB databases" icon={Database} testId="inspector-indexeddb" summary={idb.supported ? plural(present.length, "database", "databases") : undefined}>
      {!idb.supported ? (
        <Quiet>IndexedDB isn&apos;t available in this window — Remembos can&apos;t save anything here.</Quiet>
      ) : (
        <>
          <Rows>
            {idb.databases.map((d) => (
              <Row
                key={d.name}
                name={d.name}
                tag={
                  <Badge size="sm" tone={DB_ROLE[d.role].tone}>
                    {DB_ROLE[d.role].label}
                  </Badge>
                }
                right={
                  d.exists === null
                    ? "can't check"
                    : !d.exists
                      ? "not created yet"
                      : d.records !== null
                        ? plural(d.records, "record", "records")
                        : d.version !== null
                          ? `v${d.version}`
                          : "present"
                }
              />
            ))}
          </Rows>
          {idb.tables ? (
            <dl className="mt-3 grid grid-cols-3 gap-1.5" data-testid="inspector-tables">
              {REMEMBOS_TABLES.map((t) => (
                <div key={t} className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-200/70 dark:bg-white/[0.04] dark:ring-white/[0.07]">
                  <dt className="truncate font-mono text-[11px] text-muted">{t}</dt>
                  <dd className="text-sm font-semibold text-zinc-900 tabular-nums dark:text-white">{idb.tables?.[t].toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {!idb.listed ? (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              This browser can&apos;t list databases without creating them, so only the ones Remembos knows about are shown.
            </p>
          ) : null}
          {idb.error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">Couldn&apos;t read “{STORAGE_NAMES.appDb}”: {idb.error}</p> : null}
          <Link
            href={ROUTES.explorer}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
            data-testid="inspector-explorer-link"
          >
            Browse every record in the storage explorer
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </>
      )}
    </Panel>
  );
}

function WebStoragePanel({ title, icon, report, testId, empty }: { title: string; icon: LucideIcon; report: WebStorageReport; testId: string; empty: string }) {
  return (
    <Panel
      title={title}
      icon={icon}
      testId={testId}
      summary={report.supported ? `${plural(report.entries.length, "key", "keys")} · ${formatBytes(report.totalBytes)}` : undefined}
    >
      {!report.supported ? (
        <Quiet>Blocked by the browser{report.error ? ` (${report.error})` : ""}.</Quiet>
      ) : report.entries.length ? (
        <Rows>
          {report.entries.map((e) => (
            <Row
              key={e.key}
              name={e.key}
              tag={
                e.ours ? (
                  <Badge size="sm" tone="brand">
                    Remembos
                  </Badge>
                ) : null
              }
              right={formatBytes(e.bytes)}
            />
          ))}
        </Rows>
      ) : (
        <Quiet>{empty}</Quiet>
      )}
    </Panel>
  );
}

function InspectorBody({ r }: { r: StorageInspection }) {
  return (
    <div className="grid gap-3 p-3 sm:p-5 lg:grid-cols-2">
      <SpacePanel r={r} />
      <IndexedDBPanel r={r} />

      <Panel
        title="Cache Storage"
        icon={Layers}
        testId="inspector-caches"
        summary={r.cacheStorage.supported ? plural(r.cacheStorage.caches.length, "cache", "caches") : undefined}
      >
        {!r.cacheStorage.supported ? (
          <Quiet>Not available here (it needs a secure https:// address).</Quiet>
        ) : r.cacheStorage.caches.length ? (
          <Rows>
            {r.cacheStorage.caches.map((c) => (
              <Row
                key={c.name}
                name={c.name}
                tag={
                  <Badge size="sm" tone={CACHE_ROLE[c.role].tone}>
                    {CACHE_ROLE[c.role].label}
                  </Badge>
                }
                right={c.entries === null ? "?" : plural(c.entries, "file", "files")}
              />
            ))}
          </Rows>
        ) : (
          <Quiet>No caches yet. They appear after the first AI model download, and once the offline copy is set up.</Quiet>
        )}
        {r.cacheStorage.error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{r.cacheStorage.error}</p> : null}
      </Panel>

      <Panel title="Service workers" icon={Server} testId="inspector-workers" summary={r.serviceWorker.supported ? plural(r.serviceWorker.registrations.length, "worker", "workers") : undefined}>
        {!r.serviceWorker.supported ? (
          <Quiet>Not available here (private windows and plain http:// addresses switch them off).</Quiet>
        ) : r.serviceWorker.registrations.length ? (
          <Rows>
            {r.serviceWorker.registrations.map((w) => (
              <Row
                key={w.scope}
                name={w.scope}
                tag={
                  w.ours ? (
                    <Badge size="sm" tone="brand">
                      Remembos
                    </Badge>
                  ) : null
                }
                right={w.state}
              />
            ))}
          </Rows>
        ) : (
          <Quiet>None registered. That&apos;s normal on the very first visit and in development builds.</Quiet>
        )}
        <p className="mt-3 text-xs text-muted">This page is {r.serviceWorker.controlled ? "running through the offline helper." : "loaded straight from the network."}</p>
      </Panel>

      <WebStoragePanel title="localStorage" icon={SlidersHorizontal} report={r.localStorage} testId="inspector-localstorage" empty="Empty — your settings are at their defaults." />
      <WebStoragePanel title="sessionStorage" icon={NotebookPen} report={r.sessionStorage} testId="inspector-sessionstorage" empty="Empty." />

      <Panel title="Cookies" icon={Cookie} testId="inspector-cookies" summary={r.cookies.supported ? plural(r.cookies.names.length, "cookie", "cookies") : undefined}>
        {!r.cookies.supported ? (
          <Quiet>Cookies can&apos;t be read here.</Quiet>
        ) : r.cookies.names.length ? (
          <>
            <Rows>
              {r.cookies.names.map((n) => (
                <Row key={n} name={n} />
              ))}
            </Rows>
            <p className="mt-3 text-xs leading-relaxed text-muted">Remembos never sets cookies — these come from something else on this address, such as the hosting service.</p>
          </>
        ) : (
          <Quiet>None — exactly as promised. Remembos never sets cookies.</Quiet>
        )}
      </Panel>
    </div>
  );
}

function InspectorSkeleton() {
  return (
    <div aria-hidden className="grid gap-3 p-4 sm:p-5 lg:grid-cols-2">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-200/70 p-4 sm:p-5 dark:border-white/[0.08]">
          <Skeleton className="h-4 w-32 rounded-md" />
          <SkeletonText lines={3} className="mt-4" />
        </div>
      ))}
    </div>
  );
}

/** Read-only, live view of everything this site keeps in the browser, with Refresh and Copy report. */
export function LiveInspector() {
  const { data, loading } = useInspection();
  const [refreshing, setRefreshing] = useState(false);
  const checked = data ? new Date(data.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }) : null;

  return (
    <Card padding="none" className="overflow-hidden" data-testid="storage-inspector" aria-busy={loading || undefined}>
      <div className="flex flex-col gap-4 border-b border-zinc-200/70 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6 dark:border-white/10">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl brand-gradient text-white shadow-[0_8px_20px_-8px_rgb(124_58_237/0.7)]">
            <ScanSearch aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">Everything this site has stored, right now</h3>
            <p className="mt-0.5 text-sm text-muted">Read-only — looking never changes or deletes anything.</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {data ? (
                <Badge icon={<Globe />} className="max-w-full" data-testid="storage-inspector-origin">
                  <span className="truncate font-mono">{data.origin}</span>
                </Badge>
              ) : (
                <Skeleton className="h-6 w-44 rounded-full" />
              )}
              {checked ? <span className="text-xs text-muted">Checked at {checked}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button href={ROUTES.explorer} variant="soft" size="sm" leftIcon={<Database />} data-testid="storage-inspector-explorer">
            Open explorer
          </Button>
          {data ? <CopyButton value={() => formatInspectionReport(data)} label="Copy report" variant="secondary" data-testid="storage-inspector-copy" /> : null}
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw />}
            loading={refreshing}
            data-testid="storage-inspector-refresh"
            onClick={async () => {
              setRefreshing(true);
              try {
                await refreshAll();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      {data ? <InspectorBody r={data} /> : <InspectorSkeleton />}
      <p className="sr-only" aria-live="polite">
        {checked ? `Storage details updated at ${checked}.` : ""}
      </p>
    </Card>
  );
}
