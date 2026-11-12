"use client";

/**
 * The "Your data" page: where memories live (guide + storage explorer), how full storage is,
 * backups, installing as an app, freeing space, local AI models, settings, clearing data and
 * starting over — explained for everyone.
 */
import {
  ArrowRight,
  Cpu,
  Database,
  Eraser,
  HardDrive,
  LifeBuoy,
  MapPin,
  MonitorDown,
  ShieldCheck,
  SlidersHorizontal,
  Trash,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { embedderStatus } from "@/lib/ai/embedder";
import { ROUTES } from "@/lib/config";
import { ocrStatus } from "@/lib/ingest/ocr";
import { whisperStatus } from "@/lib/ingest/transcribe";
import { refreshStorage } from "@/lib/storage/monitor";
import type { ModelStatus } from "@/lib/types";
import type { Store } from "@/lib/store";
import { Accent, Container, PageHeader } from "@/components/ui/PageHeader";
import { BackupPanel } from "./BackupPanel";
import { ClearDataGuide } from "./ClearDataGuide";
import { DangerZone } from "./DangerZone";
import { DeviceVaultScene } from "./illustrations";
import { InstallAppCard } from "./InstallAppCard";
import { refreshModelCaches } from "./model-cache";
import { ModelsPanel } from "./ModelsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { SpaceSavers } from "./SpaceSavers";
import { StorageMeter } from "./StorageMeter";

const SECTIONS = [
  { href: "#storage", label: "Storage", icon: HardDrive },
  { href: "#backup", label: "Backup", icon: LifeBuoy },
  { href: "#install", label: "Install app", icon: MonitorDown },
  { href: "#space", label: "Free up space", icon: Eraser },
  { href: "#models", label: "AI models", icon: Cpu },
  { href: "#settings", label: "Settings", icon: SlidersHorizontal },
  { href: "#clear", label: "Clear in browser", icon: Trash },
  { href: "#danger", label: "Start over", icon: TriangleAlert },
];

/** Re-measure model caches whenever a model finishes loading or stops (downloads change disk usage). */
function useModelCacheWatcher() {
  useEffect(() => {
    void refreshModelCaches();
    void refreshStorage();
    const stores: Store<ModelStatus>[] = [embedderStatus, ocrStatus, whisperStatus];
    const last = stores.map((s) => s.get().state);
    const unsubs = stores.map((store, i) =>
      store.subscribe(() => {
        const state = store.get().state;
        const prev = last[i];
        last[i] = state;
        if (state !== prev && (state === "ready" || prev === "loading")) {
          void refreshModelCaches();
          void refreshStorage();
        }
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, []);
}

export function DataScreen() {
  useModelCacheWatcher();

  return (
    <Container className="pt-8 pb-12 sm:pt-12">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <PageHeader
          eyebrow={
            <>
              <ShieldCheck />
              Your data
            </>
          }
          size="lg"
          title={
            <>
              Everything stays on this <Accent>device</Accent>
            </>
          }
          description="Your memories live only in this browser — never on a server. Here you can see how much space they use, keep them safe with a backup, and decide what stays."
        >
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-700 dark:text-zinc-300">
            <li className="flex items-center gap-2">
              <ShieldCheck aria-hidden className="size-4 text-emerald-500" />
              No uploads, no account
            </li>
            <li className="flex items-center gap-2">
              <WifiOff aria-hidden className="size-4 text-emerald-500" />
              Works offline
            </li>
            <li className="flex items-center gap-2">
              <LifeBuoy aria-hidden className="size-4 text-emerald-500" />
              Backups you control
            </li>
          </ul>
        </PageHeader>
        <DeviceVaultScene className="h-40 sm:h-56" />
      </div>

      <nav aria-label="On this page" className="mt-8 -mx-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {SECTIONS.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <a
                href={href}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white/70 px-3.5 text-[13px] font-medium whitespace-nowrap text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-white hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Icon aria-hidden className="size-3.5" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex flex-col gap-6">
        <StorageMeter />
        <WhereCards />
        <BackupPanel />
        <InstallAppCard />
        <SpaceSavers />
        <ModelsPanel />
        <SettingsPanel />
        <ClearDataGuide />
        <DangerZone />
      </div>
    </Container>
  );
}

function WhereCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <WhereCard
        href={ROUTES.storage}
        icon={MapPin}
        title="Where your data lives — and how not to lose it"
        text="Which parts of your browser hold your memories, where they sit on your computer, and which everyday actions would erase them."
        cta="Open the guide"
        testId="storage-guide-link"
      />
      <WhereCard
        href={ROUTES.explorer}
        icon={Database}
        title="Storage explorer"
        text="Browse every stored record — original files, previews, search pieces — and open or download any file. Read-only."
        cta="Explore stored files"
        testId="data-explorer-link"
      />
    </div>
  );
}

function WhereCard({ href, icon: Icon, title, text, cta, testId }: { href: string; icon: LucideIcon; title: string; text: string; cta: string; testId: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-brand-500/20 bg-linear-to-br from-indigo-500/[0.07] via-violet-500/[0.05] to-fuchsia-500/[0.08] p-5 shadow-soft transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-brand-500/35 hover:shadow-lift sm:p-6 dark:border-brand-400/20 dark:from-indigo-500/[0.12] dark:via-violet-500/[0.08] dark:to-fuchsia-500/[0.12]"
    >
      <span className="flex items-start gap-4">
        <span className="brand-gradient grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-glow">
          <Icon aria-hidden className="size-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold tracking-tight text-zinc-900 sm:text-lg dark:text-white">{title}</span>
          <span className="mt-1 block text-sm leading-relaxed text-muted">{text}</span>
        </span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1.5 self-end text-sm font-semibold text-brand-700 dark:text-brand-200">
        {cta}
        <ArrowRight aria-hidden className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
