"use client";

import Link from "next/link";
import {
  AtSign,
  Banknote,
  CalendarDays,
  Hash,
  Lightbulb,
  Link2,
  Phone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { toast } from "sonner";
import { ENTITY_META } from "@/lib/config";
import type { EntityType } from "@/lib/types";
import { cn, copyToClipboard, truncate } from "@/lib/utils";

/** The lucide icon used for each entity type. */
export const ENTITY_ICONS: Record<EntityType, LucideIcon> = {
  phone: Phone,
  email: AtSign,
  url: Link2,
  money: Banknote,
  date: CalendarDays,
  name: UserRound,
  topic: Lightbulb,
  tag: Hash,
};

export interface EntityChipProps {
  type: EntityType;
  value: string;
  /** Optional count bubble (e.g. number of memories mentioning it). */
  count?: number;
  /** Custom click behavior (replaces copy-to-clipboard). */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Render as a link instead (e.g. to a search). */
  href?: string;
  /** Copy the value on click (default true when neither onClick nor href is given). */
  copy?: boolean;
  /** Prefix the value with the type label ("Phone · …"). */
  showLabel?: boolean;
  size?: "sm" | "md";
  /** Max characters shown (full value stays in the tooltip). Default 48. */
  maxChars?: number;
  className?: string;
  "data-testid"?: string;
}

/** Colored pill for an extracted entity (phone, email, link, amount, date, name, topic, tag). */
export function EntityChip({
  type,
  value,
  count,
  onClick,
  href,
  copy,
  showLabel = false,
  size = "md",
  maxChars = 48,
  className,
  "data-testid": testId,
}: EntityChipProps) {
  const meta = ENTITY_META[type];
  const Icon = ENTITY_ICONS[type];
  const shouldCopy = copy ?? (!onClick && !href);
  const display = type === "tag" ? value.replace(/^#/, "") : value;

  const classes = cn(
    "group/chip inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border bg-white font-medium text-zinc-800",
    "border-zinc-200/90 shadow-[0_1px_0_0_rgb(0_0_0/0.02)] transition-[background-color,border-color,transform] duration-150",
    "hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98]",
    "dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
    size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
    className,
  );

  const inner = (
    <>
      <Icon aria-hidden className={cn("shrink-0", meta.color, size === "sm" ? "size-3" : "size-3.5")} strokeWidth={2.2} />
      {showLabel ? <span className="shrink-0 text-muted">{meta.label} ·</span> : null}
      <span className="min-w-0 truncate">{truncate(display, maxChars)}</span>
      {typeof count === "number" && count > 1 ? (
        <span className="ml-0.5 shrink-0 rounded-full bg-zinc-100 px-1.5 text-[10.5px] tabular-nums text-zinc-500 dark:bg-white/10 dark:text-zinc-400">
          {count}
        </span>
      ) : null}
    </>
  );

  const title = shouldCopy ? `${meta.label}: ${value} — click to copy` : `${meta.label}: ${value}`;

  if (href) {
    return (
      <Link href={href} className={classes} title={title} onClick={onClick} data-testid={testId}>
        {inner}
      </Link>
    );
  }

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (!shouldCopy) return;
    const ok = await copyToClipboard(value);
    if (ok) toast.success("Copied", { id: "entity-copied", description: truncate(value, 80), duration: 1800 });
    else toast.error("Couldn't copy", { id: "entity-copied", description: "Your browser blocked clipboard access. Select the text and copy it instead." });
  }

  return (
    <button
      type="button"
      className={classes}
      title={title}
      aria-label={shouldCopy ? `Copy ${meta.label.toLowerCase()} ${value}` : undefined}
      onClick={handleClick}
      data-testid={testId}
    >
      {inner}
    </button>
  );
}
