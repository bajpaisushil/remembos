// Theme helpers shared by the inline no-flash script (layout), Providers and the theme controls.
import { STORAGE_NAMES } from "@/lib/config";
import type { Settings } from "@/lib/settings";

export type ThemePreference = Settings["theme"];

/**
 * Runs synchronously in <head> before first paint: reads the saved theme preference from
 * localStorage and sets <html class="dark"> so there is no light/dark flash.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t="system";try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  STORAGE_NAMES.settingsKey,
)})||"null");if(s&&(s.theme==="light"||s.theme==="dark"))t=s.theme}catch(e){}var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** Apply a theme to <html>, suppressing color transitions for one frame so the switch is crisp. */
export function applyTheme(pref: ThemePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = resolveTheme(pref) === "dark";
  if (root.classList.contains("dark") === dark) return;
  root.setAttribute("data-theme-switching", "");
  root.classList.toggle("dark", dark);
  // Force a style flush, then re-enable transitions on the next frame.
  void root.offsetHeight;
  window.requestAnimationFrame(() => root.removeAttribute("data-theme-switching"));
}
