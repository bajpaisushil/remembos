"use client";

import { ArrowRight, FolderLock, HardDrive, Info, Laptop, ShieldAlert, Smartphone } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { ROUTES } from "@/lib/config";
import {
  DEVICE_LABELS,
  DISK_BROWSER_LABELS,
  diskLocations,
  folderForTable,
  isDesktopOS,
  numberedPiecesNote,
  OS_LABELS,
  type RemembosTable,
} from "@/lib/storage-inspect";
import { PathBox, QuickOpenSteps } from "../paths";
import { useEnvironment } from "../use-environment";

export interface FolderOnDiskProps {
  /** Which table's folder to show ("files" → where originals are kept). */
  table: RemembosTable | "ocr";
  /** Original file name, for the honest "you won't find <name>" note. */
  fileName?: string;
  className?: string;
}

/**
 * The real folder on this computer that holds a table's records, for the detected OS + browser,
 * with a copy button and how to open it — plus the plain truth: websites can't open folders,
 * and inside it files are numbered pieces, not "<name>".
 */
export function FolderOnDisk({ table, fileName, className }: FolderOnDiskProps) {
  const env = useEnvironment();

  if (!env) {
    return (
      <div aria-hidden className={className}>
        <Skeleton className="h-5 w-48 rounded-md" />
        <Skeleton className="mt-3 h-11 w-full rounded-xl" />
        <SkeletonText lines={3} className="mt-4 max-w-md" />
      </div>
    );
  }

  const guide = diskLocations(env.os, env.diskBrowser, env.origin);
  const folder = folderForTable(guide, table);
  const where = `${DEVICE_LABELS[env.os]} · ${env.os === "other" ? "your browser" : DISK_BROWSER_LABELS[env.diskBrowser]}`;

  return (
    <div className={className} data-testid="explorer-item-folder">
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive aria-hidden className="size-4 text-brand-500 dark:text-brand-300" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">The folder on this device</h3>
        <Badge size="sm" tone="neutral" data-testid="explorer-item-folder-env">
          {where}
        </Badge>
      </div>

      {folder && isDesktopOS(env.os) ? (
        <>
          <p className="mt-2 text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {folder.label.replace(/\s*\(IndexedDB\)$/, "")} — inside {DISK_BROWSER_LABELS[env.diskBrowser]}&apos;s profile folder, with this site&apos;s
            address filled in:
          </p>
          <PathBox path={folder.path} label={folder.label} testId="explorer-item-folder-path" />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">How to open it</p>
              <QuickOpenSteps os={env.os} className="mt-1.5" />
              {guide.finder?.url ? (
                <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] leading-relaxed text-muted">
                  Not there? Your profile may be “Profile 1” instead of “Default” — paste
                  <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[12px] text-zinc-800 dark:bg-white/10 dark:text-zinc-200">
                    {guide.finder.url}
                  </code>
                  <CopyButton value={guide.finder.url} iconOnly label={`Copy ${guide.finder.url}`} notify={false} />
                  into the address bar and look for “{guide.finder.look}”.
                </p>
              ) : null}
            </div>
            <div
              role="note"
              className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-3.5 text-[13px] leading-relaxed text-sky-950 dark:border-sky-400/20 dark:bg-sky-400/[0.07] dark:text-sky-100"
              data-testid="explorer-item-folder-note"
            >
              <p className="flex items-center gap-1.5 font-semibold">
                <Info aria-hidden className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />
                Why there&apos;s no “Open folder” button
              </p>
              <p className="mt-1 opacity-90">
                Browsers don&apos;t let websites open folders on your computer — that protects you from sites snooping around. Copy the path and
                open it yourself.
              </p>
              <p className="mt-1.5 opacity-90">{numberedPiecesNote(env.diskBrowser, fileName)}</p>
              <p className="mt-1.5 font-medium">To get the file itself back, use Open original or Download.</p>
            </div>
          </div>
          <p className="mt-4 flex gap-2 rounded-xl bg-rose-500/[0.06] px-3 py-2.5 text-[12.5px] leading-relaxed text-rose-900 dark:bg-rose-400/[0.08] dark:text-rose-100">
            <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-300" />
            <span>Look, but don&apos;t touch: moving, renaming or deleting anything in that folder can break every memory. Use Back up to keep a copy.</span>
          </p>
        </>
      ) : (
        <div className="mt-2 flex gap-3" data-testid="explorer-item-folder-sandboxed">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300 [&>svg]:size-[18px]">
            {env.os === "chromeos" ? <Laptop aria-hidden /> : env.os === "other" ? <FolderLock aria-hidden /> : <Smartphone aria-hidden />}
          </span>
          <div className="min-w-0 text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            <p>
              {env.os === "other"
                ? "We couldn't tell which system this is, so we can't name the folder."
                : !guide.available
                  ? guide.message
                  : `On ${OS_LABELS[env.os]}, the browser keeps website data inside its own locked app storage — there's no folder you can open, not even with a file manager.`}
            </p>
            <p className="mt-1.5">Websites can&apos;t open folders either way. To get the file itself, use Open original or Download.</p>
          </div>
        </div>
      )}

      <Link
        href={`${ROUTES.storage}#find-it`}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300"
      >
        Other browsers and computers — every folder
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </div>
  );
}
