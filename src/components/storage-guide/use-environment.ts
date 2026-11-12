"use client";

import { useSyncExternalStore } from "react";
import { detectDiskBrowser, detectOS, type DiskBrowserId, type OSId } from "@/lib/storage-inspect";
import { detectBrowser, isInstalledApp } from "@/lib/storage/monitor";
import type { BrowserId } from "@/lib/types";

/** What the storage guide knows about where it is running. */
export interface GuideEnvironment {
  /** e.g. "https://remembos.app" — substituted into on-disk folder names. */
  origin: string;
  host: string;
  os: OSId;
  /** App-wide browser id (drives persistence / install hints). */
  browser: BrowserId;
  /** Refined browser id for profile-folder layouts (adds Vivaldi, Arc, Chromium). */
  diskBrowser: DiskBrowserId;
  /** Running as an installed app (Home Screen / Dock / desktop app window). */
  installed: boolean;
}

let cached: GuideEnvironment | null = null;
const listeners = new Set<() => void>();
let recheckScheduled = false;

function read(): GuideEnvironment {
  if (!cached) {
    const browser = detectBrowser();
    cached = {
      origin: window.location.origin,
      host: window.location.host,
      os: detectOS(),
      browser,
      diskBrowser: detectDiskBrowser(browser),
      installed: isInstalledApp(),
    };
  }
  return cached;
}

/**
 * Some hints arrive after the first paint (Arc injects its palette CSS variables a moment after the
 * page loads), so look once more shortly after load and publish a new snapshot if the answer changed.
 */
function scheduleRecheck(): void {
  if (recheckScheduled || typeof window === "undefined") return;
  recheckScheduled = true;
  const recheck = () => {
    const current = read();
    const diskBrowser = detectDiskBrowser(current.browser);
    if (diskBrowser !== current.diskBrowser) {
      cached = { ...current, diskBrowser };
      listeners.forEach((l) => l());
    }
  };
  const later = () => window.setTimeout(recheck, 1_200);
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  scheduleRecheck();
  return () => listeners.delete(listener);
}

const serverSnapshot = () => null;

/** Detected origin / OS / browser on the client; null during prerender and hydration. */
export function useEnvironment(): GuideEnvironment | null {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
