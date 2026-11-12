"use client";

/**
 * "Use Remembos without internet" — the steps to do BEFORE switching the internet off, with live ticks:
 *   1. open Remembos once while online (the app saves itself on this device)
 *   2. install it as an app (recommended: opens from the Dock / Start menu / home screen with Wi-Fi off)
 *   3. download the AI models once (reading screenshots, meaning search, voice notes)
 *   4. done — safe to go offline
 * Used inline (Data and Help pages), as a dialog (offline pill, toasts) and as a heads-up card on home.
 */
import { Check, CloudDownload, Download, Plane, RefreshCw, Smartphone, WifiOff, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { isSnoozed, snooze, useSettings } from "@/lib/settings";
import {
  offlineDownloadBytes,
  offlinePrep,
  offlineReadiness,
  openOfflineSetup,
  prepareOffline,
  refreshOfflineReadiness,
} from "@/lib/offline";
import { useStore } from "@/lib/store";
import { offlineSetupOpen } from "@/lib/ui-state";
import { cn, formatBytes } from "@/lib/utils";
import { useOnline } from "./HeaderPills";
import { startInstall } from "./install-offer";

const MODEL_STEP_LABEL = { ocr: "text reader", embedder: "meaning search", whisper: "voice transcriber" } as const;

/** Keep readiness fresh while a view that shows it is on screen. */
export function useOfflineReadiness() {
  const readiness = useStore(offlineReadiness);
  useEffect(() => {
    void refreshOfflineReadiness();
    const again = () => void refreshOfflineReadiness();
    window.addEventListener("online", again);
    window.addEventListener("offline", again);
    document.addEventListener("visibilitychange", again);
    navigator.serviceWorker?.addEventListener?.("controllerchange", again);
    return () => {
      window.removeEventListener("online", again);
      window.removeEventListener("offline", again);
      document.removeEventListener("visibilitychange", again);
      navigator.serviceWorker?.removeEventListener?.("controllerchange", again);
    };
  }, []);
  return readiness;
}

type StepState = "done" | "todo" | "busy" | "blocked";

function StepIcon({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
        state === "done" && "bg-emerald-500 text-white",
        state === "todo" && "bg-brand-500/12 text-brand-700 ring-1 ring-brand-500/30 dark:text-brand-200",
        state === "busy" && "bg-brand-500/12 text-brand-700 dark:text-brand-200",
        state === "blocked" && "bg-zinc-900/5 text-zinc-400 dark:bg-white/[0.06] dark:text-zinc-500",
      )}
    >
      {state === "done" ? <Check className="size-4" strokeWidth={3} /> : state === "busy" ? <Spinner size="xs" /> : n}
    </span>
  );
}

