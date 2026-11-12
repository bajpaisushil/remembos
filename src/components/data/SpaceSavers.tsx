"use client";

/**
 * "Free up space": remove every original file while keeping text and search, or remove the demo
 * sample memories. Deleting single memories lives in the Library.
 */
import { useLiveQuery } from "dexie-react-hooks";
import { Eraser, FileX2, LibraryBig, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ROUTES } from "@/lib/config";
import { db, getMeta } from "@/lib/db";
import { getSettings, updateSettings } from "@/lib/settings";
import { SAMPLE_IDS_META_KEY } from "@/lib/storage/helpers";
import { useStorageInfo } from "@/lib/storage/monitor";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatBytes } from "@/lib/utils";
import { IconChip, InlineSkeleton, Panel, type ChipTone } from "./shared";

async function countOriginals(): Promise<number | null> {
  try {
    return await db.files.count();
  } catch {
    return null;
  }
}

async function countSamples(): Promise<number | null> {
  try {
    const ids = (await getMeta<string[]>(SAMPLE_IDS_META_KEY)) ?? [];
    if (!ids.length) return 0;
    return (await db.items.where(":id").anyOf(ids).primaryKeys()).length;
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function SpaceSavers() {
  const info = useStorageInfo();
  const originals = useLiveQuery(countOriginals, []);
  const samples = useLiveQuery(countSamples, []);
  const [dialog, setDialog] = useState<"originals" | "samples" | null>(null);
  const [alsoStop, setAlsoStop] = useState(false);

  async function removeOriginals() {
    const ids = (await db.files.toCollection().primaryKeys()) as string[];
    const { deleteOriginals } = await import("@/lib/storage/clear");
    await deleteOriginals(ids);
    if (alsoStop && getSettings().keepOriginals) updateSettings({ keepOriginals: false });
  }

  async function removeSamples() {
    const { removeSampleData } = await import("@/lib/storage/sample");
    await removeSampleData();
  }

  const originalsBytes = info?.filesBytes ?? null;

  return (
    <Panel
      id="space"
      icon={<Eraser />}
      tone="amber"
      title="Free up space"
      description="Make room without losing what matters. Your text and search always stay."
      data-testid="space-panel"
    >
      <ul className="flex flex-col gap-3">
        <SaverRow
          icon={<FileX2 />}
          tone="rose"
          title="Remove original files"
          text={
            originals === undefined || originalsBytes === null ? (
              <InlineSkeleton className="h-3.5 w-56" />
            ) : originals ? (
              <>
                {plural(originals, "original file", "original files")} use about{" "}
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">{formatBytes(originalsBytes)}</span>. Text, previews and search
                keep working; you just can&apos;t open the originals anymore.
              </>
            ) : (
              "No original files stored — your memories keep only their text and previews."
            )
          }
        >
          <Button variant="secondary" size="sm" onClick={() => setDialog("originals")} disabled={!originals} data-testid="remove-originals">
            Remove originals
          </Button>
        </SaverRow>

        <SaverRow
          icon={<Sparkles />}
          tone="violet"
          title="Remove sample memories"
          text={
            samples === undefined ? (
              <InlineSkeleton className="h-3.5 w-48" />
            ) : samples ? (
              <>{plural(samples, "sample memory is", "sample memories are")} here from the welcome tour. Your own memories won&apos;t be touched.</>
            ) : (
              "No sample memories here."
            )
          }
        >
          <Button variant="secondary" size="sm" onClick={() => setDialog("samples")} disabled={!samples} data-testid="remove-samples">
            Remove samples
          </Button>
        </SaverRow>

        <SaverRow icon={<LibraryBig />} tone="sky" title="Delete single memories" text="Pick exactly what to remove in the Library — one or many at a time.">
          <Button variant="ghost" size="sm" href={ROUTES.library}>
            Open Library
          </Button>
        </SaverRow>
      </ul>

      <ConfirmDialog
        open={dialog === "originals"}
        onClose={() => setDialog(null)}
        title={`Remove ${originals ? plural(originals, "original file", "original files") : "original files"}?`}
        description={
          <>
            Frees about <strong className="font-semibold text-zinc-800 dark:text-zinc-200">{formatBytes(originalsBytes ?? 0)}</strong>. Your
            memories stay searchable with their text and previews, but the original screenshots, PDFs, videos and recordings will be gone from this
            device. Download a backup first if you might want them later.
          </>
        }
        confirmLabel="Remove originals"
        danger
        onConfirm={removeOriginals}
        data-testid="remove-originals-dialog"
      >
        <label className="flex items-start gap-2.5 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 dark:bg-white/[0.04] dark:text-zinc-300">
          <input
            type="checkbox"
            checked={alsoStop}
            onChange={(e) => setAlsoStop(e.currentTarget.checked)}
            className="mt-0.5 size-4 shrink-0 accent-brand-600"
            data-testid="also-stop-originals"
          />
          <span>Also stop keeping originals for new files (keeps only their text)</span>
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "samples"}
        onClose={() => setDialog(null)}
        title="Remove the sample memories?"
        description="The demo memories from the welcome tour will be deleted. Everything you added yourself stays."
        confirmLabel="Remove samples"
        onConfirm={removeSamples}
        data-testid="remove-samples-dialog"
      />
    </Panel>
  );
}

function SaverRow({ icon, tone, title, text, children }: { icon: ReactNode; tone: ChipTone; title: string; text: ReactNode; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-zinc-200/70 p-4 sm:flex-row sm:items-center dark:border-white/[0.08]">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <IconChip tone={tone} size="sm">
          {icon}
        </IconChip>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{title}</h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{text}</p>
        </div>
      </div>
      <div className="shrink-0 sm:pl-2">{children}</div>
    </li>
  );
}
