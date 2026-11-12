"use client";

import {
  CircleAlert,
  FolderOpen,
  Info,
  Laptop,
  Monitor,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { Field, Select } from "@/components/ui/Input";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import {
  browsersFor,
  DISK_BROWSER_LABELS,
  diskLocations,
  isDesktopOS,
  OS_CHOICES,
  OS_LABELS,
  type DiskBrowserId,
  type DiskLocation,
  type DiskLocationGuide,
  type OSId,
} from "@/lib/storage-inspect";
import { BackupButton } from "./actions";
import { KeyCap, PathBox } from "./paths";
import { useEnvironment } from "./use-environment";

const PLACEHOLDER = /<[^>]+>/;

function PathRow({ location }: { location: DiskLocation }) {
  const shared = location.scope === "shared";
  return (
    <li className="rounded-2xl border border-zinc-200/70 bg-white p-3.5 sm:p-4 dark:border-white/[0.08] dark:bg-white/[0.02]" data-testid={`location-${location.id}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <FolderOpen aria-hidden className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-white">{location.label}</span>
        <Badge size="sm" tone={shared ? "warning" : "brand"}>
          {shared ? "Shared with other websites" : "Only Remembos"}
        </Badge>
        {location.hashed ? (
          <Badge size="sm" tone="neutral">
            Scrambled names
          </Badge>
        ) : null}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{location.description}</p>
      <PathBox path={location.path} label={location.label} testId={`location-path-${location.id}`} />
      {PLACEHOLDER.test(location.path) ? (
        <p className="mt-1.5 text-xs text-muted">
          The part in <code className="font-mono">&lt;…&gt;</code> is different on every computer — open the folder before it and look for the matching one.
        </p>
      ) : null}
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <li>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-700 ring-1 ring-brand-500/20 dark:bg-brand-400/15 dark:text-brand-200 dark:ring-brand-400/25"
        >
          {n}
        </span>
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-zinc-600 sm:pl-11 dark:text-zinc-300">{children}</div>
    </li>
  );
}

function OpenFolderSteps({ os }: { os: "macos" | "windows" | "linux" }) {
  const items: { steps: ReactNode[]; tip: ReactNode } =
    os === "macos"
      ? {
          steps: [
            <>Open <strong className="font-medium text-zinc-900 dark:text-white">Finder</strong> (the smiling face in your Dock).</>,
            <>
              Press{" "}
              <span className="inline-flex gap-0.5 align-middle">
                <KeyCap>⌘</KeyCap>
                <KeyCap>⇧</KeyCap>
                <KeyCap>G</KeyCap>
              </span>{" "}
              — or choose Go → Go to Folder… in the menu bar.
            </>,
            <>Paste a path from below and press Return.</>,
          ],
          tip: "The Library folder is normally hidden. Go to Folder opens it anyway.",
        }
      : os === "windows"
        ? {
            steps: [
              <>
                Open <strong className="font-medium text-zinc-900 dark:text-white">File Explorer</strong> (
                <span className="inline-flex gap-0.5 align-middle">
                  <KeyCap>Win</KeyCap>
                  <KeyCap>E</KeyCap>
                </span>
                ).
              </>,
              <>
                Click the address bar at the top, or press{" "}
                <span className="inline-flex gap-0.5 align-middle">
                  <KeyCap>Alt</KeyCap>
                  <KeyCap>D</KeyCap>
                </span>
                .
              </>,
              <>Paste a path from below and press Enter. Windows fills in %LOCALAPPDATA% or %APPDATA% for you.</>,
            ],
            tip: (
              <>
                AppData is a hidden folder, so you won&apos;t find it by clicking around — pasting the path is the easy way. Even quicker: press{" "}
                <span className="inline-flex gap-0.5 align-middle">
                  <KeyCap>Win</KeyCap>
                  <KeyCap>R</KeyCap>
                </span>
                , paste the path and press Enter.
              </>
            ),
          }
        : {
            steps: [
              <>Open your file manager (Files, Dolphin, Nemo, Thunar…).</>,
              <>
                Press{" "}
                <span className="inline-flex gap-0.5 align-middle">
                  <KeyCap>Ctrl</KeyCap>
                  <KeyCap>L</KeyCap>
                </span>{" "}
                to type a location.
              </>,
              <>Paste a path from below and press Enter.</>,
            ],
            tip: (
              <>
                Folders that start with a dot are hidden —{" "}
                <span className="inline-flex gap-0.5 align-middle">
                  <KeyCap>Ctrl</KeyCap>
                  <KeyCap>H</KeyCap>
                </span>{" "}
                shows them.
              </>
            ),
          };
  return (
    <>
      <ol className="list-decimal space-y-1.5 pl-5 marker:text-muted">
        {items.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <p className="mt-2.5 flex gap-2 text-[13px] text-muted">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>{items.tip}</span>
      </p>
    </>
  );
}

function LookDontTouch() {
  return (
    <div
      role="note"
      data-testid="location-caution"
      className="flex flex-col gap-3.5 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] p-4 sm:flex-row sm:p-5 dark:border-rose-400/20 dark:bg-rose-400/[0.07]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-600 text-white shadow-[0_8px_20px_-8px_rgb(225_29_72/0.7)] dark:bg-rose-500">
        <ShieldAlert aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-rose-900 dark:text-rose-100">Look, but don&apos;t touch</p>
        <p className="mt-1 text-sm leading-relaxed text-rose-950/80 dark:text-rose-100/85">
          These are live, binary databases your browser is using right now. Don&apos;t edit, move, rename or delete anything inside them —
          one changed file can corrupt the whole vault, and several of these folders also hold other websites&apos; data. Copying them by
          hand doesn&apos;t make a working backup either. To keep a copy, use Back up.
        </p>
        <BackupButton size="sm" variant="secondary" className="mt-3" data-testid="location-backup-button" />
      </div>
    </div>
  );
}

function SandboxNotice({ guide }: { guide: DiskLocationGuide }) {
  const Icon: LucideIcon = guide.os === "chromeos" ? Laptop : guide.os === "other" ? CircleAlert : Smartphone;
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start" data-testid="location-sandboxed">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300">
        <Icon aria-hidden className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
          {guide.os === "other" ? "Pick your system" : `Not something you can browse on ${OS_LABELS[guide.os]}`}
        </h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{guide.message}</p>
        {guide.os !== "other" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <BackupButton size="md" />
            <Button href="#devtools" variant="ghost">
              Other ways to look
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DesktopGuide({ guide }: { guide: DiskLocationGuide }) {
  const name = DISK_BROWSER_LABELS[guide.browser];
  const finder = guide.finder;
  const profile = guide.profile;
  if (!profile || !isDesktopOS(guide.os)) return null;
  return (
    <>
      <LookDontTouch />
      <ol className="mt-8 space-y-9">
        <Step n={1} title={finder?.url ? "Find your exact profile folder" : `Where ${name} keeps website data`}>
          {finder?.url ? (
            <>
              <p>
                In {name}, paste this into the address bar and press Enter. Look for{" "}
                <strong className="font-medium text-zinc-900 dark:text-white">{finder.look}</strong> — that&apos;s the folder holding everything
                below.
              </p>
              <div className="mt-2.5 flex max-w-md items-center gap-1.5 rounded-xl border border-zinc-200/70 bg-zinc-50 py-1.5 pr-1.5 pl-3 dark:border-white/[0.08] dark:bg-black/20">
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-zinc-800 dark:text-zinc-200" data-testid="location-finder-url">
                  {finder.url}
                </code>
                <CopyButton value={finder.url} label="Copy" variant="secondary" />
              </div>
              <p className="mt-2 text-[13px] text-muted">
                Websites aren&apos;t allowed to open browser pages like this one, so copy it and paste it yourself.
                {finder.alternative ? ` Another way: ${finder.alternative}.` : ""}
              </p>
            </>
          ) : (
            <p>{finder?.look ? `Safari has no page that shows this folder. To see the data itself, use ${finder.look}.` : null}</p>
          )}
          <div className="mt-4 rounded-2xl border border-zinc-200/70 bg-white p-3.5 sm:p-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Usual location</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{profile.note}</p>
            <PathBox path={profile.path} label={`${name} profile folder`} testId="location-profile-path" />
            {profile.variants.length ? (
              <details className="group/variants mt-3">
                <summary className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-brand-700 hover:underline dark:text-brand-300">
                  Installed a different way?
                </summary>
                <ul className="mt-2 space-y-3">
                  {profile.variants.map((v) => (
                    <li key={v.path}>
                      <p className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">{v.label}</p>
                      <PathBox path={v.path} label={v.label} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Step>

        <Step n={2} title="Open a folder">
          <OpenFolderSteps os={guide.os} />
        </Step>

        <Step n={3} title="What each folder holds">
          <p>This site&apos;s address is already filled in. If you use another profile, swap the profile part for yours.</p>
          <ul className="mt-3 space-y-2.5">
            {guide.locations.map((l) => (
              <PathRow key={l.id} location={l} />
            ))}
          </ul>
        </Step>
      </ol>

      {guide.notes.length ? (
        <div className="mt-8 rounded-2xl border border-zinc-200/70 bg-zinc-50/70 p-3.5 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
            <Sparkles aria-hidden className="size-4 text-brand-500 dark:text-brand-300" />
            Good to know
          </p>
          <ul className="mt-2.5 space-y-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {guide.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function LoadingGuide() {
  return (
    <div aria-hidden className="space-y-5">
      <Skeleton className="h-28 w-full rounded-2xl" />
      <SkeletonText lines={2} className="max-w-md" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

/** "Find it on your computer": OS + browser (auto-detected, switchable) → exact folders with copy buttons. */
export function LocationFinder() {
  const env = useEnvironment();
  const osFieldId = useId();
  const browserFieldId = useId();
  const [osChoice, setOsChoice] = useState<OSId | null>(null);
  const [browserChoice, setBrowserChoice] = useState<DiskBrowserId | null>(null);

  const detectedOS = env && env.os !== "other" ? env.os : null;
  const os: OSId = osChoice ?? detectedOS ?? "windows";
  const browsers = browsersFor(os);
  const wanted = browserChoice ?? env?.diskBrowser ?? "chrome";
  const browser = browsers.includes(wanted) ? wanted : browsers[0];
  const origin = env?.origin ?? "";
  const guide = diskLocations(os, browser, origin);
  const isDetected = !!env && os === detectedOS && browser === env.diskBrowser;

  return (
    <Card padding="none" className="overflow-hidden" data-testid="location-finder">
      <div className="flex flex-col gap-4 border-b border-zinc-200/70 bg-zinc-50/60 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:p-6 dark:border-white/10 dark:bg-white/[0.02]">
        <Field label="Your device" htmlFor={osFieldId} className="sm:w-60">
          <Select
            id={osFieldId}
            value={os}
            disabled={!env}
            leftIcon={<Monitor />}
            onChange={(e) => setOsChoice(e.target.value as OSId)}
            options={OS_CHOICES.map((o) => ({ value: o, label: OS_LABELS[o] }))}
            data-testid="location-os-select"
          />
        </Field>
        {isDesktopOS(os) ? (
          <Field label="Your browser" htmlFor={browserFieldId} className="sm:w-60">
            <Select
              id={browserFieldId}
              value={browser}
              disabled={!env}
              onChange={(e) => setBrowserChoice(e.target.value as DiskBrowserId)}
              options={browsers.map((b) => ({ value: b, label: DISK_BROWSER_LABELS[b] }))}
              data-testid="location-browser-select"
            />
          </Field>
        ) : null}
        <div className="min-h-9 sm:ml-auto sm:flex sm:min-h-11 sm:items-center" aria-live="polite">
          {!env ? (
            <Skeleton className="h-6 w-40 rounded-full" />
          ) : isDetected ? (
            <Badge tone="success" dot data-testid="location-detected">
              Detected automatically
            </Badge>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RotateCcw />}
              onClick={() => {
                setOsChoice(null);
                setBrowserChoice(null);
              }}
              data-testid="location-reset"
            >
              {detectedOS ? `Back to ${OS_LABELS[detectedOS]} · ${DISK_BROWSER_LABELS[env.diskBrowser]}` : "Back to my device"}
            </Button>
          )}
        </div>
      </div>

      <div className="p-4 sm:p-6" aria-busy={!env || undefined}>
        {!env ? (
          <LoadingGuide />
        ) : env.os === "other" && osChoice === null ? (
          <p className="mb-5 flex gap-2 text-[13px] text-muted">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            We couldn&apos;t tell which system this is, so this shows Windows. Pick yours above.
          </p>
        ) : null}
        {!env ? null : !guide.available ? (
          <p className="flex gap-2.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-500" />
            {guide.message}
          </p>
        ) : !guide.browsable ? (
          <SandboxNotice guide={guide} />
        ) : (
          <DesktopGuide guide={guide} />
        )}
      </div>
    </Card>
  );
}
