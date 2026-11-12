// "Ready for offline": download every on-device AI model in one go, so reading screenshots, meaning search and
// voice transcription work without internet. Runs automatically when Remembos is installed as an app (and on
// the first launch of an installed app), and from the "Get ready for offline" button.
import { toast } from "sonner";
import { EMBEDDING_MODEL, MODELS, STORAGE_NAMES, WHISPER_MODEL } from "./config";
import { getSettings, updateSettings, type Settings } from "./settings";
import { createStore } from "./store";
import { formatBytes } from "./utils";

export interface OfflinePrep {
  state: "idle" | "preparing" | "ready" | "error";
  /** Model currently downloading. */
  step?: "ocr" | "embedder" | "whisper";
  error?: string;
}

export const offlinePrep = createStore<OfflinePrep>({ state: "idle" });

let running: Promise<boolean> | null = null;

/** Bytes the enabled models need (approximate). Pass the settings a component renders with (hydration-safe). */
export function offlineDownloadBytes(s: Pick<Settings, "semanticSearch" | "transcribeAudio"> = getSettings()): number {
  return MODELS.ocr.approxBytes + (s.semanticSearch ? MODELS.embedder.approxBytes : 0) + (s.transcribeAudio ? MODELS.whisper.approxBytes : 0);
}

/**
 * Download (or load from this device, when already downloaded) every enabled AI model. Single-flight; resolves
 * true when all are ready. `reason` only changes the wording of the notification.
 */
export function prepareOffline(reason: "install" | "first-launch" | "button" = "button"): Promise<boolean> {
  if (running) return running;
  running = (async () => {
    const id = "offline-ready";
    const settings = getSettings();
    const total = formatBytes(offlineDownloadBytes());
    const lead = reason === "button" ? "Getting ready for offline…" : "Setting up offline use…";
    toast.loading(lead, {
      id,
      description: `Downloading the AI models once (about ${total}) so screenshots, search and voice notes work without internet.`,
    });
    offlinePrep.set({ state: "preparing" });
    try {
      offlinePrep.set({ state: "preparing", step: "ocr" });
      const { warmupOcr } = await import("./ingest/ocr");
      await warmupOcr();
      if (settings.semanticSearch) {
        offlinePrep.set({ state: "preparing", step: "embedder" });
        const { loadEmbedder } = await import("./ai/embedder");
        await loadEmbedder();
      }
      if (settings.transcribeAudio) {
        offlinePrep.set({ state: "preparing", step: "whisper" });
        const { warmupWhisper } = await import("./ingest/transcribe");
        await warmupWhisper();
      }
      updateSettings({ offlinePreparedAt: Date.now() });
      offlinePrep.set({ state: "ready" });
      void refreshOfflineReadiness();
      toast.success("Ready for offline", {
        id,
        description: "Remembos now works fully without internet — reading screenshots, meaning search and voice notes included.",
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Check your connection";
      offlinePrep.set({ state: "error", error: message });
      toast.error("Couldn't finish the offline setup", {
        id,
        description: `${message} — it will try again next time you open Remembos online. Keyword search always works offline.`,
        action: { label: "Try again", onClick: () => void prepareOffline("button") },
      });
      return false;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Installed app opened for the first time (or set up before this existed) and not prepared yet → prepare. */
export function prepareOfflineIfNeeded(): void {
  if (getSettings().offlinePreparedAt || !navigator.onLine) return;
  void prepareOffline("first-launch");
}

// ---------------------------------------------------------------------------------------------
// Readiness: what still needs to happen before the internet can be switched off
// ---------------------------------------------------------------------------------------------

export interface OfflineReadiness {
  /** A check has completed at least once. */
  checked: boolean;
  /** The service worker controls this page and its offline copy exists. */
  appSaved: boolean;
  /** Running as an installed app (recommended, not required). */
  installed: boolean;
  /** Per model: on this device? `null` = not needed (switched off in settings). */
  models: { ocr: boolean; embedder: boolean | null; whisper: boolean | null };
  /** Everything needed to work fully offline is on this device. */
  ready: boolean;
}

export const offlineReadiness = createStore<OfflineReadiness>({
  checked: false,
  appSaved: false,
  installed: false,
  models: { ocr: false, embedder: null, whisper: null },
  ready: false,
});

async function cachedModel(model: string): Promise<boolean> {
  try {
    if (typeof caches === "undefined" || !(await caches.has(STORAGE_NAMES.modelCaches[0]))) return false;
    const keys = await (await caches.open(STORAGE_NAMES.modelCaches[0])).keys();
    return keys.some((r) => r.url.includes(`/${model}/`) && /\.onnx(?:$|\?)/.test(r.url));
  } catch {
    return false;
  }
}

async function ocrDataSaved(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return false;
    return (await indexedDB.databases()).some((d) => d.name === STORAGE_NAMES.ocrDb);
  } catch {
    return false;
  }
}

async function appCopySaved(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return false;
    return (await caches.keys()).some((k) => k.startsWith(STORAGE_NAMES.swCachePrefix));
  } catch {
    return false;
  }
}

let checking: Promise<OfflineReadiness> | null = null;

/** Re-check readiness (cheap: cache and database listings only). */
export function refreshOfflineReadiness(): Promise<OfflineReadiness> {
  if (typeof window === "undefined") return Promise.resolve(offlineReadiness.get());
  checking ??= (async () => {
    try {
      const s = getSettings();
      const { installState } = await import("./pwa");
      const [appSaved, ocr, embedder, whisper] = await Promise.all([
        appCopySaved(),
        ocrDataSaved(),
        s.semanticSearch ? cachedModel(EMBEDDING_MODEL) : Promise.resolve(null),
        s.transcribeAudio ? cachedModel(WHISPER_MODEL) : Promise.resolve(null),
      ]);
      const models = { ocr, embedder, whisper };
      const ready = appSaved && ocr && embedder !== false && whisper !== false;
      const next: OfflineReadiness = { checked: true, appSaved, installed: installState.get().installed, models, ready };
      offlineReadiness.set(next);
      return next;
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/** Open the "Use Remembos offline" steps. */
export function openOfflineSetup(): void {
  void import("./ui-state").then((m) => m.offlineSetupOpen.set(true));
}
