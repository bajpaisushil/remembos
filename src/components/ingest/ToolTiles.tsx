"use client";

import { ClipboardPaste } from "lucide-react";
import { useState, type ReactNode } from "react";
import { KindIcon } from "@/components/ui/KindIcon";
import { Spinner } from "@/components/ui/Spinner";
import type { MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { pasteFromButton } from "./paste-button";
import { KIND_ACCEPT, requestFiles } from "./pick";

type FileKind = Exclude<MemoryKind, "note">;

interface Tile {
  id: FileKind | "paste";
  title: string;
  formats: string;
  icon: ReactNode;
  /** Hover glow color (rgb triplet). */
  glow: string;
}

const KIND_GLOW: Record<FileKind, string> = {
  image: "139 92 246",
  pdf: "244 63 94",
  video: "59 130 246",
  voice: "245 158 11",
  text: "14 165 233",
};

/** Gradient chip for "Copied text" — same look as KindIcon size "md". */
function PasteIcon() {
  return (
    <span
      aria-hidden
      className="relative inline-grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-cyan-500 to-blue-500 text-white ring-1 ring-white/25 ring-inset"
    >
      <span className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/25 to-transparent" />
      <ClipboardPaste className="relative size-[18px] drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]" strokeWidth={2.1} />
    </span>
  );
}

function kindTile(kind: FileKind, title: string, formats: string): Tile {
  return { id: kind, title, formats, icon: <KindIcon kind={kind} size="md" />, glow: KIND_GLOW[kind] };
}

const TILES: Tile[] = [
  kindTile("image", "Screenshots & photos", "PNG · JPG · HEIC · WEBP"),
  kindTile("pdf", "PDFs & docs", "PDF — even scanned pages"),
  kindTile("video", "Videos & screen recordings", "MP4 · MOV · WEBM · M4V"),
  kindTile("voice", "Voice & audio", "MP3 · M4A · WAV · OGG"),
  kindTile("text", "Text files", "TXT · MD · CSV · HTML"),
  { id: "paste", title: "Copied text", formats: "Links, chats, emails…", icon: <PasteIcon />, glow: "6 182 212" },
];

const TILE_CLASSES = cn(
  "group relative flex h-full w-full items-center gap-3 overflow-hidden rounded-2xl border p-3 text-left sm:flex-col sm:items-start sm:gap-2.5 sm:p-4",
  "border-zinc-200/70 bg-white shadow-soft dark:border-white/10 dark:bg-white/[0.04]",
  "transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none",
  "hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift active:translate-y-0 dark:hover:border-white/20",
);

/**
 * Compact "What you can add" row: one tile per kind of thing Remembos remembers. File tiles open the picker
 * filtered to that kind; "Copied text" saves the clipboard right away.
 */
export function ToolTiles() {
  const [pasting, setPasting] = useState(false);

  async function paste() {
    if (pasting) return;
    setPasting(true);
    try {
      await pasteFromButton();
    } finally {
      setPasting(false);
    }
  }

  function run(tile: Tile) {
    if (tile.id === "paste") void paste();
    else requestFiles(KIND_ACCEPT[tile.id]);
  }

  return (
    <section aria-labelledby="tools-title">
      <div className="mb-4">
        <h2 id="tools-title" className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          What you can add
        </h2>
        <p className="mt-1 text-sm text-muted">
          Drop it, Remembos reads it on your device, then find it by asking in plain words.
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        {TILES.map((tile) => {
          const busy = tile.id === "paste" && pasting;
          return (
            <li key={tile.id}>
              <button
                type="button"
                onClick={() => run(tile)}
                aria-busy={busy || undefined}
                data-testid={`tool-${tile.id}`}
                className={TILE_CLASSES}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-14 -right-14 size-36 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: `radial-gradient(closest-side, rgb(${tile.glow} / 0.18), transparent)` }}
                />
                {busy ? (
                  <span className="relative inline-grid size-9 shrink-0 place-items-center rounded-xl bg-zinc-900/5 dark:bg-white/10">
                    <Spinner size="sm" />
                  </span>
                ) : (
                  tile.icon
                )}
                <span className="relative min-w-0">
                  <span className="block text-sm leading-snug font-semibold tracking-tight text-zinc-900 dark:text-white">
                    {tile.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{tile.formats}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
