"use client";

import { ArrowRight, CircleHelp, Download, HardDrive, MonitorDown, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { InstallActions } from "@/components/data/InstallAppCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ROUTES, STORAGE_THRESHOLDS } from "@/lib/config";
import { installState } from "@/lib/pwa";
import { useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { BackupButton, KeepDataButton } from "./actions";
import { useEnvironment, type GuideEnvironment } from "./use-environment";
import { useInspection } from "./use-inspection";

function ProtectCard({
  icon,
  step,
  title,
  status,
  children,
  action,
  testId,
}: {
  icon: ReactNode;
  step: number;
  title: string;
  status: ReactNode;
  children: ReactNode;
  action: ReactNode;
  testId: string;
}) {
  return (
    <Card as="article" padding="none" className="flex flex-col" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300 [&>svg]:size-5">
            {icon}
          </span>
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">Step {step}</span>
        </div>
        <h3 id={`${testId}-title`} className="mt-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
          {title}
        </h3>
        <div className="mt-1.5 min-h-6">{status}</div>
        <div className="mt-3 flex-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</div>
      </div>
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">{action}</div>
    </Card>
  );
}

function installTip(env: GuideEnvironment): string {
  if (env.os === "ios") return "Open Remembos in Safari, tap Share, then “Add to Home Screen”.";
  if (env.os === "android") {
    if (env.diskBrowser === "samsung") return "Tap the menu (☰), then “Add page to” → “Home screen”.";
    return "Tap the browser menu (⋮), then “Add to Home screen” or “Install app”.";
  }
  switch (env.diskBrowser) {
    case "safari":
      return "In Safari, choose File → “Add to Dock” (macOS Sonoma or later).";
    case "firefox":
      return "Firefox on computers doesn't install websites as apps. Keep regular backups — or install Remembos from Chrome or Edge.";
    case "arc":
      return "Arc doesn't install websites as apps. Keep regular backups instead.";
    case "edge":
      return "Click the app icon at the right end of the address bar, or open the menu (…) → Apps → “Install this site as an app”.";
    case "chrome":
    case "chromium":
      return "Click the install icon at the right end of the address bar, or open the menu (⋮) → Cast, save and share → “Install page as app”.";
    default:
      return "Look for an install icon in the address bar, or an “Install” option in the browser menu. Not every browser offers it — if yours doesn't, keep regular backups.";
  }
}

/** Safari and iOS give installed web apps their own storage, separate from the browser tab. */
function separateStorage(env: GuideEnvironment): boolean {
  return env.os === "ios" || env.diskBrowser === "safari";
}

/** "Protect yourself": back up, ask the browser to keep data, install as an app — plus links onwards. */
export function ProtectSection() {
  const env = useEnvironment();
  const { data } = useInspection();
  const { lastBackupAt } = useSettings();
  const install = useStore(installState);

  const persisted = data?.persisted;
  const installed = !!env?.installed || install.installed;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <ProtectCard
          step={1}
          icon={<Download aria-hidden />}
          title="Back up now"
          testId="protect-backup"
          status={
            !env || !data ? (
              <Skeleton className="h-5 w-32 rounded-full" />
            ) : lastBackupAt ? (
              <Badge
                tone={data.checkedAt - lastBackupAt > STORAGE_THRESHOLDS.backupNudgeDays * 86_400_000 ? "warning" : "success"}
                dot
                title={formatDate(lastBackupAt)}
              >
                Last backup {timeAgo(lastBackupAt, Math.max(data.checkedAt, lastBackupAt))}
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                No backup yet
              </Badge>
            )
          }
          action={<BackupButton fullWidth data-testid="storage-backup-button" />}
        >
          One file with everything — memories, original files and search data. Keep it on a USB stick or cloud drive and restore it any
          time from <span className="font-medium text-zinc-900 dark:text-white">Your data</span>, even in another browser or on another
          computer. The only thing that survives every mistake on this page.
        </ProtectCard>

        <ProtectCard
          step={2}
          icon={<ShieldCheck aria-hidden />}
          title="Ask your browser to keep it"
          testId="protect-persist"
          status={
            !data ? (
              <Skeleton className="h-5 w-28 rounded-full" />
            ) : persisted ? (
              <Badge tone="success" dot data-testid="protect-persist-status">
                Protected
              </Badge>
            ) : persisted === false ? (
              <Badge tone="warning" dot data-testid="protect-persist-status">
                Not yet
              </Badge>
            ) : (
              <Badge dot data-testid="protect-persist-status">
                Browser decides
              </Badge>
            )
          }
          action={
            <KeepDataButton
              fullWidth
              disabled={persisted === true}
              label={persisted ? "Already protected" : "Ask browser to keep my data"}
              data-testid="storage-persist-button"
            />
          }
        >
          Normally a browser may clear websites&apos; data on its own when the device runs low on space. Asking for “persistent storage”
          tells it Remembos matters, so it won&apos;t. Some browsers answer straight away; others decide by how often you visit.
        </ProtectCard>

        <ProtectCard
          step={3}
          icon={<MonitorDown aria-hidden />}
          title="Install as an app"
          testId="protect-install"
          status={
            !env ? (
              <Skeleton className="h-5 w-36 rounded-full" />
            ) : installed ? (
              <Badge tone="success" dot>
                You&apos;re using the app
              </Badge>
            ) : (
              <Badge dot>Optional</Badge>
            )
          }
          action={installed ? null : <InstallActions fullWidth variant="secondary" testIdPrefix="storage-install" />}
        >
          <p>
            Installed apps open in their own window and work offline, browsers are less likely to clean them up, and Safari&apos;s 7-day rule
            doesn&apos;t apply to them. On Android you can also share things straight into Remembos.
          </p>
          {env && !installed && !install.canInstall ? <p className="mt-2.5 font-medium text-zinc-800 dark:text-zinc-200">{installTip(env)}</p> : null}
          {env && separateStorage(env) ? (
            <p className="mt-2.5 rounded-xl bg-amber-500/[0.08] px-3 py-2 text-[13px] text-amber-950 dark:bg-amber-400/[0.08] dark:text-amber-100">
              Heads-up: on {env.os === "ios" ? "iPhone and iPad" : "Mac"}, the installed app keeps its own storage, separate from Safari.
              Move existing memories over with Back up here, then Restore inside the app.
            </p>
          ) : null}
        </ProtectCard>
      </div>

      <div
        className={cn(
          "mt-6 flex flex-col gap-4 rounded-3xl border border-zinc-200/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6",
          "bg-linear-to-br from-brand-500/[0.06] via-transparent to-fuchsia-500/[0.05] dark:border-white/10 dark:from-brand-400/10 dark:to-fuchsia-400/[0.06]",
        )}
      >
        <div className="max-w-xl">
          <p className="text-base font-semibold text-zinc-900 dark:text-white">Want to free up space or start fresh on purpose?</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Your data shows what takes space, removes originals or AI models, and has step-by-step guides for clearing Remembos safely
            in every browser.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={ROUTES.data} variant="primary" leftIcon={<HardDrive />} rightIcon={<ArrowRight />}>
            Manage your data
          </Button>
          <Button href={ROUTES.help} variant="ghost" leftIcon={<CircleHelp />}>
            Help
          </Button>
        </div>
      </div>
    </>
  );
}
