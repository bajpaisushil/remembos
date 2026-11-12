"use client";
// Called once from the app shell on the client. Wires background services together.
import { hydrateSettings, getSettings } from "./settings";
import { startStorageWatcher } from "./storage/monitor";
import { installPasteHandler, resumeInterrupted } from "./ingest";
import { backfillEmbeddings, ensureIndex } from "./search";
import { warmupEmbedder } from "./ai/embedder";
import { db } from "./db";

let started = false;

export function bootstrap(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;
  hydrateSettings();
  const stopWatcher = startStorageWatcher();
  const removePaste = installPasteHandler();

  // Defer heavier work until the page is idle.
  const idle = (cb: () => void) => {
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 3000 });
    else setTimeout(cb, 1200);
  };
  idle(async () => {
    try {
      // Nothing stored yet → nothing to resume, index or embed. Never download models for an empty memory.
      const count = await db.items.count();
      if (count === 0) return;
      await resumeInterrupted();
      await ensureIndex();
      if (getSettings().semanticSearch) {
        warmupEmbedder();
        void backfillEmbeddings();
      }
    } catch (err) {
      console.warn("[remembos] background start failed", err);
    }
  });

  return () => {
    started = false;
    stopWatcher();
    removePaste();
  };
}
