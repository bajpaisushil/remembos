"use client";
// "Install app" entry points (header menu, add sheet): when to offer it and what it does.
import { installState, promptInstall } from "@/lib/pwa";
import { useStore } from "@/lib/store";
import { installHelpOpen } from "@/lib/ui-state";

/**
 * Offer "Install app" only where it can work right now: the browser handed us an install prompt, or it's an
 * iPhone/iPad (Share → Add to Home Screen). Never once Remembos already runs as an installed app.
 */
export function useInstallOffer(): boolean {
  const { canInstall, installed, platform } = useStore(installState);
  return !installed && (canInstall || platform === "ios");
}

/** Show the browser's install dialog, or the step-by-step instructions when there is no dialog to show. */
export function startInstall(): void {
  if (installState.get().canInstall) {
    // `prompt()` runs synchronously inside this click (promptInstall calls it before its first await).
    void promptInstall();
    return;
  }
  installHelpOpen.set(true);
}
