import { ArrowRight, Database, FileStack, FolderOpen, LocateFixed, MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ROUTES, STORAGE_NAMES } from "@/lib/config";
import { ADDRESS_SEPARATOR } from "@/lib/storage-inspect";

function Step({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-soft ring-1 ring-zinc-200/80 dark:bg-white/10 dark:text-brand-200 dark:ring-white/10 [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-900 dark:text-white">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{text}</span>
      </span>
    </li>
  );
}

/**
 * "Find one memory's file": the per-memory "Where is this stored?" panel and the in-app storage
 * explorer — the way Remembos takes you to where a file is kept (browsers can't open folders).
 */
export function ExplorerPromo() {
  const sample = ["IndexedDB", STORAGE_NAMES.appDb, "files", "7f3a9c…"].join(ADDRESS_SEPARATOR);
  return (
    <section
      aria-labelledby="explorer-promo-title"
      data-testid="storage-explorer-promo"
      className="relative mt-6 overflow-hidden rounded-3xl border border-brand-500/20 bg-linear-to-br from-indigo-500/[0.08] via-violet-500/[0.05] to-fuchsia-500/[0.09] p-5 shadow-soft sm:p-7 dark:border-brand-400/20 dark:from-indigo-500/[0.14] dark:via-violet-500/[0.08] dark:to-fuchsia-500/[0.14]"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <span className="brand-gradient grid size-11 place-items-center rounded-2xl text-white shadow-glow">
            <LocateFixed aria-hidden className="size-5" />
          </span>
          <h2 id="explorer-promo-title" className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl dark:text-white">
            Find any memory&apos;s file in two clicks
          </h2>
          <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            Every memory has a <span className="font-semibold text-zinc-900 dark:text-white">Where is this stored?</span> panel. It shows the
            file&apos;s exact address inside your browser and the real folder on this device — and takes you straight to its records in the
            storage explorer, where you can open or download the original.
          </p>
          <p
            aria-hidden
            className="mt-4 inline-flex max-w-full items-center gap-2 rounded-xl border border-brand-500/20 bg-white/85 px-3 py-2 font-mono text-[12.5px] text-zinc-800 shadow-soft dark:border-brand-400/20 dark:bg-black/25 dark:text-zinc-100"
          >
            <FileStack className="size-3.5 shrink-0 text-brand-500 dark:text-brand-300" />
            <span className="truncate">{sample}</span>
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Button href={ROUTES.explorer} leftIcon={<Database />} rightIcon={<ArrowRight />} data-testid="storage-explorer-link">
              Open the storage explorer
            </Button>
            <Button href={ROUTES.library} variant="ghost">
              Pick a memory
            </Button>
          </div>
        </div>
        <ol className="flex flex-col gap-4 rounded-2xl border border-white/70 bg-white/60 p-4 sm:p-5 dark:border-white/10 dark:bg-white/[0.04]">
          <Step icon={<MousePointerClick aria-hidden />} title="Open a memory" text="From the library, a search result or the home page." />
          <Step
            icon={<LocateFixed aria-hidden />}
            title="Choose “Where is this stored?”"
            text="See its address and this device's folder, with a copy button and how to open it."
          />
          <Step
            icon={<FolderOpen aria-hidden />}
            title="Show in storage explorer"
            text="Lands on that memory's records — original, preview, search pieces and things found."
          />
        </ol>
      </div>
    </section>
  );
}
