"use client";
/** Small client hooks for the library and item pages. */
import { useEffect, useState, useSyncExternalStore } from "react";

// ---------- Remembered grid / list choice (per browser, localStorage) ----------

export type LibraryLayout = "grid" | "list";

const LAYOUT_KEY = "remembos:library-view";
const layoutListeners = new Set<() => void>();
/** Used only when localStorage refuses writes (blocked or full): the choice lasts for this page visit. */
let sessionLayout: LibraryLayout | null = null;

function readLayout(): LibraryLayout {
  if (sessionLayout) return sessionLayout;
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function subscribeLayout(listener: () => void): () => void {
  layoutListeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LAYOUT_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    layoutListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Grid ↔ list preference, remembered in localStorage (falls back to memory when storage is blocked). */
export function useLibraryLayout(): [LibraryLayout, (next: LibraryLayout) => void] {
  const layout = useSyncExternalStore(subscribeLayout, readLayout, () => "grid" as const);
  const setLayout = (next: LibraryLayout) => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
      sessionLayout = null;
    } catch {
      sessionLayout = next;
    }
    layoutListeners.forEach((l) => l());
  };
  return [layout, setLayout];
}

// ---------- Debounce ----------

/** `value`, updated only after it stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ---------- Lazy loading ----------

interface SharedObserver {
  io: IntersectionObserver;
  callbacks: WeakMap<Element, () => void>;
}

/** One IntersectionObserver per margin, shared by every card (cheaper than one per element). */
const sharedObservers = new Map<string, SharedObserver>();

function observeOnce(el: Element, margin: string, onSeen: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onSeen();
    return () => {};
  }
  let shared = sharedObservers.get(margin);
  if (!shared) {
    const callbacks = new WeakMap<Element, () => void>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = callbacks.get(entry.target);
          callbacks.delete(entry.target);
          io.unobserve(entry.target);
          cb?.();
        }
      },
      { rootMargin: margin },
    );
    shared = { io, callbacks };
    sharedObservers.set(margin, shared);
  }
  const { io, callbacks } = shared;
  callbacks.set(el, onSeen);
  io.observe(el);
  return () => {
    callbacks.delete(el);
    io.unobserve(el);
  };
}

/**
 * Becomes true (and stays true) once the element has come within `margin` of the viewport — used to
 * read thumbnails from IndexedDB only for cards that are about to be seen. Attach the returned ref.
 */
export function useSeen<T extends Element>(margin = "400px"): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!el || seen) return;
    return observeOnce(el, margin, () => setSeen(true));
  }, [el, seen, margin]);
  return [setEl, seen];
}

// ---------- Media queries ----------

/** Live `matchMedia` result (false during prerender). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const noopSubscribe = () => () => {};

/** Whether this browser can show PDFs inline (desktop browsers; most phones can't). */
export function usePdfViewerEnabled(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => (typeof navigator.pdfViewerEnabled === "boolean" ? navigator.pdfViewerEnabled : true),
    () => false,
  );
}

/** Whether the user asked for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
