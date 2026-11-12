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
  /** The text reader's languages were set from this device's language/region once (never overrides a choice). */
  ocrDefaultsApplied?: boolean;
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

/** Browser language → Tesseract language (only scripts English OCR can't read; adds nothing for English users). */
const OCR_FOR_LOCALE: Record<string, string> = {
  hi: "hin", mr: "mar", ne: "nep", bn: "ben", as: "asm", pa: "pan", gu: "guj", or: "ori", ta: "tam", te: "tel",
  kn: "kan", ml: "mal", ur: "urd", ar: "ara", fa: "fas", he: "heb", ru: "rus", uk: "ukr", el: "ell", th: "tha",
  zh: "chi_sim", ja: "jpn", ko: "kor",
};

/** Device in India (time zone) → read Hindi too: most scanned documents there mix Hindi and English. */
function inIndia(): boolean {
  try {
    return /^Asia\/(Kolkata|Calcutta)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** "eng" plus the browser's own language when English OCR can't read that script, plus Hindi in India. */
function defaultOcrLanguages(): string {
  try {
    const langs = new Set(["eng"]);
    if (inIndia()) langs.add("hin");
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = (tag || "").toLowerCase();
      const code = base.startsWith("zh-tw") || base.startsWith("zh-hk") ? "chi_tra" : OCR_FOR_LOCALE[base.split("-")[0]];
      if (code) langs.add(code);
      if (langs.size >= 3) break;
    }
    return [...langs].join("+");
  } catch {
    return DEFAULT_SETTINGS.ocrLanguages;
  }
}

function load(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    // First run (or a version that always started with English only): read this device's language/region too.
    if (!saved.ocrDefaultsApplied) {
      if (!saved.ocrLanguages || saved.ocrLanguages === "eng") saved.ocrLanguages = defaultOcrLanguages();
      saved.ocrDefaultsApplied = true;
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...saved }));
      } catch {
        /* storage blocked — applied for this session only */
      }
    }
    return { ...DEFAULT_SETTINGS, ...saved };
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
