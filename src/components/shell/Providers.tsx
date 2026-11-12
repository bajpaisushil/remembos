"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BASE_PATH, ROUTES, STORAGE_NAMES } from "@/lib/config";
import { initInstall } from "@/lib/pwa";
import { DEFAULT_SETTINGS, getSettings, settingsStore, useSettings, type Settings } from "@/lib/settings";
import { onboardingOpen, paletteOpen, quickAdd, recorderOpen } from "@/lib/ui-state";
import { assetUrl, navigate, setClientNavigator } from "@/lib/utils";
import { isTypingTarget } from "@/components/ui/internal";
import { rememberFiles, warmAddActions } from "./add-entry";
import { HASH_ACTIONS, type WindowWithLaunchQueue } from "./launch";
import { applyTheme } from "./theme";

/**
 * Client-side app wiring, mounted once in the root layout:
 * - starts background services (`bootstrap()`: settings, storage watcher, paste handler, index, models)
 * - keeps <html class="dark"> in sync with the theme setting, the OS and other tabs
 * - registers the offline service worker (production builds only) and offers a reload after an update
 * - install-as-app support (`initInstall`) and launches from outside: home-screen shortcuts (`?action=`),
 *   the share sheet (`?shared=1`) and "Open with Remembos" (`launchQueue`)
 * - lets non-React code (toast actions) navigate client-side through the router
 * - global "n" shortcut → new note
 */
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Background services (storage watcher, paste handler, search index, models) load right after first
    // paint instead of riding in every page's first-load bundle.
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("@/lib/bootstrap")
      .then(({ bootstrap }) => {
        if (!cancelled) stop = bootstrap();
      })
      .catch((err) => console.warn("[remembos] start-up failed", err));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useClientNavigator();
  useThemeSync();
  useSettingsSyncAcrossTabs();
  useServiceWorker();
  useInstallSupport();
  useLaunchActions();
  useFileLaunches();
  useWarmAddActions();
  useNewNoteShortcut();

  return <>{children}</>;
}

/** Toast actions ("Open", "Manage storage", …) use `navigate()` from utils; route them through the router. */
function useClientNavigator() {
  const router = useRouter();
  useEffect(() => setClientNavigator((href) => router.push(href)), [router]);
}

function useThemeSync() {
  const { theme } = useSettings();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    // Read from the store (not the render value) so the first run already sees hydrated settings.
    const sync = () => applyTheme(getSettings().theme);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);
}

/** Another tab changed preferences (theme, search options…) → mirror them here. */
function useSettingsSyncAcrossTabs() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_NAMES.settingsKey || e.storageArea !== window.localStorage) return;
      try {
        const next = e.newValue ? (JSON.parse(e.newValue) as Partial<Settings>) : {};
        settingsStore.set({ ...DEFAULT_SETTINGS, ...next });
      } catch {
        /* ignore malformed values */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}

/** Look for a new version at most this often while the app stays open (installed apps can run for days). */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheck = Date.now();
    let alive = true;

    // A worker already in control means the next controller change is an update — not the very first install.
    let hadController = Boolean(sw.controller);
    const onControllerChange = () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      toast.info("Remembos was updated", {
        id: "app-updated",
        description: "Reload to use the newest version. Your memories stay as they are.",
        duration: Infinity,
        action: { label: "Reload", onClick: () => window.location.reload() },
      });
    };

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible" || !registration || !navigator.onLine) return;
      if (Date.now() - lastCheck < UPDATE_CHECK_MS) return;
      lastCheck = Date.now();
      registration.update().catch(() => {
        /* offline or the host is unreachable — try again later */
      });
    };

    const register = () => {
      sw.register(assetUrl("/sw.js"), { scope: assetUrl("/"), updateViaCache: "none" })
        .then((reg) => {
          if (alive) registration = reg;
        })
        .catch((err) => console.info("[remembos] offline support unavailable", err));
    };

    sw.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", checkForUpdate);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      alive = false;
      sw.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.removeEventListener("load", register);
    };
  }, []);
}

/** beforeinstallprompt / appinstalled / display-mode tracking for "Install app". */
function useInstallSupport() {
  useEffect(() => initInstall(), []);
}

let sharedConsumed = false;

