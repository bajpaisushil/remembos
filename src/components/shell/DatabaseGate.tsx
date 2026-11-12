"use client";

import { Cookie, EyeOff, RefreshCw, Smartphone, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { Accent } from "@/components/ui/PageHeader";
import { isDatabaseAvailable } from "@/lib/db";
import { cn } from "@/lib/utils";

/**
 * Checks once that IndexedDB works. If it doesn't (private mode in some browsers, blocked site
 * data, very old browser), replaces the app with a friendly explanation and how to fix it —
 * instead of letting people add memories that could never be saved.
 */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    isDatabaseAvailable()
      .then((ok) => {
        if (alive) setAvailable(ok);
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (available === false) return <StorageBlocked />;
  return <>{children}</>;
}

interface Reason {
  icon: LucideIcon;
  title: string;
  body: string;
  steps: string[];
}

const SITE_DATA: Reason = {
  icon: Cookie,
  title: "Site data is blocked",
  body: "Remembos needs permission to keep data on this device. It never sets cookies, but browsers group the two settings together.",
  steps: [
    "Chrome / Brave: Settings → Privacy and security → Site settings → Additional content settings → On-device site data → “Allow sites to save data on your device”.",
    "Edge: Settings → Cookies and site permissions → Manage and delete cookies and site data → turn on “Allow sites to save and read cookie data”.",
    "Firefox: Settings → Privacy & Security → Cookies and Site Data → Manage Exceptions → allow this site.",
    "Safari: Settings → Privacy → turn off “Block all cookies” (iPhone/iPad: Settings app → Safari).",
  ],
};

const OTHER_REASONS: Reason[] = [
  {
    icon: EyeOff,
    title: "Private or incognito window",
    body: "Some browsers switch off on-device storage in private windows.",
    steps: ["Open Remembos in a normal window."],
  },
  {
    icon: Smartphone,
    title: "Opened inside another app",
    body: "Built-in browsers in social and chat apps often can't store data.",
    steps: ["Tap the menu (⋯) and choose “Open in browser”."],
  },
  {
    icon: RefreshCw,
    title: "Browser is out of date",
    body: "Remembos works in recent Chrome, Edge, Firefox, Safari and Samsung Internet.",
    steps: ["Update your browser, then reload."],
  },
];

function Steps({ steps, className }: { steps: string[]; className?: string }) {
  return (
    <ul className={cn("mt-3 gap-x-6 gap-y-2 text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300", className)}>
      {steps.map((step) => (
        <li key={step} className="flex gap-2">
          <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand-500" />
          <span>{step}</span>
        </li>
      ))}
    </ul>
  );
}

function ReasonIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300">
      <Icon aria-hidden className="size-5" />
    </span>
  );
}

const CARD = "rounded-3xl border border-zinc-200/70 bg-white p-5 shadow-card sm:p-6 dark:border-white/10 dark:bg-white/[0.04]";

function StorageBlocked() {
  return (
    <div className="relative flex min-h-dvh flex-col" data-testid="database-unavailable">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-14">
        <Logo size={30} />
        <div className="mt-10 sm:mt-14">
          <p className="text-xs font-semibold tracking-[0.14em] text-amber-600 uppercase dark:text-amber-400">Storage unavailable</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl dark:text-white">
            This window can&apos;t <Accent>remember</Accent> anything yet
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted sm:text-[17px]">
            Remembos keeps your memories privately inside your browser&apos;s own storage, on this device. Right now the
            browser isn&apos;t allowing that, so nothing could be saved. Here are the usual reasons and how to fix them:
          </p>
        </div>

        <div className={cn(CARD, "mt-8")}>
          <div className="flex items-start gap-4">
            <ReasonIcon icon={SITE_DATA.icon} />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{SITE_DATA.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{SITE_DATA.body}</p>
            </div>
          </div>
          <Steps steps={SITE_DATA.steps} className="grid sm:grid-cols-2" />
        </div>

        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {OTHER_REASONS.map((r) => (
            <li key={r.title} className={CARD}>
              <ReasonIcon icon={r.icon} />
              <h2 className="mt-3 text-[15px] font-semibold text-zinc-900 dark:text-white">{r.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{r.body}</p>
              <Steps steps={r.steps} className="flex flex-col" />
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button size="lg" leftIcon={<RefreshCw />} onClick={() => window.location.reload()} data-testid="database-retry">
            I&apos;ve fixed it — try again
          </Button>
          <p className="text-sm text-muted">Once your browser allows storage, Remembos opens normally.</p>
        </div>
      </div>
    </div>
  );
}