function Step({
  n,
  state,
  title,
  children,
  action,
  testId,
}: {
  n: number;
  state: StepState;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  testId: string;
}) {
  return (
    <li className="flex gap-3" data-testid={testId} data-state={state}>
      <StepIcon state={state} n={n} />
      <div className="min-w-0 flex-1 pb-1">
        <p className={cn("text-[15px] font-medium", state === "blocked" ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100")}>
          {title}
          {state === "done" ? <span className="sr-only"> — done</span> : null}
        </p>
        {children ? <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{children}</div> : null}
        {action && state !== "done" ? <div className="mt-2">{action}</div> : null}
      </div>
    </li>
  );
}

/** The checklist with live ticks and one button per step. */
export function OfflineSetupSteps({ className }: { className?: string }) {
  const r = useOfflineReadiness();
  const prep = useStore(offlinePrep);
  const settings = useSettings();
  const online = useOnline();
  const bytes = formatBytes(offlineDownloadBytes(settings), 0);
  const modelsReady = r.models.ocr && r.models.embedder !== false && r.models.whisper !== false;
  const missing = (Object.keys(r.models) as (keyof typeof r.models)[]).filter((k) => r.models[k] === false).map((k) => MODEL_STEP_LABEL[k]);

  const step1: StepState = r.appSaved ? "done" : "todo";
  const step2: StepState = r.installed ? "done" : "todo";
  const step3: StepState = modelsReady ? "done" : prep.state === "preparing" ? "busy" : online ? "todo" : "blocked";
  const step4: StepState = r.ready ? "done" : "blocked";

  return (
    <div className={className} data-testid="offline-setup">
      <ol className="flex flex-col gap-4">
        <Step
          n={1}
          state={step1}
          testId="offline-step-open"
          title="Open Remembos once with internet"
          action={
            online ? (
              <Button size="sm" variant="secondary" leftIcon={<RefreshCw />} onClick={() => window.location.reload()}>
                Reload to save the app
              </Button>
            ) : null
          }
        >
          {r.appSaved
            ? "Remembos is saved on this device — every screen opens without internet."
            : online
              ? "The app saves itself in the background on your first visit. If this stays unticked, reload the page once."
              : "Connect to the internet and open Remembos once — it then saves itself on this device."}
        </Step>

        <Step
          n={2}
          state={step2}
          testId="offline-step-install"
          title="Install it as an app (recommended)"
          action={
            <Button size="sm" variant="secondary" leftIcon={<Smartphone />} onClick={startInstall} data-testid="offline-install">
              Install app
            </Button>
          }
        >
          {r.installed
            ? "Installed — open it from your Dock, Start menu or home screen, even with Wi-Fi off."
            : "Opens from your Dock, Start menu or home screen with Wi-Fi off, and installing downloads the AI models for you. (Skipping is fine — then keep using this same browser.)"}
        </Step>

        <Step
          n={3}
          state={step3}
          testId="offline-step-models"
          title={`Download the AI models once (about ${bytes})`}
          action={
            <Button
              size="sm"
              leftIcon={<CloudDownload />}
              loading={prep.state === "preparing"}
              disabled={!online}
              onClick={() => void prepareOffline("button")}
              data-testid="offline-ready"
            >
              {prep.state === "error" ? "Try again" : "Download now"}
            </Button>
          }
        >
          {modelsReady
            ? "Reading screenshots, meaning search and voice notes all work without internet."
            : prep.state === "preparing"
              ? `Downloading the ${prep.step ? MODEL_STEP_LABEL[prep.step] : "AI models"}… keep this page open.`
              : !online
                ? `Needs internet once. Missing now: ${missing.join(", ") || "AI models"} — everything else keeps working.`
                : `Still needed: ${missing.join(", ") || "AI models"}. They read screenshots, find things by meaning and transcribe voice — on your device.`}
        </Step>

        <Step n={4} state={step4} testId="offline-step-done" title={r.ready ? "Ready — you can switch off the internet" : "Then you can switch off the internet"}>
          {r.ready
            ? "Everything works offline. Your memories never needed the internet — they live on this device."
            : "Finish the steps above first. Without them, browsing, keyword search and adding things still work offline."}
        </Step>
      </ol>
    </div>
  );
}

/** Dialog version, opened from the offline pill, toasts and the home card. */
export function OfflineSetupDialog() {
  const open = useStore(offlineSetupOpen);
  return (
    <Dialog
      open={open}
      onClose={() => offlineSetupOpen.set(false)}
      title="Use Remembos without internet"
      description="Do these steps while you're still online — then switching the internet off changes nothing."
      icon={
        <span className="grid size-10 place-items-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-200">
          <Plane className="size-5" aria-hidden />
        </span>
      }
      data-testid="offline-setup-dialog"
      footer={
        <Button variant="secondary" onClick={() => offlineSetupOpen.set(false)}>
          Close
        </Button>
      }
    >
      <OfflineSetupSteps />
    </Dialog>
  );
}

const CARD_SNOOZE = "offline-setup-card";

/** Home heads-up: shown while online and not yet ready for offline. */
export function OfflineSetupCard() {
  const r = useOfflineReadiness();
  const online = useOnline();
  const settings = useSettings();
  if (!r.checked || r.ready || !online || isSnoozed(CARD_SNOOZE)) return null;
  void settings; // re-render when snoozing (settings change)
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between"
      data-testid="offline-setup-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-700 dark:text-sky-200">
          <WifiOff className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">Going to use Remembos without internet?</p>
          <p className="text-sm text-muted">Set it up first while you&apos;re online — about a minute. Then everything works offline.</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" leftIcon={<Download />} onClick={openOfflineSetup} data-testid="offline-setup-open">
          Set up offline use
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Hide for now" onClick={() => snooze(CARD_SNOOZE, 30)} data-testid="offline-setup-dismiss">
          <X />
        </Button>
      </div>
    </div>
  );
}
