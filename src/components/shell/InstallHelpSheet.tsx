"use client";

import { Bookmark, ChevronLeft, ChevronRight, CircleCheck, Copy, Globe, MonitorDown, Share, SquarePlus, Wifi, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LogoMark } from "@/components/ui/Logo";
import { installState, isIOSDevice, promptInstall } from "@/lib/pwa";
import { detectBrowser } from "@/lib/storage/monitor";
import { useStore } from "@/lib/store";
import { installHelpOpen } from "@/lib/ui-state";
import { cn } from "@/lib/utils";

type GuideId = "chrome" | "edge" | "safari-mac" | "android" | "firefox";

interface InstallEnv {
  ios: boolean;
  /** The guide that matches this browser (null when we can't tell). */
  guide: GuideId | null;
}

function detectEnv(): InstallEnv {
  if (typeof navigator === "undefined") return { ios: false, guide: null };
  if (isIOSDevice()) return { ios: true, guide: null };
  if (/Android/i.test(navigator.userAgent)) return { ios: false, guide: "android" };
  switch (detectBrowser()) {
    case "edge":
      return { ios: false, guide: "edge" };
    case "chrome":
    case "brave":
    case "opera":
      return { ios: false, guide: "chrome" };
    case "safari":
      return { ios: false, guide: "safari-mac" };
    case "firefox":
      return { ios: false, guide: "firefox" };
    case "samsung":
      return { ios: false, guide: "android" };
    default:
      return { ios: false, guide: null };
  }
}

const close = () => installHelpOpen.set(false);

/**
 * "Install Remembos" sheet (driven by `installHelpOpen`). iPhone/iPad: illustrated Share → Add to Home Screen →
 * Add. Browsers that offered an install prompt: one "Install now" button. Everything else: short steps per
 * browser, with this browser's opened first (Firefox on computers can't install — keep using the tab).
 * Loaded on first use by `InstallHelpDialog`.
 */
