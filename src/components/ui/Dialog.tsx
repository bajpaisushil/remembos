"use client";

import { X } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { getFocusable, isTopOverlay, lockScroll, pushOverlay, useIsClient } from "./internal";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

export interface DialogProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button (when `dismissible`). */
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  /** Leading visual next to the title (e.g. <KindIcon kind="note" size="lg" />). */
  icon?: ReactNode;
  children?: ReactNode;
  /** Action row pinned to the bottom (buttons stack full-width on phones). */
  footer?: ReactNode;
  /** sm 384px · md 512px (default) · lg 672px · xl 896px · full 1152px */
  size?: DialogSize;
  /** "top" pins the panel near the top on larger screens (command palettes). Default "center". */
  align?: "center" | "top";
  /** Allow closing via Esc / backdrop / close button. Default true. */
  dismissible?: boolean;
  hideClose?: boolean;
  /** On phones, slide up as a bottom sheet. Default true. */
  mobileSheet?: boolean;
  /** Phones: drag the bottom sheet down to close it (needs `mobileSheet` and `dismissible`). Default false. */
  swipeToClose?: boolean;
  /** Element to focus on open (default: [data-autofocus] / autoFocus element, else the panel). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Classes for the panel. */
  className?: string;
  /** Classes for the scrollable body. */
  bodyClassName?: string;
  /** Default body padding. Set false for edge-to-edge content (lists, palettes). Default true. */
  padded?: boolean;
  /** Accessible name when there is no visible title. */
  "aria-label"?: string;
  "data-testid"?: string;
}

const EXIT_MS = 170;

const SIZES: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-6xl",
};

/**
 * Accessible modal dialog: portal, focus trap + restore, Esc, backdrop click, scroll lock,
 * enter/exit animation, bottom sheet on phones.
 */
