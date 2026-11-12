"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";
import { fitToViewport } from "./internal";

/**
 * Close a floating panel on outside pointer-down, Escape (focus returns to the trigger) and focus leaving it.
 * Shared by Popover and Menu.
 */
export function useDismiss(
  open: boolean,
  close: (opts?: { restoreFocus?: boolean }) => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (rootRef.current?.contains(document.activeElement) || document.activeElement === document.body) {
        e.preventDefault();
        e.stopPropagation();
        close({ restoreFocus: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close, rootRef]);
}

export interface PopoverProps {
  /** Trigger content (text and/or icon). */
  trigger: ReactNode;
  /** Accessible name for the trigger (required when the trigger is icon-only). */
  label?: string;
  /** Panel content, or a render function receiving `close`. */
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  align?: "start" | "end";
  side?: "bottom" | "top";
  /** Trigger styling: a Button variant/size, or `triggerClassName` for a fully custom look. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  triggerClassName?: string;
  /** Panel classes (width defaults to 20rem, clamped to the viewport). */
  className?: string;
  /** Default inner padding (p-4). Set false for edge-to-edge content. */
  padded?: boolean;
  "data-testid"?: string;
}

/** Click-to-open floating panel (non-modal). Esc / outside click close it. */
export function Popover({
  trigger,
  label,
  children,
  align = "start",
  side = "bottom",
  variant = "ghost",
  size = "sm",
  triggerClassName,
  className,
  padded = true,
  "data-testid": testId,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Bumped to move focus back to the trigger after closing (kept in state so render stays pure).
  const [refocus, setRefocus] = useState(0);

  const close = useCallback((opts?: { restoreFocus?: boolean }) => {
    setOpen(false);
    if (opts?.restoreFocus) setRefocus((n) => n + 1);
  }, []);
  useDismiss(open, close, rootRef);

  useLayoutEffect(() => {
    if (open && panelRef.current && triggerRef.current) fitToViewport(panelRef.current, triggerRef.current);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (refocus) triggerRef.current?.focus();
  }, [refocus]);

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onBlur={(e) => {
        if (open && rootRef.current && e.relatedTarget instanceof Node && !rootRef.current.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName ?? buttonClasses({ variant, size })}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={cn(
            "absolute z-50 w-80 max-w-[calc(100vw-1rem)] animate-pop-in rounded-2xl border border-zinc-200/80 bg-elevated text-fg shadow-pop outline-none",
            padded && "p-4",
            "dark:border-white/10",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
        >
          {typeof children === "function" ? children({ close: () => close({ restoreFocus: true }) }) : children}
        </div>
      ) : null}
    </div>
  );
}