export function InstallHelpSheet() {
  const open = useStore(installHelpOpen);
  const { installed, canInstall } = useStore(installState);
  // Detected once per opening, on the client (the dialog never renders while prerendering).
  const [env, setEnv] = useState<InstallEnv | null>(null);
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) setEnv(detectEnv());
  }

  const view = installed ? "installed" : env?.ios ? "ios" : canInstall ? "prompt" : "generic";

  return (
    <Dialog
      open={open}
      onClose={close}
      title={view === "installed" ? "Remembos is installed" : "Install Remembos"}
      description={
        view === "installed"
          ? "You're using the app version right now."
          : "Get an app icon, its own window and offline start-up. Your memories stay on this device."
      }
      icon={<LogoMark size={44} className="drop-shadow-[0_6px_16px_rgb(139_92_246/0.35)]" />}
      size="md"
      swipeToClose
      data-testid="install-help"
      footer={
        view === "prompt" ? (
          <>
            <Button variant="ghost" onClick={close}>
              Not now
            </Button>
            <Button
              leftIcon={<MonitorDown />}
              data-testid="install-now"
              onClick={() => {
                // prompt() must run inside this click; promptInstall calls it before its first await.
                void promptInstall();
                close();
              }}
            >
              Install now
            </Button>
          </>
        ) : (
          <Button variant={view === "installed" ? "primary" : "secondary"} onClick={close}>
            {view === "installed" ? "Great" : "Done"}
          </Button>
        )
      }
    >
      {view === "installed" ? (
        <Installed />
      ) : view === "ios" ? (
        <IOSSteps />
      ) : view === "prompt" ? (
        <PromptReady />
      ) : (
        <GenericSteps current={env?.guide ?? null} />
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const BENEFITS: { icon: LucideIcon; text: string }[] = [
  { icon: MonitorDown, text: "Opens from your home screen, dock or app list — in its own window." },
  { icon: Wifi, text: "Starts even without internet. Everything you saved works offline." },
  { icon: CircleCheck, text: "Browsers keep an installed app's data more reliably." },
];

function Benefits() {
  return (
    <ul className="space-y-2.5">
      {BENEFITS.map(({ icon: Icon, text }) => (
        <li key={text} className="flex gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-200">
            <Icon aria-hidden className="size-4" />
          </span>
          <span className="pt-1 leading-snug">{text}</span>
        </li>
      ))}
    </ul>
  );
}

function Installed() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 text-sm text-emerald-900 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100">
      <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-300" />
      <p className="leading-relaxed">
        Remembos is already on this device. Open it from your home screen, dock or app list any time — it works offline too.
      </p>
    </div>
  );
}

function PromptReady() {
  return (
    <div className="space-y-4">
      <Benefits />
      <p className="text-[13px] text-muted">Your browser will ask you to confirm. It takes a second and uses almost no space.</p>
    </div>
  );
}

function IOSSteps() {
  return (
    <div className="space-y-5" data-testid="install-help-ios">
      <ol className="space-y-4">
        <Step n={1} title="Tap the Share button" hint="In Safari it's in the bar at the bottom (top right on iPad). In Chrome, it's next to the address bar.">
          <IllustrationToolbar />
        </Step>
        <Step n={2} title="Choose “Add to Home Screen”" hint="Scroll the list if you don't see it right away.">
          <IllustrationShareSheet />
        </Step>
        <Step n={3} title="Tap “Add”" hint="Remembos now opens from your Home Screen like any other app.">
          <IllustrationConfirm />
        </Step>
      </ol>
      <p className="rounded-2xl bg-amber-500/[0.08] px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
        <strong className="font-semibold">Why it matters on iPhone and iPad:</strong> Safari can clear a website&apos;s data after
        7 days without a visit. Opened from the Home Screen, Remembos keeps your memories far more reliably.
      </p>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5">
      <span className="brand-gradient grid size-7 place-items-center rounded-full text-[13px] font-semibold text-white shadow-[0_6px_14px_-6px_rgb(124_58_237/0.7)]">
        {n}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[15px] font-semibold text-zinc-900 dark:text-white">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">{hint}</p>
      </div>
      <div className="col-start-2" aria-hidden>
        {children}
      </div>
    </li>
  );
}

// ---------- Simple illustrations (decorative) ----------

const frame =
  "overflow-hidden rounded-2xl border border-zinc-200/80 bg-zinc-50 shadow-soft dark:border-white/10 dark:bg-white/[0.04]";
const highlight = "relative rounded-xl text-[#0a84ff] ring-2 ring-[#0a84ff]/60 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-ink-800";

function IllustrationToolbar() {
  return (
    <div className={cn(frame, "px-3 pt-2.5 pb-3")}>
      <div className="mb-3 flex h-7 items-center justify-center rounded-lg bg-white text-[11px] text-zinc-400 dark:bg-white/[0.06] dark:text-zinc-500">
        <Globe className="mr-1.5 size-3" />
        remembos.app
      </div>
      <div className="flex items-center justify-between px-2 text-zinc-400 dark:text-zinc-500">
        <ChevronLeft className="size-5" />
        <ChevronRight className="size-5" />
        <span className={cn(highlight, "grid size-9 place-items-center")}>
          <span className="absolute inset-0 animate-ping rounded-xl bg-[#0a84ff]/15 motion-reduce:hidden" />
          <Share className="relative size-5" strokeWidth={2.2} />
        </span>
        <Bookmark className="size-5" />
        <Copy className="size-5" />
      </div>
    </div>
  );
}

function IllustrationShareSheet() {
  const rows: { label: string; icon: LucideIcon; on?: boolean }[] = [
    { label: "Copy", icon: Copy },
    { label: "Add to Home Screen", icon: SquarePlus, on: true },
    { label: "Add Bookmark", icon: Bookmark },
  ];
  return (
    <div className={cn(frame, "p-2")}>
      <ul className="divide-y divide-zinc-200/80 overflow-hidden rounded-xl bg-white dark:divide-white/[0.08] dark:bg-white/[0.06]">
        {rows.map(({ label, icon: Icon, on }) => (
          <li
            key={label}
            className={cn(
              "flex items-center justify-between px-3 py-2 text-[13px]",
              on ? "bg-[#0a84ff]/10 font-semibold text-zinc-900 dark:bg-[#0a84ff]/20 dark:text-white" : "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {label}
            <Icon className={cn("size-4", on && "text-[#0a84ff]")} strokeWidth={on ? 2.3 : 1.9} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function IllustrationConfirm() {
  return (
    <div className={cn(frame, "p-3")}>
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-zinc-400 dark:text-zinc-500">Cancel</span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">Add to Home Screen</span>
        <span className={cn(highlight, "px-2 py-0.5 font-semibold")}>Add</span>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-2.5 dark:bg-white/[0.06]">
        <LogoMark size={36} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-zinc-900 dark:text-white">Remembos</p>
          <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">Your private memory</p>
        </div>
      </div>
    </div>
  );
}

// ---------- Other browsers ----------

const GUIDES: { id: GuideId; title: string; subtitle: string; body: ReactNode }[] = [
  {
    id: "chrome",
    title: "Chrome, Brave or Opera on a computer",
    subtitle: "Install icon in the address bar",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Click the install icon at the right end of the address bar (a screen with a small arrow).</li>
        <li>
          No icon? Open the <strong>⋮</strong> menu → <strong>Cast, save and share</strong> → <strong>Install page as app…</strong>
        </li>
        <li>
          Click <strong>Install</strong>.
        </li>
      </ol>
    ),
  },
  {
    id: "edge",
    title: "Microsoft Edge",
    subtitle: "Apps → Install this site as an app",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>Click the “App available” icon in the address bar.</li>
        <li>
          Or open the <strong>…</strong> menu → <strong>Apps</strong> → <strong>Install this site as an app</strong>.
        </li>
        <li>
          Click <strong>Install</strong>.
        </li>
      </ol>
    ),
  },
  {
    id: "android",
    title: "Android (Chrome, Samsung Internet, Firefox)",
    subtitle: "Menu → Install app / Add to Home screen",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          Open the browser menu (<strong>⋮</strong> or <strong>☰</strong>).
        </li>
        <li>
          Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>. In Samsung Internet: <strong>Add page to</strong> →{" "}
          <strong>Home screen</strong>.
        </li>
        <li>Confirm — the Remembos icon appears with your other apps.</li>
      </ol>
    ),
  },
  {
    id: "safari-mac",
    title: "Safari on a Mac",
    subtitle: "File → Add to Dock",
    body: (
      <ol className="list-decimal space-y-1.5 pl-5">
        <li>
          In the menu bar choose <strong>File</strong> → <strong>Add to Dock…</strong> (or the Share button → <strong>Add to Dock</strong>).
        </li>
        <li>
          Click <strong>Add</strong>. Needs Safari 17 (macOS Sonoma) or newer.
        </li>
      </ol>
    ),
  },
  {
    id: "firefox",
    title: "Firefox on a computer",
    subtitle: "Not supported — keep using it in the browser",
    body: (
      <p>
        Firefox on computers can&apos;t install websites as apps. Nothing is missing, though: keep using Remembos in a tab —
        everything works the same and your memories stay on this device. Tip: bookmark it (<strong>⌘D</strong> or{" "}
        <strong>Ctrl+D</strong>) or pin the tab so it&apos;s always one click away.
      </p>
    ),
  },
];

function GenericSteps({ current }: { current: GuideId | null }) {
  const ordered = current ? [...GUIDES].sort((a, b) => Number(b.id === current) - Number(a.id === current)) : GUIDES;
  return (
    <div className="space-y-4" data-testid="install-help-generic">
      <Benefits />
      <Accordion>
        {ordered.map((guide) => (
          <AccordionItem
            key={guide.id}
            name="install-guide"
            title={guide.title}
            subtitle={guide.subtitle}
            defaultOpen={guide.id === current}
            meta={
              guide.id === current ? (
                <Badge tone="brand" size="sm">
                  Your browser
                </Badge>
              ) : undefined
            }
          >
            {guide.body}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
