"use client";
// Called once from the app shell on the client. Wires background services together.
import { hydrateSettings, getSettings, settingsStore } from "./settings";
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

  // Connection changes: catch up on memories that waited for the internet, and warn (once) when the
  // connection drops before Remembos was set up for offline use.
  const onOnline = () => {
    void retryWaitingForInternet();
    void import("./offline").then((m) => m.refreshOfflineReadiness());
  };
  const onOffline = () => void warnIfNotReadyForOffline();
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  if (navigator.onLine) idle(() => void retryWaitingForInternet());
  else idle(() => void warnIfNotReadyForOffline());

  // Scanned memories read before a language was added (e.g. Hindi) are read again with it, automatically.
  idle(() => void rereadWithNewLanguages());
  let langs = getSettings().ocrLanguages;
  const unsubscribeLangs = settingsStore.subscribe(() => {
    const next = getSettings().ocrLanguages;
    if (next !== langs) {
      langs = next;
      void rereadWithNewLanguages();
    }
  });

  return () => {
    started = false;
    stopWatcher();
    removePaste();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    unsubscribeLangs();
  };
}

let rereading = false;

/** Re-read scanned memories (photos, scanned PDFs, video frames) that were read without a language now on. */
async function rereadWithNewLanguages(): Promise<void> {
  if (rereading) return;
  rereading = true;
  try {
    const wanted = getSettings().ocrLanguages.split("+");
    const stale = await db.items
      .filter((i) => {
        if (i.ocrConfidence === undefined || !i.hasFile || i.status !== "ready") return false;
        const used = (i.ocrLangs ?? "eng").split("+");
        return wanted.some((l) => !used.includes(l));
      })
      .toArray();
    if (!stale.length) return;
    const { toast } = await import("sonner");
    const { retryItem } = await import("./ingest");
    const added = wanted.filter((l) => l !== "eng").join(", ") || "the new languages";
    toast.info(`Reading ${stale.length} scanned ${stale.length === 1 ? "memory" : "memories"} again`, {
      id: "reread-languages",
      description: `So text in ${added} becomes readable and searchable too.`,
    });
    for (const item of stale) await retryItem(item.id).catch(() => {});
  } catch (err) {
    console.warn("[remembos] couldn't re-read scanned memories", err);
  } finally {
    rereading = false;
  }
}

/** Memories that couldn't be read offline (an AI model wasn't downloaded yet) — read them now. */
async function retryWaitingForInternet(): Promise<void> {
  try {
    const { OFFLINE_WAIT_MESSAGE } = await import("./ingest/errors");
    const waiting = await db.items
      .where("status")
      .equals("error")
      .filter((i) => i.error === OFFLINE_WAIT_MESSAGE)
      .primaryKeys();
    if (!waiting.length) return;
    const { retryItem } = await import("./ingest");
    for (const id of waiting) await retryItem(id as string).catch(() => {});
  } catch (err) {
    console.warn("[remembos] couldn't resume memories waiting for internet", err);
  }
}

let warnedOffline = false;

/** Gone offline before finishing the offline setup → one calm notice with the steps. */
async function warnIfNotReadyForOffline(): Promise<void> {
  if (warnedOffline) return;
  const { refreshOfflineReadiness, openOfflineSetup } = await import("./offline");
  const readiness = await refreshOfflineReadiness();
  if (readiness.ready || navigator.onLine) return;
  warnedOffline = true;
  const { toast } = await import("sonner");
  toast.warning("You're offline — Remembos isn't fully set up for it yet", {
    id: "offline-not-ready",
    description:
      "Browsing, keyword search and adding things keep working. Reading screenshots, meaning search and voice notes need a one-time download first; what you add now is read automatically once you're back online.",
    duration: 12_000,
    action: { label: "Offline steps", onClick: openOfflineSetup },
  });
}
