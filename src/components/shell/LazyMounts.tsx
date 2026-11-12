"use client";

/**
 * App-wide overlays that are loaded only when first needed, keeping every page's first load small:
 * the processing dock (when something is being processed), the note composer, the voice recorder, the
 * ⌘K palette and the install guide (when opened). Their code is fetched in idle time after the page
 * settles, so opening them still feels instant. Once loaded they stay mounted (exit animations, state).
 */
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { queueStore } from "@/lib/ingest/queue-store";
import { useStore } from "@/lib/store";
import { installHelpOpen, paletteOpen, quickAdd, recorderOpen } from "@/lib/ui-state";
import { usePaletteShortcuts } from "@/components/search/palette-shortcuts";

const loadDock = () => import("@/components/ingest/QueueDock").then((m) => m.QueueDock);
const loadQuickAdd = () => import("@/components/ingest/QuickAddDialog").then((m) => m.QuickAddDialog);
const loadRecorder = () => import("@/components/ingest/VoiceRecorderDialog").then((m) => m.VoiceRecorderDialog);
const loadPalette = () => import("@/components/search/CommandPalette").then((m) => m.CommandPalette);
const loadInstallHelp = () => import("./InstallHelpDialog").then((m) => m.InstallHelpDialog);

const QueueDock = dynamic(loadDock, { ssr: false });
const QuickAddDialog = dynamic(loadQuickAdd, { ssr: false });
const VoiceRecorderDialog = dynamic(loadRecorder, { ssr: false });
const CommandPalette = dynamic(loadPalette, { ssr: false });
const InstallHelpDialog = dynamic(loadInstallHelp, { ssr: false });

/** Returns true from the first time `active` is true, forever after. */
function useSticky(active: boolean): boolean {
  const [on, setOn] = useState(false);
  if (active && !on) setOn(true);
  return on || active;
}

export function LazyMounts() {
  usePaletteShortcuts();

  const hasJobs = useStore(queueStore).length > 0;
  const showDock = useSticky(hasJobs);
  const showQuickAdd = useSticky(useStore(quickAdd) !== null);
  const showRecorder = useSticky(useStore(recorderOpen));
  const showPalette = useSticky(useStore(paletteOpen));
  const showInstallHelp = useSticky(useStore(installHelpOpen));

  // Warm the code in idle time so the first open is instant.
  useEffect(() => {
    const warm = () => {
      for (const load of [loadDock, loadQuickAdd, loadPalette, loadRecorder, loadInstallHelp]) void load().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {showDock && <QueueDock />}
      {showQuickAdd && <QuickAddDialog />}
      {showRecorder && <VoiceRecorderDialog />}
      {showPalette && <CommandPalette />}
      {showInstallHelp && <InstallHelpDialog />}
    </>
  );
}
