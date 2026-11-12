/**
 * Storage awareness — the "never lose data by surprise" layer.
 *
 * Everything Remembos keeps lives in this browser (IndexedDB + a few small preferences), so this
 * module watches how full that storage is and explains, in plain words, what is happening and what
 * to do about it:
 *
 * - `refreshStorage()` / `useStorageInfo()` — quota, usage, persistence, counts (never throws).
 * - `ensureSpaceFor(bytes)` — call before storing something big; blocks with a friendly toast when
 *   it would not fit.
 * - `handleStorageError(err, context)` — turn any IndexedDB / quota failure into a helpful toast.
 * - `requestPersistence()` — ask the browser to never auto-delete our data.
 * - `startStorageWatcher()` — background checks + one-time tips (fullness, private window,
 *   Safari's 7-day rule, first memory, persistence and backup nudges).
 *
 * All toasts use stable ids so repeated events update one toast instead of stacking many.
 */
import { useEffect } from "react";
import { liveQuery } from "dexie";
import { toast } from "sonner";
import { ROUTES, STORAGE_NAMES, STORAGE_THRESHOLDS } from "../config";
import { db, getMeta } from "../db";
import { getSettings, isSnoozed, snooze, updateSettings } from "../settings";
import { createStore, useStore } from "../store";
import type { BrowserId, StorageInfo } from "../types";
import { onboardingOpen } from "../ui-state";
import { formatBytes, navigate } from "../utils";
import {
  DAY_MS,
  SAMPLE_IDS_META_KEY,
  classifyBrowser,
  classifyStorageError,
  daysBetween,
  describeContext,
  isAppleMobile,
  isChromiumFamily,
  plural,
  type BrowserHints,
} from "./helpers";

// ---------------------------------------------------------------------------------------------
// Live storage snapshot
// ---------------------------------------------------------------------------------------------

/** StorageInfo plus the per-medium breakdown some browsers (Chromium) report. */
export interface StorageSnapshot extends StorageInfo {
  /** e.g. `{ indexedDB, caches, serviceWorkerRegistrations }` in bytes, when the browser reports it. */
  usageDetails?: Record<string, number>;
}

export const storageStore = createStore<StorageSnapshot | null>(null);

/** Live storage numbers for the UI. Kicks off a first check if nothing has been measured yet. */
export function useStorageInfo(): StorageSnapshot | null {
  const info = useStore(storageStore);
  useEffect(() => {
    if (!storageStore.get()) void refreshStorage();
  }, []);
  return info;
}

let running: Promise<StorageSnapshot> | null = null;
let queued: Promise<StorageSnapshot> | null = null;

/**
 * Read navigator.storage.estimate() + persistence + DB counts and publish them to `storageStore`.
 * Never rejects: unsupported browsers get `supported: false`. Concurrent calls are coalesced, and a
 * call made while a check is running gets a fresh result (not a stale one from before a change).
 */
export function refreshStorage(): Promise<StorageSnapshot> {
  if (!running) {
    running = readStorage().finally(() => {
      running = null;
    });
    return running;
  }
  if (!queued) {
    queued = running
      .catch(() => null)
      .then(() => {
        queued = null;
        return refreshStorage();
      });
  }
  return queued;
}

let filesBytesCache: { count: number; bytes: number; at: number } | null = null;

async function sumOriginalBytes(): Promise<number> {
  const count = await db.files.count();
  if (filesBytesCache && filesBytesCache.count === count && Date.now() - filesBytesCache.at < 5 * 60_000) return filesBytesCache.bytes;
  let bytes = 0;
  await db.files.each((f) => {
    bytes += f.blob?.size ?? 0;
  });
  filesBytesCache = { count, bytes, at: Date.now() };
  return bytes;
}

