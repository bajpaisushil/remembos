"use client";

import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** true on Apple platforms (client only; false during prerender). */
export function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function useModKeyLabel(): string {
  return useIsMac() ? "⌘" : "Ctrl";
}

function keyLabel(key: string, mac: boolean): string {
  switch (key.toLowerCase()) {
    case "mod":
      return mac ? "⌘" : "Ctrl";
    case "cmd":
    case "meta":
      return mac ? "⌘" : "Win";
    case "ctrl":
      return mac ? "⌃" : "Ctrl";
    case "alt":
    case "option":
      return mac ? "⌥" : "Alt";
    case "shift":
      return mac ? "⇧" : "Shift";
    case "enter":
    case "return":
      return "↵";
    case "esc":
    case "escape":
      return "Esc";
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "left":
      return "←";
    case "right":
      return "→";
    case "tab":
      return "Tab";
    case "space":
      return "Space";
    case "backspace":
      return "⌫";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

export interface KbdProps {
  /** A single key; "mod" renders ⌘ on Mac and Ctrl elsewhere. */
  children?: ReactNode;
  /** A combination, e.g. ["mod", "k"] → ⌘ K. Named keys: mod, shift, alt, ctrl, enter, esc, up, down… */
  keys?: string[];
  size?: "sm" | "md";
  className?: string;
}

/** Keyboard key hint. */
export function Kbd({ children, keys, size = "sm", className }: KbdProps) {
  const mac = useIsMac();
  const cls = cn(
    "inline-flex items-center justify-center rounded-md border font-sans font-medium leading-none",
    "border-zinc-200 bg-white text-zinc-500 shadow-[0_1px_0_0_rgb(0_0_0/0.06)]",
    "dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-400 dark:shadow-none",
    size === "sm" ? "h-5 min-w-5 px-1 text-[11px]" : "h-6 min-w-6 px-1.5 text-xs",
  );
  if (keys?.length) {
    return (
      <span className={cn("inline-flex items-center gap-0.5", className)}>
        {keys.map((k, i) => (
          <Fragment key={`${k}-${i}`}>
            <kbd className={cls}>{keyLabel(k, mac)}</kbd>
          </Fragment>
        ))}
      </span>
    );
  }
  const content = typeof children === "string" ? keyLabel(children, mac) : children;
  return <kbd className={cn(cls, className)}>{content}</kbd>;
}
