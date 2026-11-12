"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Accent } from "@/components/ui/PageHeader";
import { KindIcon } from "@/components/ui/KindIcon";
import { ACCEPTED_FILE_TYPES } from "@/lib/ingest/detect";
import { useStore } from "@/lib/store";
import type { MemoryKind } from "@/lib/types";
import { dragActive, filePickerRequest } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { rememberFiles } from "./add-entry";

const FLOATING_KINDS: { kind: MemoryKind; className: string; delay: string }[] = [
  { kind: "image", className: "-rotate-12 translate-y-2", delay: "0s" },
  { kind: "pdf", className: "-rotate-6 -translate-y-1", delay: "-1.2s" },
  { kind: "video", className: "-translate-y-3", delay: "-2.4s" },
  { kind: "voice", className: "rotate-6 -translate-y-1", delay: "-3.6s" },
  { kind: "text", className: "rotate-12 translate-y-2", delay: "-4.8s" },
];

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function countFiles(e: DragEvent): number {
  return Array.from(e.dataTransfer?.items ?? []).filter((item) => item.kind === "file").length;
}

/**
 * The app's only drag-and-drop handler. Dragging files anywhere over the window shows a full-screen
 * "Drop to remember" overlay (and sets `dragActive` so the home drop zone can animate); dropping
 * ingests them. Also owns the hidden file picker: it opens whenever `filePickerRequest` changes — inside
 * the same click that asked for it, so browsers allow it — with the requested `accept` and `capture`.
 */
export function GlobalDropOverlay() {
  const active = useStore(dragActive);
  const [count, setCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let depth = 0;
    let watchdog: number | undefined;

    const deactivate = () => {
      depth = 0;
      window.clearTimeout(watchdog);
      dragActive.set(false);
    };
    // Browsers fire dragover continuously while dragging over the page; if they stop (drag
    // cancelled outside the window, missed dragleave), hide the overlay.
    const armWatchdog = () => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(deactivate, 1000);
    };

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      const n = countFiles(e);
      if (n) setCount(n);
      dragActive.set(true);
      armWatchdog();
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      if (!dragActive.get()) dragActive.set(true);
      armWatchdog();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      const leftWindow = e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
      if (depth === 0 || (e.relatedTarget === null && leftWindow)) {
        deactivate();
        setCount(0);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      deactivate();
      setCount(0);
      void rememberFiles(Array.from(e.dataTransfer?.files ?? []));
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.clearTimeout(watchdog);
      dragActive.set(false);
    };
  }, []);

  // Open the picker synchronously inside the requesting click: the store notifies subscribers during
  // `filePickerRequest.set()`, so `input.click()` runs in the same task and keeps the user activation.
  useEffect(() => {
    const unsubscribe = filePickerRequest.subscribe(() => {
      const request = filePickerRequest.get();
      const input = inputRef.current;
      if (!request || !input) return;
      input.accept = request.accept || ACCEPTED_FILE_TYPES;
      // `capture` makes phones open the camera directly; without it they offer camera, gallery and files.
      if (request.capture) input.setAttribute("capture", request.capture);
      else input.removeAttribute("capture");
      input.click();
    });
    return () => {
      unsubscribe();
    };
  }, []);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    e.currentTarget.value = "";
    void rememberFiles(files);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        onChange={onPick}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-testid="global-file-input"
      />
      <div
        aria-hidden={!active}
        inert={!active}
        data-testid="drop-overlay"
        data-active={active || undefined}
        className={cn(
          "fixed inset-0 z-[90] grid place-items-center p-4 transition-[opacity,visibility] duration-200 ease-out sm:p-8",
          active ? "visible opacity-100" : "pointer-events-none invisible opacity-0",
        )}
      >
        <div className="glass absolute inset-0 bg-white/60 dark:bg-ink-900/70" />
        <div className="aurora absolute inset-0 opacity-90" />
        <div className="absolute inset-3 rounded-[2rem] border-2 border-dashed border-brand-400/50 sm:inset-5 dark:border-brand-300/30" />

        <div
          className={cn(
            "gradient-border relative w-full max-w-lg rounded-[2rem] bg-white/80 px-6 py-10 text-center shadow-pop transition-transform duration-300 ease-spring sm:px-10 sm:py-12",
            "dark:bg-ink-850/80",
            active ? "scale-100" : "scale-95",
          )}
        >
          <div className="mb-7 flex items-center justify-center gap-2 sm:gap-3">
            {FLOATING_KINDS.map(({ kind, className, delay }) => (
              <span key={kind} className={cn("inline-block", className)}>
                <span className="inline-block animate-float" style={{ animationDelay: delay }}>
                  <KindIcon kind={kind} size="lg" />
                </span>
              </span>
            ))}
          </div>
          <p className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            Drop to <Accent>remember</Accent>
          </p>
          <p className="mt-3 text-[15px] font-medium text-zinc-700 dark:text-zinc-200">Screenshots, PDFs, videos, voice, text</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            Read and remembered right here on your device. Nothing is uploaded.
          </p>
          <p className="mt-5 inline-flex h-8 items-center gap-2 rounded-full bg-brand-500/10 px-3.5 text-sm font-medium text-brand-700 dark:bg-brand-400/15 dark:text-brand-200">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-brand-500 text-brand-500" />
            {count > 0 ? `${count} file${count === 1 ? "" : "s"} ready` : "Release to add"}
          </p>
        </div>
      </div>
    </>
  );
}
