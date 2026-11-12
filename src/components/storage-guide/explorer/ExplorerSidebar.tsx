"use client";

import { Brain, Cog, Database, FileStack, ImageIcon, Languages, Puzzle, Tags, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { STORAGE_NAMES } from "@/lib/config";
import { classifyDatabase, OCR_DB_EXPLANATION, REMEMBOS_TABLES, TABLE_EXPLANATIONS, type RemembosTable } from "@/lib/storage-inspect";
import { cn } from "@/lib/utils";
import type { ExplorerView, OcrDatabase } from "./data";

export const VIEW_ICONS: Record<ExplorerView, LucideIcon> = {
  items: Brain,
  files: FileStack,
  thumbs: ImageIcon,
  chunks: Puzzle,
  entities: Tags,
  meta: Cog,
  ocr: Languages,
};

export interface ExplorerSidebarProps {
  view: ExplorerView;
  onSelect: (view: ExplorerView) => void;
  /** Live record counts (undefined while loading, null if the database can't be read). */
  counts: Record<RemembosTable, number> | null | undefined;
  /** Databases listed by the browser (null = it can't list them; undefined = still checking). */
  databases: { name: string; version: number | null }[] | null | undefined;
  ocr: OcrDatabase | undefined;
  /** Tables holding rows of the focused memory (get a small dot). */
  focusTables?: ReadonlySet<ExplorerView>;
}

function ViewButton({
  view,
  active,
  onSelect,
  name,
  title,
  explain,
  count,
  marked,
}: {
  view: ExplorerView;
  active: boolean;
  onSelect: (view: ExplorerView) => void;
  name: string;
  title: string;
  explain: string;
  count: ReactNode;
  marked: boolean;
}) {
  const Icon = VIEW_ICONS[view];
  return (
    <li className="shrink-0 lg:min-w-0">
      <button
        type="button"
        onClick={() => onSelect(view)}
        aria-current={active ? "true" : undefined}
        data-testid={`explorer-view-${view}`}
        className={cn(
          "group relative flex h-full min-w-0 items-center gap-2.5 rounded-2xl border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out lg:w-full lg:items-start lg:gap-3 lg:px-3 lg:py-2.5",
          active
            ? "border-brand-500/35 bg-brand-500/[0.07] shadow-soft dark:border-brand-400/35 dark:bg-brand-400/[0.1]"
            : "border-transparent hover:border-zinc-200/90 hover:bg-white dark:hover:border-white/10 dark:hover:bg-white/[0.05]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset lg:mt-0.5 lg:size-8 lg:rounded-xl [&>svg]:size-4",
            active
              ? "brand-gradient text-white ring-white/20"
              : "bg-zinc-100 text-zinc-600 ring-zinc-200/80 group-hover:text-brand-600 dark:bg-white/[0.06] dark:text-zinc-300 dark:ring-white/10 dark:group-hover:text-brand-300",
          )}
        >
          <Icon />
        </span>
        <span className="min-w-0 lg:flex-1">
          <span className="flex items-baseline justify-between gap-2.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <code className={cn("truncate font-mono text-[13px] font-semibold", active ? "text-brand-700 dark:text-brand-200" : "text-zinc-900 dark:text-white")}>
                {name}
              </code>
              {marked ? (
                <>
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-fuchsia-500" />
                  <span className="sr-only">(holds this memory)</span>
                </>
              ) : null}
            </span>
            <span className="shrink-0 text-[13px] font-semibold text-zinc-700 tabular-nums dark:text-zinc-200">{count}</span>
          </span>
          <span className="mt-0.5 hidden text-[12px] font-medium text-zinc-700 lg:block dark:text-zinc-300">{title}</span>
          <span className="mt-0.5 hidden text-[12px] leading-snug text-muted lg:line-clamp-2">{explain}</span>
          <span className="sr-only lg:hidden">
            {title}: {explain}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Left column: the databases this site has, and the tables inside them with live counts. */
export function ExplorerSidebar({ view, onSelect, counts, databases, ocr, focusTables }: ExplorerSidebarProps) {
  const others = (databases ?? []).filter((d) => d.name !== STORAGE_NAMES.appDb && d.name !== STORAGE_NAMES.ocrDb);
  const ocrListed = databases === undefined ? undefined : databases === null ? null : databases.some((d) => d.name === STORAGE_NAMES.ocrDb);
  const appVersion = databases?.find((d) => d.name === STORAGE_NAMES.appDb)?.version ?? null;

  return (
    <nav aria-label="Databases and tables" data-testid="explorer-sidebar" className="min-w-0">
      <div className="rounded-3xl border border-zinc-200/70 bg-white/80 p-2.5 shadow-card dark:border-white/10 dark:bg-white/[0.035]">
        <DbHeading name={STORAGE_NAMES.appDb} badge={<Badge tone="brand" size="sm">Your memories</Badge>} version={appVersion} />
        <ul className="no-scrollbar -mx-2.5 flex gap-1.5 overflow-x-auto px-2.5 pb-0.5 lg:mx-0 lg:grid lg:grid-cols-1 lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {REMEMBOS_TABLES.map((t) => (
            <ViewButton
              key={t}
              view={t}
              active={view === t}
              onSelect={onSelect}
              name={t}
              title={TABLE_EXPLANATIONS[t].title}
              explain={TABLE_EXPLANATIONS[t].explain}
              marked={!!focusTables?.has(t)}
              count={counts === undefined ? <Skeleton className="h-4 w-7 rounded-md" /> : counts === null ? "–" : counts[t].toLocaleString()}
            />
          ))}
        </ul>

        <div className="mx-2 my-2 h-px bg-zinc-200/70 lg:my-2.5 dark:bg-white/[0.08]" />

        <DbHeading name={STORAGE_NAMES.ocrDb} badge={<Badge tone="info" size="sm">Text reader</Badge>} version={ocr?.version ?? null} />
        <ul className="flex lg:block">
          <ViewButton
            view="ocr"
            active={view === "ocr"}
            onSelect={onSelect}
            name={ocr?.stores.length === 1 ? ocr.stores[0].name : "keyval"}
            title={OCR_DB_EXPLANATION.title}
            explain={OCR_DB_EXPLANATION.explain}
            marked={false}
            count={
              ocr === undefined || ocrListed === undefined ? (
                <Skeleton className="h-4 w-7 rounded-md" />
              ) : ocr.exists === false ? (
                <span className="text-[11.5px] font-medium text-muted">not yet</span>
              ) : ocr.exists === null ? (
                "?"
              ) : (
                ocr.total.toLocaleString()
              )
            }
          />
        </ul>

        {others.length ? (
          <div className="mt-2.5 border-t border-zinc-200/70 px-2 pt-2.5 pb-1 dark:border-white/[0.08]">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">Also on this site</p>
            <ul className="mt-1.5 space-y-1">
              {others.map((d) => (
                <li key={d.name} className="flex min-w-0 items-center gap-2 text-[12.5px]">
                  <Database aria-hidden className="size-3.5 shrink-0 text-zinc-400" />
                  <code className="min-w-0 flex-1 truncate font-mono text-zinc-700 dark:text-zinc-300">{d.name}</code>
                  <Badge size="sm">{classifyDatabase(d.name) === "helper" ? "Database helper" : "Not Remembos"}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {databases === null ? (
        <p className="mt-2.5 px-2 text-xs leading-relaxed text-muted">This browser can&apos;t list its databases, so only the ones Remembos uses are shown.</p>
      ) : null}
    </nav>
  );
}

function DbHeading({ name, badge, version }: { name: string; badge: ReactNode; version: number | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 pt-1.5 pb-2">
      <Database aria-hidden className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
      <span className="min-w-0 truncate text-[13px] font-semibold text-zinc-900 dark:text-white">
        <span className="sr-only">Database </span>
        <code className="font-mono">{name}</code>
      </span>
      {badge}
      {version !== null ? <span className="ml-auto shrink-0 text-[11px] text-muted tabular-nums">v{version}</span> : null}
    </div>
  );
}
