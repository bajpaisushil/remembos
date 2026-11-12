/**
 * Storage inspector and on-disk location guide for the "Where your data lives" page.
 *
 * - `inspectStorage()` — a live, strictly read-only snapshot of everything this site keeps in the
 *   browser: the storage estimate (+ per-medium `usageDetails` where reported), the persistence
 *   flag, IndexedDB databases (with Remembos table counts), localStorage / sessionStorage keys with
 *   sizes, cookie names, Cache Storage caches with entry counts and service-worker registrations.
 *   Every API is feature-detected, wrapped in try/catch and time-limited, so one failure never hides
 *   the rest. It never writes, creates or deletes anything.
 * - `detectOS()` / `classifyOS()` — which operating system this is.
 * - `detectDiskBrowser()` / `toDiskBrowser()` — refine the app-wide `BrowserId` (from
 *   `detectBrowser()` in storage/monitor) into the browser whose profile layout we describe; adds
 *   Vivaldi, Arc and plain Chromium.
 * - `diskLocations(os, browser, origin)` — labelled folder paths with this site's real origin filled
 *   in, for every desktop browser on macOS, Windows and Linux (and an explanation for phones,
 *   tablets and Chromebooks, where browser data is sandboxed).
 * - Storage-explorer helpers — plain-language table explanations, logical addresses
 *   ("IndexedDB › remembos › files › <id>"), paging maths, which rows belong to a memory, the folder
 *   that physically holds a table, safe types for opening stored files in a new tab, and
 *   `openExistingDatabase()` / `listDatabases()` for read-only access to other databases.
 *
 * All names come from `STORAGE_NAMES` in config. Everything except the browser reads
 * (`inspectStorage`, `openExistingDatabase`, `listDatabases`, `detectOS`, `detectDiskBrowser`) is pure
 * and unit-tested in Node.
 */
import { BASE_PATH, STORAGE_NAMES } from "./config";
import { db } from "./db";
import { extensionFor } from "./storage/helpers";
import type { BrowserId } from "./types";
import { formatBytes } from "./utils";

// =============================================================================================
// Operating systems & browsers
// =============================================================================================

export type OSId = "macos" | "windows" | "linux" | "chromeos" | "ios" | "android" | "other";

/** Browsers whose on-disk layout we can describe. */
export type DiskBrowserId = "chrome" | "edge" | "brave" | "opera" | "vivaldi" | "arc" | "chromium" | "firefox" | "safari" | "samsung";

export const OS_LABELS: Record<OSId, string> = {
  macos: "macOS",
  windows: "Windows",
  linux: "Linux",
  chromeos: "ChromeOS (Chromebook)",
  ios: "iPhone & iPad",
  android: "Android",
  other: "Other",
};

/** What people call the device itself, for friendly copy ("This Mac"). */
export const DEVICE_LABELS: Record<OSId, string> = {
  macos: "This Mac",
  windows: "This PC",
  linux: "This computer",
  chromeos: "This Chromebook",
  ios: "This iPhone or iPad",
  android: "This phone or tablet",
  other: "This device",
};

export const DISK_BROWSER_LABELS: Record<DiskBrowserId, string> = {
  chrome: "Google Chrome",
  edge: "Microsoft Edge",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  arc: "Arc",
  chromium: "Chromium",
  firefox: "Firefox",
  safari: "Safari",
  samsung: "Samsung Internet",
};

/** OS choices offered in the location finder (in display order). */
export const OS_CHOICES: Exclude<OSId, "other">[] = ["macos", "windows", "linux", "chromeos", "ios", "android"];

const BROWSER_ORDER: DiskBrowserId[] = ["chrome", "edge", "safari", "firefox", "brave", "opera", "vivaldi", "arc", "chromium", "samsung"];

const AVAILABLE_ON: Record<DiskBrowserId, OSId[]> = {
  chrome: ["macos", "windows", "linux", "chromeos", "ios", "android"],
  edge: ["macos", "windows", "linux", "ios", "android"],
  brave: ["macos", "windows", "linux", "ios", "android"],
  opera: ["macos", "windows", "linux", "ios", "android"],
  vivaldi: ["macos", "windows", "linux", "ios", "android"],
  arc: ["macos", "windows", "ios"],
  chromium: ["macos", "windows", "linux"],
  firefox: ["macos", "windows", "linux", "ios", "android"],
  safari: ["macos", "ios"],
  samsung: ["android"],
};

/** Browsers that exist for an OS, most common first. */
export function browsersFor(os: OSId): DiskBrowserId[] {
  return BROWSER_ORDER.filter((b) => AVAILABLE_ON[b].includes(os));
}

/** Desktop systems where people can open the browser's profile folder. */
export function isDesktopOS(os: OSId): os is "macos" | "windows" | "linux" {
  return os === "macos" || os === "windows" || os === "linux";
}

export function isChromiumDisk(b: DiskBrowserId): boolean {
  return b !== "firefox" && b !== "safari";
}

export interface OSHints {
  userAgent: string;
  /** navigator.userAgentData.platform (Chromium only), e.g. "macOS", "Windows", "Chrome OS". */
  uaPlatform?: string;
  /** navigator.platform (deprecated but still widely available). */
  platform?: string;
  maxTouchPoints?: number;
}

/** Classify the operating system from navigator hints. Pure. */
export function classifyOS(h: OSHints): OSId {
  const p = (h.uaPlatform || "").trim().toLowerCase();
  if (p) {
    if (p === "macos" || p === "mac os x") return "macos";
    if (p === "windows") return "windows";
    if (p === "android") return "android";
    if (p === "chrome os" || p === "chromeos" || p === "chromium os") return "chromeos";
    if (p === "ios" || p === "ipados") return "ios";
    if (p === "linux") return "linux";
  }
  const ua = h.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android"; // before Linux: Android user agents mention Linux too
  if (/\bCrOS\b/.test(ua)) return "chromeos";
  if (/Windows/.test(ua)) return "windows";
  // iPadOS Safari pretends to be a Mac; real Macs report no touch points.
  if (/Macintosh|Mac OS X/.test(ua)) return (h.maxTouchPoints ?? 0) > 1 ? "ios" : "macos";
  if (/Linux|X11/.test(ua)) return "linux";
  const platform = h.platform || "";
  if (/^Mac/i.test(platform)) return "macos";
  if (/^Win/i.test(platform)) return "windows";
  if (/Linux/i.test(platform)) return "linux";
  return "other";
}

interface NavigatorWithHints {
  userAgentData?: { platform?: string; brands?: { brand: string }[] };
}

/** Which operating system this browser runs on. "other" during prerender or when unknown. */
export function detectOS(): OSId {
  if (typeof navigator === "undefined") return "other";
  try {
    const nav = navigator as Navigator & NavigatorWithHints;
    return classifyOS({
      userAgent: nav.userAgent || "",
      uaPlatform: nav.userAgentData?.platform,
      platform: nav.platform,
      maxTouchPoints: nav.maxTouchPoints,
    });
  } catch {
    return "other";
  }
}

