"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowRight, Brain, Check, Download, ExternalLink, FileStack, ImageIcon, Puzzle, SearchX, Tags, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { EntityChip } from "@/components/ui/EntityChip";
import { KindIcon } from "@/components/ui/KindIcon";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { itemHref, KIND_META, ROUTES } from "@/lib/config";
import { logicalAddress, storedFileName, type RemembosTable } from "@/lib/storage-inspect";
import type { MemoryItem } from "@/lib/types";
import { cn, formatBytes, formatDate, formatDuration, truncate } from "@/lib/utils";
import { loadItemStorage, type ItemStorage } from "./data";
import { FolderOnDisk } from "./FolderOnDisk";
import { downloadStoredBlob, openBlobInNewTab } from "./open-blob";

export interface ItemFocusProps {
  id: string;
  /** Show one of this memory's tables below. */
  onShowTable: (table: RemembosTable) => void;
  /** Leave the focused view (back to the whole database). */
  onClose: () => void;
}

function fullDate(ms: number): string {
  return formatDate(ms, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Shows a stored preview blob through an object URL that is revoked when it changes or unmounts. */
function BlobImage({ blob, className }: { blob: Blob; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const url = URL.createObjectURL(blob);
    img.src = url;
    return () => {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element -- a local object URL; there is nothing to optimise
  return <img ref={ref} alt="" width={64} height={64} decoding="async" className={className} />;
}

async function load(id: string): Promise<ItemStorage | null | "error"> {
  try {
    return await loadItemStorage(id);
  } catch {
    return "error";
  }
}

/** "This memory is stored here": every record one memory has, its address and the folder on disk. */
export function ItemFocus({ id, onShowTable, onClose }: ItemFocusProps) {
  const data = useLiveQuery(() => load(id), [id]);

  if (data === undefined) return <FocusSkeleton />;
  if (data === null || data === "error") {
    return (
      <Card as="section" aria-labelledby="explorer-item-title" data-testid="explorer-item" data-state="missing" className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-300">
          <SearchX aria-hidden className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="explorer-item-title" tabIndex={-1} className="text-lg font-semibold tracking-tight text-zinc-900 focus:outline-none dark:text-white">
            {data === "error" ? "Couldn't read this memory right now" : "This memory isn't stored here"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {data === "error"
              ? "The database didn't answer. Reload the page to try again."
              : "It may have been deleted, or the link came from another browser or device — each one keeps its own memories."}{" "}
            <code className="font-mono text-[12.5px]">{truncate(id, 40)}</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onClose} data-testid="explorer-item-close">
            Show everything
          </Button>
          <Button href={ROUTES.library} variant="ghost" rightIcon={<ArrowRight />}>
            Library
          </Button>
        </div>
      </Card>
    );
  }

  return <FocusCard data={data} onShowTable={onShowTable} onClose={onClose} />;
}

function FocusCard({ data, onShowTable, onClose }: { data: ItemStorage; onShowTable: (t: RemembosTable) => void; onClose: () => void }) {
  const { item, file, thumb } = data;
  const fileName = file ? storedFileName(file as Blob & { name?: unknown }, item) : undefined;
  const mainTable: RemembosTable = file ? "files" : "items";
  const address = logicalAddress(mainTable, item.id);
  const meta = KIND_META[item.kind];

  return (
    <Card as="section" padding="none" aria-labelledby="explorer-item-title" data-testid="explorer-item" data-state="found" data-item-id={item.id} className="overflow-hidden">
      <div className="relative border-b border-zinc-200/70 bg-linear-to-br from-indigo-500/[0.07] via-violet-500/[0.04] to-fuchsia-500/[0.08] p-4 sm:p-6 dark:border-white/10 dark:from-indigo-500/[0.12] dark:via-violet-500/[0.06] dark:to-fuchsia-500/[0.12]">
        <div className="flex items-start gap-3.5 sm:gap-4">
          <span className="hidden shrink-0 sm:block">
            <KindIcon kind={item.kind} size="lg" />
          </span>
          <span className="shrink-0 sm:hidden">
            <KindIcon kind={item.kind} size="md" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300">This memory is stored here</p>
            <h2
              id="explorer-item-title"
              tabIndex={-1}
              className="mt-1 line-clamp-2 text-xl font-semibold tracking-tight text-zinc-900 focus:outline-none sm:text-2xl dark:text-white"
            >
              {item.title || "Untitled memory"}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <span>{meta?.label ?? item.kind}</span>
              <span aria-hidden>·</span>
              <span>Added {fullDate(item.createdAt)}</span>
              {item.status !== "ready" ? (
                <Badge size="sm" tone={item.status === "error" ? "danger" : "info"} dot pulse={item.status === "processing"}>
                  {item.status === "error" ? "Couldn't be read" : "Still processing"}
                </Badge>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="hidden sm:block">
              <Button href={itemHref(item.id)} variant="secondary" size="sm" rightIcon={<ArrowRight />} data-testid="explorer-item-open-memory">
                Open memory
              </Button>
            </span>
            <Button variant="ghost" size="icon-sm" aria-label="Close — show all records" title="Show all records" onClick={onClose} data-testid="explorer-item-close">
              <X />
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[12px] font-semibold text-zinc-700 dark:text-zinc-300">{file ? "Its original file's address inside your browser" : "Its address inside your browser"}</p>
          <div className="mt-1.5 flex items-center gap-1.5 rounded-2xl border border-brand-500/20 bg-white/85 py-1.5 pr-1.5 pl-3.5 shadow-soft dark:border-brand-400/20 dark:bg-black/25">
            <code className="min-w-0 flex-1 py-1 font-mono text-[13px] font-medium break-all text-zinc-900 dark:text-white" data-testid="explorer-item-address">
              {address}
            </code>
            <CopyButton value={address} label="Copy" variant="secondary" data-testid="explorer-item-address-copy" />
          </div>
          <div className="mt-2 sm:hidden">
            <Button href={itemHref(item.id)} variant="ghost" size="sm" rightIcon={<ArrowRight />}>
              Open memory
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4 sm:p-6 md:grid-cols-2">
        <OriginalTile item={item} file={file} fileName={fileName} onShow={() => onShowTable("files")} />
        <DetailsTile item={item} onShow={() => onShowTable("items")} />
        <PreviewTile item={item} thumb={thumb} onShow={() => onShowTable("thumbs")} />
        <ChunksTile item={item} chunks={data.chunks} onShow={() => onShowTable("chunks")} />
        <EntitiesTile data={data} onShow={() => onShowTable("entities")} />
      </div>

      <div className="border-t border-zinc-200/70 bg-zinc-50/60 p-4 sm:p-6 dark:border-white/10 dark:bg-white/[0.02]">
        <FolderOnDisk table={mainTable} fileName={fileName} />
      </div>
    </Card>
  );
}

function Tile({
  icon: Icon,
  table,
  title,
  onShow,
  children,
  className,
  testId,
}: {
  icon: LucideIcon;
  table: RemembosTable;
  title: string;
  onShow: () => void;
  children: ReactNode;
  className?: string;
  testId: string;
}) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col rounded-2xl border border-zinc-200/70 bg-white p-3.5 sm:p-4 dark:border-white/[0.08] dark:bg-white/[0.025]", className)} data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-white">{title}</h3>
        <button
          type="button"
          onClick={onShow}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 font-mono text-[11.5px] text-brand-700 transition-colors hover:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-400/15"
          aria-label={`Show the ${table} table`}
          data-testid={`explorer-item-show-${table}`}
        >
          {table}
          <ArrowDownToLine aria-hidden className="size-3" />
        </button>
      </div>
      <div className="mt-2.5 min-w-0 flex-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</div>
    </section>
  );
}

function OriginalTile({ item, file, fileName, onShow }: { item: MemoryItem; file: Blob | null; fileName?: string; onShow: () => void }) {
  return (
    <Tile icon={FileStack} table="files" title="Original file" onShow={onShow} testId="explorer-item-original">
      {file ? (
        <>
          <p className="truncate font-medium text-zinc-900 dark:text-white" title={fileName}>
            {fileName}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted tabular-nums">
            {file.type || "unknown type"} · {formatBytes(file.size)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" leftIcon={<ExternalLink />} onClick={() => openBlobInNewTab(file)} data-testid="explorer-item-open-original">
              Open original
            </Button>
            <Button size="sm" variant="secondary" leftIcon={<Download />} onClick={() => downloadStoredBlob(file, fileName ?? `${item.id}.bin`)} data-testid="explorer-item-download">
              Download
            </Button>
          </div>
        </>
      ) : (
        <p>
          {item.hasFile && item.status === "processing"
            ? "Still saving the original… it appears here in a moment."
            : item.kind === "note" || item.kind === "text"
            ? "No separate file — this memory is text, kept in its items record."
            : "No original kept — it was removed to save space, or “Keep original files” was off. The text and search still work."}
        </p>
      )}
    </Tile>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-28 shrink-0 font-mono text-[11.5px] text-muted">{name}</dt>
      <dd className="min-w-0 flex-1 truncate text-[12.5px] text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}

function DetailsTile({ item, onShow }: { item: MemoryItem; onShow: () => void }) {
  const textLength = item.text?.length ?? 0;
  const fromFile = !!item.hasFile || !!item.sourceName;
  return (
    <Tile icon={Brain} table="items" title="Details" onShow={onShow} className="md:row-span-3" testId="explorer-item-details">
      <dl className="space-y-1" data-testid="explorer-item-fields">
        <Field name="id">
          <code className="font-mono">{item.id}</code>
        </Field>
        <Field name="kind">{item.kind}</Field>
        <Field name="title">{item.title || "—"}</Field>
        <Field name="text">{textLength ? `${textLength.toLocaleString()} characters` : "empty"}</Field>
        {item.sourceName ? <Field name="sourceName">{item.sourceName}</Field> : null}
        {item.mimeType ? <Field name="mimeType">{item.mimeType}</Field> : null}
        <Field name="size">{fromFile ? formatBytes(item.size) : `${item.size.toLocaleString()} characters`}</Field>
        <Field name="createdAt">{fullDate(item.createdAt)}</Field>
        {item.sourceDate ? <Field name="sourceDate">{fullDate(item.sourceDate)}</Field> : null}
        {item.pageCount ? <Field name="pageCount">{item.pageCount}</Field> : null}
        {item.durationSec ? <Field name="durationSec">{formatDuration(item.durationSec)}</Field> : null}
        {item.width && item.height ? (
          <Field name="width × height">
            {item.width} × {item.height}
          </Field>
        ) : null}
        {typeof item.ocrConfidence === "number" ? <Field name="ocrConfidence">{Math.round(item.ocrConfidence)}%</Field> : null}
        <Field name="tags">{item.tags?.length ? item.tags.map((t) => `#${t}`).join(" ") : "—"}</Field>
        <Field name="status">{item.status}</Field>
      </dl>
    </Tile>
  );
}

function PreviewTile({ item, thumb, onShow }: { item: MemoryItem; thumb: Blob | null; onShow: () => void }) {
  return (
    <Tile icon={ImageIcon} table="thumbs" title="Preview" onShow={onShow} testId="explorer-item-preview">
      {thumb ? (
        <div className="flex items-center gap-3">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-zinc-200/70 bg-zinc-100 dark:border-white/10 dark:bg-white/[0.05]">
            <BlobImage blob={thumb} className="size-full object-cover" />
          </span>
          <p className="min-w-0">
            <span className="block font-medium text-zinc-900 dark:text-white">Stored</span>
            <span className="block text-[12.5px] text-muted tabular-nums">
              {thumb.type || "image"} · {formatBytes(thumb.size)}
            </span>
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Download preview"
            title="Download preview"
            onClick={() => downloadStoredBlob(thumb, storedFileName(thumb, item, "preview"))}
          >
            <Download />
          </Button>
        </div>
      ) : (
        <p>No preview picture — they&apos;re made for screenshots, photos, PDFs and videos.</p>
      )}
    </Tile>
  );
}

function ChunksTile({ item, chunks, onShow }: { item: MemoryItem; chunks: number; onShow: () => void }) {
  return (
    <Tile icon={Puzzle} table="chunks" title="Search pieces" onShow={onShow} testId="explorer-item-chunks">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-white" data-testid="explorer-item-chunk-count">
          {chunks.toLocaleString()}
        </span>
        <span>{chunks === 1 ? "piece of searchable text" : "pieces of searchable text"}</span>
      </p>
      <p className="mt-2 flex items-center gap-2">
        {item.embedded ? (
          <Badge tone="success" size="sm" icon={<Check />} data-testid="explorer-item-embedded" data-embedded="yes">
            Meaning vectors stored
          </Badge>
        ) : (
          <Badge tone="neutral" size="sm" data-testid="explorer-item-embedded" data-embedded="no">
            No meaning vectors yet
          </Badge>
        )}
      </p>
      <p className="mt-1.5 text-[12.5px] text-muted">
        {item.embedded ? "Found by meaning as well as by words." : "Found by words now; meaning search adds its vectors when it's on and ready."}
      </p>
    </Tile>
  );
}

function EntitiesTile({ data, onShow }: { data: ItemStorage; onShow: () => void }) {
  const { entities, moreEntities } = data;
  return (
    <Tile icon={Tags} table="entities" title="Things found" onShow={onShow} className="md:col-span-2" testId="explorer-item-entities">
      {entities.length ? (
        <div className="flex flex-wrap gap-1.5">
          {entities.map((e) => (
            <EntityChip key={e.id} type={e.type} value={e.value} size="sm" maxChars={36} />
          ))}
          {moreEntities ? <Badge size="sm">+{moreEntities.toLocaleString()} more</Badge> : null}
        </div>
      ) : (
        <p>Nothing found yet — phone numbers, names, amounts, emails, links and dates show up here.</p>
      )}
    </Tile>
  );
}

function FocusSkeleton() {
  return (
    <Card padding="none" aria-busy="true" data-testid="explorer-item-loading" className="overflow-hidden">
      <span role="status" className="sr-only">
        Loading this memory…
      </span>
      <div className="border-b border-zinc-200/70 p-4 sm:p-6 dark:border-white/10">
        <div className="flex items-start gap-4">
          <Skeleton className="size-11 rounded-[14px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40 rounded-full" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-48 rounded-full" />
          </div>
        </div>
        <Skeleton className="mt-5 h-12 w-full rounded-2xl" />
      </div>
      <div className="grid gap-3 p-4 sm:p-6 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-200/70 p-4 dark:border-white/[0.08]">
            <Skeleton className="h-4 w-28 rounded-md" />
            <SkeletonText lines={3} className="mt-3" />
          </div>
        ))}
      </div>
    </Card>
  );
}