/** The service worker stored what another app shared; remember it now (once per page load). */
function consumeShared(): void {
  if (sharedConsumed) return;
  sharedConsumed = true;
  import("@/lib/share-receiver")
    .then(({ consumeSharedItems }) => consumeSharedItems())
    .catch((err: unknown) => {
      console.error("[remembos] could not add shared items", err);
      toast.error("Couldn't add what you shared", {
        id: "share-failed",
        description: "Please try sharing it again, or save it to your device and drop it here.",
      });
    });
}

/** App path without the deployment base path ("/", "/search/", …). */
function appPath(pathname: string): string {
  const rest = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) : pathname;
  return rest || "/";
}

/** Send the home page to its upload panel / Paste button (it highlights the element with that id). */
function pointHomeAt(target: (typeof HASH_ACTIONS)[number]): void {
  if (appPath(window.location.pathname) !== ROUTES.home) {
    navigate(`${ROUTES.home}#${target}`);
    return;
  }
  const oldURL = window.location.href;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${target}`);
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }));
}

/**
 * Launch URLs:
 * - `?action=upload|paste` → `#upload` / `#paste` (normally already rewritten by the inline head script)
 * - `?action=record` → open the voice recorder
 * - `?shared=1` → the service worker stored what was shared from another app; remember it now
 * The parameters are then removed so a reload doesn't repeat them.
 */
function useLaunchActions() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const action = url.searchParams.get("action");
    const shared = url.searchParams.get("shared");
    if (action === null && shared === null) return;

    const oldURL = url.href;
    url.searchParams.delete("action");
    url.searchParams.delete("shared");
    const hashAction = HASH_ACTIONS.find((a) => a === action);
    if (hashAction) url.hash = hashAction;
    else if (action === "record") recorderOpen.set(true);
    if (shared === "1") consumeShared();

    // `null` state lets the router adopt the cleaned URL (passing its own state would bypass it).
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (hashAction) window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
  }, []);
}

/**
 * A launch delivered to this already-open window (manifest `launch_handler: focus-existing`): a home-screen
 * shortcut, a share or an app-icon tap focuses Remembos instead of opening a new window, so act on its URL here.
 */
function runLaunchURL(href: string): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  const action = url.searchParams.get("action");
  const hashAction = HASH_ACTIONS.find((a) => a === action);
  if (hashAction) {
    pointHomeAt(hashAction);
    return;
  }
  if (action === "record") {
    recorderOpen.set(true);
    return;
  }
  if (url.searchParams.get("shared") === "1") {
    sharedConsumed = false;
    consumeShared();
    return;
  }
  // Shortcuts to other screens (e.g. Search). A plain app-icon tap keeps whatever screen is open.
  const path = appPath(url.pathname);
  if (path !== ROUTES.home && path !== appPath(window.location.pathname)) navigate(path + url.search + url.hash);
}

/**
 * "Open with Remembos" (desktop Chrome/Edge file handlers) remembers the opened files; other launches into this
 * open window are routed by `runLaunchURL`.
 */
function useFileLaunches() {
  useEffect(() => {
    const queue = (window as WindowWithLaunchQueue).launchQueue;
    if (!queue || typeof queue.setConsumer !== "function") return;
    // The launch that opened this page was already handled from its URL (useLaunchActions).
    const nav = performance.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
    const pageURL = nav?.name ?? "";
    let first = true;
    queue.setConsumer((params) => {
      const pageLaunch = first && params.targetURL === pageURL;
      first = false;
      const handles = params.files ?? [];
      if (handles.length) {
        void Promise.all(handles.map((handle) => handle.getFile().catch(() => null))).then((files) =>
          rememberFiles(files.filter((file): file is File => file !== null)),
        );
        return;
      }
      if (params.targetURL && !pageLaunch) runLaunchURL(params.targetURL);
    });
  }, []);
}

/** Fetch the add actions while the browser is idle so Upload / Paste respond instantly. */
function useWarmAddActions() {
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warmAddActions, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(warmAddActions, 800);
    return () => window.clearTimeout(t);
  }, []);
}

function useNewNoteShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "n" && e.key !== "N") return;
      if (isTypingTarget(e.target)) return;
      if (quickAdd.get() || paletteOpen.get() || onboardingOpen.get()) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      quickAdd.set({ mode: "note" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
