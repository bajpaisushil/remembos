// How Remembos is opened from outside the page — home-screen shortcuts (`?action=`), the share sheet
// (`?shared=1`), "Open with Remembos" (file handlers via `window.launchQueue`) — plus the install prompt that
// can arrive before the app has loaded. Plain constants only: the server-rendered layout inlines the scripts.

/**
 * Name of the global where the inline head script parks a `beforeinstallprompt` that fired before the app's
 * JavaScript loaded (Chrome can fire it very early). `initInstall()` in lib/pwa adopts it.
 */
export const EARLY_INSTALL_PROMPT_KEY = "__remembosInstallPrompt";

/** Inline <head> script: keep an early `beforeinstallprompt` so "Install app" is never lost on a fast first visit. */
export const EARLY_INSTALL_PROMPT_SCRIPT = `(function(){try{window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window[${JSON.stringify(
  EARLY_INSTALL_PROMPT_KEY,
)}]=e;});}catch(e){}})();`;

/** Shortcut actions that only need the home page to point at something (it highlights `#upload` / `#paste`). */
export const HASH_ACTIONS = ["upload", "paste"] as const;

/**
 * Inline <head> script: turns `?action=upload|paste` into `#upload` / `#paste` before the app loads, so the
 * home page already sees the hash on its first render (browsers only open a file picker after a click, so the
 * upload shortcut points at the upload panel instead of opening the picker).
 */
export const LAUNCH_ACTION_SCRIPT = `(function(){try{var u=new URL(location.href),a=u.searchParams.get("action");if(${JSON.stringify(
  HASH_ACTIONS,
)}.indexOf(a)<0)return;u.searchParams.delete("action");history.replaceState(history.state,"",u.pathname+u.search+"#"+a)}catch(e){}})();`;

/** Minimal typing for the File Handling API (Chrome/Edge desktop). */
export interface LaunchParams {
  readonly files?: readonly FileSystemFileHandle[];
  readonly targetURL?: string;
}

export interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

export type WindowWithLaunchQueue = Window & { launchQueue?: LaunchQueue };
