"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  FileClock,
  FileQuestion,
  HardDrive,
  HardDriveDownload,
  Info,
  Layers,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCw,
  ScanText,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Container,
  CopyButton,
  EmptyState,
  KindBadge,
  KindIcon,
  Menu,
  Progress,
  Spinner,
  type BadgeTone,
} from "@/components/ui";
import { APP_NAME, explorerHref, KIND_META, ROUTES, searchHref } from "@/lib/config";
import { db } from "@/lib/db";
import { retryItemLazy as retryItem, useQueue } from "@/lib/ingest/queue-store";
import { deleteItems, deleteOriginals } from "@/lib/storage/clear";
import type { MemoryItem } from "@/lib/types";
import { cn, formatBytes, formatDate, formatDuration, timeAgo } from "@/lib/utils";
import { EditableTitle } from "./EditableTitle";
import { ItemEntities } from "./ItemEntities";
import { hasVisualPreview, ItemPreview } from "./ItemPreview";
import { setPinned, STAGE_LABELS, wordCount } from "./memory-data";
import { downloadOriginal, openOriginal, useStoredOriginal } from "./original";
import { RelatedMemories } from "./RelatedMemories";
import { ItemSkeleton } from "./Skeletons";
import { TagEditor } from "./TagEditor";
import { TextPanel } from "./TextPanel";
import { WhereStored } from "./WhereStored";

