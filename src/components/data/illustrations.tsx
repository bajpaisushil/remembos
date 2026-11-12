/**
 * Decorative scenes for the welcome tour, the Help page and the Data page hero.
 *
 * Pure markup (no hooks, no browser APIs), so Server and Client Components can both render them.
 * Everything is aria-hidden: the surrounding text carries the meaning. Motion uses only
 * transform/opacity keyframes from the design system and switches off under reduced motion.
 */
import { ArrowDown, AudioLines, CloudOff, Download, Lock, LockKeyhole, Phone, ScanText, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { KindIcon } from "@/components/ui/KindIcon";
import { cn } from "@/lib/utils";

/** Soft gradient stage with a faint grid and a glow behind the composition. */
export function SceneStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative isolate flex items-center justify-center overflow-hidden rounded-2xl border border-zinc-200/70",
        "bg-linear-to-br from-indigo-50 via-white to-fuchsia-50",
        "dark:border-white/10 dark:from-indigo-500/[0.12] dark:via-white/[0.02] dark:to-fuchsia-500/[0.12]",
        className,
      )}
    >
      <div className="bg-grid absolute inset-0 -z-10 opacity-70" />
      <div className="absolute top-1/2 left-1/2 -z-10 size-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-400/25 blur-3xl dark:bg-violet-500/25" />
      {children}
    </div>
  );
}

function Float({ className, delay, children }: { className?: string; delay?: string; children: ReactNode }) {
  const style: CSSProperties | undefined = delay ? { animationDelay: delay } : undefined;
  return (
    <span className={cn("absolute animate-float motion-reduce:animate-none", className)} style={style}>
      {children}
    </span>
  );
}

/** A small white "sticker" label floating over a scene. */
function Sticker({ icon, children, className, tone = "brand" }: { icon: ReactNode; children: ReactNode; className?: string; tone?: "brand" | "emerald" | "amber" | "sky" }) {
  const toneClass = {
    brand: "text-brand-600 dark:text-brand-300",
    emerald: "text-emerald-600 dark:text-emerald-300",
    amber: "text-amber-600 dark:text-amber-300",
    sky: "text-sky-600 dark:text-sky-300",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-zinc-700 shadow-card",
        "dark:border-white/10 dark:bg-ink-700 dark:text-zinc-200",
        className,
      )}
    >
      <span className={cn("flex [&>svg]:size-3.5", toneClass)}>{icon}</span>
      {children}
    </span>
  );
}

function TextLines({ widths, className }: { widths: string[]; className?: string }) {
  return (
    <span className={cn("flex flex-col gap-1.5", className)}>
      {widths.map((w, i) => (
        <span key={i} className={cn("block h-1.5 rounded-full bg-zinc-200 dark:bg-white/10", w)} />
      ))}
    </span>
  );
}

/** Step 1 — files of every kind dropping into one friendly target. */
export function DropScene({ className }: { className?: string }) {
  return (
    <SceneStage className={className}>
      <div className="relative h-36 w-60">
        <div className="absolute inset-x-8 inset-y-3 grid place-items-center rounded-2xl border-2 border-dashed border-brand-400/60 bg-white/80 shadow-card dark:border-brand-300/35 dark:bg-white/[0.06]">
          <span className="flex flex-col items-center gap-1.5">
            <span className="brand-gradient grid size-10 place-items-center rounded-xl text-white shadow-glow">
              <ArrowDown className="size-5" />
            </span>
            <span className="text-[11px] font-semibold text-brand-700 dark:text-brand-200">Drop to remember</span>
          </span>
        </div>
        <Float className="-top-1 left-0" delay="0s">
          <KindIcon kind="image" size="md" />
        </Float>
        <Float className="-top-2 right-3" delay="-2.2s">
          <KindIcon kind="pdf" size="md" />
        </Float>
        <Float className="top-14 -right-3" delay="-4.1s">
          <KindIcon kind="voice" size="sm" />
        </Float>
        <Float className="bottom-0 -left-2" delay="-1.3s">
          <KindIcon kind="text" size="sm" />
        </Float>
        <Float className="-bottom-1 right-10" delay="-3.4s">
          <KindIcon kind="note" size="sm" />
        </Float>
      </div>
    </SceneStage>
  );
}

