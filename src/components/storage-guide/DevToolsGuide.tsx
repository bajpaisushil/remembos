"use client";

import { ArrowRight, Compass, Database, Flame, Globe, Smartphone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { Kbd } from "@/components/ui/Kbd";
import { ROUTES, STORAGE_NAMES } from "@/lib/config";
import type { DevToolsFamily } from "./content";
import { useEnvironment, type GuideEnvironment } from "./use-environment";

function familyFor(env: GuideEnvironment): DevToolsFamily {
  if (env.os === "ios" || env.os === "android") return "mobile";
  if (env.diskBrowser === "firefox") return "firefox";
  if (env.diskBrowser === "safari") return "safari";
  return "chromium";
}

/** Literal key cap (no Mac glyph substitution). */
function Key({ children }: { children: string }) {
  return (
    <Kbd>
      <>{children}</>
    </Kbd>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {keys.map((k) => (
        <Key key={k}>{k}</Key>
      ))}
    </span>
  );
}

function Name({ children }: { children: ReactNode }) {
  return <strong className="font-medium text-zinc-900 dark:text-white">{children}</strong>;
}

function Steps({ steps, warning }: { steps: ReactNode[]; warning: ReactNode }) {
  return (
    <>
      <ol className="list-decimal space-y-2 pl-5 marker:text-muted">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="mt-3.5 flex gap-2 rounded-xl bg-rose-500/[0.06] px-3 py-2.5 text-[13px] text-rose-900 dark:bg-rose-400/[0.08] dark:text-rose-100">
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-300" />
        <span>{warning}</span>
      </p>
    </>
  );
}

const OPEN_KEYS = (
  <>
    Press <Keys keys={["F12"]} /> or <Keys keys={["Ctrl", "Shift", "I"]} /> — on a Mac, <Keys keys={["⌥", "⌘", "I"]} />.
  </>
);

/** "See it in DevTools": step-by-step for each browser family; the visitor's own browser opens first. */
export function DevToolsGuide() {
  const env = useEnvironment();
  const mine = env ? familyFor(env) : null;
  const yours = (f: DevToolsFamily) =>
    mine === f ? (
      <Badge tone="brand" size="sm">
        Your browser
      </Badge>
    ) : null;

  return (
    <div className="max-w-4xl" data-testid="devtools-guide">
    <Link
      href={ROUTES.explorer}
      className="group mb-4 flex items-start gap-3 rounded-2xl border border-brand-500/20 bg-brand-500/[0.05] px-4 py-3.5 transition-[border-color,background-color] duration-150 hover:border-brand-500/35 hover:bg-brand-500/[0.08] dark:border-brand-400/20 dark:bg-brand-400/[0.07] dark:hover:border-brand-400/35"
      data-testid="devtools-explorer-link"
    >
      <Database aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600 dark:text-brand-300" />
      <span className="min-w-0 flex-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
        <span className="font-semibold text-zinc-900 dark:text-white">No developer tools needed: </span>
        the storage explorer shows the same IndexedDB tables right inside Remembos — on phones too — and lets you open or download any
        stored file.
      </span>
      <ArrowRight aria-hidden className="mt-1 size-4 shrink-0 text-brand-600 transition-transform group-hover:translate-x-0.5 dark:text-brand-300" />
    </Link>
    <Accordion>
      <AccordionItem
        name="devtools"
        defaultOpen={mine === "chromium"}
        icon={<Globe aria-hidden />}
        title="Chrome, Edge, Brave, Opera, Vivaldi & Arc"
        subtitle="The “Application” panel"
        meta={yours("chromium")}
        data-testid="devtools-chromium"
      >
        <Steps
          steps={[
            <>Open Remembos, then open the developer tools. {OPEN_KEYS}</>,
            <>
              Click the <Name>Application</Name> tab at the top (it may hide behind the <Name>»</Name> arrow).
            </>,
            <>
              In the sidebar under <Name>Storage</Name>: <Name>IndexedDB</Name> → <code className="font-mono text-[12.5px]">{STORAGE_NAMES.appDb}</code>{" "}
              (and <code className="font-mono text-[12.5px]">{STORAGE_NAMES.ocrDb}</code>), <Name>Local storage</Name>, <Name>Session storage</Name>,{" "}
              <Name>Cookies</Name>, and <Name>Cache storage</Name>.
            </>,
            <>
              Click <Name>Storage</Name> at the very top of the sidebar for a chart of how much space each kind uses.
            </>,
          ]}
          warning={<>Look only. “Clear site data” and the delete buttons there erase your memories instantly — no undo.</>}
        />
      </AccordionItem>

      <AccordionItem
        name="devtools"
        defaultOpen={mine === "firefox"}
        icon={<Flame aria-hidden />}
        title="Firefox"
        subtitle="The “Storage” panel"
        meta={yours("firefox")}
        data-testid="devtools-firefox"
      >
        <Steps
          steps={[
            <>Open Remembos, then open the developer tools. {OPEN_KEYS}</>,
            <>
              Click the <Name>Storage</Name> tab.
            </>,
            <>
              Expand <Name>Indexed DB</Name> → this site → <code className="font-mono text-[12.5px]">{STORAGE_NAMES.appDb}</code>, and look through{" "}
              <Name>Local Storage</Name>, <Name>Session Storage</Name>, <Name>Cookies</Name> and <Name>Cache Storage</Name>.
            </>,
          ]}
          warning={<>Look only. “Delete All” and the right-click delete options erase data straight away.</>}
        />
      </AccordionItem>

      <AccordionItem
        name="devtools"
        defaultOpen={mine === "safari"}
        icon={<Compass aria-hidden />}
        title="Safari on Mac"
        subtitle="Web Inspector → “Storage”"
        meta={yours("safari")}
        data-testid="devtools-safari"
      >
        <Steps
          steps={[
            <>
              Turn on the developer tools once: Safari → <Name>Settings</Name> → <Name>Advanced</Name> → tick{" "}
              <Name>Show features for web developers</Name> (older versions: “Show Develop menu in menu bar”).
            </>,
            <>
              Open Remembos and choose <Name>Develop → Show Web Inspector</Name> (<Keys keys={["⌥", "⌘", "I"]} />).
            </>,
            <>
              Click the <Name>Storage</Name> tab: <Name>Indexed Databases</Name>, <Name>Local Storage</Name>, <Name>Session Storage</Name> and{" "}
              <Name>Cookies</Name>.
            </>,
          ]}
          warning={<>Look only. The delete (trash) buttons remove data immediately.</>}
        />
      </AccordionItem>

      <AccordionItem
        name="devtools"
        defaultOpen={mine === "mobile"}
        icon={<Smartphone aria-hidden />}
        title="Phones & tablets"
        subtitle="Through a computer"
        meta={yours("mobile")}
        data-testid="devtools-mobile"
      >
        <Steps
          steps={[
            <>Mobile browsers have no developer tools of their own — you look from a computer over a USB cable.</>,
            <>
              <Name>Android:</Name> turn on USB debugging in Developer options, connect the phone, then open{" "}
              <code className="font-mono text-[12.5px]">chrome://inspect</code> in Chrome on the computer and click <Name>Inspect</Name> under
              Remembos.
            </>,
            <>
              <Name>iPhone & iPad:</Name> turn on Settings → Safari → Advanced → <Name>Web Inspector</Name>, connect to a Mac, then use Safari&apos;s{" "}
              <Name>Develop</Name> menu on the Mac.
            </>,
          ]}
          warning={<>Same rule: look, don&apos;t delete. A backup is the easy way to keep a copy.</>}
        />
      </AccordionItem>
    </Accordion>
    </div>
  );
}
