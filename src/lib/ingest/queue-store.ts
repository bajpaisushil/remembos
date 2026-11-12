// The live processing queue as a tiny standalone store, so UI that only *shows* progress (home, library cards,
// item page, the processing dock) doesn't pull the whole ingest pipeline into the first page load.
import { createStore, useStore } from "../store";
import type { QueueJob } from "../types";

/** Live processing queue for the UI (newest first). Finished jobs linger ~1 min (errors 5 min) then are pruned. */
export const queueStore = createStore<QueueJob[]>([]);

export function useQueue(): QueueJob[] {
  return useStore(queueStore);
}

/** Retry an item without loading the pipeline up front. */
export function retryItemLazy(itemId: string): Promise<void> {
  return import("./queue").then((m) => m.retryItem(itemId));
}