async function readStorage(): Promise<StorageSnapshot> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  let supported = false;
  let usage = 0;
  let quota = 0;
  let usageDetails: Record<string, number> | undefined;
  if (sm && typeof sm.estimate === "function") {
    try {
      const est = (await sm.estimate()) as StorageEstimate & { usageDetails?: Record<string, number> };
      usage = est.usage ?? 0;
      quota = est.quota ?? 0;
      usageDetails = est.usageDetails && typeof est.usageDetails === "object" ? { ...est.usageDetails } : undefined;
      supported = true;
    } catch {
      supported = false;
    }
  }
  let persisted: boolean | null = null;
  if (sm && typeof sm.persisted === "function") {
    try {
      persisted = await sm.persisted();
    } catch {
      persisted = null;
    }
  }
  let itemCount = 0;
  let filesBytes = 0;
  try {
    [itemCount, filesBytes] = await Promise.all([db.items.count(), sumOriginalBytes()]);
  } catch {
    // IndexedDB unavailable (blocked / private mode) — the app shell shows a dedicated screen.
  }
  const smallQuota = supported && quota > 0 && quota < STORAGE_THRESHOLDS.privateQuotaBytes;
  const snapshot: StorageSnapshot = {
    supported,
    usage,
    quota,
    ratio: quota > 0 ? Math.min(1, usage / quota) : 0,
    persisted,
    likelyPrivate: smallQuota || (await privateWindowHeuristic()),
    itemCount,
    filesBytes,
    checkedAt: Date.now(),
    usageDetails,
  };
  storageStore.set(snapshot);
  return snapshot;
}

let privateHeuristic: Promise<boolean> | null = null;

/** Cheap, browser-specific private-window hints (computed once per page load). */
function privateWindowHeuristic(): Promise<boolean> {
  if (privateHeuristic) return privateHeuristic;
  privateHeuristic = (async () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const browser = detectBrowser();
    try {
      // Firefox turns service workers off in private windows.
      if (browser === "firefox") return window.isSecureContext && !("serviceWorker" in navigator);
      // Safari refuses the origin-private file system in private windows.
      if (browser === "safari" || browser === "ios-safari") {
        const getDirectory = navigator.storage?.getDirectory?.bind(navigator.storage);
        if (!getDirectory) return false;
        try {
          await getDirectory();
          return false;
        } catch (err) {
          return /unknown transient reason/i.test(String((err as Error)?.message ?? err));
        }
      }
    } catch {
      /* heuristics are best effort */
    }
    return false;
  })();
  return privateHeuristic;
}

// ---------------------------------------------------------------------------------------------
// Navigation from toasts (no router in plain modules)
// ---------------------------------------------------------------------------------------------

let softNavigate: ((href: string) => void) | null = null;

/**
 * Optional override for toast links. Without it, links use the shared `navigate()` from utils, which goes
 * through the Next router once the app shell has registered it (otherwise a normal page load).
 * Returns an unregister function.
 */
export function registerStorageNavigator(fn: (href: string) => void): () => void {
  softNavigate = fn;
  return () => {
    if (softNavigate === fn) softNavigate = null;
  };
}

/** Open an app route (e.g. ROUTES.data) from a toast action. `href` excludes the base path. */
export function goTo(href: string): void {
  if (typeof window === "undefined") return;
  if (softNavigate) {
    softNavigate(href);
    return;
  }
  navigate(href);
}

const manageStorageAction = (label = "Manage storage") => ({ label, onClick: () => goTo(ROUTES.data) });

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

function persistenceDeniedHint(browser: BrowserId): string {
  switch (browser) {
    case "firefox":
      return "Firefox asks with a small pop-up. If you closed it or chose “Block”, click the storage icon at the left of the address bar to allow it, then try again.";
    case "safari":
      return "Safari decides on its own. Add Remembos to your Dock (File → Add to Dock) and download a backup now and then.";
    case "ios-safari":
      return "Safari decides on its own. Add Remembos to your Home Screen (Share → Add to Home Screen) and download a backup now and then.";
    default:
      return isChromiumFamily(browser)
        ? "Chrome-style browsers say yes automatically once you use a site often or install it as an app (the install icon in the address bar). Until then, keep a backup."
        : "Your browser decides on its own. Download a backup now and then so nothing is lost.";
  }
}

async function startBackupDownload(): Promise<void> {
  try {
    const { downloadBackup } = await import("./backup");
    await downloadBackup();
  } catch {
    /* downloadBackup already explained what went wrong */
  }
}

