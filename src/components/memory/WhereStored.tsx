"use client";
/**
 * "Where is this stored?" — one memory's storage address, in plain words.
 *
 * Always visible: the logical address (IndexedDB › remembos › files › <id>) and a link to the in-app
 * storage explorer focused on this memory. Opened: every record this memory keeps (original, preview,
 * text, search pieces, found details), the real folder for this computer and browser with a copy
 * button and how to open it, and an honest note that browsers can't open folders for a website and
 * keep files as numbered internal pieces — so Open original / Download are the way to get it back.
 *
 * The folder guide (`@/lib/storage-inspect`) is only loaded when the panel is opened (or about to be).
 */
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Info,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { Button, CopyButton, Kbd, Skeleton } from "@/components/ui";
import { explorerHref, ROUTES, STORAGE_NAMES } from "@/lib/config";
import { db } from "@/lib/db";
import type { DiskBrowserId, DiskLocation, DiskLocationGuide, OSId } from "@/lib/storage-inspect";
import { detectBrowser } from "@/lib/storage/monitor";
import type { MemoryItem } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { wordCount } from "./memory-data";

type InspectModule = typeof import("@/lib/storage-inspect");

let inspectModule: Promise<InspectModule> | null = null;

/** Load the folder guide once (shared by every memory page). */
function loadInspect(): Promise<InspectModule> {
  inspectModule ??= import("@/lib/storage-inspect").catch((err: unknown) => {
    inspectModule = null;
    throw err;
  });
  return inspectModule;
}

interface Place {
  os: OSId;
  /** "This Mac", "This PC"… */
  device: string;
  browserId: DiskBrowserId;
  /** "Google Chrome", "Firefox"… */
  browser: string;
  guide: DiskLocationGuide;
}

async function detectPlace(): Promise<Place> {
  const m = await loadInspect();
  const os = m.detectOS();
  const browser = m.detectDiskBrowser(detectBrowser());
  return {
    os,
    device: m.DEVICE_LABELS[os],
    browserId: browser,
    browser: m.DISK_BROWSER_LABELS[browser],
    guide: m.diskLocations(os, browser, window.location.origin),
  };
}

/** The one caveat most likely to matter when looking for the folder in this browser. */
function folderTip(place: Place): string | undefined {
  const { guide, browserId } = place;
  if (browserId === "firefox") return "The “<xxxxxxxx>” part is 8 random letters and numbers, different on every computer.";
  if (browserId === "safari") return guide.notes[0];
  return guide.notes.find((n) => /Profile 1/.test(n)) ?? guide.notes[0];
}

/** Folders worth showing for one memory: where originals sit first (when it has one), then the database. */
function relevantLocations(guide: DiskLocationGuide, hasFile: boolean): DiskLocation[] {
  const byId = new Map(guide.locations.map((l) => [l.id, l]));
  const wanted = hasFile ? (["indexeddb-blobs", "indexeddb"] as const) : (["indexeddb"] as const);
  const picked = wanted.map((id) => byId.get(id)).filter((l): l is DiskLocation => Boolean(l));
  if (!picked.length) {
    const site = byId.get("site-folder");
    if (site) picked.push(site);
  }
  return picked;
}

export interface WhereStoredProps {
  item: MemoryItem;
  /** Open the stored original in a new tab (shown when there is one). */
  onOpenOriginal?: () => void;
  /** Download the original (or the text). */
  onDownload?: () => void;
}

