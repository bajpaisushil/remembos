"use client";

/**
 * Backups: download everything as one .zip (with live progress), export the text as Markdown,
 * restore from a backup file, and a gentle reminder of when the last backup was made.
 */
import { ArchiveRestore, CircleCheck, Clock, FileDown, FileText, LifeBuoy, PackageCheck } from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { db } from "@/lib/db";
import { useMounted } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import type { BackupProgress } from "@/lib/storage/backup";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { STORAGE_THRESHOLDS } from "@/lib/config";
import { downloadBlob, formatBytes, formatDate, timeAgo } from "@/lib/utils";
import { Callout, InlineSkeleton, Panel } from "./shared";

type Activity =
  | { kind: "export"; progress: BackupProgress | null }
  | { kind: "restore"; progress: BackupProgress | null; fileName: string }
  | { kind: "markdown" };

type Result = { kind: "export"; text: string } | { kind: "restore"; text: string } | { kind: "restore-failed"; text: string };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** True when there has never been a backup, or the last one is older than the reminder interval. */
function backupIsStale(lastBackupAt: number | undefined): boolean {
  return !lastBackupAt || Date.now() - lastBackupAt > STORAGE_THRESHOLDS.backupNudgeDays * 86_400_000;
}

function fraction(p: BackupProgress | null): number | null {
  if (!p || !p.total) return null;
  return Math.min(1, Math.max(0, p.done / p.total));
}