/** Step 2 — a screenshot being read on the device, nothing uploaded. */
export function ReadScene({ className }: { className?: string }) {
  return (
    <SceneStage className={className}>
      <div className="relative h-40 w-64">
        <div className="absolute top-3 left-1/2 w-36 -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-lift dark:border-white/10 dark:bg-ink-800">
          <span className="mb-2.5 flex items-center gap-1.5">
            <KindIcon kind="image" size="xs" />
            <span className="h-1.5 w-14 rounded-full bg-zinc-300 dark:bg-white/20" />
          </span>
          <TextLines widths={["w-full", "w-5/6", "w-2/3"]} />
          <span className="mt-2.5 block rounded-md bg-brand-500/10 px-1.5 py-1 text-[10px] font-semibold text-brand-700 tabular-nums dark:bg-brand-400/15 dark:text-brand-200">
            +1 (415) 555-0134
          </span>
          <TextLines widths={["w-4/5"]} className="mt-2.5" />
          <span className="absolute inset-x-0 top-[46%] h-10 animate-pulse bg-linear-to-b from-transparent via-violet-400/25 to-transparent motion-reduce:animate-none" />
          <span className="absolute inset-x-1.5 top-[58%] h-px bg-violet-500/70 shadow-[0_0_8px_rgb(139_92_246/0.8)]" />
        </div>
        <Float className="top-1 -right-1" delay="-1s">
          <Sticker icon={<ScanText />}>Reads text</Sticker>
        </Float>
        <Float className="top-10 -left-2" delay="-3s">
          <Sticker icon={<AudioLines />} tone="amber">
            Transcribes
          </Sticker>
        </Float>
        <Float className="right-1 bottom-1" delay="-5s">
          <Sticker icon={<Sparkles />} tone="sky">
            Understands
          </Sticker>
        </Float>
        <Float className="bottom-1 -left-3" delay="-2s">
          <Sticker icon={<ShieldCheck />} tone="emerald">
            Nothing uploaded
          </Sticker>
        </Float>
      </div>
    </SceneStage>
  );
}

/** Step 3 — a plain question and the exact answer pulled from a screenshot. */
export function AskScene({ className }: { className?: string }) {
  return (
    <SceneStage className={className}>
      <div className="relative w-64">
        <div className="flex h-10 items-center gap-2 rounded-full border border-zinc-200/80 bg-white pr-3 pl-3.5 shadow-lift dark:border-white/10 dark:bg-ink-800">
          <Search className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
          <span className="min-w-0 truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">What&apos;s Priya&apos;s phone number?</span>
          <span className="h-4 w-px shrink-0 animate-pulse bg-brand-500 motion-reduce:animate-none" />
        </div>
        <div className="relative mt-3 ml-6 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-card dark:border-white/10 dark:bg-ink-800">
          <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-glow">
            <Sparkles className="size-3" />
            Answer
          </span>
          <span className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300">
              <Phone className="size-3.5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-white">+1 (415) 555-0134</span>
          </span>
          <span className="mt-2 flex items-center gap-1.5 text-[10.5px] text-muted">
            <KindIcon kind="image" size="xs" />
            <span className="truncate">From “Priya Sharma — contact card”</span>
          </span>
        </div>
      </div>
    </SceneStage>
  );
}