export interface DiskBrowserHints {
  userAgent: string;
  /** navigator.userAgentData.brands, Chromium only. */
  brands?: string[];
  /** Arc sets `--arc-palette-*` CSS variables on every page. */
  isArc?: boolean;
}

/**
 * Refine the app-wide BrowserId into the browser whose folders we describe. Pure.
 * Vivaldi and Arc look exactly like Chrome to the generic detector, so they need extra hints.
 */
export function toDiskBrowser(base: BrowserId, h: DiskBrowserHints): DiskBrowserId {
  switch (base) {
    case "edge":
    case "brave":
    case "opera":
    case "firefox":
    case "samsung":
      return base;
    case "safari":
    case "ios-safari":
      return "safari";
    default:
      break;
  }
  const ua = h.userAgent || "";
  const brands = h.brands ?? [];
  if (h.isArc) return "arc";
  if (/\bVivaldi\//.test(ua) || brands.includes("Vivaldi")) return "vivaldi";
  if (/\bChromium\//.test(ua)) return "chromium";
  if (base === "other" && /\bFirefox\//.test(ua)) return "firefox";
  if (base === "other" && /\bSafari\//.test(ua) && !/\bChrome\//.test(ua)) return "safari";
  return "chrome";
}

/** Runtime wrapper around `toDiskBrowser` (pass `detectBrowser()` from storage/monitor). */
export function detectDiskBrowser(base: BrowserId): DiskBrowserId {
  if (typeof navigator === "undefined") return toDiskBrowser(base, { userAgent: "" });
  const nav = navigator as Navigator & NavigatorWithHints;
  let isArc = false;
  try {
    isArc = typeof document !== "undefined" && !!getComputedStyle(document.documentElement).getPropertyValue("--arc-palette-title").trim();
  } catch {
    isArc = false;
  }
  return toDiskBrowser(base, {
    userAgent: nav.userAgent || "",
    brands: nav.userAgentData?.brands?.map((b) => b.brand) ?? [],
    isArc,
  });
}

// =============================================================================================
// Origins → folder names
// =============================================================================================

export interface ParsedOrigin {
  /** "https" */
  scheme: string;
  /** "remembos.app" (IPv6 hosts keep their brackets). */
  host: string;
  /** null when it is the scheme's default port. */
  port: number | null;
  origin: string;
}

export function parseOrigin(origin: string): ParsedOrigin | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { scheme: u.protocol.slice(0, -1), host: u.hostname, port: u.port ? Number(u.port) : null, origin: u.origin };
  } catch {
    return null;
  }
}

/**
 * Chromium's per-site storage identifier, e.g. `https_remembos.app_0` (port 0 = the scheme's
 * default port) or `http_localhost_3000`. IPv6 colons become underscores (`http_[__1]_8080`).
 */
export function chromiumOriginId(origin: string): string {
  const p = parseOrigin(origin);
  if (!p) return "https_<this-site>_0";
  const host = p.host.startsWith("[") ? p.host.replace(/:/g, "_") : p.host;
  return `${p.scheme}_${host}_${p.port ?? 0}`;
}

/** Firefox's per-site folder name, e.g. `https+++remembos.app` or `http+++localhost+3000`. */
export function firefoxOriginDir(origin: string): string {
  const p = parseOrigin(origin);
  if (!p) return "https+++<this-site>";
  return `${p.scheme}+++${p.host.replace(/:/g, "+")}${p.port ? `+${p.port}` : ""}`;
}

// =============================================================================================
// On-disk locations
// =============================================================================================

export type LocationScope = "remembos" | "shared";

export type DiskLocationId =
  | "site-folder"
  | "indexeddb"
  | "indexeddb-blobs"
  | "local-storage"
  | "session-storage"
  | "cache-storage"
  | "cookies"
  | "legacy-indexeddb"
  | "legacy-local-storage";

export interface DiskLocation {
  id: DiskLocationId;
  label: string;
  /** Plain words: what this folder/file holds for Remembos. */
  description: string;
  path: string;
  /** "remembos" = only this site's data · "shared" = one store for every website (never delete it). */
  scope: LocationScope;
  /** Folder names are scrambled, so the path contains a <hashed> placeholder. */
  hashed?: boolean;
}

export interface PathVariant {
  label: string;
  path: string;
}

export interface ProfileFinder {
  /** Internal page to paste into the address bar, e.g. "chrome://version". */
  url?: string;
  /** What to look for on that page. */
  look: string;
  /** Another way to get there. */
  alternative?: string;
}

export interface DiskLocationGuide {
  os: OSId;
  browser: DiskBrowserId;
  /** false on phones, tablets and Chromebooks (and unknown systems): the data is sandboxed. */
  browsable: boolean;
  /** false when this browser does not exist for this OS (e.g. Safari on Windows). */
  available: boolean;
  separator: "/" | "\\";
  /** The browser profile folder that holds everything below. */
  profile?: { path: string; note: string; variants: PathVariant[] };
  finder?: ProfileFinder;
  locations: DiskLocation[];
  /** Version / install-type caveats, in plain words. */
  notes: string[];
  /** Explanation shown instead of paths when not browsable or not available. */
  message?: string;
}

type DesktopOS = "macos" | "windows" | "linux";
type ChromiumDisk = Exclude<DiskBrowserId, "firefox" | "safari" | "samsung">;

interface ProfileRoot {
  path: string;
  variants?: PathVariant[];
}

/** Default profile folder of each Chromium-based browser, per desktop OS. */
const CHROMIUM_PROFILES: Record<ChromiumDisk, Partial<Record<DesktopOS, ProfileRoot>>> = {
  chrome: {
    macos: { path: "~/Library/Application Support/Google/Chrome/Default" },
    windows: { path: "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default" },
    linux: {
      path: "~/.config/google-chrome/Default",
      variants: [{ label: "Flatpak install", path: "~/.var/app/com.google.Chrome/config/google-chrome/Default" }],
    },
  },
  edge: {
    macos: { path: "~/Library/Application Support/Microsoft Edge/Default" },
    windows: { path: "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default" },
    linux: {
      path: "~/.config/microsoft-edge/Default",
      variants: [{ label: "Flatpak install", path: "~/.var/app/com.microsoft.Edge/config/microsoft-edge/Default" }],
    },
  },
  brave: {
    macos: { path: "~/Library/Application Support/BraveSoftware/Brave-Browser/Default" },
    windows: { path: "%LOCALAPPDATA%\\BraveSoftware\\Brave-Browser\\User Data\\Default" },
    linux: {
      path: "~/.config/BraveSoftware/Brave-Browser/Default",
      variants: [
        { label: "Snap install", path: "~/snap/brave/current/.config/BraveSoftware/Brave-Browser/Default" },
        { label: "Flatpak install", path: "~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/Default" },
      ],
    },
  },
  opera: {
    macos: {
      path: "~/Library/Application Support/com.operasoftware.Opera",
      variants: [{ label: "Newer versions with several profiles", path: "~/Library/Application Support/com.operasoftware.Opera/Default" }],
    },
    windows: {
      path: "%APPDATA%\\Opera Software\\Opera Stable",
      variants: [
        { label: "Newer versions with several profiles", path: "%APPDATA%\\Opera Software\\Opera Stable\\Default" },
        { label: "Opera GX", path: "%APPDATA%\\Opera Software\\Opera GX Stable" },
      ],
    },
    linux: {
      path: "~/.config/opera",
      variants: [{ label: "Newer versions with several profiles", path: "~/.config/opera/Default" }],
    },
  },
  vivaldi: {
    macos: { path: "~/Library/Application Support/Vivaldi/Default" },
    windows: { path: "%LOCALAPPDATA%\\Vivaldi\\User Data\\Default" },
    linux: { path: "~/.config/vivaldi/Default" },
  },
  arc: {
    macos: { path: "~/Library/Application Support/Arc/User Data/Default" },
    windows: { path: "%LOCALAPPDATA%\\Packages\\TheBrowserCompany.Arc_<id>\\LocalCache\\Local\\Arc\\User Data\\Default" },
  },
  chromium: {
    macos: { path: "~/Library/Application Support/Chromium/Default" },
    windows: { path: "%LOCALAPPDATA%\\Chromium\\User Data\\Default" },
    linux: {
      path: "~/.config/chromium/Default",
      variants: [
        { label: "Snap install (Ubuntu's default)", path: "~/snap/chromium/common/chromium/Default" },
        { label: "Flatpak install", path: "~/.var/app/org.chromium.Chromium/config/chromium/Default" },
      ],
    },
  },
};

const CHROMIUM_FINDERS: Record<ChromiumDisk, ProfileFinder> = {
  chrome: { url: "chrome://version", look: "Profile Path" },
  chromium: { url: "chrome://version", look: "Profile Path" },
  edge: { url: "edge://version", look: "Profile path" },
  brave: { url: "brave://version", look: "Profile Path" },
  vivaldi: { url: "vivaldi://about", look: "Profile Path" },
  opera: { url: "opera://about", look: "Profile (under “Paths”)" },
  arc: { url: "arc://version", look: "Profile Path" },
};

const FIREFOX_PROFILE_NAME = "<xxxxxxxx>.default-release";

const FIREFOX_PROFILES: Record<DesktopOS, ProfileRoot> = {
  macos: { path: `~/Library/Application Support/Firefox/Profiles/${FIREFOX_PROFILE_NAME}` },
  windows: {
    path: `%APPDATA%\\Mozilla\\Firefox\\Profiles\\${FIREFOX_PROFILE_NAME}`,
    variants: [
      {
        label: "Installed from the Microsoft Store",
        path: `%LOCALAPPDATA%\\Packages\\Mozilla.Firefox_<id>\\LocalCache\\Roaming\\Mozilla\\Firefox\\Profiles\\${FIREFOX_PROFILE_NAME}`,
      },
    ],
  },
  linux: {
    path: `~/.mozilla/firefox/${FIREFOX_PROFILE_NAME}`,
    variants: [
      { label: "Snap install (Ubuntu's default)", path: `~/snap/firefox/common/.mozilla/firefox/${FIREFOX_PROFILE_NAME}` },
      { label: "Flatpak install", path: `~/.var/app/org.mozilla.firefox/.mozilla/firefox/${FIREFOX_PROFILE_NAME}` },
      { label: "Recent versions on new installs", path: `~/.config/mozilla/firefox/${FIREFOX_PROFILE_NAME}` },
    ],
  },
};

const SAFARI_WEBSITE_DATA = "~/Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteData/Default";

const SANDBOX_MESSAGES: Record<"ios" | "android" | "chromeos" | "other", string> = {
  ios:
    "On iPhone and iPad, every browser keeps website data inside its own locked app container. iOS doesn't let anyone — not even you — open those folders, so there is nothing to browse. Your safety net is a backup file.",
  android:
    "Android keeps each browser's data in a private app folder that only the browser itself can open. File managers can't see it (without rooting the phone, which we don't recommend). Your safety net is a backup file.",
  chromeos:
    "Chromebooks keep browser data in an encrypted, system-protected part of the disk. The Files app can't show it. Your safety net is a backup file you save to Downloads or Google Drive.",
  other: "We couldn't tell which system this is. Pick yours above to see the exact folders.",
};

function join(sep: "/" | "\\", ...parts: string[]): string {
  return parts.join(sep);
}

/**
 * Where this site's data sits on disk for a given OS + browser, with the real origin substituted.
 * Pure: pass `window.location.origin` as `origin`.
 */
export function diskLocations(os: OSId, browser: DiskBrowserId, origin: string): DiskLocationGuide {
  const base = { os, browser, locations: [] as DiskLocation[], notes: [] as string[] };
  if (!isDesktopOS(os)) {
    return {
      ...base,
      browsable: false,
      available: os === "other" ? true : AVAILABLE_ON[browser].includes(os),
      separator: "/",
      message: SANDBOX_MESSAGES[os],
    };
  }
  const separator = os === "windows" ? "\\" : "/";
  if (!AVAILABLE_ON[browser].includes(os)) {
    return {
      ...base,
      browsable: true,
      available: false,
      separator,
      message: `${DISK_BROWSER_LABELS[browser]} isn't available for ${OS_LABELS[os]}. Pick the browser you use to see its folders.`,
    };
  }
  if (browser === "firefox") return firefoxGuide(os, origin);
  if (browser === "safari") return safariGuide(origin);
  return chromiumGuide(os, browser as ChromiumDisk, origin);
}

function chromiumGuide(os: DesktopOS, browser: ChromiumDisk, origin: string): DiskLocationGuide {
  const sep = os === "windows" ? "\\" : "/";
  const root = CHROMIUM_PROFILES[browser][os] as ProfileRoot;
  const id = chromiumOriginId(origin);
  const p = root.path;
  const name = DISK_BROWSER_LABELS[browser];
  const locations: DiskLocation[] = [
    {
      id: "indexeddb",
      label: "Your memories (IndexedDB)",
      description: `Every memory, its text and search data, plus the text reader's language files — one database folder for this site, made of binary files like 000003.log and MANIFEST-000001.`,
      path: join(sep, p, "IndexedDB", `${id}.indexeddb.leveldb`),
      scope: "remembos",
    },
    {
      id: "indexeddb-blobs",
      label: "Your original files (IndexedDB)",
      description: "The screenshots, PDFs, videos and recordings you added, saved as numbered files without names or extensions. It appears after you add your first file.",
      path: join(sep, p, "IndexedDB", `${id}.indexeddb.blob`),
      scope: "remembos",
    },
    {
      id: "cache-storage",
      label: "AI model files & offline copy (Cache Storage)",
      description: "Downloaded AI models and the offline copy of the app. Each website gets its own sub-folder with a scrambled (hashed) name, so you can't spot Remembos by name.",
      path: join(sep, p, "Service Worker", "CacheStorage"),
      scope: "shared",
      hashed: true,
    },
    {
      id: "local-storage",
      label: "Preferences (localStorage)",
      description: `Your Remembos settings (theme, search options). This one database holds localStorage for every website you use in ${name}.`,
      path: join(sep, p, "Local Storage", "leveldb"),
      scope: "shared",
    },
    {
      id: "session-storage",
      label: "Per-tab notes (sessionStorage)",
      description: `Short-lived notes for open tabs, for every website. Remembos only keeps “tip already shown” flags here.`,
      path: join(sep, p, "Session Storage"),
      scope: "shared",
    },
    {
      id: "cookies",
      label: "Cookies",
      description: "Every website's cookies in one file. Remembos sets none.",
      path: join(sep, p, "Network", "Cookies"),
      scope: "shared",
    },
  ];
  const notes = [
    `Your profile folder may be called “Default”, or “Profile 1”, “Profile 2”… if you use more than one ${name} profile.`,
    "Folder names sometimes change between browser versions. If a folder isn't there, look for a “WebStorage” folder in the same profile — newer versions keep some site data there.",
    "Older versions kept cookies directly in the profile folder (a file named “Cookies”, without “Network”).",
  ];
  if (browser === "opera") notes.unshift("Opera keeps its main profile directly in this folder. Versions with several profiles may add a “Default” sub-folder — opera://about shows the exact path.");
  if (browser === "arc" && os === "windows") notes.unshift("Arc for Windows is installed like a Store app, so Windows adds a short code after “Arc_” in the folder name.");
  return {
    os,
    browser,
    browsable: true,
    available: true,
    separator: sep,
    profile: {
      path: p,
      note: `${name}'s profile folder — everything this browser stores lives under it.`,
      variants: root.variants ?? [],
    },
    finder: CHROMIUM_FINDERS[browser],
    locations,
    notes,
  };
}

function firefoxGuide(os: DesktopOS, origin: string): DiskLocationGuide {
  const sep = os === "windows" ? "\\" : "/";
  const root = FIREFOX_PROFILES[os];
  const p = root.path;
  const site = join(sep, p, "storage", "default", firefoxOriginDir(origin));
  const locations: DiskLocation[] = [
    {
      id: "site-folder",
      label: "Everything Remembos stores",
      description: "This site's own folder. The three folders below live inside it.",
      path: site,
      scope: "remembos",
    },
    {
      id: "indexeddb",
      label: "Your memories & original files (IndexedDB)",
      description: "One .sqlite file per database (your memories, and the text reader's language files) with scrambled names, plus a matching .files folder that holds your screenshots, PDFs, videos and recordings as numbered files.",
      path: join(sep, site, "idb"),
      scope: "remembos",
    },
    {
      id: "cache-storage",
      label: "AI model files & offline copy (Cache Storage)",
      description: "A caches.sqlite index plus a “morgue” folder with the downloaded model files and the offline copy of the app.",
      path: join(sep, site, "cache"),
      scope: "remembos",
    },
    {
      id: "local-storage",
      label: "Preferences (localStorage)",
      description: "Your Remembos settings, in a small data.sqlite file.",
      path: join(sep, site, "ls"),
      scope: "remembos",
    },
    {
      id: "session-storage",
      label: "Per-tab notes (sessionStorage)",
      description: "Firefox keeps sessionStorage in memory and saves it with your open tabs for session restore — for every website at once.",
      path: join(sep, p, "sessionstore-backups"),
      scope: "shared",
    },
    {
      id: "cookies",
      label: "Cookies",
      description: "Every website's cookies in one database. Remembos sets none.",
      path: join(sep, p, "cookies.sqlite"),
      scope: "shared",
    },
  ];
  return {
    os,
    browser: "firefox",
    browsable: true,
    available: true,
    separator: sep,
    profile: {
      path: p,
      note: "Firefox's profile folder. The part before “.default-release” is 8 random letters and numbers, different on every computer.",
      variants: root.variants ?? [],
    },
    finder: {
      url: "about:profiles",
      look: "Root Directory of the profile marked “This is the profile in use”",
      alternative: "about:support → “Profile Folder” → Open Folder (Show in Finder on Mac)",
    },
    locations,
    notes: [
      "Older or special profiles end in “.default”, “.default-esr” or “.dev-edition-default” instead of “.default-release”.",
      "Using Firefox containers? Each container gets its own site folder ending in “^userContextId=…”.",
      "Very old Firefox versions kept localStorage for all sites in one webappsstore.sqlite file in the profile folder.",
      "Private windows keep everything in memory only — nothing is written here, and it vanishes when you close them.",
    ],
  };
}

function safariGuide(origin: string): DiskLocationGuide {
  const id = chromiumOriginId(origin);
  const site = `${SAFARI_WEBSITE_DATA}/<hashed>/<hashed>`;
  const locations: DiskLocation[] = [
    {
      id: "site-folder",
      label: "Everything Remembos stores",
      description: "This site's folder. Safari scrambles (hashes) the folder names for privacy; each site folder holds a small file named “origin” that records which website it belongs to.",
      path: site,
      scope: "remembos",
      hashed: true,
    },
    {
      id: "indexeddb",
      label: "Your memories & original files (IndexedDB)",
      description: "Your memories, the original files and the text reader's language files, in SQLite databases.",
      path: `${site}/IndexedDB`,
      scope: "remembos",
      hashed: true,
    },
    {
      id: "cache-storage",
      label: "AI model files & offline copy (Cache Storage)",
      description: "Downloaded AI models and the offline copy of the app.",
      path: `${site}/CacheStorage`,
      scope: "remembos",
      hashed: true,
    },
    {
      id: "local-storage",
      label: "Preferences (localStorage)",
      description: "Your Remembos settings.",
      path: `${site}/LocalStorage`,
      scope: "remembos",
      hashed: true,
    },
    {
      id: "cookies",
      label: "Cookies",
      description: "Every website's cookies in one file. Remembos sets none.",
      path: "~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies",
      scope: "shared",
    },
    {
      id: "legacy-indexeddb",
      label: "Older Safari versions: IndexedDB",
      description: "Before the move to hashed folders, Safari used readable folder names like this one.",
      path: `~/Library/Safari/Databases/___IndexedDB/${id}`,
      scope: "remembos",
    },
    {
      id: "legacy-local-storage",
      label: "Older Safari versions: localStorage",
      description: "Where older versions kept this site's preferences.",
      path: `~/Library/Safari/LocalStorage/${id}.localstorage`,
      scope: "remembos",
    },
  ];
  return {
    os: "macos",
    browser: "safari",
    browsable: true,
    available: true,
    separator: "/",
    profile: {
      path: SAFARI_WEBSITE_DATA,
      note: "Safari's website-data folder for its default profile. Safari has no page that shows this path.",
      variants: [],
    },
    finder: {
      look: "Develop → Show Web Inspector → Storage tab (shows the data itself, not the folder)",
    },
    locations,
    notes: [
      "macOS protects Safari's folders. Finder may ask for permission or show them as empty — that's normal, and you don't need to open them. Safari's Web Inspector is the friendlier way to look.",
      "Safari Profiles and web apps added to the Dock each keep their own, separate website data.",
      "Exact folder layout differs between Safari versions.",
    ],
  };
}

// =============================================================================================
// Live inspection (read-only)
// =============================================================================================

export const REMEMBOS_TABLES = ["items", "files", "thumbs", "chunks", "entities", "meta"] as const;
export type RemembosTable = (typeof REMEMBOS_TABLES)[number];

export interface EstimateReport {
  supported: boolean;
  usage: number;
  quota: number;
  /** Per-medium bytes (Chromium), e.g. { indexedDB, caches, serviceWorkerRegistrations }. */
  usageDetails?: Record<string, number>;
}

/** app = Remembos's memories · ocr = tesseract.js language cache · helper = the database library's bookkeeping. */
export type DatabaseRole = "app" | "ocr" | "helper" | "other";

export interface InspectedDatabase {
  name: string;
  version: number | null;
  role: DatabaseRole;
  /** null = this browser can't list databases, so we can't tell without creating it. */
  exists: boolean | null;
  /** Records across all object stores (only counted for the OCR cache). */
  records: number | null;
}

export interface IndexedDBReport {
  supported: boolean;
  /** indexedDB.databases() was available (Chrome, Edge, Safari, Firefox 126+). */
  listed: boolean;
  databases: InspectedDatabase[];
  /** Record counts per Remembos table; null when the database couldn't be read. */
  tables: Record<RemembosTable, number> | null;
  error?: string;
}

export interface WebStorageEntry {
  key: string;
  /** Approximate bytes: browsers count 2 bytes per character for key + value. */
  bytes: number;
  /** Key starts with STORAGE_NAMES.keyPrefix. */
  ours: boolean;
}

export interface WebStorageReport {
  supported: boolean;
  entries: WebStorageEntry[];
  totalBytes: number;
  ours: { count: number; bytes: number };
  error?: string;
}

export interface CookieReport {
  supported: boolean;
  names: string[];
}

/** models = AI model files · shell = offline copy of the app · share = inbox for things shared from other apps (Android). */
export type CacheRole = "models" | "shell" | "share" | "other";

export interface InspectedCache {
  name: string;
  role: CacheRole;
  /** Number of stored responses; null when it couldn't be read. */
  entries: number | null;
}

export interface CacheStorageReport {
  supported: boolean;
  caches: InspectedCache[];
  error?: string;
}

export interface InspectedWorker {
  scope: string;
  /** "activated", "installing", "waiting"… */
  state: string;
  scriptURL: string;
  /** Registered by Remembos (its scope is this app). */
  ours: boolean;
}

export interface ServiceWorkerReport {
  supported: boolean;
  /** This page is currently controlled by a service worker. */
  controlled: boolean;
  registrations: InspectedWorker[];
  error?: string;
}

export interface StorageInspection {
  origin: string;
  checkedAt: number;
  secureContext: boolean;
  estimate: EstimateReport;
  /** Browser promised not to evict. null = unknown / unsupported. */
  persisted: boolean | null;
  indexedDB: IndexedDBReport;
  localStorage: WebStorageReport;
  sessionStorage: WebStorageReport;
  cookies: CookieReport;
  cacheStorage: CacheStorageReport;
  serviceWorker: ServiceWorkerReport;
}

// ---------- Pure helpers (unit-tested) ----------

export function classifyDatabase(name: string): DatabaseRole {
  if (name === STORAGE_NAMES.appDb) return "app";
  if (name === STORAGE_NAMES.ocrDb) return "ocr";
  if (name === "__dbnames") return "helper";
  return "other";
}

export function classifyCache(name: string): CacheRole {
  if ((STORAGE_NAMES.modelCaches as readonly string[]).includes(name)) return "models";
  if (name.startsWith(STORAGE_NAMES.swCachePrefix)) return "shell";
  if (name === STORAGE_NAMES.shareCache) return "share";
  return "other";
}

export function isOwnKey(key: string): boolean {
  return key.startsWith(STORAGE_NAMES.keyPrefix);
}

/** Approximate bytes a localStorage/sessionStorage entry takes (UTF-16: 2 bytes per character). */
export function webStorageBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

/** Read every entry of a Storage-like object. Remembos's keys first, then the rest by name. */
export function readWebStorage(storage: Pick<Storage, "length" | "key" | "getItem">): Omit<WebStorageReport, "supported"> {
  const entries: WebStorageEntry[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null) continue;
    const value = storage.getItem(key) ?? "";
    entries.push({ key, bytes: webStorageBytes(key, value), ours: isOwnKey(key) });
  }
  entries.sort((a, b) => (a.ours === b.ours ? a.key.localeCompare(b.key) : a.ours ? -1 : 1));
  const own = entries.filter((e) => e.ours);
  return {
    entries,
    totalBytes: entries.reduce((n, e) => n + e.bytes, 0),
    ours: { count: own.length, bytes: own.reduce((n, e) => n + e.bytes, 0) },
  };
}

/** Cookie names from a `document.cookie` string (values are never kept). Unique, in order. */
export function parseCookieNames(cookie: string): string[] {
  const names: string[] = [];
  for (const part of cookie.split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    // A cookie without "=" has an empty name and that text as its value.
    const name = (eq === -1 ? "" : pair.slice(0, eq)).trim();
    const label = name || "(unnamed)";
    if (!names.includes(label)) names.push(label);
  }
  return names;
}

const USAGE_DETAIL_LABELS: Record<string, string> = {
  indexedDB: "IndexedDB — memories & text-reader files",
  caches: "Cache Storage — AI models & offline copy",
  serviceWorkerRegistrations: "Service worker",
  serviceWorker: "Service worker",
  fileSystem: "File system (not used by Remembos)",
  fileSystemDirectories: "File system (not used by Remembos)",
  webSQL: "Web SQL (not used by Remembos)",
};

/** Human labels for `estimate().usageDetails`, biggest first, empty entries dropped. */
export function describeUsageDetails(details: Record<string, number> | undefined): { key: string; label: string; bytes: number }[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, bytes]) => typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0)
    .map(([key, bytes]) => ({
      key,
      bytes,
      label: USAGE_DETAIL_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Plain-text summary of an inspection, for "Copy report". Lists only names, counts and sizes —
 * never the content of memories, settings values or cookie values.
 */
export function formatInspectionReport(r: StorageInspection): string {
  const lines: string[] = [];
  const yesNo = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");
  lines.push("Remembos storage report");
  lines.push(`Site: ${r.origin}`);
  lines.push(`Checked: ${new Date(r.checkedAt).toISOString()}`);
  lines.push("");
  lines.push("Space");
  if (r.estimate.supported) {
    lines.push(`  Used: ${formatBytes(r.estimate.usage)} of ${formatBytes(r.estimate.quota)} allowed`);
    for (const d of describeUsageDetails(r.estimate.usageDetails)) lines.push(`  - ${d.label}: ${formatBytes(d.bytes)}`);
  } else lines.push("  Not reported by this browser");
  lines.push(`  Protected from automatic clean-up: ${yesNo(r.persisted)}`);
  lines.push("");
  lines.push("IndexedDB");
  if (!r.indexedDB.supported) lines.push("  Not available");
  for (const d of r.indexedDB.databases) {
    const state = d.exists === null ? "can't check" : d.exists ? "present" : "not created yet";
    const extra = [d.version !== null ? `version ${d.version}` : "", d.records !== null ? `${d.records} records` : ""].filter(Boolean).join(", ");
    lines.push(`  ${d.name} (${d.role}): ${state}${extra ? `, ${extra}` : ""}`);
  }
  if (r.indexedDB.tables) {
    lines.push(`  ${STORAGE_NAMES.appDb} tables: ${REMEMBOS_TABLES.map((t) => `${t} ${r.indexedDB.tables?.[t] ?? 0}`).join(", ")}`);
  }
  if (r.indexedDB.error) lines.push(`  Error: ${r.indexedDB.error}`);
  for (const [label, s] of [
    ["localStorage", r.localStorage],
    ["sessionStorage", r.sessionStorage],
  ] as const) {
    lines.push("");
    lines.push(label);
    if (!s.supported) lines.push(`  Not available${s.error ? ` (${s.error})` : ""}`);
    else if (!s.entries.length) lines.push("  Empty");
    for (const e of s.entries) lines.push(`  ${e.key}: ${formatBytes(e.bytes)}${e.ours ? " (Remembos)" : ""}`);
  }
  lines.push("");
  lines.push("Cookies");
  lines.push(r.cookies.supported ? (r.cookies.names.length ? `  ${r.cookies.names.join(", ")}` : "  None") : "  Not readable");
  lines.push("");
  lines.push("Cache Storage");
  if (!r.cacheStorage.supported) lines.push("  Not available");
  else if (!r.cacheStorage.caches.length) lines.push("  No caches");
  for (const c of r.cacheStorage.caches) lines.push(`  ${c.name} (${c.role}): ${c.entries ?? "?"} entries`);
  lines.push("");
  lines.push("Service workers");
  if (!r.serviceWorker.supported) lines.push("  Not available");
  else if (!r.serviceWorker.registrations.length) lines.push("  None registered");
  for (const w of r.serviceWorker.registrations) lines.push(`  ${w.scope}: ${w.state}${w.ours ? " (Remembos)" : ""}`);
  lines.push(`  This page controlled by a service worker: ${r.serviceWorker.controlled ? "yes" : "no"}`);
  return lines.join("\n");
}

// =============================================================================================
// Storage explorer (pure helpers, unit-tested)
// =============================================================================================

/** Rows shown per page in the storage explorer. */
export const EXPLORER_PAGE_SIZE = 50;

export interface TableExplanation {
  /** Friendly name, e.g. "Original files". */
  title: string;
  /** One plain-language line about what the table holds. */
  explain: string;
}

/** What each table of the "remembos" database holds, in plain words. */
export const TABLE_EXPLANATIONS: Record<RemembosTable, TableExplanation> = {
  items: { title: "Memories", explain: "Your memories' text & details — titles, the words read from them, dates and tags." },
  files: { title: "Original files", explain: "Your original uploads — screenshots, PDFs, videos and recordings, exactly as added." },
  thumbs: { title: "Previews", explain: "Small preview pictures shown in the library and in search results." },
  chunks: { title: "Search pieces", explain: "Searchable pieces of each memory's text, with the meaning vectors used by meaning search." },
  entities: { title: "Things found", explain: "Phone numbers, names, amounts, emails, links and dates found in your memories." },
  meta: { title: "Bookkeeping", explain: "App bookkeeping — a few small notes Remembos keeps for itself." },
};

/** The text reader's database (tesseract.js keeps its language data in it). */
export const OCR_DB_EXPLANATION: TableExplanation = {
  title: "Text-reader language data",
  explain: "Language files the text reader (OCR) downloaded once. None of your memories are in here.",
};

/** Separator used in logical addresses ("IndexedDB › remembos › files › abc123"). */
export const ADDRESS_SEPARATOR = " › ";

/** Where a record lives inside the browser, e.g. "IndexedDB › remembos › files › abc123". */
export function logicalAddress(table: string, key?: string, database: string = STORAGE_NAMES.appDb): string {
  return ["IndexedDB", database, table, ...(key === undefined || key === "" ? [] : [key])].join(ADDRESS_SEPARATOR);
}

/** Number of pages for `total` rows (always at least 1, so "page 1 of 1" reads naturally when empty). */
export function pageCount(total: number, size: number = EXPLORER_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0 || size <= 0) return 1;
  return Math.ceil(total / size);
}

/** Zero-based page that contains the row at zero-based `offset`. */
export function pageOf(offset: number, size: number = EXPLORER_PAGE_SIZE): number {
  if (!Number.isFinite(offset) || offset <= 0 || size <= 0) return 0;
  return Math.floor(offset / size);
}

/** Keep a page number inside 0 … last page. */
export function clampPage(page: number, total: number, size: number = EXPLORER_PAGE_SIZE): number {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.min(Math.floor(page), pageCount(total, size) - 1);
}

/** 1-based first/last row numbers shown on a page ("51–100 of 230"); 0/0 when there are no rows. */
export function pageSpan(page: number, total: number, size: number = EXPLORER_PAGE_SIZE): { first: number; last: number } {
  if (!Number.isFinite(total) || total <= 0) return { first: 0, last: 0 };
  const p = clampPage(page, total, size);
  return { first: p * size + 1, last: Math.min(total, (p + 1) * size) };
}

/** Chunks are keyed `${itemId}:${index}`, so all of an item's chunks start with this prefix. */
export function chunkKeyPrefix(itemId: string): string {
  return `${itemId}:`;
}

/** Item id a chunk key belongs to (`abc:12` → `abc`), or null for keys in another shape. */
export function chunkItemId(chunkKey: string): string | null {
  const i = chunkKey.lastIndexOf(":");
  return i > 0 ? chunkKey.slice(0, i) : null;
}

/**
 * Does this row of `table` belong to the memory `itemId`? items/files/thumbs are keyed by the item
 * id, chunks by `${itemId}:${index}`, and entities list the items mentioning them in `itemIds`.
 */
export function rowBelongsTo(table: RemembosTable, key: string, itemId: string, itemIds?: readonly string[]): boolean {
  if (!itemId) return false;
  switch (table) {
    case "items":
    case "files":
    case "thumbs":
      return key === itemId;
    case "chunks":
      return key.startsWith(chunkKeyPrefix(itemId)) && chunkItemId(key) === itemId;
    case "entities":
      return !!itemIds?.includes(itemId);
    case "meta":
      return false;
  }
}

/** Types a browser would run as a web page (scripts included) when a stored file is opened directly. */
const ACTIVE_TYPE = /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/xsl|application\/xslt\+xml|text\/(?:java|ecma)script|application\/(?:java|ecma)script|multipart\/|[a-z]+\/[a-z0-9.+-]*\+xml$)/i;

/**
 * The type to use when opening a stored file in a new tab. Anything that could run as a web page
 * inside Remembos (HTML, SVG, XML, scripts) is shown as plain text instead; unknown types download.
 */
export function safeOpenType(type: string | undefined): string {
  const base = (type ?? "").split(";")[0].trim().toLowerCase();
  if (!base) return "application/octet-stream";
  if (ACTIVE_TYPE.test(base)) return "text/plain";
  return base;
}

/** Name to show / download a stored original or preview under. Stored File objects keep their own name. */
export function storedFileName(
  blob: Pick<Blob, "type"> & { name?: unknown },
  item?: { sourceName?: string; title?: string; mimeType?: string } | null,
  variant: "original" | "preview" = "original",
): string {
  if (variant === "original") {
    const own = typeof blob.name === "string" ? blob.name.trim() : "";
    if (own) return own;
    const source = item?.sourceName?.trim();
    if (source) return source;
  }
  const base =
    (item?.title || "memory")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "memory";
  const ext = extensionFor(blob.type || (variant === "original" ? item?.mimeType : undefined));
  return `${base}${variant === "preview" ? " (preview)" : ""}.${ext}`;
}

/**
 * The folder on disk that physically holds a table's records for this OS + browser: Chromium keeps
 * files in a separate `.indexeddb.blob` folder; Firefox and Safari keep everything under IndexedDB.
 * null on phones, tablets and Chromebooks (sandboxed) or for a browser that doesn't exist on this OS.
 */
export function folderForTable(guide: DiskLocationGuide, table: RemembosTable | "ocr"): DiskLocation | null {
  if (!guide.browsable || !guide.available) return null;
  const wanted: DiskLocationId[] = table === "files" || table === "thumbs" ? ["indexeddb-blobs", "indexeddb"] : ["indexeddb"];
  for (const id of wanted) {
    const found = guide.locations.find((l) => l.id === id);
    if (found) return found;
  }
  return null;
}

/**
 * Honest explanation of what you'd actually find in that folder: not "<name>", but numbered pieces.
 * `name` is the original file name, when there is one.
 */
export function numberedPiecesNote(browser: DiskBrowserId, name?: string): string {
  const what = name ? `a file called “${name}”` : "your file under its own name";
  if (browser === "firefox") {
    return `You won't find ${what} in there. Firefox keeps stored files as numbered files (1, 2, 3…) in a “.files” folder next to a database with a scrambled name — no names, no extensions.`;
  }
  if (browser === "safari") {
    return `You won't find ${what} in there. Safari hides the database behind scrambled folder names and keeps stored files as numbered pieces — no names, no extensions.`;
  }
  return `You won't find ${what} in there. ${DISK_BROWSER_LABELS[browser]} keeps every stored file as a numbered piece in numbered sub-folders of the “.indexeddb.blob” folder (like 1/00/2) — no names, no extensions; copy one out and add its extension (.png, .pdf…) to open it. Your text, notes and search data live in the “.indexeddb.leveldb” folder, packed inside its .log and .ldb database files.`;
}

/** Short, safe description of a `meta` record's value: kind, one-line preview and approximate size. */
export function describeValue(value: unknown, maxChars = 120): { type: string; preview: string; bytes: number } {
  if (value === null || value === undefined) return { type: "empty", preview: "—", bytes: 0 };
  if (typeof Blob !== "undefined" && value instanceof Blob) return { type: value.type || "file", preview: "Binary file", bytes: value.size };
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes = value.byteLength;
    return { type: "binary", preview: `${bytes.toLocaleString("en-US")} bytes of binary data`, bytes };
  }
  let json: string;
  try {
    json = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    json = String(value);
  }
  const type = Array.isArray(value)
    ? `list of ${value.length.toLocaleString("en-US")}`
    : typeof value === "string"
      ? "text"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "yes/no"
          : typeof value === "object"
            ? "record"
            : typeof value;
  const flat = json.replace(/\s+/g, " ").trim();
  const preview = flat.length > maxChars ? `${flat.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : flat || "—";
  const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(json).length : json.length;
  return { type, preview, bytes };
}

// ---------- Browser reads ----------

const STEP_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms = STEP_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const { name, message } = err as { name?: unknown; message?: unknown };
    const m = typeof message === "string" ? message : "";
    const n = typeof name === "string" && name !== "Error" ? name : "";
    return [n, m].filter(Boolean).join(": ") || "Unknown error";
  }
  return String(err || "Unknown error");
}

async function inspectEstimate(): Promise<{ estimate: EstimateReport; persisted: boolean | null }> {
  const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const estimate: EstimateReport = { supported: false, usage: 0, quota: 0 };
  if (sm && typeof sm.estimate === "function") {
    try {
      const est = (await withTimeout(sm.estimate())) as StorageEstimate & { usageDetails?: Record<string, number> };
      estimate.supported = true;
      estimate.usage = est.usage ?? 0;
      estimate.quota = est.quota ?? 0;
      if (est.usageDetails && typeof est.usageDetails === "object") estimate.usageDetails = { ...est.usageDetails };
    } catch {
      estimate.supported = false;
    }
  }
  let persisted: boolean | null = null;
  if (sm && typeof sm.persisted === "function") {
    try {
      persisted = await withTimeout(sm.persisted());
    } catch {
      persisted = null;
    }
  }
  return { estimate, persisted };
}

/**
 * Open an existing database read-only (no version, so no upgrade). Never creates one: if the
 * database doesn't exist the upgrade is aborted and this resolves null. Also null when blocked,
 * unavailable or slower than the step timeout. Close the result when done.
 */
export function openExistingDatabase(name: string, timeoutMs = STEP_TIMEOUT_MS): Promise<IDBDatabase | null> {
  return new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let settled = false;
    let req: IDBOpenDBRequest;
    const finish = (database: IDBDatabase | null) => {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(database);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      req = indexedDB.open(name);
    } catch {
      return finish(null);
    }
    req.onupgradeneeded = () => {
      // The database didn't exist: abort so nothing is created.
      try {
        req.transaction?.abort();
      } catch {
        /* already aborting */
      }
    };
    req.onerror = () => finish(null);
    req.onblocked = () => finish(null);
    req.onsuccess = () => {
      const database = req.result;
      // Step aside if the page that owns this database needs to upgrade it.
      database.onversionchange = () => database.close();
      finish(database);
    };
  });
}

/** Names and versions of every IndexedDB database of this site, or null when the browser can't list them. */
export async function listDatabases(): Promise<{ name: string; version: number | null }[] | null> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return null;
  try {
    const listed = await withTimeout(indexedDB.databases());
    return listed.filter((d): d is IDBDatabaseInfo & { name: string } => !!d.name).map((d) => ({ name: d.name, version: d.version ?? null }));
  } catch {
    return null;
  }
}

/** Count records in every store of an existing database. Never creates one. */
async function countIdbRecords(name: string): Promise<number | null> {
  const database = await openExistingDatabase(name);
  if (!database) return null;
  const stores = Array.from(database.objectStoreNames);
  if (!stores.length) {
    database.close();
    return 0;
  }
  return new Promise<number | null>((resolve) => {
    try {
      const tx = database.transaction(stores, "readonly");
      let total = 0;
      for (const s of stores) {
        const countReq = tx.objectStore(s).count();
        countReq.onsuccess = () => {
          total += countReq.result;
        };
      }
      tx.oncomplete = () => {
        database.close();
        resolve(total);
      };
      tx.onerror = tx.onabort = () => {
        database.close();
        resolve(null);
      };
    } catch {
      database.close();
      resolve(null);
    }
  });
}

async function inspectIndexedDB(): Promise<IndexedDBReport> {
  if (typeof indexedDB === "undefined") return { supported: false, listed: false, databases: [], tables: null };
  const report: IndexedDBReport = { supported: true, listed: false, databases: [], tables: null };

  try {
    const [items, files, thumbs, chunks, entities, meta] = await withTimeout(
      Promise.all([db.items.count(), db.files.count(), db.thumbs.count(), db.chunks.count(), db.entities.count(), db.meta.count()]),
    );
    report.tables = { items, files, thumbs, chunks, entities, meta };
  } catch (err) {
    report.error = errorText(err);
  }

  let listed: { name?: string; version?: number }[] | null = null;
  if (typeof indexedDB.databases === "function") {
    try {
      listed = await withTimeout(indexedDB.databases());
      report.listed = true;
    } catch {
      listed = null;
    }
  }

  if (listed) {
    for (const d of listed) {
      if (!d.name) continue;
      report.databases.push({ name: d.name, version: d.version ?? null, role: classifyDatabase(d.name), exists: true, records: null });
    }
    // Listing can lag right after creation; the counts prove the app database exists.
    if (report.tables && !report.databases.some((d) => d.role === "app")) {
      report.databases.push({ name: STORAGE_NAMES.appDb, version: null, role: "app", exists: true, records: null });
    }
    if (!report.databases.some((d) => d.role === "ocr")) {
      report.databases.push({ name: STORAGE_NAMES.ocrDb, version: null, role: "ocr", exists: false, records: null });
    }
  } else {
    // Can't list without creating: report the known names; only the app database is proven by its counts.
    report.databases.push({ name: STORAGE_NAMES.appDb, version: null, role: "app", exists: report.tables ? true : null, records: null });
    report.databases.push({ name: STORAGE_NAMES.ocrDb, version: null, role: "ocr", exists: null, records: null });
  }

  const ocr = report.databases.find((d) => d.role === "ocr" && d.exists === true);
  if (ocr) ocr.records = await countIdbRecords(ocr.name);

  const order: Record<DatabaseRole, number> = { app: 0, ocr: 1, helper: 2, other: 3 };
  report.databases.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  return report;
}

function inspectWebStorage(pick: () => Storage): WebStorageReport {
  try {
    const storage = pick();
    if (!storage) return { supported: false, entries: [], totalBytes: 0, ours: { count: 0, bytes: 0 } };
    return { supported: true, ...readWebStorage(storage) };
  } catch (err) {
    return { supported: false, entries: [], totalBytes: 0, ours: { count: 0, bytes: 0 }, error: errorText(err) };
  }
}

function inspectCookies(): CookieReport {
  try {
    if (typeof document === "undefined") return { supported: false, names: [] };
    return { supported: true, names: parseCookieNames(document.cookie || "") };
  } catch {
    return { supported: false, names: [] };
  }
}

async function inspectCaches(): Promise<CacheStorageReport> {
  if (typeof caches === "undefined") return { supported: false, caches: [] };
  try {
    const names = await withTimeout(caches.keys());
    const list = await Promise.all(
      names.map(async (name): Promise<InspectedCache> => {
        let entries: number | null = null;
        try {
          // Opening a name returned by keys() never creates anything new.
          const cache = await withTimeout(caches.open(name));
          entries = (await withTimeout(cache.keys())).length;
        } catch {
          entries = null;
        }
        return { name, role: classifyCache(name), entries };
      }),
    );
    const order: Record<CacheRole, number> = { models: 0, shell: 1, share: 2, other: 3 };
    list.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
    return { supported: true, caches: list };
  } catch (err) {
    return { supported: true, caches: [], error: errorText(err) };
  }
}

async function inspectServiceWorkers(origin: string): Promise<ServiceWorkerReport> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { supported: false, controlled: false, registrations: [] };
  const sw = navigator.serviceWorker;
  const appScope = `${origin}${BASE_PATH}/`;
  try {
    const regs = await withTimeout(sw.getRegistrations());
    return {
      supported: true,
      controlled: !!sw.controller,
      registrations: regs.map((r) => {
        const worker = r.active ?? r.waiting ?? r.installing;
        return {
          scope: r.scope,
          state: worker?.state ?? "unknown",
          scriptURL: worker?.scriptURL ?? "",
          ours: r.scope === appScope,
        };
      }),
    };
  } catch (err) {
    return { supported: true, controlled: !!sw.controller, registrations: [], error: errorText(err) };
  }
}

/**
 * Live, read-only snapshot of everything this site keeps in the browser. Never rejects; sections
 * that can't be read report `supported: false` or an `error`.
 */
export async function inspectStorage(): Promise<StorageInspection> {
  const origin = typeof location !== "undefined" ? location.origin : "";
  const [space, indexed, cacheReport, workers] = await Promise.all([
    inspectEstimate(),
    inspectIndexedDB().catch((err): IndexedDBReport => ({ supported: true, listed: false, databases: [], tables: null, error: errorText(err) })),
    inspectCaches(),
    inspectServiceWorkers(origin),
  ]);
  return {
    origin,
    checkedAt: Date.now(),
    secureContext: typeof window !== "undefined" && window.isSecureContext === true,
    estimate: space.estimate,
    persisted: space.persisted,
    indexedDB: indexed,
    localStorage: inspectWebStorage(() => window.localStorage),
    sessionStorage: inspectWebStorage(() => window.sessionStorage),
    cookies: inspectCookies(),
    cacheStorage: cacheReport,
    serviceWorker: workers,
  };
}