/**
 * Ask the browser to never auto-evict our data. Shows a result toast (unless `silent`) and records
 * `settings.persistAsked`. Resolves true when storage is (or already was) persistent.
 */
export async function requestPersistence(opts?: { silent?: boolean }): Promise<boolean> {
  const silent = !!opts?.silent;
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!sm || typeof sm.persist !== "function") {
    if (!silent) {
      toast.info("Your browser decides when to keep data", {
        id: "storage-persist",
        description: "This browser doesn't let sites ask. Download a backup now and then to be safe.",
        action: { label: "Back up now", onClick: () => void startBackupDownload() },
      });
    }
    return false;
  }
  let granted = false;
  try {
    granted = (typeof sm.persisted === "function" && (await sm.persisted())) || (await sm.persist());
  } catch {
    granted = false;
  }
  updateSettings({ persistAsked: true });
  void refreshStorage();
  if (!silent) {
    if (granted) {
      toast.success("Your browser will keep your memories safe", {
        id: "storage-persist",
        description: "It won't clear Remembos to free up space. A backup now and then is still a good idea.",
      });
    } else {
      toast.info("Your browser said “not yet”", {
        id: "storage-persist",
        description: persistenceDeniedHint(detectBrowser()),
        duration: 12_000,
        action: { label: "Back up now", onClick: () => void startBackupDownload() },
      });
    }
  }
  return granted;
}

// ---------------------------------------------------------------------------------------------
// Space checks & error handling
// ---------------------------------------------------------------------------------------------

/** Derived data (text, chunks, vectors, thumbnail) adds a little on top of the original. */
const SPACE_OVERHEAD = 1.1;
const SPACE_PADDING = 256 * 1024;
/** How old a storage snapshot may be when checking space for a new file. */
const SNAPSHOT_FRESH_MS = 20_000;
/** Space promised to earlier files of a batch, valid for one snapshot (keyed by identity, not time). */
let reserved: { snapshot: StorageSnapshot | null; bytes: number } = { snapshot: null, bytes: 0 };
let lastNearlyFullWarning = 0;

/**
 * Before importing `bytes`, check free space. Shows a warning toast when it gets tight and an
 * error toast (with "Free up space" → Your data) when it would not fit. Returns false to block.
 * Back-to-back calls (a batch of files) count the space already promised to earlier files.
 */
export async function ensureSpaceFor(bytes: number): Promise<boolean> {
  const cached = storageStore.get();
  // A recent snapshot is good enough: everything promised since it was taken is counted in `reserved`, so
  // adding never waits on a fresh estimate (or a scan of the files table) while files keep arriving.
  const info = cached && Date.now() - cached.checkedAt < SNAPSHOT_FRESH_MS ? cached : await refreshStorage();
  if (!info.supported || info.quota <= 0) return true;
  if (reserved.snapshot !== info) reserved = { snapshot: info, bytes: 0 };

  const needed = Math.max(0, bytes) * SPACE_OVERHEAD + SPACE_PADDING;
  const projected = (info.usage + reserved.bytes + needed) / info.quota;
  if (projected >= STORAGE_THRESHOLDS.block) {
    const free = Math.max(0, info.quota * STORAGE_THRESHOLDS.block - info.usage - reserved.bytes);
    toast.error("Not enough space to add this", {
      id: "storage-no-space",
      description: `It needs about ${formatBytes(needed)}, but only ${formatBytes(free)} is left for Remembos in this browser. Free up space by removing originals you don't need, deleting old memories, or clearing downloaded AI models.`,
      duration: 15_000,
      action: manageStorageAction("Free up space"),
    });
    return false;
  }
  reserved.bytes += needed;
  if (projected >= STORAGE_THRESHOLDS.critical && Date.now() - lastNearlyFullWarning > 10 * 60_000) {
    lastNearlyFullWarning = Date.now();
    toast.warning(`Storage is almost full (${Math.round(projected * 100)}%)`, {
      id: "storage-nearly-full",
      description: "This will still fit, but soon new memories won't. Remove originals or back up and delete older memories.",
      duration: 10_000,
      action: manageStorageAction(),
    });
  }
  return true;
}

const reload = () => {
  if (typeof window !== "undefined") window.location.reload();
};

