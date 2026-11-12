"use client";

import { Camera, ClipboardPaste, Mic, PenLine, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { KindIcon } from "@/components/ui/KindIcon";
import { openCamera, openNote, openRecorder, openUploadPicker } from "@/lib/add-actions";
import { LIMITS } from "@/lib/config";
import { useStore } from "@/lib/store";
import type { MemoryKind } from "@/lib/types";
import { dragActive } from "@/lib/ui-state";
import { cn, formatBytes } from "@/lib/utils";
import { pasteFromButton } from "./paste-button";

/** Decorative icons floating above the panel title (static offsets + a gentle, staggered float). */
const FLOATERS: { kind: MemoryKind; className: string; delay: string }[] = [
  { kind: "image", className: "-rotate-12 translate-y-2", delay: "0s" },
  { kind: "pdf", className: "-rotate-6 -translate-y-1", delay: "-1.4s" },
  { kind: "video", className: "rotate-2 -translate-y-2", delay: "-2.8s" },
  { kind: "voice", className: "rotate-6 -translate-y-1", delay: "-4.2s" },
  { kind: "text", className: "rotate-12 translate-y-2", delay: "-5.6s" },
];

/** Accepted formats shown as chips; the rest only where there is room. */
const FORMATS: { label: string; wide?: boolean }[] = [
  { label: "PNG" },
  { label: "JPG" },
  { label: "HEIC", wide: true },
  { label: "PDF" },
  { label: "MP4" },
  { label: "MOV" },
  { label: "MP3" },
  { label: "M4A" },
  { label: "WAV", wide: true },
  { label: "TXT" },
  { label: "MD", wide: true },
  { label: "CSV", wide: true },
];

type FocusTarget = "upload" | "paste";

/** How long the brand-glow pulse stays on after an app shortcut / #upload link lands here. */
const PULSE_MS = 1700;
/** The same request can arrive twice (first render + the shell's launch handling); pulse once. */
const DEDUPE_MS = 900;
let lastFocusAt = 0;

/** One-off keyframes for the arrival pulse (expanding brand ring + soft glow), hoisted into <head> by React. */
const PULSE_CSS = `@keyframes remembos-arrival-pulse{0%{box-shadow:0 0 0 0 rgb(139 92 246/.55),0 0 0 0 rgb(217 70 239/.3)}70%{box-shadow:0 0 0 18px rgb(139 92 246/0),0 0 56px 8px rgb(217 70 239/.16)}100%{box-shadow:0 0 0 22px rgb(139 92 246/0),0 0 0 0 rgb(217 70 239/0)}}`;
const PULSE_ANIMATION = "animate-[remembos-arrival-pulse_850ms_ease-out_2]";

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** `#upload` / `#paste` in the address bar (links, app shortcuts). */
function hashTarget(): FocusTarget | null {
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "upload" || hash === "paste" ? hash : null;
}

/** Drop the handled hash so the same link or shortcut works again next time. */
function clearHash(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, label, select, textarea, [role='button']") !== null;
}

/**
 * The home page's hero: one big upload panel. Upload files (opens the picker at once), Paste (saves the
 * clipboard immediately), Record voice, Take photo (touch devices) and a quiet "or add a note". Clicking
 * anywhere on the empty panel opens the picker too. The shell's GlobalDropOverlay handles the actual drop
 * anywhere on the page and owns the file input; this panel lights up while files are dragged over the window.
 *
 * `id="upload"` / `id="paste"`: links and app shortcuts land here (`#upload` / `#paste`, on load and on
 * hashchange; the shell turns the manifest's `?action=upload|paste` into these) — the target scrolls into
 * view, takes focus and glows briefly. Browsers only open a file picker after a click, so "upload" points
 * at the panel (Enter then opens the picker).
 */
export function DropZone({ className }: { className?: string }) {
  const active = useStore(dragActive);
  const panelRef = useRef<HTMLElement>(null);
  const pasteRef = useRef<HTMLButtonElement>(null);
  const [pasting, setPasting] = useState(false);
  /** Which element is glowing; `n` restarts the animation when the same target is pointed at again. */
  const [pulse, setPulse] = useState<{ target: FocusTarget; n: number } | null>(null);

  useEffect(() => {
    const land = (target: FocusTarget) => {
      const now = Date.now();
      if (now - lastFocusAt < DEDUPE_MS) return;
      lastFocusAt = now;
      const panel = panelRef.current;
      const el = target === "paste" ? pasteRef.current : panel;
      if (!panel || !el) return;
      el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      el.focus({ preventScroll: true });
      setPulse({ target, n: now });
    };
    const onHash = () => {
      const target = hashTarget();
      if (!target) return;
      clearHash();
      land(target);
    };
    // After the first paint, so the browser's own jump-to-anchor and the layout have settled.
    const frame = window.requestAnimationFrame(onHash);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!pulse) return;
    const timer = window.setTimeout(() => setPulse(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  async function paste() {
    if (pasting) return;
    setPasting(true);
    try {
      await pasteFromButton();
    } finally {
      setPasting(false);
    }
  }

  function onPanelClick(e: MouseEvent<HTMLElement>) {
    if (isInteractive(e.target)) return;
    openUploadPicker();
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    // The panel itself only takes focus when a link or shortcut lands here; Enter/Space then opens the picker.
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openUploadPicker();
  }

  const lit = active || pulse?.target === "upload";

  return (
    <div className={cn("relative", className)}>
      <style href="remembos-arrival-pulse" precedence="default">
        {PULSE_CSS}
      </style>
      {/* The arrival ring sits outside the panel so its glow isn't clipped. */}
      {pulse?.target === "upload" ? (
        <span key={pulse.n} aria-hidden className={cn("pointer-events-none absolute inset-0 rounded-[2rem]", PULSE_ANIMATION)} />
      ) : null}

      <section
        ref={panelRef}
        id="upload"
        tabIndex={-1}
        aria-labelledby="upload-title"
        aria-describedby="upload-hint"
        onClick={onPanelClick}
        onKeyDown={onPanelKeyDown}
        data-testid="drop-zone"
        data-active={active || undefined}
        className={cn(
          "group/zone relative isolate cursor-pointer overflow-hidden rounded-[2rem] border-2 border-dashed px-4 pt-5 pb-5 text-center",
          "sm:px-10 sm:pt-9 sm:pb-8",
          "transition-[transform,border-color,background-color,box-shadow] duration-200 ease-out motion-reduce:transition-none",
          "focus-visible:outline-offset-4",
          lit
            ? "border-brand-400 bg-brand-50/80 shadow-glow dark:border-brand-300/60 dark:bg-brand-400/10"
            : cn(
                "border-zinc-300/80 bg-white/70 shadow-card hover:border-brand-400/70 hover:bg-white/90 hover:shadow-lift",
                "dark:border-white/15 dark:bg-white/[0.03] dark:hover:border-brand-300/45 dark:hover:bg-white/[0.05]",
              ),
          active && "scale-[1.01]",
        )}
      >
        {/* Soft brand glow that brightens on hover / drag. Static gradients only. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 -z-10 transition-opacity duration-300",
            "bg-[radial-gradient(60%_70%_at_50%_0%,rgb(139_92_246/0.16),transparent_70%),radial-gradient(40%_50%_at_8%_100%,rgb(99_102_241/0.10),transparent_70%),radial-gradient(40%_50%_at_92%_100%,rgb(217_70_239/0.10),transparent_70%)]",
            "dark:bg-[radial-gradient(60%_70%_at_50%_0%,rgb(139_92_246/0.24),transparent_70%),radial-gradient(40%_50%_at_8%_100%,rgb(99_102_241/0.14),transparent_70%),radial-gradient(40%_50%_at_92%_100%,rgb(217_70_239/0.14),transparent_70%)]",
            lit ? "opacity-100" : "opacity-70 group-hover/zone:opacity-100",
          )}
        />

        <span aria-hidden className="mb-3 flex items-end justify-center gap-2 sm:mb-6 sm:gap-3.5">
          {FLOATERS.map(({ kind, className: offset, delay }) => (
            <span
              key={kind}
              className={cn(
                "inline-block transition-[scale] duration-300 ease-spring motion-reduce:transition-none",
                offset,
                lit ? "scale-115" : "group-hover/zone:scale-110",
              )}
            >
              <span className="inline-block animate-float" style={{ animationDelay: delay }}>
                <KindIcon kind={kind} size="sm" className="sm:hidden" />
                <KindIcon kind={kind} size="lg" className="max-sm:hidden" />
              </span>
            </span>
          ))}
        </span>

        <h2
          id="upload-title"
          className="text-[1.3rem] leading-tight font-semibold tracking-tight text-zinc-900 sm:text-[1.7rem] dark:text-white"
        >
          {active ? (
            "Release to remember"
          ) : (
            <>
              <span className="pointer-coarse:hidden">Drop anything here</span>
              <span className="hidden pointer-coarse:inline">Add anything</span>
            </>
          )}
        </h2>
        <p id="upload-hint" className="mx-auto mt-1.5 max-w-md text-sm text-muted sm:mt-2 sm:text-[15px]">
          <span className="pointer-coarse:hidden">
            Files, screenshots and recordings — or paste with{" "}
            <Kbd keys={["mod", "v"]} className="align-[-0.15em]" /> anywhere
          </span>
          <span className="hidden pointer-coarse:inline">Photos, files, recordings or anything you copied</span>
        </p>

        <div className="mx-auto mt-5 flex max-w-sm flex-col gap-2.5 sm:mt-7 sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center">
          <Button
            size="lg"
            leftIcon={<Upload />}
            onClick={() => openUploadPicker()}
            data-testid="home-upload"
            className="sm:px-7"
          >
            Upload files
          </Button>
          <div className="grid grid-cols-2 gap-2.5 sm:contents">
            <Button
              ref={pasteRef}
              id="paste"
              variant="secondary"
              size="lg"
              leftIcon={<ClipboardPaste />}
              loading={pasting}
              onClick={() => void paste()}
              data-testid="home-paste"
              aria-keyshortcuts="Meta+V Control+V"
              className="px-3 sm:px-5"
            >
              {pulse?.target === "paste" ? (
                <span
                  key={pulse.n}
                  aria-hidden
                  className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", PULSE_ANIMATION)}
                />
              ) : null}
              Paste
              <Kbd keys={["mod", "v"]} className="ml-0.5 pointer-coarse:hidden max-[400px]:hidden" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              leftIcon={<Mic />}
              onClick={openRecorder}
              aria-label="Record voice"
              data-testid="home-record"
              className="px-3 sm:px-5"
            >
              <span>
                Record<span className="max-[379px]:hidden"> voice</span>
              </span>
            </Button>
            <div className="col-span-2 hidden pointer-coarse:block">
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                leftIcon={<Camera />}
                onClick={openCamera}
                data-testid="home-camera"
                className="px-3 sm:px-5"
              >
                Take photo
              </Button>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={openNote}
          data-testid="home-note"
          className={cn(
            "mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium sm:mt-4",
            "text-zinc-600 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900",
            "dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white",
          )}
        >
          <PenLine aria-hidden className="size-3.5" />
          or add a note
        </button>

        <ul aria-label="Supported files" className="mx-auto mt-3 flex max-w-lg flex-wrap items-center justify-center gap-1.5 sm:mt-4">
          {FORMATS.map(({ label, wide }) => (
            <li
              key={label}
              className={cn(
                "rounded-md bg-zinc-900/[0.045] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300",
                wide && "max-sm:hidden",
              )}
            >
              {label}
            </li>
          ))}
          <li className="px-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
            + more · up to {formatBytes(LIMITS.maxFileBytes, 0)} each
          </li>
        </ul>

        <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 sm:mt-5 dark:text-emerald-300">
          <ShieldCheck aria-hidden className="size-3.5" />
          Stays on this device — nothing is uploaded
        </p>
      </section>
    </div>
  );
}
