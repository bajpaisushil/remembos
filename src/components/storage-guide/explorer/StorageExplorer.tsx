"use client";

/**
 * In-app IndexedDB explorer (/storage/explorer/): a read-only, live view of everything Remembos
 * keeps in this browser. Left: databases → tables with live counts. Main: 50 rows a page, read
 * through indexes. `?item=<id>` focuses one memory: where each of its records lives (logical
 * address + the real folder on this computer) and its rows highlighted in every table.
 * `?table=<name>` picks the table (items, files, thumbs, chunks, entities, meta, or ocr).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Lightbulb, LocateFixed } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ROUTES } from "@/lib/config";
import { db } from "@/lib/db";
import { listDatabases } from "@/lib/storage-inspect";
import type { MemoryItem } from "@/lib/types";
import { countTables, isExplorerView, loadOcrDatabase, type ExplorerView, type OcrDatabase } from "./data";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { ItemFocus } from "./ItemFocus";
import { OcrView } from "./OcrView";
import { TableView } from "./TableView";

type Listed = { name: string; version: number | null }[] | null;

function explorerUrl(item: string, table: ExplorerView | null): string {
  const q = new URLSearchParams();
  if (item) q.set("item", item);
  if (table) q.set("table", table);
  const s = q.toString();
  return s ? `${ROUTES.explorer}?${s}` : ROUTES.explorer;
}

function smooth(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

async function safeCounts() {
  try {
    return await countTables();
  } catch {
    return null;
  }
}

async function focusRecord(id: string): Promise<MemoryItem | null> {
  if (!id) return null;
  try {
    return (await db.items.get(id)) ?? null;
  } catch {
    return null;
  }
}

export function StorageExplorer() {
  const params = useSearchParams();
  const router = useRouter();
  const focusId = (params.get("item") ?? "").trim();
  const tableParam = params.get("table");

  const counts = useLiveQuery(safeCounts, []);
  const focusItem = useLiveQuery(() => focusRecord(focusId), [focusId]);
  const [databases, setDatabases] = useState<Listed | undefined>(undefined);
  const [ocr, setOcr] = useState<OcrDatabase | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = await listDatabases();
      if (cancelled) return;
      setDatabases(listed);
      const summary = await loadOcrDatabase(0, listed);
      if (!cancelled) setOcr(summary);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The table to show: the one in the address, else the focused memory's original file, else memories.
  const explicit = isExplorerView(tableParam) ? tableParam : null;
  const waitingForFocus = !explicit && !!focusId && focusItem === undefined;
  const view: ExplorerView = explicit ?? (focusItem?.hasFile ? "files" : "items");

  const focusTables = useMemo(() => {
    const set = new Set<ExplorerView>();
    if (!focusItem) return set;
    set.add("items");
    if (focusItem.hasFile) set.add("files");
    if (focusItem.hasThumb) set.add("thumbs");
    if (focusItem.status === "ready" && (focusItem.text?.length ?? 0) > 0) set.add("chunks");
    if (focusItem.entityIds?.length) set.add("entities");
    return set;
  }, [focusItem]);

  const selectView = useCallback(
    (next: ExplorerView) => {
      router.replace(explorerUrl(focusId, next), { scroll: false });
    },
    [router, focusId],
  );

  const showTable = useCallback(
    (next: ExplorerView) => {
      selectView(next);
      requestAnimationFrame(() => document.getElementById("explorer-table")?.scrollIntoView({ behavior: smooth(), block: "start" }));
    },
    [selectView],
  );

  const focusOn = useCallback(
    (itemId: string) => {
      if (itemId === focusId) {
        window.scrollTo({ top: 0, behavior: smooth() });
        return;
      }
      router.push(explorerUrl(itemId, view), { scroll: false });
      window.scrollTo({ top: 0, behavior: smooth() });
    },
    [router, focusId, view],
  );

  const clearFocus = useCallback(() => {
    router.replace(explorerUrl("", explicit ?? view), { scroll: false });
  }, [router, explicit, view]);

  return (
    <div className="flex flex-col gap-6">
      {focusId ? (
        <ItemFocus key={focusId} id={focusId} onShowTable={showTable} onClose={clearFocus} />
      ) : (
        <p className="flex items-start gap-3 rounded-2xl border border-brand-500/15 bg-brand-500/[0.05] px-4 py-3 text-[13.5px] leading-relaxed text-zinc-700 dark:border-brand-400/15 dark:bg-brand-400/[0.07] dark:text-zinc-200">
          <Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500 dark:text-brand-300" />
          <span>
            Looking for one memory&apos;s file? Open it and choose <span className="font-semibold">Where is this stored?</span> → Show in storage
            explorer — or press <LocateFixed aria-hidden className="inline size-3.5 align-[-2px] text-brand-600 dark:text-brand-300" />
            <span className="sr-only">the locate button</span> on any row below. You&apos;ll see its exact address, its folder on this device, and every record it has.
          </span>
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <ExplorerSidebar view={view} onSelect={selectView} counts={counts} databases={databases} ocr={ocr} focusTables={focusTables} />
        <div className="min-w-0">
          {waitingForFocus ? (
            <div aria-hidden className="h-96 rounded-3xl border border-zinc-200/70 dark:border-white/10" />
          ) : view === "ocr" ? (
            databases === undefined ? (
              <div aria-hidden className="h-64 rounded-3xl border border-zinc-200/70 dark:border-white/10" />
            ) : (
              <OcrView listed={databases} onLoaded={setOcr} />
            )
          ) : (
            <TableView key={`${view}|${focusId}`} table={view} focusId={focusId} focusTitle={focusItem?.title} onFocus={focusOn} />
          )}
        </div>
      </div>
    </div>
  );
}
