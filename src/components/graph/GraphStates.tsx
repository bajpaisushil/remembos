"use client";
/**
 * Everything the graph screen shows when there is no graph to draw yet: loading, an empty library,
 * memories still being read, no connections, nothing matching the filters, and errors.
 */
import { CircleAlert, LibraryBig, NotebookPen, RotateCcw, Sparkles, Upload, Waypoints } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Card, EmptyState, LoadingStatus, Spinner } from "@/components/ui";
import { openNote, openUploadPicker } from "@/lib/add-actions";
import { KIND_HEX, ROUTES } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Size of the graph card: grows to fill the rest of the screen under the page intro (the page is a
 * full-height flex column), never shorter than a comfortable minimum.
 */
export const STAGE_HEIGHT = "min-h-[28rem] flex-1 md:min-h-[32rem]";

/** Soft glow behind the canvas. */
export function StageBackdrop() {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0",
        "bg-[radial-gradient(55%_50%_at_50%_48%,rgb(139_92_246/0.07),transparent_72%),radial-gradient(40%_35%_at_15%_90%,rgb(14_165_233/0.05),transparent_70%)]",
        "dark:bg-[radial-gradient(55%_50%_at_50%_48%,rgb(139_92_246/0.13),transparent_72%),radial-gradient(40%_35%_at_15%_90%,rgb(14_165_233/0.07),transparent_70%)]",
      )}
    />
  );
}

/** Card frame shared by the loading state and the live graph. */
export function StageCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card padding="none" className={cn("flex flex-col", STAGE_HEIGHT, className)}>
      {children}
    </Card>
  );
}

/** Placeholder with the same size as the real graph (no layout shift). */
export function GraphStageLoading({ label = "Mapping your memories…" }: { label?: string }) {
  return (
    <StageCard>
      <div className="flex flex-col gap-3 rounded-t-3xl border-b border-zinc-200/70 px-3 pt-3 pb-2.5 sm:px-4 sm:pt-4 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div className="h-9 w-full rounded-lg bg-zinc-200/60 sm:w-72 lg:w-80 dark:bg-white/[0.06]" />
          <div className="h-5 w-56 rounded-full bg-zinc-200/60 dark:bg-white/[0.06]" />
        </div>
        <div className="flex gap-1.5 overflow-hidden">
          {[72, 84, 64, 76, 70].map((w, i) => (
            <div key={i} className="h-8 shrink-0 rounded-full bg-zinc-200/60 dark:bg-white/[0.06]" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-3xl" data-testid="graph-loading">
        <StageBackdrop />
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-4">
            <Constellation className="w-56 opacity-80 sm:w-64" pulse />
            <p className="inline-flex items-center gap-2 text-sm text-muted">
              <Spinner size="sm" className="text-brand-500" />
              {label}
            </p>
          </div>
        </div>
        <LoadingStatus label={label} />
      </div>
    </StageCard>
  );
}

/** Decorative mini graph in the brand's kind colors. */
export function Constellation({ className, pulse }: { className?: string; pulse?: boolean }) {
  const nodes: { x: number; y: number; r: number; c: string; square?: boolean }[] = [
    { x: 120, y: 72, r: 13, c: KIND_HEX.image },
    { x: 52, y: 44, r: 9, c: KIND_HEX.pdf },
    { x: 196, y: 40, r: 10, c: KIND_HEX.note },
    { x: 60, y: 118, r: 8, c: KIND_HEX.voice },
    { x: 190, y: 116, r: 9, c: KIND_HEX.text },
    { x: 222, y: 84, r: 7, c: KIND_HEX.video },
    { x: 88, y: 78, r: 5, c: "#8b5cf6", square: true },
    { x: 160, y: 60, r: 5, c: "#10b981", square: true },
    { x: 150, y: 112, r: 5, c: "#ec4899", square: true },
    { x: 124, y: 22, r: 4.5, c: "#14b8a6", square: true },
  ];
  const links: [number, number][] = [
    [0, 6],
    [1, 6],
    [3, 6],
    [0, 7],
    [2, 7],
    [5, 7],
    [0, 8],
    [4, 8],
    [5, 8],
    [2, 9],
    [1, 9],
    [0, 9],
  ];
  return (
    <svg viewBox="0 0 240 140" aria-hidden className={cn("overflow-visible", className)}>
      <g className="text-zinc-400/50 dark:text-white/20" stroke="currentColor" strokeWidth="1.2" fill="none">
        {links.map(([a, b], i) => {
          const s = nodes[a];
          const t = nodes[b];
          const mx = (s.x + t.x) / 2 - (t.y - s.y) * 0.08;
          const my = (s.y + t.y) / 2 + (t.x - s.x) * 0.08;
          return <path key={i} d={`M${s.x} ${s.y} Q${mx} ${my} ${t.x} ${t.y}`} />;
        })}
      </g>
      {nodes.map((n, i) =>
        n.square ? (
          <rect
            key={i}
            x={n.x - n.r}
            y={n.y - n.r}
            width={n.r * 2}
            height={n.r * 2}
            rx={n.r * 0.45}
            fill={n.c}
            className={cn("stroke-white dark:stroke-ink-900", pulse && "animate-pulse")}
            strokeWidth="1.5"
            style={pulse ? { animationDelay: `${i * 140}ms` } : undefined}
          />
        ) : (
          <g key={i} className={pulse ? "animate-float" : undefined} style={pulse ? { animationDelay: `${i * -900}ms` } : undefined}>
            <circle cx={n.x} cy={n.y} r={n.r * 2.2} fill={n.c} opacity="0.16" />
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.c} className="stroke-white dark:stroke-ink-900" strokeWidth="2" />
          </g>
        ),
      )}
    </svg>
  );
}

function useSampleLoader() {
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const { loadSampleData } = await import("@/lib/storage/sample");
      await loadSampleData();
    } catch {
      /* the loader already explained what went wrong in a toast */
    } finally {
      setLoading(false);
    }
  };
  return { loading, load };
}

