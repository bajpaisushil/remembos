"use client";

/**
 * Small pieces shared by the location finder and the storage explorer: a copyable path box,
 * literal key caps and the quickest way to open a pasted folder path on each desktop system.
 */
import type { ReactNode } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { Kbd } from "@/components/ui/Kbd";
import { cn } from "@/lib/utils";

/** A path in a monospace box with a copy button. */
export function PathBox({ path, label, testId, className }: { path: string; label: string; testId?: string; className?: string }) {
  return (
    <div
      className={cn(
        "mt-2.5 flex items-start gap-1.5 rounded-xl border border-zinc-200/70 bg-zinc-50 py-1.5 pr-1.5 pl-3 dark:border-white/[0.08] dark:bg-black/20",
        className,
      )}
    >
      <code data-testid={testId} className="min-w-0 flex-1 py-1 font-mono text-[12.5px] leading-relaxed break-all text-zinc-800 dark:text-zinc-200">
        {path}
      </code>
      <CopyButton value={path} iconOnly label={`Copy path: ${label}`} />
    </div>
  );
}

/** A key cap that shows exactly its label (Kbd would turn "Ctrl"/"Alt" into Mac glyphs on a Mac). */
export function KeyCap({ children }: { children: string }) {
  return (
    <Kbd>
      <>{children}</>
    </Kbd>
  );
}

/** A key combination, e.g. <KeyCombo keys={["⌘", "⇧", "G"]} />. */
export function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {keys.map((k) => (
        <KeyCap key={k}>{k}</KeyCap>
      ))}
    </span>
  );
}

const QUICK_OPEN: Record<"macos" | "windows" | "linux", { steps: ReactNode[] }> = {
  macos: {
    steps: [
      <>Copy the path above.</>,
      <>
        In <strong className="font-medium text-zinc-900 dark:text-white">Finder</strong>, press <KeyCombo keys={["⌘", "⇧", "G"]} /> (Go → Go to
        Folder…).
      </>,
      <>Paste it and press Return.</>,
    ],
  },
  windows: {
    steps: [
      <>Copy the path above.</>,
      <>
        Press <KeyCombo keys={["Win", "R"]} /> to open <strong className="font-medium text-zinc-900 dark:text-white">Run</strong>.
      </>,
      <>Paste it and press Enter — Windows fills in %LOCALAPPDATA% / %APPDATA% and opens the folder.</>,
    ],
  },
  linux: {
    steps: [
      <>Copy the path above.</>,
      <>
        In your file manager, press <KeyCombo keys={["Ctrl", "L"]} /> to type a location.
      </>,
      <>Paste it and press Enter (folders starting with a dot are hidden — <KeyCombo keys={["Ctrl", "H"]} /> shows them).</>,
    ],
  },
};

/** Three short steps to open a pasted folder path on macOS, Windows or Linux. */
export function QuickOpenSteps({ os, className }: { os: "macos" | "windows" | "linux"; className?: string }) {
  return (
    <ol className={cn("list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-600 marker:text-muted dark:text-zinc-300", className)} data-testid="quick-open-steps">
      {QUICK_OPEN[os].steps.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ol>
  );
}
