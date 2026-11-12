"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { addSheetOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { openSheet, warmAddActions } from "./add-entry";
import { isNavActive, NAV_ITEMS, type NavItem } from "./nav";

/**
 * Bottom tab bar for phones and small tablets (hidden from md up). Safe-area aware.
 * Home · Search · raised + (opens the add sheet) · Library · Your data.
 */
export function MobileNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.mobile);
  const middle = Math.ceil(items.length / 2);

  return (
    <>
      {/* Spacer so page content and the footer never hide behind the fixed bar. */}
      <div aria-hidden className="h-[var(--app-bottom-inset)] md:hidden" />
      <nav
        aria-label="Main"
        data-testid="mobile-nav"
        className="glass fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/70 pb-safe md:hidden dark:border-white/[0.08]"
      >
        <ul className="mx-auto grid h-[var(--mobile-nav-h)] max-w-lg grid-cols-5 px-1">
          {items.slice(0, middle).map((item) => (
            <Tab key={item.href} item={item} active={isNavActive(item, pathname)} />
          ))}
          <li className="flex">
            <AddButton />
          </li>
          {items.slice(middle).map((item) => (
            <Tab key={item.href} item={item} active={isNavActive(item, pathname)} />
          ))}
        </ul>
      </nav>
    </>
  );
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <li className="flex">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        data-testid={`mobile-${item.testId}`}
        className={cn(
          "group flex flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium transition-colors",
          "focus-visible:-outline-offset-4",
          active ? "text-brand-700 dark:text-brand-200" : "text-zinc-500 active:text-zinc-900 dark:text-zinc-400 dark:active:text-white",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-12 place-items-center rounded-full transition-[background-color,transform] duration-200 ease-spring",
            active ? "bg-brand-500/12 dark:bg-brand-400/15" : "group-active:scale-90",
          )}
        >
          <Icon aria-hidden className="size-[20px]" strokeWidth={active ? 2.3 : 1.9} />
        </span>
        {item.short}
      </Link>
    </li>
  );
}

/** The raised gradient + in the middle of the tab bar. */
function AddButton() {
  const open = useStore(addSheetOpen);
  return (
    <button
      type="button"
      onClick={openSheet}
      onPointerDown={warmAddActions}
      aria-label="Add to memory"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="mobile-add"
      className={cn(
        "group relative flex flex-1 flex-col items-center justify-end rounded-2xl pb-[9px] text-[11px] font-semibold",
        "text-zinc-700 focus-visible:-outline-offset-4 dark:text-zinc-200",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "brand-gradient absolute -top-4 left-1/2 grid size-[52px] -translate-x-1/2 place-items-center rounded-full text-white",
          "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3),0_10px_24px_-8px_rgb(124_58_237/0.75)] ring-[5px] ring-canvas",
          "transition-transform duration-200 ease-spring group-active:scale-90 motion-reduce:transition-none",
        )}
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-linear-to-b from-white/25 to-transparent" />
        <Plus
          className={cn("relative size-6 transition-transform duration-200 ease-spring", open && "rotate-45")}
          strokeWidth={2.6}
        />
      </span>
      Add
    </button>
  );
}