function AddActions({ compact }: { compact?: boolean }) {
  const samples = useSampleLoader();
  return (
    <>
      <Button size={compact ? "md" : "lg"} leftIcon={<Upload />} onClick={() => openUploadPicker()} data-testid="graph-add-files">
        Upload files
      </Button>
      {compact ? null : (
        <Button size="lg" variant="secondary" leftIcon={<NotebookPen />} onClick={openNote}>
          Write a note
        </Button>
      )}
      <Button
        size={compact ? "md" : "lg"}
        variant="ghost"
        leftIcon={<Sparkles />}
        loading={samples.loading}
        onClick={samples.load}
        data-testid="graph-try-samples"
      >
        Try sample memories
      </Button>
    </>
  );
}

/** No memories at all. */
export function GraphEmptyLibrary() {
  return (
    <Card padding="none" className={cn("relative grid place-items-center overflow-hidden", STAGE_HEIGHT)} data-testid="graph-empty">
      <StageBackdrop />
      <div className="relative flex flex-col items-center px-4 pt-8">
        <Constellation className="w-60 sm:w-72" pulse />
        <EmptyState
          className="pt-6"
          title="Your memory map starts here"
          description={
            <>
              Upload screenshots, PDFs, videos, voice notes or text. Remembos spots the people, numbers, links, dates and tags they
              share and draws the connections here — privately, on this device.
            </>
          }
          action={<AddActions />}
        >
          You can also drop files anywhere on this page.
        </EmptyState>
      </div>
    </Card>
  );
}

/** Memories exist, but none has finished processing yet (or all failed). */
export function GraphStillReading({ processing }: { processing: number }) {
  return (
    <Card padding="none" className={cn("relative grid place-items-center overflow-hidden", STAGE_HEIGHT)} data-testid="graph-processing">
      <StageBackdrop />
      {processing > 0 ? (
        <EmptyState
          className="relative"
          icon={<Spinner size="lg" />}
          title="Reading your memories…"
          description={
            <>
              {processing === 1 ? "One memory is" : `${processing.toLocaleString()} memories are`} still being read on this device.
              The graph appears as soon as the first one is ready.
            </>
          }
        />
      ) : (
        <EmptyState
          className="relative"
          icon={<CircleAlert />}
          title="Nothing could be read yet"
          description="Your memories couldn't be processed. Open the library to retry them, or add something new."
          action={
            <Button href={ROUTES.library} variant="secondary" leftIcon={<LibraryBig />}>
              Open library
            </Button>
          }
        />
      )}
    </Card>
  );
}

export function GraphError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card padding="none" className={cn("relative grid place-items-center overflow-hidden", STAGE_HEIGHT)} data-testid="graph-error">
      <EmptyState
        icon={<CircleAlert />}
        title="Couldn't draw your graph"
        description="Something went wrong while connecting your memories. They're safe — nothing was changed."
        action={
          <Button leftIcon={<RotateCcw />} onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </Card>
  );
}

/** Message card shown over the canvas (graph drawn, but nothing connects). The screen positions it. */
export function StageMessage({
  title,
  description,
  action,
  testId,
}: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="pointer-events-auto w-full max-w-sm rounded-3xl border border-zinc-200/80 bg-white/95 p-5 text-center shadow-pop animate-slide-up dark:border-white/10 dark:bg-ink-850/95"
      data-testid={testId}
    >
      <div className="mx-auto mb-3 grid size-11 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
        <Waypoints className="size-5" />
      </div>
      <p className="font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</p>
      <div className="mt-1.5 text-sm leading-relaxed text-muted">{description}</div>
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** "No connections yet" — memories exist but share nothing. */
export function NoConnectionsMessage() {
  return (
    <StageMessage
      testId="graph-no-connections"
      title="No connections yet"
      description="Lines appear when memories mention the same person, number, link, date or tag. Add a few more — or try the samples to see it in action."
      action={<AddActions compact />}
    />
  );
}
