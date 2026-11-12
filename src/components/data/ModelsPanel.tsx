"use client";

/**
 * "AI models on this device": the three local helpers (meaning search, text reader, voice
 * transcriber) with what they do, their size, whether they are downloaded / loading / ready, and
 * a way to download meaning search now or remove every downloaded model file.
 */
import { AudioLines, BrainCircuit, CircleCheck, CloudDownload, Cpu, RefreshCw, ScanText, Trash2, TriangleAlert, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { warmupEmbedder, embedderStatus } from "@/lib/ai/embedder";
import { offlineDownloadBytes, offlinePrep, prepareOffline } from "@/lib/offline";
import { MODELS, OCR_LANG_DEFAULT } from "@/lib/config";
import { ocrStatus } from "@/lib/ingest/ocr";
import { whisperStatus } from "@/lib/ingest/transcribe";
import { backfillEmbeddings } from "@/lib/search";
import { updateSettings, useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import type { ModelId, ModelStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Progress } from "@/components/ui/Progress";
import { cn, formatBytes } from "@/lib/utils";
import { modelCacheStore, refreshModelCaches } from "./model-cache";
import { IconChip, InlineSkeleton, Panel, type ChipTone } from "./shared";
import { ocrLanguageNames, parseOcrLanguages } from "./ocr-languages";

interface StatusView {
  tone: BadgeTone;
  label: string;
  /** Show a progress bar (0..1) or an indeterminate one (null). */
  progress?: number | null;
  detail?: string;
}

function describe(status: ModelStatus, cached: boolean | null, enabled: boolean, offLabel: string): StatusView {
  if (!enabled) return { tone: "neutral", label: "Off", detail: offLabel };
  switch (status.state) {
    case "loading": {
      const p = typeof status.progress === "number" && status.progress > 0 ? status.progress : null;
      const pct = p === null ? "" : ` ${Math.round(p * 100)}%`;
      const bytes =
        status.loadedBytes && status.totalBytes ? `${formatBytes(status.loadedBytes)} of ${formatBytes(status.totalBytes)}` : undefined;
      return { tone: "brand", label: `${cached ? "Starting" : "Downloading"}${pct}`, progress: p, detail: bytes };
    }
    case "ready":
      return {
        tone: "success",
        label: "Ready",
        detail: status.device === "webgpu" ? "Running on your graphics chip" : status.device === "wasm" ? "Running on your processor" : undefined,
      };
    case "error":
      return { tone: "danger", label: "Couldn't download", detail: status.error || "Check your internet connection, then try again." };
    default:
      if (cached === true) return { tone: "info", label: "On this device", detail: "Downloaded — starts when needed" };
      if (cached === false) return { tone: "neutral", label: "Not downloaded" };
      return { tone: "neutral", label: "Downloads when needed" };
  }
}

export function ModelsPanel() {
  const settings = useSettings();
  const emb = useStore(embedderStatus);
  const ocr = useStore(ocrStatus);
  const whisper = useStore(whisperStatus);
  const caches = useStore(modelCacheStore);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const langs = parseOcrLanguages(settings.ocrLanguages || OCR_LANG_DEFAULT);
  const extraLangs = Math.max(0, langs.length - 1);

  function downloadEmbedder() {
    if (!settings.semanticSearch) updateSettings({ semanticSearch: true });
    warmupEmbedder({ userRequested: true });
    void backfillEmbeddings();
  }

  const prep = useStore(offlinePrep);
  const preparing = prep.state === "preparing";
  const offlineReady =
    prep.state === "ready" ||
    (!!settings.offlinePreparedAt &&
      caches.ocr !== false &&
      (!settings.semanticSearch || caches.embedder !== false) &&
      (!settings.transcribeAudio || caches.whisper !== false)) ||
    (ocr.state === "ready" &&
      (!settings.semanticSearch || emb.state === "ready") &&
      (!settings.transcribeAudio || whisper.state === "ready"));
  const offlineBytes = offlineDownloadBytes(settings);

  /** Download every model now, so screenshots, meaning search and voice also work without internet. */
  async function getReadyForOffline() {
    await prepareOffline("button");
    await refreshModelCaches();
  }

  async function removeModels() {
    const { clearModelCaches } = await import("@/lib/storage/clear");
    const freed = await clearModelCaches();
    await refreshModelCaches();
    toast.success("Downloaded AI models removed", {
      id: "models-removed",
      description: `${freed > 0 ? `Freed about ${formatBytes(freed)}. ` : ""}Your memories are untouched. Each helper downloads again the next time it's needed.`,
    });
  }

  const anyBusy = emb.state === "loading" || ocr.state === "loading" || whisper.state === "loading";
  const nothingDownloaded = caches.bytes === 0 && caches.embedder !== true && caches.whisper !== true && caches.ocr !== true;

  const embView = describe(emb, caches.embedder, settings.semanticSearch, "Meaning search is switched off in Settings");
  const ocrView = describe(ocr, caches.ocr, true, "");
  const whisperView = describe(whisper, caches.whisper, settings.transcribeAudio, "Voice transcription is switched off in Settings");

  return (
    <Panel
      id="models"
      icon={<Cpu />}
      tone="sky"
      title="AI models on this device"
      description="Small helpers that run inside your browser. Only the model files are downloaded (once, from jsDelivr and Hugging Face) — your memories never leave this device."
      data-testid="models-panel"
    >
      <div
        className="mb-4 flex flex-col gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"
        data-testid="offline-ready-card"
      >
        <div className="flex min-w-0 items-start gap-3">
          <IconChip tone="sky"><WifiOff /></IconChip>
          <div className="min-w-0">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">{offlineReady ? "Ready for offline" : "Get ready for offline"}</p>
            <p className="text-sm text-muted">
              {offlineReady
                ? "Every AI model is on this device — Remembos works fully without internet."
                : `Download every AI model now (about ${formatBytes(offlineBytes)}, once) so reading screenshots, meaning search and voice notes also work without internet.`}
            </p>
          </div>
        </div>
        {offlineReady ? (
          <Badge tone="success" icon={<CircleCheck />}>
            Offline ready
          </Badge>
        ) : (
          <Button size="sm" leftIcon={<CloudDownload />} onClick={() => void getReadyForOffline()} loading={preparing} data-testid="offline-ready" className="shrink-0">
            Get ready for offline
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        <ModelRow
          id="embedder"
          icon={<BrainCircuit />}
          tone="violet"
          view={embView}
          note={
            settings.semanticSearch
              ? emb.state === "ready"
                ? undefined
                : "Downloads by itself the first time you search or add a memory — or get it now."
              : "Keyword search still finds exact words."
          }
          action={
            emb.state === "ready" || emb.state === "loading" ? null : (
              <Button
                size="sm"
                variant={emb.state === "error" ? "secondary" : "soft"}
                leftIcon={emb.state === "error" ? <RefreshCw /> : <CloudDownload />}
                onClick={downloadEmbedder}
                data-testid="model-download-embedder"
              >
                {emb.state === "error" ? "Try again" : !settings.semanticSearch ? "Turn on & download" : caches.embedder ? "Load now" : "Download now"}
              </Button>
            )
          }
        />
        <ModelRow
          id="ocr"
          icon={<ScanText />}
          tone="brand"
          view={ocrView}
          note={
            <>
              Downloads by itself the first time you add a screenshot, photo, scanned PDF or video. Reading {ocrLanguageNames(langs)}
              {extraLangs > 0 ? ` — each extra language adds a few MB` : ""}.
            </>
          }
        />
        <ModelRow
          id="whisper"
          icon={<AudioLines />}
          tone="amber"
          view={whisperView}
          note={settings.transcribeAudio ? "Downloads by itself the first time you add a voice recording or a video." : "Recordings and videos are still saved — what's said just isn't turned into text."}
        />
      </ul>

      <div className="mt-5 flex flex-col gap-3 border-t border-zinc-200/70 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
        <p className="text-sm text-muted">
          Downloaded model files use{" "}
          <span className="font-semibold text-zinc-900 tabular-nums dark:text-white" data-testid="models-bytes">
            {caches.bytes === null ? <InlineSkeleton className="h-3.5 w-12" /> : formatBytes(caches.bytes)}
          </span>
          . Removing them frees space; they download again when needed.
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<Trash2 />}
          onClick={() => setConfirmOpen(true)}
          disabled={nothingDownloaded}
          data-testid="remove-models"
        >
          Remove downloaded models
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Remove downloaded AI models?"
        description={
          <>
            This frees {caches.bytes ? <>about {formatBytes(caches.bytes)}</> : "the space they use"}. Your memories, their text and keyword
            search stay exactly as they are.
          </>
        }
        confirmLabel="Remove models"
        danger
        onConfirm={removeModels}
        data-testid="remove-models-dialog"
      >
        <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-2">
            <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            Each helper downloads again (needs internet) the next time you add a file or search by meaning.
          </li>
          {anyBusy ? (
            <li className="flex gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-500" />
              A model is loading or working right now — it will be stopped.
            </li>
          ) : null}
        </ul>
      </ConfirmDialog>
    </Panel>
  );
}

function ModelRow({ id, icon, tone, view, action, note }: { id: ModelId; icon: ReactNode; tone: ChipTone; view: StatusView; action?: ReactNode; note?: ReactNode }) {
  const meta = MODELS[id];
  return (
    <li
      className="rounded-2xl border border-zinc-200/70 p-4 dark:border-white/[0.08]"
      data-testid={`model-${id}`}
      data-state={view.label}
    >
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-3">
        <IconChip tone={tone}>{icon}</IconChip>
        <div className="min-w-0 flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{meta.label}</h3>
            <span className="text-xs font-medium text-muted tabular-nums">≈ {formatBytes(meta.approxBytes, 0)}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{meta.purpose}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge tone={view.tone} dot pulse={view.tone === "brand"} data-testid={`model-status-${id}`}>
            {view.label}
          </Badge>
          {action}
        </div>
      </div>
      {view.progress !== undefined ? (
        <div className="mt-3.5">
          <Progress value={view.progress ?? 0} indeterminate={view.progress === null} size="sm" label={`${meta.label} download`} />
        </div>
      ) : null}
      {view.detail || note ? (
        <p className={cn("mt-3 text-[13px] leading-relaxed", view.tone === "danger" ? "text-rose-700 dark:text-rose-300" : "text-muted")}>
          {view.detail}
          {view.detail && note ? " · " : null}
          {note}
        </p>
      ) : null}
    </li>
  );
}
