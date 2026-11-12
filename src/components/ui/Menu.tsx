"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./Button";
import { fitToViewport } from "./internal";
import { useDismiss } from "./Popover";

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /** Right-aligned hint, e.g. a <Kbd>. */
  shortcut?: ReactNode;
  onSelect?: () => void;
  /** Navigate instead of calling onSelect. */
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Makes the item a radio-style choice (role="menuitemradio") with a check mark when true. */
  checked?: boolean;
  "data-testid"?: string;
}

export type MenuEntry = MenuItem | { type: "separator" } | { type: "label"; label: ReactNode };

export interface MenuProps {
  items: MenuEntry[];
  /** Accessible name of the trigger (and its visible text unless `iconOnly`). */
  label: string;
  /** Trigger icon, e.g. <MoreHorizontal />. */
  icon?: ReactNode;
  /** Show only the icon (label becomes aria-label). Default: true when an icon is given and no children. */
  iconOnly?: boolean;
  /** Custom trigger content (overrides label/icon rendering, label stays the aria-label). */
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: "start" | "end";
  side?: "bottom" | "top";
  triggerClassName?: string;
  /** Menu panel classes. */
  className?: string;
  "data-testid"?: string;
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return !("type" in entry);
}

function getMenuItems(list: HTMLElement | null): HTMLElement[] {
  return Array.from(list?.querySelectorAll<HTMLElement>(
      "[role=menuitem]:not([aria-disabled=true]), [role=menuitemradio]:not([aria-disabled=true])",
    ) ?? []);
}

/**
 * Button + dropdown list. Keyboard: Enter/Space/↓ opens, ↑/↓/Home/End move, Enter selects, Esc/Tab closes.
 *
 * @example <Menu label="More actions" icon={<MoreHorizontal />} align="end"
 *            items={[{ label: "Rename", icon: <Pencil />, onSelect: rename }, { type: "separator" },
 *                    { label: "Delete", icon: <Trash2 />, danger: true, onSelect: remove }]} />
 */
export function Menu({
  items,
  label,
  icon,
  iconOnly,
  children,
  variant = "ghost",
  size,
  align = "start",
  side = "bottom",
  triggerClassName,
  className,
  "data-testid": testId,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<"first" | "last">("first");
  const menuId = useId();
  const triggerId = `${menuId}-trigger`;
  const showIconOnly = iconOnly ?? (Boolean(icon) && !children);
  const triggerSize: ButtonSize = size ?? (showIconOnly ? "icon" : "md");

  const close = useCallback((opts?: { restoreFocus?: boolean }) => {
    setOpen(false);
    if (opts?.restoreFocus) triggerRef.current?.focus();
  }, []);
  useDismiss(open, close, rootRef);

  useLayoutEffect(() => {
    if (open && listRef.current && triggerRef.current) fitToViewport(listRef.current, triggerRef.current);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = getMenuItems(listRef.current);
    const target = focusOnOpen.current === "last" ? list[list.length - 1] : list[0];
    (target ?? listRef.current)?.focus({ preventScroll: true });
  }, [open]);

  function openWith(where: "first" | "last") {
    focusOnOpen.current = where;
    setOpen(true);
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openWith("first");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openWith("last");
    }
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = getMenuItems(listRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = list[(index + 1) % list.length];
    else if (e.key === "ArrowUp") next = list[(index - 1 + list.length) % list.length];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const ch = e.key.toLowerCase();
      const ordered = [...list.slice(index + 1), ...list.slice(0, index + 1)];
      next = ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(ch));
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    close({ restoreFocus: true });
    item.onSelect?.();
  }

  const itemClasses = (item: MenuItem) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors",
      "[&_svg]:size-4 [&_svg]:shrink-0",
      item.disabled
        ? "cursor-not-allowed opacity-45"
        : item.danger
          ? "text-rose-600 hover:bg-rose-500/10 focus-visible:bg-rose-500/10 focus:bg-rose-500/10 dark:text-rose-400"
          : "text-zinc-700 hover:bg-zinc-900/5 hover:text-zinc-900 focus:bg-zinc-900/5 focus:text-zinc-900 dark:text-zinc-200 dark:hover:bg-white/10 dark:hover:text-white dark:focus:bg-white/10 dark:focus:text-white",
    );

  const itemBody = (item: MenuItem) => (
    <>
      {item.icon ? <span className={cn("flex", !item.danger && "text-zinc-400 dark:text-zinc-500")}>{item.icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.label}</span>
        {item.description ? <span className="mt-0.5 block text-xs leading-snug text-muted">{item.description}</span> : null}
      </span>
      {item.shortcut ? <span className="ml-3 shrink-0 text-xs text-muted">{item.shortcut}</span> : null}
      {typeof item.checked === "boolean" ? (
        <Check aria-hidden className={cn("ml-2 text-brand-600 dark:text-brand-300", item.checked ? "opacity-100" : "opacity-0")} />
      ) : null}
    </>
  );

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={showIconOnly || children ? label : undefined}
        data-testid={testId}
        onClick={() => (open ? close() : openWith("first"))}
        onKeyDown={onTriggerKeyDown}
        className={triggerClassName ?? buttonClasses({ variant, size: triggerSize })}
      >
        {children ?? (
          <>
            {icon}
            {showIconOnly ? null : label}
          </>
        )}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className={cn(
            "absolute z-50 flex w-max min-w-52 max-w-[min(20rem,calc(100vw-2rem))] animate-pop-in flex-col rounded-2xl border p-1.5 shadow-pop outline-none",
            "border-zinc-200/80 bg-elevated dark:border-white/10",
            side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
        >
          {items.map((entry, i) => {
            if (!isItem(entry)) {
              if (entry.type === "separator") {
                return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-zinc-200/80 dark:bg-white/10" />;
              }
              return (
                <div key={`label-${i}`} role="presentation" className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  {entry.label}
                </div>
              );
            }
            if (entry.href && !entry.disabled) {
              return (
                <Link
                  key={i}
                  href={entry.href}
                  role="menuitem"
                  tabIndex={-1}
                  className={itemClasses(entry)}
                  data-testid={entry["data-testid"]}
                  onClick={() => select(entry)}
                >
                  {itemBody(entry)}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role={typeof entry.checked === "boolean" ? "menuitemradio" : "menuitem"}
                aria-checked={typeof entry.checked === "boolean" ? entry.checked : undefined}
                tabIndex={-1}
                aria-disabled={entry.disabled || undefined}
                className={itemClasses(entry)}
                data-testid={entry["data-testid"]}
                onClick={() => select(entry)}
              >
                {itemBody(entry)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
