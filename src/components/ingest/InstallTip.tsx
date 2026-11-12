"use client";

import { MonitorDown, Smartphone, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useMounted } from "@/lib/hooks";
import { installState, promptInstall } from "@/lib/pwa";
import { snooze, useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { installHelpOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

const SNOOZE_KEY = "install-tip";
const SNOOZE_DAYS = 30;

function stillSnoozed(until: number | undefined): boolean {
  return typeof until === "number" && until > Date.now();
}

/**
 * Gentle "install as an app" suggestion under Recent memories, once there is something worth keeping.
 * Shown only when the browser can install Remembos (or on iPhone/iPad Safari, which gets Add to Home Screen
 * steps) and it isn't installed yet. "Not now" hides it for 30 days.
 */
export function InstallTip({ hasMemories }: { hasMemories: boolean }) {
  const mounted = useMounted();
  const { canInstall, installed, platform } = useStore(installState);
  const { snoozed } = useSettings();
  const [busy, setBusy] = useState(false);

  const offered = canInstall || platform === "ios";
  if (!mounted || !hasMemories || installed || !offered || stillSnoozed(snoozed[SNOOZE_KEY])) return null;

  async function install() {
    if (platform === "ios" || !canInstall) {
      installHelpOpen.set(true);
      return;
    }
    setBusy(true);
    try {
      await promptInstall();
    } catch (err) {
      console.warn("[remembos] install prompt failed", err);
      installHelpOpen.set(true);
    } finally {
      setBusy(false);
    }
  }

  const Icon = platform === "ios" ? Smartphone : MonitorDown;

  return (
    <aside
      aria-labelledby="install-tip-title"
      data-testid="install-tip"
      className={cn(
        "relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 overflow-hidden rounded-2xl border px-4 py-3.5 sm:flex-nowrap sm:px-5",
        "border-brand-500/15 bg-white/80 shadow-soft dark:border-brand-400/20 dark:bg-white/[0.04]",
        "animate-slide-up motion-reduce:animate-none",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_120%_at_0%_50%,rgb(139_92_246/0.10),transparent_70%)] dark:bg-[radial-gradient(50%_120%_at_0%_50%,rgb(139_92_246/0.18),transparent_70%)]"
      />
      <span
        aria-hidden
        className="brand-gradient relative inline-grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-[0_8px_20px_-8px_rgb(139_92_246/0.8)] ring-1 ring-white/25 ring-inset"
      >
        <Icon className="size-5" />
      </span>
      <div className="relative min-w-0 flex-1 basis-56">
        <p id="install-tip-title" className="text-sm font-semibold text-zinc-900 dark:text-white">
          Install Remembos as an app
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          Opens instantly, works offline, and your browser keeps your memories safer.
        </p>
      </div>
      <div className="relative ml-auto flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={() => void install()} loading={busy} data-testid="install-tip-install">
          {platform === "ios" ? "Show me how" : "Install"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => snooze(SNOOZE_KEY, SNOOZE_DAYS)}
          data-testid="install-tip-dismiss"
          leftIcon={<X />}
          aria-label="Not now — hide this for 30 days"
        >
          Not now
        </Button>
      </div>
    </aside>
  );
}
