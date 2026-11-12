import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * Read a browser-only value during render without hydration mismatches: returns `fallback` while
 * prerendering and hydrating, then the real value. `read` must return a primitive (or a stable
 * reference) because it can run on every render.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(noopSubscribe, read, () => fallback);
}
