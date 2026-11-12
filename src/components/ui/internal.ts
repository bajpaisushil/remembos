"use client";
// Small browser helpers shared by the overlay primitives (Dialog, Menu, Popover).

import { useSyncExternalStore } from "react";
import { createStore } from "@/lib/store";

const noopSubscribe = () => () => {};

/** true on the client (after hydration), false during prerender — without an extra effect render. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/** Visible, keyboard-focusable descendants in DOM order. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0,
  );
}

// ---------- Scroll lock (ref-counted so stacked overlays behave) ----------

let lockCount = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

/** Number of open modal overlays (dialogs, sheets). The toast host moves out of their way on phones. */
export const openModalCount = createStore<number>(0);

export function lockScroll(): () => void {
  if (typeof document === "undefined") return () => {};
  if (lockCount === 0) {
    const body = document.body;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    saved = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
  }
  lockCount++;
  openModalCount.set(lockCount);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    openModalCount.set(lockCount);
    if (lockCount === 0 && saved) {
      document.body.style.overflow = saved.overflow;
      document.body.style.paddingRight = saved.paddingRight;
      saved = null;
    }
  };
}

// ---------- Overlay stack: only the topmost overlay reacts to Escape ----------

const stack: string[] = [];

export function pushOverlay(id: string): () => void {
  stack.push(id);
  return () => {
    const i = stack.lastIndexOf(id);
    if (i !== -1) stack.splice(i, 1);
  };
}

export function isTopOverlay(id: string): boolean {
  return stack[stack.length - 1] === id;
}

/** True when the user is typing somewhere (inputs, textareas, selects, contenteditable). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
  }
  return false;
}

/**
 * Keep an absolutely positioned floating panel inside the viewport: shifts it horizontally
 * (via the CSS `translate` property, so transform animations still work) and flips it above
 * the anchor when there's no room below. Call right after the panel mounts.
 */
export function fitToViewport(panel: HTMLElement, anchor: HTMLElement, margin = 8): void {
  panel.style.translate = "";
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let rect = panel.getBoundingClientRect();

  // Narrow screens: never wider than the viewport.
  if (rect.width > vw - margin * 2) {
    panel.style.width = `${vw - margin * 2}px`;
    rect = panel.getBoundingClientRect();
  }

  let dx = 0;
  if (rect.left < margin) dx = margin - rect.left;
  else if (rect.right > vw - margin) dx = vw - margin - rect.right;
  if (dx) panel.style.translate = `${Math.round(dx)}px 0`;

  const anchorRect = anchor.getBoundingClientRect();
  const below = rect.top >= anchorRect.bottom;
  if (below && rect.bottom > vh - margin && anchorRect.top - margin > rect.height + 8) {
    panel.style.top = "auto";
    panel.style.bottom = "100%";
    panel.style.marginTop = "0";
    panel.style.marginBottom = "8px";
  }
}
