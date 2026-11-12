import { ArrowDown, Database, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Accent } from "@/components/ui/PageHeader";
import { ROUTES } from "@/lib/config";
import { BackupButton } from "./actions";
import { ExplorerPromo } from "./ExplorerPromo";
import { GlanceStats } from "./GlanceStats";
import { VaultDiagram } from "./VaultDiagram";

/** Page intro: the promise in one sentence, the diagram, three live numbers and the way to one memory's file. */
export function GuideHero() {
  return (
    <section aria-labelledby="storage-title" data-testid="storage-guide-hero" className="relative isolate pt-8 sm:pt-14">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[34rem] overflow-hidden">
        <div className="aurora absolute inset-0" />
      </div>

      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14">
        <div>
          <p className="glass inline-flex h-8 items-center gap-2 rounded-full border border-zinc-200/80 px-3.5 text-[13px] font-medium text-zinc-700 shadow-soft dark:border-white/10 dark:text-zinc-200">
            <HardDrive aria-hidden className="size-4 text-brand-600 dark:text-brand-300" />
            Where your data lives
          </p>
          <h1
            id="storage-title"
            className="mt-5 text-[2.3rem] leading-[1.08] font-semibold tracking-tight text-zinc-900 min-[400px]:text-[2.6rem] sm:text-5xl lg:text-[3.35rem] dark:text-white"
          >
            Your memories live <Accent>inside this browser</Accent> on this device
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            Remembos has no server and no cloud account. Everything you add is saved by your browser, in a private corner of this
            device that only this site can open. Here&apos;s exactly where it lives — and how to keep it safe.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <BackupButton size="lg" data-testid="hero-backup-button" />
            <Button href={ROUTES.explorer} variant="secondary" size="lg" leftIcon={<Database />} data-testid="hero-explorer-link">
              Explore stored files
            </Button>
            <Button href="#find-it" variant="ghost" size="lg" rightIcon={<ArrowDown />}>
              Show me where
            </Button>
          </div>
        </div>
        <VaultDiagram />
      </div>

      <GlanceStats />
      <ExplorerPromo />
    </section>
  );
}