/**
 * Turn any storage error into one helpful toast (quota full, IndexedDB blocked, another tab…).
 * `context` is a short gerund phrase describing what was happening, e.g. "saving your note" —
 * it is shown as "Couldn't finish saving your note." Repeated errors of the same kind update the
 * same toast instead of stacking.
 */
export function handleStorageError(err: unknown, context?: string): void {
  let kind: ReturnType<typeof classifyStorageError> = "other";
  try {
    kind = classifyStorageError(err);
  } catch {
    /* never let error reporting itself fail */
  }
  const what = describeContext(context);
  const didnt = what ? `Couldn't finish ${what}. ` : "";
  if (typeof console !== "undefined") console.warn(`[remembos] storage error${context ? ` (${context})` : ""}`, err);

  switch (kind) {
    case "quota":
      void refreshStorage();
      toast.error("Your browser's storage is full", {
        id: "storage-error:quota",
        description: `${didnt}Nothing was half-saved. Free up space by removing originals of big files, deleting memories you don't need, or clearing downloaded AI models — then try again.`,
        duration: 20_000,
        action: manageStorageAction("Free up space"),
      });
      return;
    case "unavailable":
      toast.error("This browser is blocking storage", {
        id: "storage-error:unavailable",
        description: `${didnt}Remembos keeps memories in your browser's storage, and it's switched off here. Allow cookies and site data for this site (or leave private mode), then reload.`,
        duration: 20_000,
        action: { label: "Learn more", onClick: () => goTo(ROUTES.storage) },
      });
      return;
    case "version":
      toast.error("Remembos was updated in another tab", {
        id: "storage-error:version",
        description: `${didnt}Reload this page to keep going — your memories are safe.`,
        duration: 20_000,
        action: { label: "Reload", onClick: reload },
      });
      return;
    case "blocked":
      toast.error("Remembos is busy in another tab", {
        id: "storage-error:blocked",
        description: `${didnt}Another Remembos tab is holding the storage. Close other Remembos tabs, then reload this one.`,
        duration: 20_000,
        action: { label: "Reload", onClick: reload },
      });
      return;
    case "invalid-state":
      toast.error("Storage isn't available right now", {
        id: "storage-error:invalid-state",
        description: `${didnt}This can happen in private windows or right after the browser cleared site data. Reload the page; if it keeps happening, open Remembos in a normal window.`,
        duration: 15_000,
        action: { label: "Reload", onClick: reload },
      });
      return;
    case "unknown":
      toast.error("Your browser's storage hit a snag", {
        id: "storage-error:unknown",
        description: `${didnt}This is usually temporary — often because the device is low on disk space. Free some space, then reload. If it keeps happening, restart the browser.`,
        duration: 15_000,
        action: { label: "Reload", onClick: reload },
      });
      return;
    case "clone":
      toast.error("This file couldn't be stored", {
        id: "storage-error:clone",
        description: `${didnt}Your browser can't keep this kind of file here (common in private windows). Try again in a normal window.`,
        duration: 12_000,
      });
      return;
    case "aborted":
      toast.error("Saving was interrupted", {
        id: "storage-error:aborted",
        description: `${didnt}Nothing was half-saved. Please try again.`,
        duration: 10_000,
      });
      return;
    default:
      toast.error("Couldn't save to this device", {
        id: "storage-error:other",
        description: `${didnt}Something went wrong with the browser's storage. Reload the page and try again.`,
        duration: 12_000,
        action: { label: "Reload", onClick: reload },
      });
  }
}

// ---------------------------------------------------------------------------------------------
// Browser detection
// ---------------------------------------------------------------------------------------------

interface NavigatorExtras {
  userAgentData?: { brands?: { brand: string }[]; platform?: string };
  brave?: unknown;
  standalone?: boolean;
}

function browserHints(): BrowserHints | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & NavigatorExtras;
  return {
    userAgent: nav.userAgent || "",
    brands: nav.userAgentData?.brands?.map((b) => b.brand) ?? [],
    isBrave: !!nav.brave,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
  };
}

