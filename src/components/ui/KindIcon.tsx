import { Clapperboard, ClipboardType, FileText, ImageIcon, Mic, StickyNote, type LucideIcon } from "lucide-react";
import { KIND_HEX, KIND_META } from "@/lib/config";
import type { MemoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The lucide icon used for each memory kind — use these everywhere for consistency. */
export const KIND_ICONS: Record<MemoryKind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
  video: Clapperboard,
  voice: Mic,
  text: ClipboardType,
  note: StickyNote,
};

export type KindIconSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<KindIconSize, { box: string; icon: string; glow: boolean }> = {
  xs: { box: "size-5 rounded-md", icon: "size-3", glow: false },
  sm: { box: "size-7 rounded-lg", icon: "size-3.5", glow: false },
  md: { box: "size-9 rounded-xl", icon: "size-[18px]", glow: false },
  lg: { box: "size-11 rounded-[14px]", icon: "size-5", glow: true },
  xl: { box: "size-14 rounded-2xl", icon: "size-7", glow: true },
};

export interface KindIconProps {
  kind: MemoryKind;
  /** xs 20px · sm 28px · md 36px (default) · lg 44px · xl 56px */
  size?: KindIconSize;
  className?: string;
  /** Accessible label; omit when the kind is spelled out next to it (decorative). */
  label?: string;
}

/** Gradient chip with the kind's icon (image violet, pdf rose, video blue, voice amber, text sky, note emerald). */
export function KindIcon({ kind, size = "md", className, label }: KindIconProps) {
  const Icon = KIND_ICONS[kind];
  const s = SIZES[size];
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center bg-linear-to-br text-white ring-1 ring-inset ring-white/25",
        KIND_META[kind].gradient,
        s.box,
        className,
      )}
      style={s.glow ? { boxShadow: `0 8px 20px -8px ${KIND_HEX[kind]}b3` } : undefined}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-white/25 to-transparent" />
      <Icon className={cn("relative drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]", s.icon)} strokeWidth={2.1} />
    </span>
  );
}

export interface KindBadgeProps {
  kind: MemoryKind;
  size?: "sm" | "md";
  /** Override the text (defaults to KIND_META[kind].label, e.g. "Screenshot"). */
  label?: string;
  className?: string;
}

/** Tinted pill with the kind's icon + label. */
export function KindBadge({ kind, size = "md", label, className }: KindBadgeProps) {
  const Icon = KIND_ICONS[kind];
  const meta = KIND_META[kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        meta.bg,
        meta.color,
        meta.ring,
        className,
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} strokeWidth={2.2} />
      {label ?? meta.label}
    </span>
  );
}
