"use client";

/**
 * Danger zone: "Delete everything" with a typed confirmation, an optional "also remove downloaded
 * AI models" choice and a last-chance backup button. Afterwards the app restarts fresh.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Bomb, FileDown, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ROUTES } from "@/lib/config";
import { db } from "@/lib/db";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { assetUrl, formatBytes } from "@/lib/utils";
import { modelCacheStore } from "./model-cache";
import { Panel } from "./shared";

async function countItems(): Promise<number | null> {
  try {
    return await db.items.count();
  } catch {
    return null;
  }
}

export function DangerZone() {
  const count = useLiveQuery(countItems, []);
  const models = useStore(modelCacheStore);
  const [open, setOpen] = useState(false);
  const [includeModels, setIncludeModels] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restarting, setRestarting] = useState(false);

  function openDialog() {
    setIncludeModels(false);
    setOpen(true);
  }

  async function backupFirst() {
    setBackingUp(true);
    try {
      const { downloadBackup } = await import("@/lib/storage/backup");
      await downloadBackup();
    } finally {
      setBackingUp(false);
    }
  }

  async function deleteEverything() {
    const { clearAllData } = await import("@/lib/storage/clear");
    await clearAllData({ includeModels });
    setRestarting(true);
    // Give the "all clear" message a moment, then start fresh (drops in-memory queues and models).
    window.setTimeout(() => window.location.assign(assetUrl(ROUTES.home)), 1600);
  }

  const n = typeof count === "number" ? count : null;

  return (
    <Panel
      id="danger"
      icon={<TriangleAlert />}
      tone="rose"
      variant="danger"
      title="Danger zone"
      description="Start over on this device. This can't be undone, so download a backup first if you might want anything back."
      data-testid="danger-zone"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between dark:border-rose-400/20 dark:bg-rose-400/[0.05]">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">Delete everything</h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            {n === 0
              ? "Removes everything Remembos keeps in this browser — settings, search data and any leftovers."
              : `Removes ${n === null ? "all memories" : n === 1 ? "your 1 memory" : `all ${n.toLocaleString()} memories`}, original files, search data and settings from this browser.`}
          </p>
        </div>
        <Button variant="danger" leftIcon={<Bomb />} onClick={openDialog} className="shrink-0" data-testid="delete-everything">
          Delete everything
        </Button>
      </div>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete everything?"
        description={
          <>
            This permanently removes{" "}
            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
              {n === null || n === 0 ? "everything Remembos keeps" : n === 1 ? "your 1 memory" : `all ${n.toLocaleString()} memories`}
            </strong>
            {n ? ", their original files, search data and your settings" : " — memories, search data and your settings —"} from this browser. There
            is no undo.
          </>
        }
        confirmLabel="Delete everything"
        danger
        requireText="DELETE"
        onConfirm={deleteEverything}
        data-testid="delete-everything-dialog"
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-xl bg-amber-500/[0.08] px-3 py-2.5 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300" data-testid="erase-traces-note">
            Original files are erased from your disk right away. Text can leave traces inside the browser&apos;s own
            database files until the browser tidies them up later — websites can&apos;t force that. To wipe every trace
            now, also delete this site&apos;s data in your browser (Chrome: click the icon left of the address → Site
            settings → Delete data).
          </p>
          {n ? (
            <div className="flex flex-col gap-2 rounded-xl border border-zinc-200/80 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
              <span className="text-[13px] text-zinc-700 dark:text-zinc-300">Want a copy first?</span>
              <Button size="sm" variant="secondary" leftIcon={<FileDown />} loading={backingUp} onClick={backupFirst} data-testid="delete-backup-first">
                Download backup
              </Button>
            </div>
          ) : null}
          <label className="flex items-start gap-2.5 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 dark:bg-white/[0.04] dark:text-zinc-300">
            <input
              type="checkbox"
              checked={includeModels}
              onChange={(e) => setIncludeModels(e.currentTarget.checked)}
              className="mt-0.5 size-4 shrink-0 accent-rose-600"
              data-testid="delete-include-models"
            />
            <span>
              Also remove downloaded AI models{models.bytes ? ` (${formatBytes(models.bytes)})` : ""}
              <span className="block text-xs text-muted">Otherwise they stay, so you won&apos;t need to download them again.</span>
            </span>
          </label>
        </div>
      </ConfirmDialog>

      {restarting ? <RestartingOverlay /> : null}
    </Panel>
  );
}

function RestartingOverlay() {
  return createPortal(
    <div
      role="status"
      aria-live="assertive"
      className="fixed inset-0 z-[120] grid animate-fade-in place-items-center bg-canvas/85 backdrop-blur-sm"
      data-testid="restarting"
    >
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <span className="brand-gradient grid size-14 place-items-center rounded-2xl text-white shadow-glow">
          <Spinner size="md" />
        </span>
        <p className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">All clear</p>
        <p className="max-w-xs text-sm text-muted">Everything was removed from this browser. Starting fresh…</p>
      </div>
    </div>,
    document.body,
  );
}
