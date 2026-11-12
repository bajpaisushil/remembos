"use client";

import { useEffect } from "react";
import { inspectStorage, type StorageInspection } from "@/lib/storage-inspect";
import { createStore, useStore } from "@/lib/store";
import { refreshStorage, storageStore } from "@/lib/storage/monitor";

export interface InspectionState {
  /** Latest snapshot; null until the first inspection finishes. */
  data: StorageInspection | null;
  loading: boolean;
}

/** One shared inspection for every live section of the page (cards, stats, inspector). */
export const inspectionStore = createStore<InspectionState>({ data: null, loading: false });

let inflight: Promise<StorageInspection | null> | null = null;
let lastStartedAt = 0;

/** Re-read everything (coalesces concurrent calls). Never rejects. */
export function refreshInspection(): Promise<StorageInspection | null> {
  if (inflight) return inflight;
  lastStartedAt = Date.now();
  inspectionStore.set((s) => ({ ...s, loading: true }));
  inflight = inspectStorage()
    .then((data) => {
      inspectionStore.set({ data, loading: false });
      return data;
    })
    .catch(() => {
      inspectionStore.set((s) => ({ ...s, loading: false }));
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Refresh the page's inspection and the app-wide storage meter together (Refresh buttons). */
export async function refreshAll(): Promise<void> {
  await Promise.all([refreshInspection(), refreshStorage().catch(() => null)]);
}

let watchers = 0;
let stopWatching: (() => void) | null = null;

/**
 * Keep the snapshot fresh while the page is open: re-inspect shortly after the app's storage meter
 * changes (a memory was added or deleted) and when the tab becomes visible again.
 */
function startWatching(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Date.now() - lastStartedAt > 1_500) void refreshInspection();
    }, 600);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") soon();
  };
  const unsubscribe = storageStore.subscribe(soon);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Live storage inspection shared by the whole page. Starts the first read on mount. */
export function useInspection(): InspectionState {
  const state = useStore(inspectionStore);
  useEffect(() => {
    if (!inspectionStore.get().data) void refreshInspection();
    watchers += 1;
    if (watchers === 1) stopWatching = startWatching();
    return () => {
      watchers -= 1;
      if (watchers === 0 && stopWatching) {
        stopWatching();
        stopWatching = null;
      }
    };
  }, []);
  return state;
}
