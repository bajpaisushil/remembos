"use client";
// Global ⌘K / Ctrl+K and "/" shortcuts for the command palette. Lives apart from the palette itself so the
// shortcut works from the first paint while the palette's code loads only when it's first opened.
import { useEffect } from "react";
import { isTypingTarget } from "@/components/ui/internal";
import { paletteOpen } from "@/lib/ui-state";

// ---------- Global shortcuts ----------

function anotherDialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

export function usePaletteShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        if (paletteOpen.get()) {
          e.preventDefault();
          paletteOpen.set(false);
          return;
        }
        if (anotherDialogOpen()) return;
        e.preventDefault();
        paletteOpen.set(true);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (paletteOpen.get() || isTypingTarget(e.target) || anotherDialogOpen()) return;
        e.preventDefault();
        const pageInput = document.querySelector<HTMLInputElement>("[data-search-page-input]");
        if (pageInput) {
          pageInput.focus();
          pageInput.select();
          return;
        }
        paletteOpen.set(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