export function BackupPanel() {
  const settings = useSettings();
  const mounted = useMounted();
  const fileInput = useRef<HTMLInputElement>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const busy = activity !== null;

  async function exportZip() {
    if (busy) return;
    setResult(null);
    setActivity({ kind: "export", progress: null });
    try {
      const count = await db.items.count();
      if (!count) {
        toast.info("Nothing to back up yet", {
          id: "backup-download",
          description: "Add a memory first — then you can download a backup of everything.",
        });
        return;
      }
      const mod = await import("@/lib/storage/backup");
      try {
        const res = await mod.exportBackup((p) => setActivity({ kind: "export", progress: p }));
        downloadBlob(res.blob, res.filename);
        const text = `${res.filename} · ${formatBytes(res.blob.size)} · ${plural(res.items, "memory", "memories")}`;
        setResult({ kind: "export", text });
        toast.success("Backup downloaded", {
          id: "backup-download",
          description: `${text}. Keep it somewhere safe, like a cloud drive or USB stick.`,
          duration: 10_000,
        });
      } catch (err) {
        if (err instanceof mod.BackupError) {
          toast.error(err.title, { id: "backup-download", description: err.hint, duration: 15_000 });
          err.handled = true;
        } else throw err;
      }
    } catch (err) {
      console.warn("[remembos] backup failed", err);
      toast.error("Couldn't create the backup", {
        id: "backup-download",
        description: "Something went wrong while reading your memories. Reload the page and try again — nothing was changed.",
        duration: 15_000,
      });
    } finally {
      setActivity(null);
    }
  }

  async function exportMarkdown() {
    if (busy) return;
    setResult(null);
    setActivity({ kind: "markdown" });
    try {
      const { downloadMarkdown } = await import("@/lib/storage/backup");
      await downloadMarkdown();
    } catch {
      toast.error("Couldn't export your memories", { id: "markdown-download", description: "Reload the page and try again — nothing was changed." });
    } finally {
      setActivity(null);
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file || busy) return;
    setResult(null);
    setActivity({ kind: "restore", progress: null, fileName: file.name });
    try {
      const { importBackup } = await import("@/lib/storage/backup");
      const { added, skipped } = await importBackup(file, (p) => setActivity({ kind: "restore", progress: p, fileName: file.name }));
      setResult({
        kind: "restore",
        text: `Restored ${plural(added, "memory", "memories")}${skipped ? ` · ${plural(skipped, "was", "were")} already here` : ""}.`,
      });
    } catch {
      // importBackup already explained the problem in a toast.
      setResult({ kind: "restore-failed", text: `“${file.name}” couldn't be restored. The message on screen says why — nothing was changed.` });
    } finally {
      setActivity(null);
    }
  }

  const last = settings.lastBackupAt;
  const stale = backupIsStale(last);

  return (
    <Panel
      id="backup"
      icon={<LifeBuoy />}
      tone="emerald"
      title="Backup & restore"
      description="Backups are your safety net — your browser can delete site data. One file holds every memory, original and setting you need to restore."
      data-testid="backup-panel"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionTile
          icon={<PackageCheck />}
          title="Back up everything"
          text="A single .zip with all memories and original files. Restore it here or on another device."
        >
          <Button fullWidth leftIcon={<FileDown />} onClick={exportZip} loading={activity?.kind === "export"} disabled={busy && activity?.kind !== "export"} data-testid="export-backup">
            {activity?.kind === "export" ? "Preparing…" : "Download backup"}
          </Button>
        </ActionTile>
        <ActionTile icon={<ArchiveRestore />} title="Restore from a backup" text="Pick a Remembos .zip. Memories you already have are skipped, so nothing is duplicated.">
          <Button
            fullWidth
            variant="secondary"
            leftIcon={<ArchiveRestore />}
            onClick={() => fileInput.current?.click()}
            loading={activity?.kind === "restore"}
            disabled={busy && activity?.kind !== "restore"}
            data-testid="restore-backup"
          >
            {activity?.kind === "restore" ? "Restoring…" : "Choose backup file"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={onPick}
            data-testid="restore-input"
          />
        </ActionTile>
      </div>

      {activity && activity.kind !== "markdown" ? (
        <div className="mt-4 rounded-2xl border border-zinc-200/70 px-4 py-3.5 dark:border-white/10" role="status" data-testid="backup-progress">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-zinc-800 dark:text-zinc-100">
              {activity.kind === "export" ? "Preparing your backup" : `Restoring “${activity.fileName}”`}
              <span className="font-normal text-muted"> — {activity.progress?.phase ?? "Getting ready"}</span>
            </span>
            <span className="shrink-0 font-semibold text-zinc-900 tabular-nums dark:text-white">
              {fraction(activity.progress) === null ? "" : `${Math.round((fraction(activity.progress) ?? 0) * 100)}%`}
            </span>
          </div>
          <Progress
            className="mt-2.5"
            value={fraction(activity.progress) ?? 0}
            indeterminate={fraction(activity.progress) === null}
            size="sm"
            label={activity.kind === "export" ? "Backup progress" : "Restore progress"}
          />
          <p className="mt-2 text-xs text-muted">Keep this tab open until it finishes.</p>
        </div>
      ) : null}

      {result ? (
        <Callout
          className="mt-4"
          role="status"
          tone={result.kind === "restore-failed" ? "warning" : "success"}
          icon={<CircleCheck />}
          data-testid="backup-result"
        >
          {result.text}
        </Callout>
      ) : null}

      <div className="mt-5 flex flex-col gap-4 border-t border-zinc-200/70 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
        <p className="flex items-start gap-2.5 text-sm text-muted" data-testid="last-backup">
          <Clock aria-hidden className={stale && mounted ? "mt-0.5 size-4 shrink-0 text-amber-500" : "mt-0.5 size-4 shrink-0 text-emerald-500"} />
          <span>
            {!mounted ? (
              <InlineSkeleton className="h-3.5 w-48" />
            ) : last ? (
              <>
                Last backup <span className="font-medium text-zinc-800 dark:text-zinc-200">{timeAgo(last)}</span>
                {timeAgo(last) !== formatDate(last) ? ` (${formatDate(last)})` : ""}.
                {stale ? " Time for a fresh one." : ""}
              </>
            ) : (
              <>
                <span className="font-medium text-zinc-800 dark:text-zinc-200">No backup yet.</span> Download one now and then — it only takes a
                moment.
              </>
            )}
          </span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<FileText />}
          onClick={exportMarkdown}
          loading={activity?.kind === "markdown"}
          disabled={busy && activity?.kind !== "markdown"}
          data-testid="export-markdown"
        >
          Export text as Markdown
        </Button>
      </div>
    </Panel>
  );
}

function ActionTile({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200/70 bg-zinc-50/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex text-emerald-600 dark:text-emerald-300 [&>svg]:size-5">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">{text}</p>
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}