function fullDate(ms: number): string {
  return formatDate(ms, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function ocrTone(confidence: number): BadgeTone {
  if (confidence >= 80) return "success";
  if (confidence >= 60) return "warning";
  return "danger";
}

/** True when the item came from a file (its size is bytes, not characters typed). */
function fromFile(item: MemoryItem): boolean {
  return (
    Boolean(item.sourceName) || item.kind === "image" || item.kind === "pdf" || item.kind === "video" || item.kind === "voice"
  );
}

// ---------------------------------------------------------------------------------------------

/** /item/?id=… — reads the id (and an optional ?q= to highlight) from the URL. */
export function ItemView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const q = params.get("q") ?? "";
  return <ItemScreen key={id} id={id} initialQuery={q} />;
}

function ItemScreen({ id, initialQuery }: { id: string; initialQuery: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const data = useLiveQuery(async () => {
    if (!id) return { item: null as MemoryItem | null };
    try {
      return { item: (await db.items.get(id)) ?? null };
    } catch (err) {
      console.warn("[remembos] could not open memory", err);
      return { item: null as MemoryItem | null };
    }
  }, [id]);
  const item = data?.item ?? null;
  const title = item?.title;

  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);

  async function remove() {
    setLeaving(true);
    try {
      await deleteItems([id]);
    } catch (err) {
      setLeaving(false);
      throw err;
    }
    router.replace(ROUTES.library);
  }

  if (data === undefined || (leaving && !item)) return <ItemSkeleton />;
  if (!item) return <ItemNotFound hasId={Boolean(id)} />;
  return <ItemDetail item={item} initialQuery={initialQuery} onDelete={remove} />;
}

function ItemNotFound({ hasId }: { hasId: boolean }) {
  return (
    <Container size="md" className="py-10 sm:py-16">
      <EmptyState
        data-testid="item-not-found"
        bordered
        titleAs="h1"
        icon={<FileQuestion />}
        title={hasId ? "This memory isn't here" : "No memory chosen"}
        description={
          hasId
            ? "It may have been deleted, or it was saved in a different browser. Memories only live in the browser where you added them."
            : "Pick something from your library to see it here."
        }
        action={
          <>
            <Button href={ROUTES.library} leftIcon={<ChevronLeft />}>
              Back to library
            </Button>
            <Button href={ROUTES.search} variant="secondary" leftIcon={<Search />}>
              Search memories
            </Button>
          </>
        }
      />
    </Container>
  );
}

// ---------------------------------------------------------------------------------------------

interface ItemDetailProps {
  item: MemoryItem;
  initialQuery: string;
  onDelete: () => Promise<void>;
}

function ItemDetail({ item, initialQuery, onDelete }: ItemDetailProps) {
  const [confirm, setConfirm] = useState<null | "delete" | "original">(null);
  const [retrying, setRetrying] = useState(false);
  const processing = item.status === "processing";
  const failed = item.status === "error";
  const canRetry = !processing && (failed || (!item.text.trim() && Boolean(item.hasFile)));
  const canDownload = Boolean(item.hasFile) || Boolean(item.text);
  // Looked up now so "Open original" can open its tab right inside the click.
  const original = useStoredOriginal(item.id, item.hasFile);

  async function retry() {
    setRetrying(true);
    try {
      await retryItem(item.id);
    } finally {
      setRetrying(false);
    }
  }

  async function togglePin() {
    const next = !item.pinned;
    if (await setPinned([item.id], next)) {
      toast.success(next ? "Pinned to the top" : "Unpinned", {
        id: "memory-pin",
        description: next ? "It now shows first in your library." : undefined,
        duration: 1800,
      });
    }
  }

  const download = () => void downloadOriginal(item, original);
  const open = () => void openOriginal(item, original);

  return (
    <Container className="py-6 sm:py-10">
      <div data-testid="item-page" data-item-id={item.id} data-kind={item.kind} data-status={item.status}>
        <div className="mb-5 flex flex-wrap items-center gap-2 sm:mb-7">
          <Button href={ROUTES.library} variant="ghost" size="sm" leftIcon={<ChevronLeft />} data-testid="item-back">
            Library
          </Button>
          {initialQuery ? (
            <Button href={searchHref(initialQuery)} variant="ghost" size="sm" leftIcon={<Search />}>
              Back to “{initialQuery.length > 28 ? `${initialQuery.slice(0, 27)}…` : initialQuery}”
            </Button>
          ) : null}
        </div>

        {/* ---------- header ---------- */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
          <KindIcon kind={item.kind} size="xl" label={KIND_META[item.kind].label} />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <KindBadge kind={item.kind} />
              {item.pinned ? (
                <Badge tone="brand" icon={<Pin className="fill-current" />}>
                  Pinned
                </Badge>
              ) : null}
              {item.sample ? <Badge tone="info">Sample</Badge> : null}
              {processing ? (
                <Badge tone="brand" dot pulse>
                  Reading…
                </Badge>
              ) : null}
              {failed ? (
                <Badge tone="danger" icon={<AlertTriangle />}>
                  Needs attention
                </Badge>
              ) : null}
            </div>
            <EditableTitle itemId={item.id} title={item.title} />
            <MetaRow item={item} />
          </div>
        </header>

        {/* ---------- actions ---------- */}
        <div className="mt-5 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Memory actions">
          {item.hasFile ? (
            <Button
              leftIcon={<ExternalLink />}
              onClick={open}
              title="Opens in a new tab with your browser's own viewer"
              data-testid="open-original"
            >
              Open original
              <span className="sr-only"> (opens in a new tab)</span>
            </Button>
          ) : null}
          {canDownload ? (
            <Button variant="secondary" leftIcon={<Download />} onClick={download} data-testid="item-download">
              {item.hasFile ? "Download" : "Download text"}
            </Button>
          ) : null}
          {item.text ? <CopyButton value={() => item.text} label="Copy text" variant="secondary" size="md" data-testid="item-copy-text" /> : null}
          <Button
            variant={item.pinned ? "soft" : "secondary"}
            leftIcon={item.pinned ? <PinOff /> : <Pin />}
            onClick={togglePin}
            aria-pressed={Boolean(item.pinned)}
            data-testid="item-pin"
          >
            {item.pinned ? "Unpin" : "Pin"}
          </Button>
          {canRetry ? (
            <Button variant="soft" leftIcon={<RotateCw />} loading={retrying} onClick={retry} data-testid="item-retry">
              {failed ? "Retry" : "Try reading again"}
            </Button>
          ) : null}
          <Button
            variant="outline"
            leftIcon={<Trash2 className="text-rose-500" />}
            onClick={() => setConfirm("delete")}
            data-testid="item-delete"
          >
            Delete
          </Button>
          <Menu
            label="More actions"
            icon={<MoreHorizontal />}
            variant="ghost"
            align="end"
            data-testid="item-more"
            items={[
              {
                label: "Search for related things",
                description: "Find memories about the same subject",
                icon: <Search />,
                href: searchHref(item.title),
              },
              {
                label: "Show in storage explorer",
                description: "See every record this memory keeps",
                icon: <HardDrive />,
                href: explorerHref(item.id),
              },
              {
                label: "Remove original to save space",
                description: item.hasFile ? "Keeps the text, preview and search" : "No original file is stored",
                icon: <HardDriveDownload />,
                disabled: !item.hasFile || processing,
                onSelect: () => setConfirm("original"),
                "data-testid": "item-remove-original",
              },
            ]}
          />
        </div>

        <StatusBanner item={item} onRetry={retry} retrying={retrying} />

        <WhereStored item={item} onOpenOriginal={item.hasFile ? open : undefined} onDownload={canDownload ? download : undefined} />

        {/* ---------- content ---------- */}
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            {hasVisualPreview(item) ? <ItemPreview item={item} onDownload={item.hasFile ? download : undefined} /> : null}
            <TextPanel item={item} initialQuery={initialQuery} />
          </div>
          <aside className="min-w-0 space-y-6" aria-label="About this memory">
            <ItemEntities item={item} />
            <TagEditor item={item} />
            <DetailsCard item={item} />
          </aside>
        </div>

        {processing ? null : <RelatedMemories item={item} />}
      </div>

      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        danger
        title="Delete this memory?"
        description={
          <>
            “{item.title}” and everything Remembos found in it will be removed from this device for good. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete memory"
        onConfirm={onDelete}
        data-testid="item-delete-dialog"
      />
      <ConfirmDialog
        open={confirm === "original"}
        onClose={() => setConfirm(null)}
        title="Remove the original file?"
        description={
          <>
            Frees about <strong className="font-semibold text-zinc-900 dark:text-white">{formatBytes(item.size)}</strong>. The text,
            preview and search stay — you just won&apos;t be able to open or download the original any more.
          </>
        }
        confirmLabel="Remove original"
        onConfirm={async () => {
          await deleteOriginals([item.id]);
        }}
        data-testid="item-original-dialog"
      />
    </Container>
  );
}

// ---------------------------------------------------------------------------------------------

function MetaItem({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string }) {
  return (
    <li className="inline-flex items-center gap-1.5" title={title}>
      <span aria-hidden className="text-zinc-400 dark:text-zinc-500 [&>svg]:size-4">
        {icon}
      </span>
      {children}
    </li>
  );
}

function MetaRow({ item }: { item: MemoryItem }) {
  const showSource = item.sourceDate && Math.abs(item.sourceDate - item.createdAt) > 60_000;
  const words = item.kind === "note" || (item.kind === "text" && !item.sourceName) ? wordCount(item.text) : null;
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted" data-testid="item-meta">
      <MetaItem icon={<CalendarPlus />} title={`Added ${fullDate(item.createdAt)}`}>
        Added {timeAgo(item.createdAt)}
      </MetaItem>
      {showSource && item.sourceDate ? (
        <MetaItem icon={<FileClock />} title={`File date ${fullDate(item.sourceDate)}`}>
          From {formatDate(item.sourceDate)}
        </MetaItem>
      ) : null}
      {words !== null ? (
        <MetaItem icon={<Layers />}>
          {words.toLocaleString()} {words === 1 ? "word" : "words"}
        </MetaItem>
      ) : item.size ? (
        <MetaItem icon={<HardDrive />}>{formatBytes(item.size)}</MetaItem>
      ) : null}
      {item.pageCount ? (
        <MetaItem icon={<Layers />}>
          {item.pageCount} {item.pageCount === 1 ? "page" : "pages"}
        </MetaItem>
      ) : null}
      {item.durationSec ? <MetaItem icon={<Clock />}>{formatDuration(item.durationSec)}</MetaItem> : null}
      {typeof item.ocrConfidence === "number" ? (
        <li>
          <Badge
            tone={ocrTone(item.ocrConfidence)}
            icon={<ScanText />}
            title="How sure the on-device text reader is about the words it read"
          >
            {Math.round(item.ocrConfidence)}% read confidence
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

function StatusBanner({ item, onRetry, retrying }: { item: MemoryItem; onRetry: () => void; retrying: boolean }) {
  const jobs = useQueue();
  if (item.status === "processing") {
    const job = jobs.find((j) => j.itemId === item.id && j.stage !== "done" && j.stage !== "cancelled");
    const label = job ? (job.message ?? STAGE_LABELS[job.stage]) : "Waiting to be read";
    const determinate = Boolean(job && job.progress > 0 && job.progress < 1);
    return (
      <div
        className="mt-6 flex flex-col gap-3 rounded-2xl border border-brand-500/20 bg-brand-50/70 p-4 sm:flex-row sm:items-center sm:gap-4 dark:border-brand-400/20 dark:bg-brand-400/10"
        data-testid="item-processing"
        role="status"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-soft dark:bg-white/10 dark:text-brand-300">
          <Spinner size="md" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Reading this {KIND_META[item.kind].label.toLowerCase()} on your device…</p>
          <p className="mt-0.5 truncate text-sm text-muted">
            {label}
            {determinate && job ? ` · ${Math.round(job.progress * 100)}%` : ""}
          </p>
          <Progress
            className="mt-2.5"
            size="sm"
            value={job?.progress}
            indeterminate={!determinate}
            label="Processing progress"
          />
        </div>
      </div>
    );
  }
  if (item.status === "error") {
    return (
      <div
        className="mt-6 flex flex-col gap-3 rounded-2xl border border-rose-500/25 bg-rose-50/80 p-4 sm:flex-row sm:items-center sm:gap-4 dark:border-rose-400/20 dark:bg-rose-500/10"
        data-testid="item-error"
        role="alert"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-rose-600 shadow-soft dark:bg-white/10 dark:text-rose-300">
          <AlertTriangle aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-white">Remembos couldn&apos;t finish reading this</p>
          <p className="mt-0.5 text-sm leading-relaxed text-rose-800 dark:text-rose-200">
            {item.error || "Something went wrong while reading it."}
          </p>
        </div>
        <Button variant="secondary" leftIcon={<RotateCw />} loading={retrying} onClick={onRetry} className="self-start sm:self-center">
          Retry
        </Button>
      </div>
    );
  }
  return null;
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 text-right break-words text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}

function DetailsCard({ item }: { item: MemoryItem }) {
  const words = wordCount(item.text);
  return (
    <Card padding="sm" radius="2xl" data-testid="item-details">
      <CardHeader icon={<Info />} title="Details" />
      <dl className="mt-2 divide-y divide-zinc-200/70 text-sm dark:divide-white/[0.07]">
        <DetailRow label="Kind">{KIND_META[item.kind].label}</DetailRow>
        {item.sourceName ? (
          <DetailRow label="File">
            <span className="font-mono text-[12.5px]">{item.sourceName}</span>
          </DetailRow>
        ) : null}
        <DetailRow label="Added">{fullDate(item.createdAt)}</DetailRow>
        {item.sourceDate ? <DetailRow label="File date">{fullDate(item.sourceDate)}</DetailRow> : null}
        {fromFile(item) && item.size ? <DetailRow label="Size">{formatBytes(item.size)}</DetailRow> : null}
        {item.width && item.height ? (
          <DetailRow label="Dimensions">
            {item.width.toLocaleString()} × {item.height.toLocaleString()}
          </DetailRow>
        ) : null}
        {item.pageCount ? <DetailRow label="Pages">{item.pageCount.toLocaleString()}</DetailRow> : null}
        {item.durationSec ? <DetailRow label="Length">{formatDuration(item.durationSec)}</DetailRow> : null}
        <DetailRow label="Words">{words.toLocaleString()}</DetailRow>
        {fromFile(item) ? (
          <DetailRow label="Original">
            {item.hasFile ? (
              <span className="text-emerald-700 dark:text-emerald-300">Kept on this device</span>
            ) : (
              <span>Removed to save space</span>
            )}
          </DetailRow>
        ) : null}
        <DetailRow label="Meaning search">
          {item.embedded ? (
            <span className="text-emerald-700 dark:text-emerald-300">Ready</span>
          ) : item.status === "processing" ? (
            "After reading"
          ) : (
            <span title="Keyword search already works. Meaning search catches up in the background.">Catching up</span>
          )}
        </DetailRow>
      </dl>
      {item.sample ? (
        <p className={cn("mt-3 rounded-xl bg-sky-500/10 px-3 py-2 text-xs leading-relaxed text-sky-800 dark:text-sky-200")}>
          This is a sample memory. Remove all samples anytime from Your data.
        </p>
      ) : null}
    </Card>
  );
}
