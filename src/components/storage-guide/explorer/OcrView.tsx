"use client";

import { ChevronLeft, ChevronRight, Languages, RefreshCw, Ruler } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { STORAGE_NAMES } from "@/lib/config";
import { ADDRESS_SEPARATOR, logicalAddress, OCR_DB_EXPLANATION, pageCount, pageSpan } from "@/lib/storage-inspect";
import { formatBytes } from "@/lib/utils";
import { loadOcrDatabase, measureOcrValue, type OcrDatabase } from "./data";

export interface OcrViewProps {
  /** Databases listed by the browser (null = it can't list them). */
  listed: { name: string; version: number | null }[] | null;
  /** Report fresh numbers to the sidebar. */
  onLoaded?: (ocr: OcrDatabase) => void;
}

/** The text reader's language data (keyval-store): keys only, sizes measured on request. */
export function OcrView({ listed, onLoaded }: OcrViewProps) {
  const [page, setPage] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ request: string; data: OcrDatabase } | null>(null);
  const [sizes, setSizes] = useState<Record<string, number | null | "measuring">>({});
  const request = `${page}|${nonce}`;

  useEffect(() => {
    let cancelled = false;
    void loadOcrDatabase(page, listed).then((data) => {
      if (cancelled) return;
      setState({ request: `${page}|${nonce}`, data });
      onLoaded?.(data);
    });
    return () => {
      cancelled = true;
    };
  }, [page, nonce, listed, onLoaded]);

  const data = state?.data ?? null;
  const stale = !!state && state.request !== request;
  const storeName = data?.stores.length === 1 ? data.stores[0].name : null;
  const address = storeName ? logicalAddress(storeName, undefined, STORAGE_NAMES.ocrDb) : ["IndexedDB", STORAGE_NAMES.ocrDb].join(ADDRESS_SEPARATOR);
  const span = pageSpan(data?.page ?? 0, data?.total ?? 0);
  const pages = pageCount(data?.total ?? 0);

  async function measure(store: string, key: string) {
    const id = `${store}\u0000${key}`;
    setSizes((s) => ({ ...s, [id]: "measuring" }));
    const bytes = await measureOcrValue(store, key);
    setSizes((s) => ({ ...s, [id]: bytes }));
  }

  return (
    <Card as="section" padding="none" id="explorer-table" aria-labelledby="explorer-table-title" data-testid="explorer-table" data-table="ocr" className="min-w-0 scroll-mt-24 overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-zinc-200/70 p-4 sm:p-5 dark:border-white/10">
        <div className="flex flex-wrap items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/20 ring-inset dark:bg-sky-400/15 dark:text-sky-300 [&>svg]:size-5">
            <Languages aria-hidden />
          </span>
          <div className="min-w-0 flex-1 basis-52">
            <h2 id="explorer-table-title" className="flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
              <code className="font-mono">{STORAGE_NAMES.ocrDb}</code>
              <span className="text-sm font-medium text-muted">{OCR_DB_EXPLANATION.title}</span>
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{OCR_DB_EXPLANATION.explain}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw />}
            loading={stale}
            onClick={() => setNonce((n) => n + 1)}
            data-testid="explorer-ocr-refresh"
          >
            Refresh
          </Button>
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-1 self-start rounded-xl border border-zinc-200/70 bg-zinc-50 py-1 pr-1 pl-2.5 dark:border-white/[0.08] dark:bg-black/20">
          <code className="min-w-0 truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-300">{address}</code>
          <CopyButton value={address} iconOnly label="Copy database address" />
        </div>
      </header>

      <div className="min-h-40" aria-busy={!data || stale || undefined} data-testid="explorer-rows">
        {!data ? (
          <div aria-hidden className="space-y-3 p-5">
            <Skeleton className="h-5 w-2/3 rounded-md" />
            <Skeleton className="h-5 w-1/2 rounded-md" />
          </div>
        ) : data.exists === false ? (
          <p className="px-5 py-12 text-center text-sm leading-relaxed text-muted" data-testid="explorer-empty">
            Not downloaded yet. The text reader fetches its language data the first time you add a screenshot, photo, scanned PDF or video —
            then it lives here.
          </p>
        ) : data.exists === null ? (
          <p className="px-5 py-12 text-center text-sm leading-relaxed text-muted" data-testid="explorer-empty">
            Not found. It appears after the text reader&apos;s first download. (This browser can&apos;t list databases, and Remembos won&apos;t create
            one just to look.)
          </p>
        ) : data.error ? (
          <p className="px-5 py-12 text-center text-sm text-rose-700 dark:text-rose-300" role="alert">
            Couldn&apos;t read it right now: {data.error}
          </p>
        ) : data.rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted" data-testid="explorer-empty">
            The database exists but is empty — language data downloads again when it&apos;s needed.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200/70 dark:divide-white/[0.06]">
            {data.rows.map((r) => {
              const id = `${r.store}\u0000${r.key}`;
              const size = sizes[id];
              return (
                <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5" data-testid="explorer-row" data-key={r.key}>
                  <div className="min-w-0 flex-1 basis-48">
                    <code className="block truncate font-mono text-[13px] font-medium text-zinc-900 dark:text-white" title={r.key}>
                      {r.key}
                    </code>
                    <p className="mt-0.5 text-[12px] text-muted">
                      in <code className="font-mono">{r.store}</code> · language data for the text reader
                    </p>
                  </div>
                  {typeof size === "number" ? (
                    <Badge tone="info" className="tabular-nums">
                      {formatBytes(size)}
                    </Badge>
                  ) : size === null ? (
                    <Badge>Size unknown</Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      leftIcon={<Ruler />}
                      loading={size === "measuring"}
                      onClick={() => void measure(r.store, r.key)}
                      aria-label={`Measure the size of ${r.key}`}
                    >
                      Measure
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data && data.total > 0 ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/70 px-4 py-3 sm:px-5 dark:border-white/10">
          <p className="text-[13px] text-muted tabular-nums" aria-live="polite">
            Showing {span.first.toLocaleString()}–{span.last.toLocaleString()} of {data.total.toLocaleString()} · sizes are measured only when you ask
            (each file is several MB)
          </p>
          {pages > 1 ? (
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" size="sm" leftIcon={<ChevronLeft />} disabled={data.page === 0} onClick={() => setPage(data.page - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" rightIcon={<ChevronRight />} disabled={data.page >= pages - 1} onClick={() => setPage(data.page + 1)}>
                Next
              </Button>
            </div>
          ) : null}
        </footer>
      ) : null}
    </Card>
  );
}
