"use client";

/**
 * "How to clear Remembos data in your browser": step-by-step guides for the popular browsers,
 * with the visitor's own browser opened first and the real site address filled in.
 */
import { Eraser } from "lucide-react";
import type { ReactNode } from "react";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { detectBrowser } from "@/lib/storage/monitor";
import type { BrowserId } from "@/lib/types";
import { Callout, Panel, StepList } from "./shared";
import { useClientValue } from "./use-client-value";

type GuideId = "chrome" | "edge" | "firefox" | "safari" | "ios-safari" | "samsung";

interface Guide {
  id: GuideId;
  name: string;
  subtitle: string;
  sections: { heading?: string; steps: (host: ReactNode) => ReactNode[] }[];
}

const Ui = ({ children }: { children: ReactNode }) => <span className="font-medium text-zinc-900 dark:text-zinc-100">{children}</span>;

const GUIDES: Guide[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    subtitle: "Also Brave, Opera, Vivaldi and Arc",
    sections: [
      {
        heading: "On a computer",
        steps: (host) => [
          <>
            Click the <Ui>site settings icon</Ui> at the left of the address bar, then <Ui>Site settings</Ui>.
          </>,
          <>
            Click <Ui>Delete data</Ui> and confirm. Everything {host} stored is removed.
          </>,
          <>
            Or: <Ui>Settings → Privacy and security → Third-party cookies → See all site data and permissions</Ui>, search for {host} and click the
            trash icon.
          </>,
        ],
      },
      {
        heading: "On Android",
        steps: (host) => [
          <>
            Tap <Ui>⋮ → Settings → Site settings → All sites</Ui>.
          </>,
          <>Find {host} and tap it.</>,
          <>
            Tap <Ui>Delete</Ui> (or <Ui>Clear &amp; reset</Ui>) and confirm.
          </>,
        ],
      },
    ],
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    subtitle: "Windows, Mac and Android",
    sections: [
      {
        steps: (host) => [
          <>
            Open <Ui>Settings → Cookies and site permissions → Manage and delete cookies and site data → See all cookies and site data</Ui>.
          </>,
          <>Search for {host}.</>,
          <>
            Click the arrow next to it, then the <Ui>trash icon</Ui> to delete its data.
          </>,
        ],
      },
    ],
  },
  {
    id: "firefox",
    name: "Firefox",
    subtitle: "Windows, Mac, Linux and Android",
    sections: [
      {
        heading: "On a computer",
        steps: (host) => [
          <>
            Click the <Ui>padlock</Ui> at the left of the address bar.
          </>,
          <>
            Choose <Ui>Clear cookies and site data…</Ui> and confirm with <Ui>Remove</Ui>.
          </>,
          <>
            Or: <Ui>Settings → Privacy &amp; Security → Cookies and Site Data → Manage Data</Ui>, search for {host}, then{" "}
            <Ui>Remove Selected → Save Changes</Ui>.
          </>,
        ],
      },
      {
        heading: "On Android",
        steps: () => [
          <>
            Tap <Ui>⋮ → Settings → Delete browsing data</Ui> — or tap the padlock while on Remembos and choose <Ui>Clear cookies and site data</Ui>.
          </>,
        ],
      },
    ],
  },
  {
    id: "safari",
    name: "Safari on Mac",
    subtitle: "macOS",
    sections: [
      {
        steps: (host) => [
          <>
            In the menu bar choose <Ui>Safari → Settings…</Ui> and open the <Ui>Privacy</Ui> tab.
          </>,
          <>
            Click <Ui>Manage Website Data…</Ui> and search for {host}.
          </>,
          <>
            Select it, click <Ui>Remove</Ui>, then <Ui>Done</Ui>.
          </>,
        ],
      },
    ],
  },
  {
    id: "ios-safari",
    name: "Safari on iPhone & iPad",
    subtitle: "Also every other browser on iPhone and iPad",
    sections: [
      {
        steps: (host) => [
          <>
            Open the <Ui>Settings</Ui> app and go to <Ui>Apps → Safari</Ui> (on older iOS, just <Ui>Safari</Ui>).
          </>,
          <>
            Tap <Ui>Advanced → Website Data</Ui> and search for {host}.
          </>,
          <>
            Swipe left on it and tap <Ui>Delete</Ui>. If you added Remembos to your Home Screen, also delete that icon — its data goes with it.
          </>,
        ],
      },
    ],
  },
  {
    id: "samsung",
    name: "Samsung Internet",
    subtitle: "Android",
    sections: [
      {
        steps: (host) => [
          <>
            Tap <Ui>☰ → Settings → Sites and downloads</Ui> (or <Ui>Privacy</Ui>) → <Ui>Manage website data</Ui>.
          </>,
          <>Find {host}.</>,
          <>
            Select it and tap <Ui>Delete</Ui>.
          </>,
        ],
      },
    ],
  },
];

function guideFor(browser: BrowserId | null): GuideId | null {
  switch (browser) {
    case "chrome":
    case "brave":
    case "opera":
      return "chrome";
    case "edge":
    case "firefox":
    case "safari":
    case "ios-safari":
    case "samsung":
      return browser;
    default:
      return null;
  }
}

export function ClearDataGuide() {
  const browser = useClientValue<BrowserId | null>(detectBrowser, null);
  const host = useClientValue<string>(() => window.location.host, "");
  const current = guideFor(browser);
  const ordered = current ? [...GUIDES.filter((g) => g.id === current), ...GUIDES.filter((g) => g.id !== current)] : GUIDES;

  const hostChip = host ? (
    <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[12.5px] text-zinc-900 dark:bg-white/10 dark:text-zinc-100">{host}</code>
  ) : (
    <Ui>this site</Ui>
  );

  return (
    <Panel
      id="clear"
      icon={<Eraser />}
      tone="neutral"
      title="How to clear Remembos data in your browser"
      description="“Delete everything” below is the easiest way. To remove every trace — including the offline app files — clear this site's data in your browser settings."
      data-testid="clear-guide"
    >
      {host ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          Look for this site address: {hostChip}
          <CopyButton value={host} label="Copy address" size="sm" />
        </div>
      ) : null}

      <Accordion>
        {ordered.map((g) => (
          <AccordionItem
            key={g.id}
            title={g.name}
            subtitle={g.subtitle}
            defaultOpen={g.id === current}
            meta={g.id === current ? <Badge tone="brand" size="sm">Your browser</Badge> : undefined}
            data-testid={`clear-guide-${g.id}`}
          >
            <div className="flex flex-col gap-4">
              {g.sections.map((section, i) => (
                <div key={i}>
                  {section.heading ? <h4 className="mb-2 text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">{section.heading}</h4> : null}
                  <StepList steps={section.steps(hostChip)} />
                </div>
              ))}
            </div>
          </AccordionItem>
        ))}
      </Accordion>

      <Callout tone="warning" className="mt-4">
        Clearing <strong>“Cookies and other site data”</strong> for all sites, “Forget about this site”, removing your browser profile or using
        cleaner apps also erases Remembos. Clearing only history or cached images is usually safe. Back up first either way.
      </Callout>
    </Panel>
  );
}
