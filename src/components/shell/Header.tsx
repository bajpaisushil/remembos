"use client";

import { Camera, ChevronDown, ClipboardPaste, Mic, MonitorDown, Search, StickyNote, Upload } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/Kbd";
import { Logo } from "@/components/ui/Logo";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { Tooltip } from "@/components/ui/Tooltip";
import { ROUTES } from "@/lib/config";
import { paletteOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";
import { startCamera, startNote, startPaste, startRecording, startUpload, useIsTouchDevice, warmAddActions } from "./add-entry";
import { OfflinePill, PrivacyPill, StoragePill } from "./HeaderPills";
import { startInstall, useInstallOffer } from "./install-offer";
import { isNavActive, NAV_ITEMS } from "./nav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Sticky translucent app header: logo · nav (md+) · privacy & storage pills · search (⌘K) · Upload ▾ · theme.
 * While offline a small pill hangs just below it.
 */
export function Header() {
  const pathname = usePathname();

  return (
    <header className="glass sticky top-0 z-40 border-b border-zinc-200/60 pt-safe dark:border-white/[0.07]">
      {/* Installed on iPhone/iPad the status bar is translucent with white text: give it a backdrop it can be read
          on. Zero height everywhere else (no safe-area inset at the top). */}
      <div
        aria-hidden
        className="brand-gradient pointer-events-none fixed inset-x-0 top-0 z-50 h-[env(safe-area-inset-top,0px)] dark:bg-ink-950 dark:bg-none"
      />
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link
          href={ROUTES.home}
          aria-label="Remembos — home"
          className="-ml-1 shrink-0 rounded-xl p-1 transition-opacity hover:opacity-90"
          data-testid="header-logo"
        >
          <Logo size={30} />
        </Link>

        <nav aria-label="Main" className="ml-3 hidden items-center gap-0.5 md:flex lg:ml-6" data-testid="main-nav">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-testid={item.testId}
                className={cn(
                  "relative inline-flex h-9 items-center rounded-xl px-2 text-sm font-medium whitespace-nowrap transition-colors lg:px-3",
                  active
                    ? "text-zinc-900 dark:text-white"
                    : "text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white",
                  active &&
                    "bg-zinc-900/[0.05] after:absolute after:inset-x-3 after:-bottom-[14px] after:h-0.5 after:rounded-full after:bg-linear-to-r after:from-indigo-500 after:via-violet-500 after:to-fuchsia-500 dark:bg-white/[0.08]",
                )}
              >
                <span className="lg:hidden">{item.short}</span>
                <span className="hidden lg:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 min-[400px]:gap-1.5">
          <PrivacyPill />
          <div className="hidden sm:block md:hidden lg:block">
            <StoragePill />
          </div>

          <Tooltip
            content={
              <span className="inline-flex items-center gap-1.5">
                Search memories <Kbd keys={["mod", "k"]} />
              </span>
            }
            side="bottom"
            describe={false}
            className="xl:hidden"
          >
            <button
              type="button"
              onClick={() => paletteOpen.set(true)}
              aria-label="Search memories"
              aria-keyshortcuts="Control+K Meta+K /"
              data-testid="open-palette"
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl border text-sm transition-colors",
                "border-zinc-200/90 bg-white/70 text-zinc-500 hover:border-zinc-300 hover:bg-white hover:text-zinc-800",
                "dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:bg-white/10 dark:hover:text-zinc-100",
                "w-9 justify-center xl:w-44 xl:justify-start xl:pr-1.5 xl:pl-3",
              )}
            >
              <Search aria-hidden className="size-4 shrink-0" />
              <span className="hidden flex-1 text-left xl:inline">Search…</span>
              <span className="hidden xl:inline-flex">
                <Kbd keys={["mod", "k"]} />
              </span>
            </button>
          </Tooltip>

          <AddButtons />

          {/* Very narrow phones: the theme lives in the footer (and Your data) so the header never overflows. */}
          <div className="hidden min-[400px]:block">
            <ThemeToggle className="inline-flex size-9 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-[18px]" />
          </div>
        </div>
      </div>

      {/* Hangs just below the bar while offline, so it never crowds the header on any screen size. */}
      <div className="pointer-events-none absolute inset-x-0 top-full flex justify-center px-4 pt-2">
        <div className="pointer-events-auto">
          <OfflinePill />
        </div>
      </div>
    </header>
  );
}