/** Which browser this is — drives the "how to clear / keep your data" guidance. */
export function detectBrowser(): BrowserId {
  const hints = browserHints();
  return hints ? classifyBrowser(hints) : "other";
}

/** True when running as an installed app (Home Screen / Dock / desktop PWA). */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & NavigatorExtras;
  try {
    return nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Background watcher
// ---------------------------------------------------------------------------------------------

const NOTICE = {
  private: "notice:private-window",
  warn: "notice:storage-70",
  critical: "notice:storage-90",
  safari: "notice:safari-7-day",
  persist: "notice:persist-nudge",
  backup: "notice:backup-nudge",
  /** Marker (stored as a long snooze) that the first-memory tip was handled. */
  firstMemory: "notice:first-memory",
} as const;

const STARTUP_DELAY_MS = 2_500;
const NOTICE_GAP_MS = 1_800;
const NUDGE_MIN_INTERVAL_MS = 30 * 60_000;
const SESSION_KEY_PREFIX = `${STORAGE_NAMES.keyPrefix}session:`;

const shownThisSession = new Set<string>();

/** True the first time it is called for `key` in this tab session (survives reloads). */
function firstTimeThisSession(key: string): boolean {
  if (shownThisSession.has(key)) return false;
  shownThisSession.add(key);
  try {
    if (window.sessionStorage.getItem(SESSION_KEY_PREFIX + key)) return false;
    window.sessionStorage.setItem(SESSION_KEY_PREFIX + key, "1");
  } catch {
    /* sessionStorage blocked — the in-memory set still limits repeats */
  }
  return true;
}

interface Notice {
  key: string;
  /** Wait while the welcome dialog is open (tips/nudges, not warnings). */
  polite: boolean;
  show: () => void;
}

/** Shows watcher toasts one at a time with a short gap, so tips never arrive as a pile. */
/** Delay before the "Saved on this device only" notice, so it doesn't cover the add's own Undo toast. */
const FIRST_MEMORY_NOTICE_DELAY_MS = 8_000;

function createNoticeQueue() {
  const queue: Notice[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastShownAt = 0;
  let disposed = false;

  const pump = () => {
    timer = null;
    if (disposed || !queue.length) return;
    const wait = lastShownAt + NOTICE_GAP_MS - Date.now();
    if (wait > 0) {
      timer = setTimeout(pump, wait);
      return;
    }
    const idx = queue.findIndex((n) => !n.polite || !onboardingOpen.get());
    if (idx === -1) {
      timer = setTimeout(pump, 1_000);
      return;
    }
    const [next] = queue.splice(idx, 1);
    lastShownAt = Date.now();
    try {
      next.show();
    } catch (err) {
      console.warn("[remembos] notice failed", err);
    }
    if (queue.length) timer = setTimeout(pump, NOTICE_GAP_MS);
  };

  return {
    push(n: Notice) {
      if (disposed || queue.some((q) => q.key === n.key)) return;
      queue.push(n);
      if (!timer) pump();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

async function countSampleItems(): Promise<number> {
  try {
    const ids = (await getMeta<string[]>(SAMPLE_IDS_META_KEY)) ?? [];
    if (!ids.length) return 0;
    const items = await db.items.bulkGet(ids);
    return items.filter((i) => i?.sample).length;
  } catch {
    return 0;
  }
}

async function hasRealItems(): Promise<boolean> {
  return !!(await db.items.filter((i) => !i.sample).first());
}

function isSafariFamily(b: BrowserId): boolean {
  if (b === "safari" || b === "ios-safari") return true;
  // Every iOS browser is Safari underneath and follows the same storage rules.
  const hints = browserHints();
  return !!hints && isAppleMobile(hints);
}

/**
 * Start background checks (call once on app start): initial estimate, threshold toasts
 * (70% / 90%), private-window warning, Safari 7-day eviction tip, first-memory tip, persistence
 * nudge, backup reminder, re-check on visibility change. Returns cleanup.
 */
export function startStorageWatcher(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  let stopped = false;
  const notices = createNoticeQueue();
  let lastNudgeCheck = 0;
  let lastCount: number | null = null;
  let sawNoRealItems = false;
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  let ready = false; // startup delay passed

  // --- storage level, private window, Safari tip -------------------------------------------
  const evaluateStorage = (info: StorageSnapshot) => {
    if (stopped || !ready) return;
    if (info.likelyPrivate && firstTimeThisSession(NOTICE.private)) {
      notices.push({
        key: NOTICE.private,
        polite: false,
        show: () =>
          toast.warning("Private window: memories vanish when you close it", {
            id: "storage-private",
            description:
              "It looks like this is a private or incognito window, so the browser will erase everything you add here when it closes. Open Remembos in a normal window to keep your memories — or download a backup before you leave.",
            duration: 20_000,
            action: { label: "Learn more", onClick: () => goTo(ROUTES.storage) },
          }),
      });
    }

    if (info.supported && info.quota > 0) {
      const pct = Math.round(info.ratio * 100);
      const level = info.ratio >= STORAGE_THRESHOLDS.critical ? "critical" : info.ratio >= STORAGE_THRESHOLDS.warn ? "warn" : null;
      if (level) {
        const key = level === "critical" ? NOTICE.critical : NOTICE.warn;
        const covered = level === "warn" && shownThisSession.has(NOTICE.critical);
        if (!covered && !isSnoozed(key) && firstTimeThisSession(key)) {
          const cancel = { label: "Remind me later", onClick: () => snooze(key, 3) };
          notices.push({
            key,
            polite: false,
            show: () =>
              level === "critical"
                ? toast.error(`Storage is ${pct}% full`, {
                    id: "storage-level",
                    description: "New memories may soon fail to save. Remove originals you don't need, or back up and delete older memories.",
                    duration: 20_000,
                    action: manageStorageAction(),
                    cancel,
                  })
                : toast.warning(`Storage is ${pct}% full`, {
                    id: "storage-level",
                    description: "Remove originals or back up older memories to keep adding.",
                    duration: 12_000,
                    action: manageStorageAction(),
                    cancel,
                  }),
          });
        }
      }
    }
  };

  // --- nudges: Safari tip, persistence, backup ------------------------------------------------
  const evaluateNudges = async () => {
    if (stopped || !ready) return;
    lastNudgeCheck = Date.now();
    try {
      const info = storageStore.get() ?? (await refreshStorage());
      const total = await db.items.count();
      if (!total || stopped) return;
      const real = total - (await countSampleItems());
      if (real < 1 || stopped) return;
      const browser = detectBrowser();

      // 1) Safari's 7-day rule (once a year at most).
      if (isSafariFamily(browser) && !isInstalledApp() && info.persisted !== true && !isSnoozed(NOTICE.safari)) {
        snooze(NOTICE.safari, 365);
        const ios = browser !== "safari"; // iOS Safari, or any other browser on iPhone/iPad
        notices.push({
          key: NOTICE.safari,
          polite: true,
          show: () =>
            toast.info("Safari tip: keep your memories", {
              id: "storage-safari",
              description: ios
                ? "Safari may erase a site's data after 7 days without a visit. Add Remembos to your Home Screen (Share → Add to Home Screen) and download a backup now and then."
                : "Safari may erase a site's data after 7 days without a visit. Add Remembos to your Dock (File → Add to Dock) and download a backup now and then.",
              duration: 20_000,
              action: { label: "Learn more", onClick: () => goTo(ROUTES.storage) },
            }),
        });
        return; // one nudge per check
      }

      // 2) Ask for persistent storage once there is something worth keeping.
      const canPersist = typeof navigator.storage?.persist === "function";
      if (real >= 10 && canPersist && info.persisted === false && !isSnoozed(NOTICE.persist)) {
        snooze(NOTICE.persist, 7);
        notices.push({
          key: NOTICE.persist,
          polite: true,
          show: () =>
            toast.info("Keep your memories safe", {
              id: "storage-persist-nudge",
              description: `You have ${plural(real, "memory", "memories")} here. Ask your browser not to clear them when space runs low.`,
              duration: 15_000,
              action: { label: "Keep it safe", onClick: () => void requestPersistence() },
              cancel: { label: "Not now", onClick: () => snooze(NOTICE.persist, 7) },
            }),
        });
        return;
      }

      // 3) Backup reminder.
      if (real >= STORAGE_THRESHOLDS.backupNudgeMinItems && !isSnoozed(NOTICE.backup)) {
        const { lastBackupAt } = getSettings();
        const now = Date.now();
        let due = false;
        let description = "";
        if (lastBackupAt) {
          const days = daysBetween(lastBackupAt, now);
          due = days >= STORAGE_THRESHOLDS.backupNudgeDays;
          description = `Your last backup was ${days} days ago. One click saves everything into a single file you keep.`;
        } else {
          const oldest = await db.items.orderBy("createdAt").filter((i) => !i.sample).first();
          due = !!oldest && now - oldest.createdAt > 3 * DAY_MS;
          description = `You have ${plural(real, "memory", "memories")} and no backup yet. One click saves everything into a single file you keep.`;
        }
        if (due && !stopped) {
          snooze(NOTICE.backup, 2);
          notices.push({
            key: NOTICE.backup,
            polite: true,
            show: () =>
              toast.info("Back up your memories", {
                id: "storage-backup-nudge",
                description,
                duration: 15_000,
                action: { label: "Back up now", onClick: () => void startBackupDownload() },
                cancel: { label: "Later", onClick: () => snooze(NOTICE.backup, 7) },
              }),
          });
        }
      }
    } catch (err) {
      console.warn("[remembos] storage nudge check failed", err);
    }
  };

  const scheduleNudges = (delay: number) => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      void evaluateNudges();
    }, delay);
  };

  // --- first memory ---------------------------------------------------------------------------
  const onCount = async (count: number) => {
    const prev = lastCount;
    lastCount = count;
    try {
      if (prev === null || count === 0) {
        if (!(count > 0 && (await hasRealItems()))) sawNoRealItems = true;
        else if (!isSnoozed(NOTICE.firstMemory)) snooze(NOTICE.firstMemory, 3650); // existing collection
        return;
      }
      if (count <= prev) return;
      if (sawNoRealItems && !isSnoozed(NOTICE.firstMemory) && (await hasRealItems())) {
        sawNoRealItems = false;
        snooze(NOTICE.firstMemory, 3650);
        const info = await refreshStorage();
        if (info.persisted !== true && !stopped) {
          // Wait out the "Saved · Undo" toast of the add that triggered this, so this notice never covers its Undo.
          await new Promise((r) => setTimeout(r, FIRST_MEMORY_NOTICE_DELAY_MS));
          if (stopped) return;
          notices.push({
            key: NOTICE.firstMemory,
            polite: false,
            show: () =>
              toast.info("Saved on this device only", {
                id: "storage-first-memory",
                description: "Your memories stay in this browser — nothing is uploaded. Ask the browser to keep them safe so they're never cleared to free up space.",
                duration: 12_000,
                action: { label: "Keep it safe", onClick: () => void requestPersistence() },
              }),
          });
        }
      }
      scheduleNudges(8_000);
    } catch (err) {
      console.warn("[remembos] memory count check failed", err);
    }
  };

  // --- wiring -----------------------------------------------------------------------------------
  const check = async () => {
    if (stopped) return;
    const info = await refreshStorage();
    evaluateStorage(info);
    if (Date.now() - lastNudgeCheck > NUDGE_MIN_INTERVAL_MS) scheduleNudges(0);
  };

  void refreshStorage(); // fill the meter right away

  const startTimer = setTimeout(() => {
    ready = true;
    void check();
  }, STARTUP_DELAY_MS);

  const poll = setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, STORAGE_THRESHOLDS.pollMs);

  const onVisibility = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisibility);

  let subscription: { unsubscribe(): void } | null = null;
  try {
    subscription = liveQuery(() => db.items.count()).subscribe({
      next: (count) => void onCount(count),
      error: (err) => console.warn("[remembos] could not watch memory count", err),
    });
  } catch (err) {
    console.warn("[remembos] could not watch memory count", err);
  }

  return () => {
    stopped = true;
    clearTimeout(startTimer);
    clearInterval(poll);
    if (nudgeTimer) clearTimeout(nudgeTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    subscription?.unsubscribe();
    notices.dispose();
  };
}