/** Step 4 — the browser as a vault: memories live only here; a backup file keeps a copy. */
export function VaultScene({ className }: { className?: string }) {
  return (
    <SceneStage className={className}>
      <div className="relative h-40 w-64">
        <div className="absolute inset-x-4 top-2 bottom-5 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-lift dark:border-white/10 dark:bg-ink-800">
          <div className="flex items-center gap-1.5 border-b border-zinc-200/70 px-3 py-2 dark:border-white/10">
            <span className="size-2 rounded-full bg-rose-400" />
            <span className="size-2 rounded-full bg-amber-400" />
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="ml-2 flex h-4 flex-1 items-center gap-1 rounded-full bg-zinc-100 px-2 text-[9px] font-medium text-muted dark:bg-white/[0.06]">
              <Lock className="size-2.5" />
              your browser
            </span>
          </div>
          <div className="grid h-[calc(100%-2.1rem)] place-items-center">
            <span className="brand-gradient grid size-14 animate-float place-items-center rounded-2xl text-white shadow-glow motion-reduce:animate-none">
              <LockKeyhole className="size-7" />
            </span>
          </div>
        </div>
        <Float className="bottom-0 -left-1" delay="-2s">
          <Sticker icon={<Lock />} tone="emerald">
            Only on this device
          </Sticker>
        </Float>
        <Float className="right-0 bottom-3" delay="-4s">
          <span className="flex items-center gap-1.5 rounded-xl border border-zinc-200/80 bg-white px-2 py-1.5 shadow-card dark:border-white/10 dark:bg-ink-700">
            <span className="grid size-6 place-items-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-300">
              <Download className="size-3.5" />
            </span>
            <span className="text-[10px] leading-tight font-semibold text-zinc-700 dark:text-zinc-200">
              backup
              <span className="block font-medium text-muted">.zip</span>
            </span>
          </span>
        </Float>
      </div>
    </SceneStage>
  );
}

/** Data page hero: browser window → (no cloud) → this device's vault. */
export function DeviceVaultScene({ className }: { className?: string }) {
  return (
    <SceneStage className={className}>
      <div className="relative flex items-center gap-2 px-4 py-8 sm:gap-3">
        <div className="w-32 shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-lift sm:w-36 dark:border-white/10 dark:bg-ink-800">
          <div className="flex items-center gap-1 border-b border-zinc-200/70 px-2.5 py-1.5 dark:border-white/10">
            <span className="size-1.5 rounded-full bg-rose-400" />
            <span className="size-1.5 rounded-full bg-amber-400" />
            <span className="size-1.5 rounded-full bg-emerald-400" />
          </div>
          <div className="flex flex-col gap-2 p-2.5">
            <span className="flex items-center gap-1.5">
              <KindIcon kind="image" size="xs" />
              <TextLines widths={["w-14"]} />
            </span>
            <span className="flex items-center gap-1.5">
              <KindIcon kind="pdf" size="xs" />
              <TextLines widths={["w-10"]} />
            </span>
            <span className="flex items-center gap-1.5">
              <KindIcon kind="voice" size="xs" />
              <TextLines widths={["w-12"]} />
            </span>
          </div>
        </div>

        <div className="relative flex w-12 shrink-0 items-center sm:w-16">
          <span className="h-0.5 w-full rounded-full bg-[repeating-linear-gradient(90deg,var(--color-brand-400)_0_6px,transparent_6px_11px)]" />
          <span className="absolute -right-1 size-2 rotate-45 border-t-2 border-r-2 border-brand-400" />
          <span className="absolute -top-9 left-1/2 -translate-x-1/2">
            <span className="flex items-center gap-1 rounded-full border border-zinc-200/80 bg-white px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-zinc-600 shadow-soft dark:border-white/10 dark:bg-ink-700 dark:text-zinc-300">
              <CloudOff className="size-3 text-rose-500 dark:text-rose-300" />
              No cloud
            </span>
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <span className="brand-gradient grid size-16 animate-float place-items-center rounded-3xl text-white shadow-glow motion-reduce:animate-none sm:size-20">
            <LockKeyhole className="size-8 sm:size-9" />
          </span>
          <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">This device</span>
        </div>
      </div>
    </SceneStage>
  );
}
