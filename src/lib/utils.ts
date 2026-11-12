import { BASE_PATH } from "./config";

/** Join class names, skipping falsy values. (No tailwind-merge — keep classes non-conflicting.) */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}

export function uid(prefix = ""): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return prefix ? `${prefix}_${raw}` : raw;
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : digits)} ${units[i]}`;
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.round(d / 7)} wk ago`;
  return formatDate(ms);
}

export function formatDate(ms: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(ms).toLocaleDateString(undefined, opts ?? { day: "numeric", month: "short", year: "numeric" });
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Collapse whitespace and trim. */
export function cleanText(text: string): string {
  return text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Prefix a public/ asset path with the deployment base path. */
export function assetUrl(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

export const isBrowser = typeof window !== "undefined";

// ---------- In-app navigation from non-React code (toast actions, background modules) ----------

let clientNavigator: ((href: string) => void) | null = null;

/**
 * Route in-app links through the Next router so they stay client-side (no reload, in-memory state kept).
 * The app shell registers `router.push` once; returns an unregister function.
 */
export function setClientNavigator(fn: (href: string) => void): () => void {
  clientNavigator = fn;
  return () => {
    if (clientNavigator === fn) clientNavigator = null;
  };
}

/**
 * Open an app route (e.g. `ROUTES.data`, `itemHref(id)`) from code outside React components.
 * `href` excludes the base path. Uses the registered client navigator, else a normal page load.
 */
export function navigate(href: string): void {
  if (typeof window === "undefined") return;
  if (clientNavigator) {
    try {
      clientNavigator(href);
      return;
    } catch {
      /* fall through to a full navigation */
    }
  }
  const target = assetUrl(href);
  if (window.location.pathname + window.location.search === target) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  window.location.assign(target);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
