/**
 * Canvas colors for the graph in light and dark mode. The app toggles `html.dark`; the engine reads
 * it when it starts and whenever that class changes.
 */

export interface Palette {
  dark: boolean;
  link: string;
  linkSimilar: string;
  linkHighlight: string;
  linkSimilarHighlight: string;
  linkDim: string;
  /** Thin ring around nodes that separates them from links and each other. */
  outline: string;
  text: string;
  textMuted: string;
  labelBg: string;
  labelBorder: string;
  /** Selection ring and its soft halo. */
  ring: string;
  ringSoft: string;
  hoverRing: string;
  /** Opacity of the glow behind memory nodes. */
  glowAlpha: number;
  /** Opacity of nodes outside the highlighted neighbourhood. */
  dimAlpha: number;
}

export const LIGHT_PALETTE: Palette = {
  dark: false,
  link: "rgba(82, 82, 120, 0.2)",
  linkSimilar: "rgba(139, 92, 246, 0.42)",
  linkHighlight: "rgba(124, 58, 237, 0.75)",
  linkSimilarHighlight: "rgba(124, 58, 237, 0.85)",
  linkDim: "rgba(82, 82, 120, 0.06)",
  outline: "#ffffff",
  text: "#18181b",
  textMuted: "#4b4b57",
  labelBg: "rgba(255, 255, 255, 0.88)",
  labelBorder: "rgba(24, 24, 27, 0.08)",
  ring: "#7c3aed",
  ringSoft: "rgba(124, 58, 237, 0.2)",
  hoverRing: "rgba(24, 24, 27, 0.45)",
  glowAlpha: 0.32,
  dimAlpha: 0.16,
};

export const DARK_PALETTE: Palette = {
  dark: true,
  link: "rgba(200, 200, 255, 0.15)",
  linkSimilar: "rgba(196, 181, 253, 0.42)",
  linkHighlight: "rgba(196, 181, 253, 0.85)",
  linkSimilarHighlight: "rgba(216, 180, 254, 0.95)",
  linkDim: "rgba(200, 200, 255, 0.045)",
  outline: "#12121c",
  text: "#f4f4f6",
  textMuted: "#c9c9d6",
  labelBg: "rgba(14, 14, 24, 0.82)",
  labelBorder: "rgba(255, 255, 255, 0.08)",
  ring: "#a78bfa",
  ringSoft: "rgba(167, 139, 250, 0.28)",
  hoverRing: "rgba(255, 255, 255, 0.55)",
  glowAlpha: 0.55,
  dimAlpha: 0.14,
};

export function isDarkMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function readPalette(): Palette {
  return isDarkMode() ? DARK_PALETTE : LIGHT_PALETTE;
}

/** "#8b5cf6" + alpha → "rgba(139, 92, 246, a)". */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(139, 92, 246, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