export function Dialog(props: DialogProps) {
  const { open } = props;
  const isClient = useIsClient();
  const [prevOpen, setPrevOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (prevOpen !== open) {
    setPrevOpen(open);
    setExiting(!open);
  }

  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(() => setExiting(false), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [exiting]);

  if (!isClient || (!open && !exiting)) return null;
  return createPortal(<DialogPanel {...props} />, document.body);
}

function DialogPanel({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
  align = "center",
  dismissible = true,
  hideClose = false,
  mobileSheet = true,
  swipeToClose = false,
  initialFocusRef,
  className,
  bodyClassName,
  padded = true,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerDownOnBackdrop = useRef(false);

  const requestClose = () => {
    if (dismissible) onClose();
  };
  const onEscape = useEffectEvent(requestClose);

  // Open lifecycle: overlay stack, scroll lock, initial focus, focus restore.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const popOverlay = pushOverlay(id);
    const unlock = lockScroll();

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const target =
        initialFocusRef?.current ??
        panel.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ??
        panel;
      target.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !isTopOverlay(id)) return;
      e.preventDefault();
      onEscape();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      popOverlay();
      unlock();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [open, id, initialFocusRef]);

  useSwipeToClose(panelRef, open && swipeToClose && mobileSheet && dismissible, onClose);

  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = getFocusable(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const state = open ? "open" : "closed";
  const hasHeader = Boolean(title || description || icon);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex justify-center overflow-y-auto overscroll-contain",
        mobileSheet ? "items-end sm:p-4" : "items-center p-4",
        align === "top" ? "sm:items-start sm:pt-[12vh]" : "sm:items-center",
        !open && "pointer-events-none",
      )}
      data-state={state}
    >
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 bg-zinc-950/35 backdrop-blur-[3px] dark:bg-black/60",
          open ? "animate-fade-in" : "animate-fade-out",
        )}
        onPointerDown={(e) => {
          pointerDownOnBackdrop.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (pointerDownOnBackdrop.current && e.target === e.currentTarget) requestClose();
          pointerDownOnBackdrop.current = false;
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        data-state={state}
        data-testid={testId}
        onKeyDown={trapTab}
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-elevated text-fg shadow-pop outline-none",
          "border border-zinc-200/70 dark:border-white/10",
          mobileSheet
            ? "max-h-[92dvh] rounded-t-3xl border-b-0 pb-safe sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:border-b sm:pb-0"
            : "max-h-[calc(100dvh-2rem)] rounded-3xl",
          align === "top" && "sm:max-h-[76vh]",
          SIZES[size],
          mobileSheet
            ? open
              ? "animate-sheet-in sm:animate-scale-in"
              : "animate-sheet-out sm:animate-scale-out"
            : open
              ? "animate-scale-in"
              : "animate-scale-out",
          className,
        )}
      >
        {mobileSheet ? (
          <div aria-hidden className="flex justify-center pt-2.5 sm:hidden">
            <span className="h-1 w-10 rounded-full bg-zinc-300 dark:bg-white/20" />
          </div>
        ) : null}

        {hasHeader ? (
          <div className={cn("flex items-start gap-3.5 px-5 pt-4 sm:px-6 sm:pt-6", hideClose || !dismissible ? "" : "pr-14 sm:pr-16")}>
            {icon ? <div className="shrink-0">{icon}</div> : null}
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <div id={descId} className="mt-1 text-sm leading-relaxed text-muted">
                  {description}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!hideClose && dismissible ? (
          <button
            type="button"
            onClick={() => requestClose()}
            aria-label="Close"
            className="absolute top-3 right-3 grid size-9 place-items-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 sm:top-4 sm:right-4 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <X className="size-[18px]" />
          </button>
        ) : null}

        <div
          data-dialog-body=""
          className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", padded && "px-5 py-4 sm:px-6 sm:py-5", bodyClassName)}
        >
          {children}
        </div>

        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-zinc-200/70 bg-zinc-50/70 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end sm:px-6 dark:border-white/[0.08] dark:bg-white/[0.02] [&>*]:w-full sm:[&>*]:w-auto">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Matches the Dialog's `sm` breakpoint: below it, sheets sit at the bottom of the screen. */
const PHONE_QUERY = "(max-width: 639.98px)";
const SWIPE_SLOP = 8;

/**
 * Drag a bottom sheet down to dismiss it. Starts only on a downward drag (not from form fields, and not
 * while the sheet's content is scrolled), follows the finger, and closes past ~30% of the sheet's height
 * or on a quick flick — otherwise it springs back.
 */
function useSwipeToClose(panelRef: RefObject<HTMLDivElement | null>, enabled: boolean, onClose: () => void) {
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel) return;

    let tracking = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let offset = 0;

    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (e.touches.length !== 1 || !window.matchMedia(PHONE_QUERY).matches) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [data-no-swipe]")) return;
      const body = panel.querySelector<HTMLElement>("[data-dialog-body]");
      if (body && target && body.contains(target) && body.scrollTop > 0) return;
      tracking = true;
      dragging = false;
      offset = 0;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = performance.now();
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!dragging) {
        // Horizontal swipes and upward scrolls are not ours.
        if (Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy)) tracking = false;
        else if (dy < -SWIPE_SLOP / 2) tracking = false;
        if (!tracking || dy < SWIPE_SLOP) return;
        dragging = true;
        panel.style.animation = "none";
        panel.style.transition = "none";
      }
      e.preventDefault();
      offset = Math.max(0, dy - SWIPE_SLOP);
      panel.style.transform = `translate3d(0, ${offset}px, 0)`;
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!dragging) return;
      dragging = false;
      const velocity = offset / Math.max(1, performance.now() - startTime);
      const dismiss = offset > Math.min(160, panel.offsetHeight * 0.3) || (velocity > 0.55 && offset > 32);
      if (dismiss) {
        panel.style.transition = "transform 160ms ease-in";
        panel.style.transform = "translate3d(0, 100%, 0)";
        close();
      } else {
        panel.style.transition = "transform 240ms cubic-bezier(0.16, 1, 0.3, 1)";
        panel.style.transform = "";
      }
    };

    panel.addEventListener("touchstart", onStart, { passive: true });
    panel.addEventListener("touchmove", onMove, { passive: false });
    panel.addEventListener("touchend", onEnd);
    panel.addEventListener("touchcancel", onEnd);
    return () => {
      panel.removeEventListener("touchstart", onStart);
      panel.removeEventListener("touchmove", onMove);
      panel.removeEventListener("touchend", onEnd);
      panel.removeEventListener("touchcancel", onEnd);
    };
  }, [panelRef, enabled]);
}