/** Small tinted icon chip for the add menu. */
function MenuIcon({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn("grid size-8 place-items-center rounded-lg", className)}>{children}</span>;
}

/**
 * The primary action, split in two: **Upload** opens the file picker immediately (no menu first), and the
 * attached ▾ lists the other ways to add something — paste, record, take a photo (touch devices), a note,
 * and "Install app" when the browser allows it.
 */
function AddButtons() {
  const touch = useIsTouchDevice();
  const offerInstall = useInstallOffer();

  const items: MenuEntry[] = [
    {
      label: "Paste from clipboard",
      description: "Saves what you copied, instantly",
      icon: (
        <MenuIcon className="bg-sky-500/10 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300">
          <ClipboardPaste />
        </MenuIcon>
      ),
      shortcut: touch ? undefined : <Kbd keys={["mod", "v"]} />,
      onSelect: startPaste,
      "data-testid": "add-menu-paste",
    },
    {
      label: "Record voice",
      description: "Transcribed on this device",
      icon: (
        <MenuIcon className="bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300">
          <Mic />
        </MenuIcon>
      ),
      onSelect: startRecording,
      "data-testid": "add-menu-record",
    },
    ...(touch
      ? [
          {
            label: "Take photo",
            description: "Receipts, cards, whiteboards",
            icon: (
              <MenuIcon className="bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300">
                <Camera />
              </MenuIcon>
            ),
            onSelect: startCamera,
            "data-testid": "add-menu-camera",
          },
        ]
      : []),
    {
      label: "Add note",
      description: "Type a thought or decision",
      icon: (
        <MenuIcon className="bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300">
          <StickyNote />
        </MenuIcon>
      ),
      shortcut: touch ? undefined : <Kbd>N</Kbd>,
      onSelect: startNote,
      "data-testid": "add-menu-note",
    },
    ...(offerInstall
      ? ([
          { type: "separator" },
          {
            label: "Install app",
            description: "Own window, works offline",
            icon: (
              <MenuIcon className="bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
                <MonitorDown />
              </MenuIcon>
            ),
            onSelect: startInstall,
            "data-testid": "add-menu-install",
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  const half =
    "inline-flex h-9 items-center justify-center text-white transition-colors hover:bg-white/15 active:bg-black/10 dark:hover:bg-white/15";

  return (
    <div
      className="brand-gradient flex h-9 shrink-0 items-stretch rounded-xl shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_6px_20px_-8px_rgb(124_58_237/0.7)]"
      onPointerEnter={warmAddActions}
      onFocusCapture={warmAddActions}
    >
      <Tooltip content="Upload files — or drop them anywhere" side="bottom" align="end" describe={false} className="lg:hidden">
        <button
          type="button"
          onClick={() => startUpload()}
          aria-label="Upload files"
          data-testid="header-upload"
          className={cn(half, "w-9 gap-2 rounded-l-xl text-sm font-semibold lg:w-auto lg:pr-2.5 lg:pl-3.5 [&_svg]:size-4")}
        >
          <Upload aria-hidden strokeWidth={2.4} />
          <span className="hidden lg:inline">Upload</span>
        </button>
      </Tooltip>
      <span aria-hidden className="my-2 w-px bg-white/35" />
      <Menu
        label="More ways to add"
        align="end"
        items={items}
        data-testid="header-add-menu"
        triggerClassName={cn(half, "group/add w-7 rounded-r-xl aria-expanded:bg-white/15 [&_svg]:size-4")}
      >
        <ChevronDown aria-hidden strokeWidth={2.4} className="transition-transform duration-200 group-aria-expanded/add:rotate-180" />
      </Menu>
    </div>
  );
}