export function WhereStored({ item, onOpenOriginal, onDownload }: WhereStoredProps) {
  const titleId = useId();
  const panelId = useId();
  // Links like /item/?id=…#where-stored open the panel straight away.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === "#where-stored");
  const hasFile = Boolean(item.hasFile);
  const table = hasFile ? "files" : "items";
  const subject = hasFile ? "This file" : item.kind === "note" ? "This note" : "This memory";

  const prefetch = () => {
    void loadInspect().catch(() => {
      /* retried when the panel opens */
    });
  };

  return (
    <section
      id="where-stored"
      aria-labelledby={titleId}
      data-testid="where-stored"
      data-open={open ? "true" : "false"}
      className="mt-6 scroll-mt-[calc(var(--header-h,4rem)+1rem)] overflow-hidden rounded-3xl border border-zinc-200/70 bg-white/80 shadow-soft dark:border-white/10 dark:bg-white/[0.035]"
    >
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-emerald-500 to-teal-500 text-white shadow-[0_8px_20px_-8px_rgb(16_185_129/0.7)] ring-1 ring-white/25 ring-inset sm:size-11">
            <HardDrive aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">
              Where is this stored?
            </h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
              {subject} lives inside your browser&apos;s storage on this device — never uploaded anywhere.
            </p>
            <Address parts={["IndexedDB", STORAGE_NAMES.appDb, table, item.id]} className="mt-2" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:shrink-0">
          <Button href={explorerHref(item.id)} size="sm" leftIcon={<Database />} data-testid="open-explorer">
            Show in storage explorer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            onPointerEnter={prefetch}
            onFocus={prefetch}
            rightIcon={<ChevronDown className={cn("transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />}
            data-testid="where-stored-toggle"
          >
            {open ? "Hide details" : "Find it on disk"}
          </Button>
        </div>
      </div>

      {/* Always in the DOM (so aria-controls points somewhere); its contents only load once opened. */}
      <div
        id={panelId}
        hidden={!open}
        className="animate-fade-in border-t border-zinc-200/70 bg-zinc-50/60 p-4 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.015]"
        data-testid="where-stored-details"
      >
        {open ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
              <InsideBrowser item={item} />
              <OnDisk hasFile={hasFile} />
            </div>
            <HonestNote item={item} onOpenOriginal={onOpenOriginal} onDownload={onDownload} />
          </>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function Address({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-1 font-mono text-[12px] leading-5", className)} data-testid="where-stored-address">
      <span className="sr-only">Stored at: </span>
      {parts.map((part, i) => (
        <Fragment key={`${i}-${part}`}>
          {i ? <ChevronRight aria-hidden className="size-3 shrink-0 text-zinc-400 dark:text-zinc-500" /> : null}
          <span
            className={cn(
              "max-w-full truncate rounded-md px-1.5",
              i === parts.length - 1
                ? "bg-emerald-500/10 text-emerald-800 ring-1 ring-emerald-500/20 ring-inset dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/20"
                : "bg-zinc-100 text-zinc-700 dark:bg-white/[0.07] dark:text-zinc-200",
            )}
          >
            {part}
          </span>
          {i < parts.length - 1 ? <span className="sr-only">, </span> : null}
        </Fragment>
      ))}
    </p>
  );
}

function SubHeading({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
      <span aria-hidden className="text-brand-600 dark:text-brand-300 [&>svg]:size-4">
        {icon}
      </span>
      {children}
    </h3>
  );
}

// ---------- The records inside the browser ----------

interface RecordRow {
  table: string;
  what: string;
  detail: ReactNode;
  keyLabel: string;
}

function InsideBrowser({ item }: { item: MemoryItem }) {
  const chunkCount = useLiveQuery(
    async () => {
      try {
        return await db.chunks.where("itemId").equals(item.id).count();
      } catch {
        return null;
      }
    },
    [item.id],
  );
  const words = wordCount(item.text);
  const fromFile = Boolean(item.sourceName) || item.hasFile;

  const rows: RecordRow[] = [];
  if (item.hasFile) {
    rows.push({
      table: "files",
      what: "The original file",
      detail: [item.sourceName, item.size ? formatBytes(item.size) : null].filter(Boolean).join(" · ") || "Stored as it was added",
      keyLabel: item.id,
    });
  } else if (fromFile) {
    rows.push({ table: "files", what: "The original file", detail: "Removed to save space — the text below stays", keyLabel: "—" });
  }
  if (item.hasThumb) rows.push({ table: "thumbs", what: "Small preview image", detail: "Used for cards and lists", keyLabel: item.id });
  rows.push({
    table: "items",
    what: "Title, text & details",
    detail: `${words.toLocaleString()} ${words === 1 ? "word" : "words"}, tags and dates`,
    keyLabel: item.id,
  });
  rows.push({
    table: "chunks",
    what: "Search pieces",
    detail:
      chunkCount === undefined ? (
        <Skeleton className="inline-block h-3 w-24 rounded-full align-middle" />
      ) : chunkCount === null ? (
        "Couldn't count them"
      ) : (
        `${chunkCount.toLocaleString()} ${chunkCount === 1 ? "piece" : "pieces"}${item.embedded ? " · meaning search ready" : ""}`
      ),
    keyLabel: `${item.id}:0…`,
  });
  if (item.entityIds.length) {
    rows.push({
      table: "entities",
      what: "Names, numbers & links found",
      detail: `${item.entityIds.length.toLocaleString()} linked to this memory`,
      keyLabel: "type:value",
    });
  }

  return (
    <div className="min-w-0">
      <SubHeading icon={<Database />}>Inside this browser</SubHeading>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
        Browser storage (IndexedDB) → database <Code>{STORAGE_NAMES.appDb}</Code> → one table per part, each filed under this
        memory&apos;s key.
      </p>
      <ul
        className="mt-3 divide-y divide-zinc-200/70 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white dark:divide-white/[0.07] dark:border-white/10 dark:bg-white/[0.03]"
        data-testid="where-stored-records"
      >
        {rows.map((r) => (
          <li key={r.table} className="flex items-start gap-3 px-3.5 py-2.5" data-table={r.table}>
            <span className="mt-px w-[4.5rem] shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-center font-mono text-[11.5px] text-zinc-700 dark:bg-white/[0.07] dark:text-zinc-200">
              {r.table}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{r.what}</span>
              <span className="block truncate text-xs text-muted">{r.detail}</span>
            </span>
            <span className="hidden max-w-[9rem] shrink-0 truncate pt-px font-mono text-[11px] text-zinc-400 sm:block dark:text-zinc-500" title={`Key: ${r.keyLabel}`}>
              {r.keyLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-zinc-100 px-1 py-px font-mono text-[12px] text-zinc-800 dark:bg-white/[0.08] dark:text-zinc-100">{children}</code>
  );
}

// ---------- The real folder on this computer ----------

function OnDisk({ hasFile }: { hasFile: boolean }) {
  const [place, setPlace] = useState<Place | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    detectPlace()
      .then((p) => {
        if (!cancelled) setPlace(p);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="min-w-0">
        <SubHeading icon={<FolderOpen />}>On this device</SubHeading>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          The folder guide couldn&apos;t load right now.{" "}
          <Link href={ROUTES.storage} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
            Open the storage guide
          </Link>{" "}
          to see the folders for every browser.
        </p>
      </div>
    );
  }

  if (!place) {
    return (
      <div className="min-w-0" aria-busy="true">
        <SubHeading icon={<FolderOpen />}>On this device</SubHeading>
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-4 w-2/3 rounded-full" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-4 w-1/2 rounded-full" />
        </div>
      </div>
    );
  }

  const { guide } = place;
  const heading = (
    <SubHeading icon={guide.browsable ? <FolderOpen /> : <Smartphone />}>
      {place.device} · {place.browser}
    </SubHeading>
  );

  if (!guide.browsable || !guide.available) {
    return (
      <div className="min-w-0" data-testid="where-stored-disk">
        {heading}
        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{guide.message}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          <Link href={ROUTES.data} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
            Make a backup
          </Link>{" "}
          to keep a copy you can see, or{" "}
          <Link href={ROUTES.storage} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
            see the folders for other computers
          </Link>
          .
        </p>
      </div>
    );
  }

  const locations = relevantLocations(guide, hasFile);
  const profileNote = folderTip(place);
  const finder = guide.finder;

  return (
    <div className="min-w-0" data-testid="where-stored-disk" data-os={place.os}>
      {heading}
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">The real folder{locations.length === 1 ? "" : "s"} on this computer:</p>
      <ul className="mt-3 space-y-2.5">
        {locations.map((loc) => (
          <li key={loc.id} className="min-w-0">
            <p className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{loc.label}</p>
            <div className="mt-1 flex items-start gap-1.5 rounded-xl border border-zinc-200/80 bg-white py-1 pr-1 pl-3 dark:border-white/10 dark:bg-black/20">
              <code className="min-w-0 flex-1 py-1 font-mono text-[12px] leading-5 break-all text-zinc-800 dark:text-zinc-100" data-testid="where-stored-path">
                {loc.path}
              </code>
              <CopyButton value={loc.path} label="Copy folder path" iconOnly className="shrink-0" data-testid="where-stored-copy" />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{loc.description}</p>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <p className="text-[13px] font-semibold text-zinc-900 dark:text-white">How to open it</p>
        <OpenSteps os={place.os} />
      </div>

      {profileNote || finder?.url ? (
        <p className="mt-3 flex gap-2 text-xs leading-relaxed text-muted">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {profileNote}
            {finder?.url ? (
              <>
                {profileNote ? " " : ""}
                To be sure, type <Code>{finder.url}</Code> in the address bar and look for “{finder.look}”.
              </>
            ) : null}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {keys.map((k) => (
        <Kbd key={k}>
          <>{k}</>
        </Kbd>
      ))}
    </span>
  );
}

function OpenSteps({ os }: { os: OSId }) {
  const steps: ReactNode[] =
    os === "macos"
      ? [
          <>Copy a folder path above.</>,
          <>
            Open <strong className="font-medium text-zinc-900 dark:text-white">Finder</strong> and press <Keys keys={["⌘", "⇧", "G"]} /> (Go to
            Folder).
          </>,
          <>
            Paste the path and press <Keys keys={["Return"]} />.
          </>,
        ]
      : os === "windows"
        ? [
            <>Copy a folder path above.</>,
            <>
              Press <Keys keys={["Win", "R"]} /> to open the Run box.
            </>,
            <>
              Paste the path and press <Keys keys={["Enter"]} /> — File Explorer opens the folder.
            </>,
          ]
        : [
            <>Copy a folder path above.</>,
            <>
              Open your file manager and press <Keys keys={["Ctrl", "L"]} /> to type a location.
            </>,
            <>
              Paste the path and press <Keys keys={["Enter"]} />.
            </>,
          ];
  return (
    <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-zinc-600 marker:text-muted dark:text-zinc-300" data-testid="where-stored-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

// ---------- Why you can't just double-click it ----------

function HonestNote({ item, onOpenOriginal, onDownload }: WhereStoredProps) {
  const name = item.sourceName || item.title || "this memory";
  return (
    <div className="mt-6 space-y-3">
      <div
        role="note"
        className="flex flex-col gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-4 sm:flex-row sm:items-center sm:gap-4 dark:border-sky-400/20 dark:bg-sky-400/[0.07]"
        data-testid="where-stored-note"
      >
        <Info aria-hidden className="size-5 shrink-0 text-sky-600 dark:text-sky-300" />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-sky-950/85 dark:text-sky-100/90">
          {item.hasFile ? (
            <>
              Browsers don&apos;t let websites open folders on your computer, and the file is stored in numbered internal pieces — not as “
              <span className="font-medium break-all">{name}</span>” — so use <strong className="font-semibold">Open original</strong> or{" "}
              <strong className="font-semibold">Download</strong> to get it.
            </>
          ) : (
            <>
              Browsers don&apos;t let websites open folders on your computer, and this text is kept inside the database&apos;s internal files —
              not as a separate document — so use <strong className="font-semibold">Copy text</strong> or{" "}
              <strong className="font-semibold">Download</strong> to get it.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          {item.hasFile && onOpenOriginal ? (
            <Button variant="secondary" size="sm" leftIcon={<ExternalLink />} onClick={onOpenOriginal} data-testid="where-open-original">
              Open original
            </Button>
          ) : null}
          {onDownload ? (
            <Button variant="secondary" size="sm" leftIcon={<Download />} onClick={onDownload} data-testid="where-download">
              Download
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 text-xs leading-relaxed text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="flex gap-2">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-rose-500 dark:text-rose-400" />
          <span>
            Look, but don&apos;t touch: changing or deleting anything in those folders can break every memory. To keep a copy, use{" "}
            <Link href={ROUTES.data} className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300">
              Back up
            </Link>
            .
          </span>
        </p>
        <Link
          href={ROUTES.storage}
          className="group inline-flex shrink-0 items-center gap-1 font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
          data-testid="where-stored-guide"
        >
          Full guide: where your data lives
          <ArrowRight aria-hidden className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </Link>
      </div>
    </div>
  );
}
