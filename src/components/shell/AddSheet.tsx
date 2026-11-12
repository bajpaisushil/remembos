"use client";

import { Camera, ChevronRight, ClipboardPaste, Images, Mic, MonitorDown, StickyNote, Upload, type LucideIcon } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { useStore } from "@/lib/store";
import { addSheetOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { startCamera, startNote, startPaste, startRecording, startUpload, useIsTouchDevice } from "./add-entry";
import { startInstall, useInstallOffer } from "./install-offer";

interface Tile {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  gradient: string;
  glow: string;
  run: () => void;
}

const close = () => addSheetOpen.set(false);

/**
 * "Add to your memory" sheet, opened by the + in the mobile tab bar (`addSheetOpen`). Big friendly tiles —
 * upload, photos & videos, camera, paste, record — plus a small "Add note" row. Choosing anything runs it
 * right away (inside the tap, so pickers and the clipboard are allowed) and closes the sheet. Swipe down,
 * Esc or tap outside to close. Centred dialog on larger screens. Mounted globally by the app shell. No props.
 */
export function AddSheet() {
  const open = useStore(addSheetOpen);
  const touch = useIsTouchDevice();
  const offerInstall = useInstallOffer();

  const choose = (run: () => void) => () => {
    run();
    close();
  };

  const tiles: Tile[] = [
    {
      id: "media",
      label: "Photos & videos",
      hint: "From your gallery",
      icon: Images,
      gradient: "from-violet-500 to-blue-500",
      glow: "shadow-[0_8px_20px_-8px_rgb(139_92_246/0.7)]",
      run: () => startUpload("media"),
    },
    ...(touch
      ? [
          {
            id: "camera",
            label: "Take photo",
            hint: "Use the camera",
            icon: Camera,
            gradient: "from-blue-500 to-cyan-400",
            glow: "shadow-[0_8px_20px_-8px_rgb(59_130_246/0.7)]",
            run: startCamera,
          },
        ]
      : []),
    {
      id: "paste",
      label: "Paste",
      hint: "What you just copied",
      icon: ClipboardPaste,
      gradient: "from-sky-500 to-cyan-400",
      glow: "shadow-[0_8px_20px_-8px_rgb(14_165_233/0.7)]",
      run: startPaste,
    },
    {
      id: "record",
      label: "Record voice",
      hint: "Transcribed right here",
      icon: Mic,
      gradient: "from-amber-500 to-yellow-400",
      glow: "shadow-[0_8px_20px_-8px_rgb(245_158_11/0.7)]",
      run: startRecording,
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add to your memory"
      description="Saved on this device only — nothing is uploaded."
      size="md"
      swipeToClose
      data-testid="add-sheet"
      bodyClassName="pt-3 sm:pt-4"
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={choose(() => startUpload())}
          data-testid="add-sheet-upload"
          className={cn(
            "group relative flex items-center gap-4 overflow-hidden rounded-3xl border border-brand-500/20 p-4 text-left transition-transform duration-200 ease-spring sm:p-5 dark:border-brand-300/20",
            "bg-linear-to-br from-indigo-500/[0.07] via-violet-500/[0.06] to-fuchsia-500/[0.07] active:scale-[0.98]",
            "hover:from-indigo-500/[0.11] hover:via-violet-500/[0.09] hover:to-fuchsia-500/[0.11]",
            "dark:from-indigo-400/[0.12] dark:via-violet-400/[0.1] dark:to-fuchsia-400/[0.12]",
            "dark:hover:from-indigo-400/[0.18] dark:hover:via-violet-400/[0.15] dark:hover:to-fuchsia-400/[0.18]",
          )}
        >
          <span className="brand-gradient relative grid size-14 shrink-0 place-items-center rounded-2xl text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_10px_24px_-8px_rgb(124_58_237/0.75)] transition-transform duration-200 ease-spring group-hover:-translate-y-0.5">
            <Upload aria-hidden className="size-6" strokeWidth={2.3} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-white">Upload files</span>
            <span className="mt-0.5 block text-sm leading-snug text-muted">Screenshots, PDFs, videos, voice, text</span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 dark:text-zinc-500" />
        </button>

        <ul className="grid grid-cols-2 gap-3">
          {tiles.map((tile, i) => {
            const Icon = tile.icon;
            const wide = tiles.length % 2 === 1 && i === tiles.length - 1;
            return (
              <li key={tile.id} className={cn("flex", wide && "col-span-2")}>
                <button
                  type="button"
                  onClick={choose(tile.run)}
                  data-testid={`add-sheet-${tile.id}`}
                  className={cn(
                    "group flex flex-1 gap-2.5 rounded-2xl border p-3 text-left transition-[transform,border-color,background-color,box-shadow] duration-200 ease-spring sm:gap-3 sm:p-3.5",
                    "border-zinc-200/80 bg-white shadow-soft hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-lift active:scale-[0.97]",
                    "dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-white/20 dark:hover:bg-white/[0.08]",
                    wide ? "flex-row items-center" : "flex-col items-start",
                  )}
                >
                  <span
                    className={cn(
                      "relative grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br text-white ring-1 ring-inset ring-white/25 sm:size-11 sm:rounded-[14px]",
                      tile.gradient,
                      tile.glow,
                    )}
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/25 to-transparent" />
                    <Icon aria-hidden className="relative size-5" strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold text-zinc-900 dark:text-white">{tile.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{tile.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-1 rounded-2xl border border-zinc-200/70 p-1 dark:border-white/[0.08]">
          <SmallRow
            icon={StickyNote}
            iconClassName="text-emerald-600 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-400/15"
            label="Add note"
            hint="Type a thought, decision or to-do"
            onClick={choose(startNote)}
            testId="add-sheet-note"
          />
          {offerInstall ? (
            <SmallRow
              icon={MonitorDown}
              iconClassName="text-brand-600 bg-brand-500/10 dark:text-brand-200 dark:bg-brand-400/15"
              label="Install app"
              hint="Home-screen icon, works offline"
              onClick={choose(startInstall)}
              testId="add-sheet-install"
            />
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function SmallRow({
  icon: Icon,
  iconClassName,
  label,
  hint,
  onClick,
  testId,
}: {
  icon: LucideIcon;
  iconClassName: string;
  label: string;
  hint: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
        "hover:bg-zinc-900/[0.04] active:bg-zinc-900/[0.06] dark:hover:bg-white/[0.06] dark:active:bg-white/[0.08]",
      )}
    >
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", iconClassName)}>
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-white">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 dark:text-zinc-500" />
    </button>
  );
}
