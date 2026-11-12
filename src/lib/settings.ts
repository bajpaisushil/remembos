import { createStore, useStore } from "./store";

/** Small user preferences, persisted in localStorage (NOT user data — that lives in IndexedDB). */
export interface Settings {
  /** Use the local embedding model for meaning-based search. */
  semanticSearch: boolean;
  /** Transcribe dropped audio with local Whisper. */
  transcribeAudio: boolean;
  /** Tesseract language codes joined by '+', e.g. "eng" or "eng+deu". */
  ocrLanguages: string;
  /** Keep the original files (screenshots, PDFs, audio) — off = text only, saves space. */
  keepOriginals: boolean;
  theme: "system" | "light" | "dark";
  /** Dismissed the inline first-visit welcome tip (there is no blocking welcome dialog). */
  onboarded: boolean;
  lastBackupAt?: number;
  /** When every AI model was downloaded for offline use (set on app install / "Get ready for offline"). */
  offlinePreparedAt?: number;
  /** Already asked the browser for persistent storage. */
  persistAsked?: boolean;
  /** Toast keys the user snoozed → snoozed-until ms epoch. */
  snoozed: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  semanticSearch: true,
  transcribeAudio: true,
  ocrLanguages: "eng",
  keepOriginals: true,
  theme: "system",
  onboarded: false,
  snoozed: {},
};

const KEY = "remembos:settings:v1";

function load(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<Settings>(DEFAULT_SETTINGS);
let hydrated = false;

/** Load persisted settings into the store. Call once on the client (bootstrap does). */
export function hydrateSettings(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  settingsStore.set(load());
}

export function getSettings(): Settings {
  if (!hydrated) hydrateSettings();
  return settingsStore.get();
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...getSettings(), ...patch };
  settingsStore.set(next);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked / full — settings stay in memory for this session */
  }
}

export function useSettings(): Settings {
  return useStore(settingsStore);
}

/** Snooze a recurring toast for `days`. */
export function snooze(key: string, days: number): void {
  const s = getSettings();
  updateSettings({ snoozed: { ...s.snoozed, [key]: Date.now() + days * 86_400_000 } });
}

export function isSnoozed(key: string): boolean {
  const until = getSettings().snoozed[key];
  return typeof until === "number" && until > Date.now();
}
