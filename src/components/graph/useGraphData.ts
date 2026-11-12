"use client";
/**
 * Data for the graph screen: live library counts (so the graph rebuilds when memories are added,
 * edited, finish processing or are deleted) and the graph itself from `buildGraph`, rebuilt when
 * the filters change. `buildGraph` (and the search index it reads) is loaded on demand.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { db } from "@/lib/db";
import type { GraphData } from "@/lib/types";

export interface LibraryStats {
  total: number;
  ready: number;
  processing: number;
  /** Most recent `updatedAt` across all memories (changes on every add/edit/finish). */
  newest: number;
}

/** Live counts of memories; `undefined` while loading. */
export function useLibraryStats(): LibraryStats | undefined {
  return useLiveQuery(async () => {
    const [total, ready, processing, newest] = await Promise.all([
      db.items.count(),
      db.items.where("status").equals("ready").count(),
      db.items.where("status").equals("processing").count(),
      db.items.orderBy("updatedAt").reverse().limit(1).keys(),
    ]);
    return { total, ready, processing, newest: typeof newest[0] === "number" ? newest[0] : 0 };
  }, []);
}

export interface GraphQuery {
  /** Only names/numbers/topics shared by two or more memories. */
  sharedOnly: boolean;
  /** Add memory ↔ memory links between memories about the same thing. */
  similar: boolean;
  /** Only the neighbourhood of this node. */
  focusId?: string;
}

export interface GraphDataState {
  stats: LibraryStats | undefined;
  /** Latest built graph (kept while a newer one is being built); null before the first build. */
  data: GraphData | null;
  /** A build for the current filters/data is pending or running. */
  building: boolean;
  /** The last build for the current filters failed. */
  error: string | null;
  retry: () => void;
}

const EMPTY: GraphData = { nodes: [], links: [] };
/** Wait this long after library changes (e.g. a batch of files finishing) before rebuilding. */
const REBUILD_DELAY_MS = 450;

export function useGraphData(query: GraphQuery): GraphDataState {
  const stats = useLibraryStats();
  const [result, setResult] = useState<{ key: string; sig: string; data: GraphData } | null>(null);
  const [failure, setFailure] = useState<{ key: string; sig: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastKey = useRef<string | null>(null);

  const key = `${query.sharedOnly ? 1 : 0}|${query.similar ? 1 : 0}|${query.focusId ?? ""}`;
  const sig = stats ? `${stats.total}:${stats.ready}:${stats.newest}` : null;
  const hasReady = !!stats && stats.ready > 0;
  const { sharedOnly, similar, focusId } = query;

  // The library emptied: forget the old graph so it can't flash back when memories are added again.
  if (stats && !hasReady && (result || failure)) {
    setResult(null);
    setFailure(null);
  }

  useEffect(() => {
    if (!sig) return;
    if (!hasReady) {
      lastKey.current = null; // the next build (first memory ready) runs right away
      return;
    }
    let cancelled = false;
    // Filter changes rebuild right away; library changes are batched.
    const delay = lastKey.current === null || lastKey.current !== key ? 0 : REBUILD_DELAY_MS;
    lastKey.current = key;
    const timer = setTimeout(async () => {
      try {
        const { buildGraph } = await import("@/lib/graph/build");
        const data = await buildGraph({
          minItemsPerEntity: sharedOnly ? 2 : undefined,
          includeSimilar: similar,
          focusId,
        });
        if (cancelled) return;
        setResult({ key, sig, data });
        setFailure(null);
      } catch (err) {
        if (cancelled) return;
        console.warn("[remembos] graph build failed", err);
        setFailure({ key, sig, message: err instanceof Error ? err.message : String(err) });
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sig, key, hasReady, sharedOnly, similar, focusId, attempt]);

  const current = !!result && result.key === key && result.sig === sig;
  const failed = !!failure && failure.key === key && failure.sig === sig;
  return {
    stats,
    data: !stats ? null : hasReady ? (result?.data ?? null) : EMPTY,
    building: hasReady && !current && !failed,
    error: hasReady && failed && !current ? failure.message : null,
    retry: () => {
      setFailure(null);
      setAttempt((a) => a + 1);
    },
  };
}
