/**
 * Plain-language copy for the "Where your data lives" page. Storage names always come from
 * `STORAGE_NAMES` (config), so the page stays in sync with what the app really uses.
 */
import {
  AppWindow,
  Archive,
  Boxes,
  Cookie,
  Database,
  Globe,
  Languages,
  NotebookPen,
  SlidersHorizontal,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { MODELS, STORAGE_NAMES } from "@/lib/config";
import type { RemembosTable } from "@/lib/storage-inspect";
import { formatBytes } from "@/lib/utils";

export type MediumId = "vault" | "ocr" | "models" | "shell" | "local" | "session" | "cookies" | "http";

/** What clearing a medium means for the user. */
export type ClearImpact = "danger" | "caution" | "safe";

/** Chip tint for each medium's icon. */
export type MediumTone = "brand" | "violet" | "sky" | "teal" | "amber" | "zinc" | "rose";

export interface MediumCopy {
  id: MediumId;
  title: string;
  /** Technical name of the browser feature. */
  tech: string;
  /** Exact database / key / cache names, from STORAGE_NAMES. */
  names: string[];
  icon: LucideIcon;
  tone: MediumTone;
  summary: string;
  ifCleared: { impact: ClearImpact; text: string };
}

export const MEDIA: MediumCopy[] = [
  {
    id: "vault",
    title: "Your memory vault",
    tech: "IndexedDB",
    names: [STORAGE_NAMES.appDb],
    icon: Database,
    tone: "brand",
    summary:
      "IndexedDB is a database built into every modern browser. Remembos keeps everything you add in one database called “remembos” — your original files, the text read from them, and everything that makes search fast. Files live only here: Remembos never makes a second copy elsewhere.",
    ifCleared: { impact: "danger", text: "Every memory is erased from this browser. Only a backup file can bring them back." },
  },
  {
    id: "ocr",
    title: "Text-reader language files",
    tech: "IndexedDB",
    names: [STORAGE_NAMES.ocrDb],
    icon: Languages,
    tone: "violet",
    summary:
      "The first time you add a screenshot, scanned PDF or video, the text reader downloads its language data once and keeps it in a small database called “keyval-store”. None of your memories are in it.",
    ifCleared: { impact: "safe", text: "Nothing is lost. The language data downloads again the next time it's needed." },
  },
  {
    id: "models",
    title: "AI model files",
    tech: "Cache Storage",
    names: [...STORAGE_NAMES.modelCaches],
    icon: Sparkles,
    tone: "sky",
    summary: `Meaning search (about ${formatBytes(MODELS.embedder.approxBytes, 0)}) and the voice transcriber (about ${formatBytes(MODELS.whisper.approxBytes, 0)}, only if you add recordings or videos) are small AI models that run on your device. They download once from public servers and wait here, so they work offline afterwards.`,
    ifCleared: { impact: "safe", text: "Nothing is lost. Models download again when you next need them — keyword search keeps working meanwhile." },
  },
  {
    id: "shell",
    title: "Offline copy of the app",
    tech: "Cache Storage",
    names: [`${STORAGE_NAMES.swCachePrefix}…`, STORAGE_NAMES.shareCache],
    icon: AppWindow,
    tone: "teal",
    summary:
      "A small helper called a “service worker” saves Remembos's own pages and code, so the app opens even without internet. When you share something to the installed app on Android, it waits in a short-lived “remembos-share” inbox for a moment until it's saved as a memory.",
    ifCleared: { impact: "safe", text: "Nothing is lost. The app just needs a connection the next time you open it (and a share still in the inbox would need sharing again)." },
  },
  {
    id: "local",
    title: "Your preferences",
    tech: "localStorage",
    names: [STORAGE_NAMES.settingsKey],
    icon: SlidersHorizontal,
    tone: "amber",
    summary:
      "localStorage is a tiny notepad every website gets. Remembos keeps a single entry there with your settings — theme, search options, when you last backed up. Never your memories.",
    ifCleared: { impact: "caution", text: "Settings go back to their defaults and backup reminders start over. Your memories are untouched." },
  },
  {
    id: "session",
    title: "Per-tab notes",
    tech: "sessionStorage",
    names: [`${STORAGE_NAMES.keyPrefix}session:…`],
    icon: NotebookPen,
    tone: "zinc",
    summary:
      "sessionStorage works like localStorage but is forgotten when you close the tab. Remembos only notes which tips it has already shown, so they don't pop up again when you reload.",
    ifCleared: { impact: "safe", text: "Nothing important — a tip might show once more." },
  },
  {
    id: "http",
    title: "Browser cache",
    tech: "HTTP cache",
    names: ["Cached images and files"],
    icon: Globe,
    tone: "zinc",
    summary:
      "Every browser keeps recent downloads of website code and pictures to load pages faster. For Remembos it holds app code only — never your data — and web pages can't look inside it.",
    ifCleared: { impact: "safe", text: "Nothing is lost. Pages may load a little slower once." },
  },
  {
    id: "cookies",
    title: "Cookies",
    tech: "Cookies",
    names: [],
    icon: Cookie,
    tone: "rose",
    summary:
      "Cookies are small notes websites send along with every visit, mostly for logins and tracking. Remembos sets none — there's no account to log into and nothing to track.",
    ifCleared: {
      impact: "danger",
      text: "Cookies alone change nothing for Remembos — but the usual “Cookies and site data” option also erases your memory vault.",
    },
  },
];

/** The tables inside the "remembos" database, in plain words. */
export const VAULT_TABLES: { table: RemembosTable; title: string; text: string; icon: LucideIcon }[] = [
  { table: "items", title: "Memories", text: "Each memory's title, the text read from it, dates and tags.", icon: Archive },
  { table: "files", title: "Original files", text: "Your screenshots, PDFs, videos and recordings, exactly as added.", icon: Boxes },
  { table: "thumbs", title: "Previews", text: "Small pictures for the library and search results.", icon: AppWindow },
  { table: "chunks", title: "Search pieces", text: "Text cut into short passages, each with a “meaning fingerprint” for search.", icon: Sparkles },
  { table: "entities", title: "Things found", text: "Phone numbers, emails, links, amounts, dates, names and topics.", icon: Languages },
  { table: "meta", title: "Housekeeping", text: "A few notes Remembos keeps for itself, like which memories are samples.", icon: NotebookPen },
];

export interface ChecklistEntry {
  title: string;
  detail: string;
}

/** Actions that erase memories (ARCHITECTURE §9). */
export const ERASES: ChecklistEntry[] = [
  {
    title: "Clearing browsing data with “Cookies and other site data” ticked",
    detail:
      "Chrome, Edge and Brave call it “Cookies and other site data”, Firefox “Cookies and site data”, Safari “Remove All Website Data”. Even a short range like “Last hour” can include Remembos.",
  },
  {
    title: "Safari's “Clear History”",
    detail:
      "In Safari, clearing history also removes website data — on Mac (History → Clear History…) and on iPhone or iPad (Settings → Safari → Clear History and Website Data).",
  },
  {
    title: "Deleting this site's data in site settings",
    detail:
      "The icon at the left of the address bar → Site settings or Cookies and site data → “Delete data” / “Clear data”. In Firefox: “Clear cookies and site data…”.",
  },
  {
    title: "Firefox's “Forget About This Site”",
    detail: "In History, right-clicking a Remembos page and choosing Forget About This Site wipes everything it stored.",
  },
  {
    title: "Closing a private or incognito window",
    detail: "Private windows keep nothing. Everything added there disappears the moment the window closes.",
  },
  {
    title: "Safari's 7-day rule",
    detail:
      "Safari — and every browser on iPhone and iPad — may delete a site's data after 7 days of browsing without opening that site. Installed apps on the Home Screen or Dock are exempt.",
  },
  {
    title: "Running out of disk space",
    detail:
      "When a device is nearly full, browsers quietly clear sites that aren't marked “keep”. Asking the browser to keep Remembos's data (below) protects you.",
  },
  {
    title: "Clean-up apps and “clear on exit” settings",
    detail:
      "CCleaner, BleachBit, CleanMyMac, antivirus clean-ups, privacy extensions, and options like “Delete cookies and site data when you close all windows”.",
  },
  {
    title: "Resetting or removing your browser profile",
    detail:
      "Resetting the browser, deleting a profile, or signing out and choosing to remove data from this device. A different profile also has its own, separate vault.",
  },
  {
    title: "Uninstalling the browser and its data",
    detail: "Uninstallers on Windows and Android often offer to delete browsing data; Mac clean-up tools remove it too.",
  },
  {
    title: "Clearing the browser app's storage on a phone",
    detail: "Android: Settings → Apps → your browser → Storage → Clear storage. iPhone and iPad: deleting the browser app.",
  },
  {
    title: "Deleting, moving or editing the folders above",
    detail: "They're binary databases. Even renaming a single file can corrupt the whole vault.",
  },
];

/** Actions that leave memories alone. */
export const SAFE: ChecklistEntry[] = [
  {
    title: "Clearing browsing history only",
    detail: "In Chrome, Edge, Firefox, Brave and Opera — as long as cookies / site data stays unticked. (Not in Safari — see the list on the left.)",
  },
  {
    title: "Clearing “Cached images and files”",
    detail: "That's the HTTP cache: copies of website code and pictures, never your memories.",
  },
  {
    title: "Clearing passwords, autofill or download history",
    detail: "None of these touch site data.",
  },
  {
    title: "Closing the tab or the whole browser",
    detail: "In a normal window your memories stay put and are there next time.",
  },
  {
    title: "Restarting or updating your browser or computer",
    detail: "Updates keep site data where it is.",
  },
  {
    title: "Updating Remembos",
    detail: "New versions open the very same vault.",
  },
  {
    title: "Removing downloaded AI models in Your data",
    detail: "They download again when needed; memories stay.",
  },
];

export type DevToolsFamily = "chromium" | "firefox" | "safari" | "mobile";
