// Install-as-app support. The shell captures `beforeinstallprompt` and exposes it here so any screen can offer
// "Install app" without knowing browser details.
//
// - Chrome / Edge / Samsung Internet / Android browsers fire `beforeinstallprompt`; we keep the event (which also
//   stops Chrome's own mini-infobar) and show the real install dialog when the person asks for it.
// - iPhone / iPad have no prompt: installing is Share → Add to Home Screen, so the UI shows instructions instead.
// - Once installed (or opened from the home screen / dock) nothing offers installing again.
import { toast } from "sonner";
import { EARLY_INSTALL_PROMPT_KEY } from "@/components/shell/launch";
import { createStore } from "./store";

export interface InstallState {
  /** The browser offered an install prompt we can show (Chrome/Edge/Samsung/Android). */
  canInstall: boolean;
  /** Running as an installed app (display-mode standalone / iOS navigator.standalone). */
  installed: boolean;
  /** "ios" = Safari on iPhone/iPad (manual Add to Home Screen); "prompt" = beforeinstallprompt available; "other". */
  platform: "ios" | "prompt" | "other";
}

export const installState = createStore<InstallState>({ canInstall: false, installed: false, platform: "other" });

/** The non-standard event Chromium browsers fire when the site can be installed. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
  prompt(): Promise<void>;
}

type WindowWithEarlyPrompt = Window & { [EARLY_INSTALL_PROMPT_KEY]?: BeforeInstallPromptEvent | null };
type NavigatorWithStandalone = Navigator & { standalone?: boolean };

let deferred: BeforeInstallPromptEvent | null = null;
let initialized = false;

/** iPhone, iPod and iPad — including iPadOS, whose Safari reports a desktop Mac user agent but has a touch screen. */
export function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
}

/** True when this page runs as an installed app (home screen, dock, app list). */
export function isRunningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if ((navigator as NavigatorWithStandalone).standalone === true) return true;
  try {
    // (Not "fullscreen": a normal tab matches it while the browser itself is fullscreen.)
    return ["standalone", "window-controls-overlay"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  } catch {
    return false;
  }
}

function platformNow(): InstallState["platform"] {
  if (isIOSDevice()) return "ios";
  return deferred ? "prompt" : "other";
}

function sync(patch?: Partial<InstallState>): void {
  const installed = patch?.installed ?? installState.get().installed;
  installState.set((prev) => {
    const next: InstallState = {
      installed,
      canInstall: !installed && deferred !== null,
      platform: platformNow(),
    };
    return prev.installed === next.installed && prev.canInstall === next.canInstall && prev.platform === next.platform
      ? prev
      : next;
  });
}

function adopt(event: BeforeInstallPromptEvent): void {
  deferred = event;
  sync();
}

async function onInstalled(): Promise<void> {
  deferred = null;
  sync({ installed: true });
  const id = "pwa-installed";
  const description = "Open it from your home screen, dock or app list — it works offline too.";
  toast.success("Remembos is installed", { id, description });
  try {
    const { requestPersistence } = await import("./storage/monitor");
    const kept = await requestPersistence({ silent: true });
    if (kept) {
      toast.success("Remembos is installed", {
        id,
        description: `${description} Your browser also promised to keep your memories safe.`,
      });
    }
  } catch {
    /* persistence is a bonus — the storage watcher keeps nudging when it matters */
  }
  // Install = also download the AI models, so the app works fully offline straight away.
  setTimeout(() => {
    void import("./offline").then((m) => m.prepareOffline("install")).catch(() => {});
  }, 1500);
}

/** Wire up beforeinstallprompt / appinstalled / display-mode listeners (call once on the client). Returns cleanup. */
export function initInstall(): () => void {
  if (typeof window === "undefined" || initialized) return () => {};
  initialized = true;

  const w = window as WindowWithEarlyPrompt;
  const early = w[EARLY_INSTALL_PROMPT_KEY];
  if (early) deferred = early;
  w[EARLY_INSTALL_PROMPT_KEY] = null;
  sync({ installed: isRunningStandalone() });
  // Running as the installed app (incl. iPhone, which has no "installed" event): make sure the AI models are on
  // this device for offline use. Waits a moment so it never competes with the first paint.
  if (isRunningStandalone()) {
    setTimeout(() => {
      void import("./offline").then((m) => m.prepareOfflineIfNeeded()).catch(() => {});
    }, 4000);
  }

  const onBeforeInstallPrompt = (event: Event) => {
    // Keep the browser's own banner quiet; Remembos offers "Install app" where it fits.
    event.preventDefault();
    adopt(event as BeforeInstallPromptEvent);
  };
  const onAppInstalled = () => void onInstalled();
  const onDisplayModeChange = () => sync({ installed: isRunningStandalone() });

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", onDisplayModeChange);
  } catch {
    media = null;
  }

  return () => {
    initialized = false;
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onAppInstalled);
    media?.removeEventListener("change", onDisplayModeChange);
  };
}

/** Show the browser's install dialog. Resolves true when the user accepted. On iOS returns false (show instructions). */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // A prompt can be shown only once; the browser fires a fresh beforeinstallprompt later if installing is still possible.
  deferred = null;
  sync();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted";
  } catch {
    return false;
  }
}
