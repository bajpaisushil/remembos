// "Ready for offline": download every on-device AI model in one go, so reading screenshots, meaning search and
// voice transcription work without internet. Runs automatically when Remembos is installed as an app (and on
// the first launch of an installed app), and from the "Get ready for offline" button.
import { toast } from "sonner";
import { MODELS } from "./config";
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
