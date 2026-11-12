"use client";

import { CalendarDays, RotateCcw, Sparkles, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ENTITY_ICONS, KindIcon, Spinner, Tooltip } from "@/components/ui";
import { embedderStatus } from "@/lib/ai/embedder";
import { ENTITY_META, MODELS, ROUTES } from "@/lib/config";
import { openOfflineSetup } from "@/lib/offline";
import { useSettings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import type { ParsedQuery, SearchResponse } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { INTENT_LABEL, KIND_HINT_LABEL } from "./format";

const CHIP =
  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-zinc-200/90 bg-white pl-2.5 text-[13px] font-medium text-zinc-800 shadow-[0_1px_0_0_rgb(0_0_0/0.02)] " +
  "dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-100";

export interface QueryUnderstandingProps {
  parsed: ParsedQuery;
  /** The date phrase was switched off by the person. */
  dateIgnored: boolean;
  onRemoveDate: () => void;
  onRestoreDate: () => void;
}

/** "Understood" chips: the time range, what is being asked for, and the kinds of memory mentioned. */
export function QueryUnderstanding({ parsed, dateIgnored, onRemoveDate, onRestoreDate }: QueryUnderstandingProps) {
  const { dateRange, intents, kindHints } = parsed;
  if (!dateRange && !intents.length && !kindHints.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="query-understanding">
      <span className="mr-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted">
        <Sparkles aria-hidden className="size-3.5 text-brand-500 dark:text-brand-300" />
        Understood
      </span>

      {dateRange ? (
        dateIgnored ? (
          <span className={cn(CHIP, "border-dashed pr-1 text-muted")} data-testid="date-chip" data-ignored="">
            <CalendarDays aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">Any time</span>
            <button
              type="button"
              onClick={onRestoreDate}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-500/10 dark:text-brand-200 dark:hover:bg-brand-400/15"
              data-testid="restore-date-filter"
            >
              <RotateCcw aria-hidden className="size-3" />
              Only {dateRange.label}
            </button>
          </span>
        ) : (
          <span className={cn(CHIP, "pr-0.5")} data-testid="date-chip">
            <CalendarDays aria-hidden className="size-3.5 shrink-0 text-pink-600 dark:text-pink-300" />
            <span className="truncate">{dateRange.label}</span>
            <button
              type="button"
              onClick={onRemoveDate}
              aria-label={`Remove the date filter “${dateRange.label}” and search all dates`}
              title="Search all dates"
              className="grid size-6 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-900/[0.06] hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-white"
              data-testid="remove-date-filter"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        )
      ) : null}

      {intents.map((t) => {
        const Icon = ENTITY_ICONS[t];
        return (
          <span key={t} className={cn(CHIP, "pr-2.5")} data-testid="intent-chip">
            <Icon aria-hidden className={cn("size-3.5 shrink-0", ENTITY_META[t].color)} />
            <span className="truncate">{INTENT_LABEL[t]}</span>
          </span>
        );
      })}

      {kindHints.map((k) => (
        <span key={k} className={cn(CHIP, "pl-1 pr-2.5")} data-testid="kind-hint-chip">
          <KindIcon kind={k} size="xs" />
          <span className="truncate">{KIND_HINT_LABEL[k]}</span>
        </span>
      ))}
    </div>
  );
}

/** Small pill saying whether meaning search helped with this answer — and how to turn it on if not. */
export function MeaningStatus({ response }: { response: SearchResponse }) {
  const settings = useSettings();
  const model = useStore(embedderStatus);

  let content: ReactNode = null;
  let tip = "";
  if (response.semanticUsed) {
    tip = "Also finds memories that mean the same thing in different words.";
    content = (
      <Badge tone="brand" icon={<Sparkles aria-hidden />}>
        Meaning search on
      </Badge>
    );
  } else if (!response.semanticNote) {
    return null;
  } else if (!settings.semanticSearch || model.state === "disabled") {
    tip = "Only exact words are matched. Turn on meaning search in Your data.";
    content = (
      <Link href={ROUTES.data} className="rounded-full" data-testid="meaning-status-link">
        <Badge tone="neutral" className="transition-colors hover:bg-zinc-200/80 dark:hover:bg-white/[0.12]">
          Meaning search off · <span className="text-brand-700 dark:text-brand-300">Turn on</span>
        </Badge>
      </Link>
    );
  } else if (/you.re offline/i.test(response.semanticNote)) {
    tip = "Meaning search needs a one-time download before it works offline. Exact words still work now.";
    content = (
      <button type="button" onClick={openOfflineSetup} className="rounded-full" data-testid="meaning-status-offline">
        <Badge tone="warning" className="transition-colors hover:bg-amber-500/15">
          Exact words only offline · <span className="underline underline-offset-2">Set up</span>
        </Badge>
      </button>
    );
  } else if (model.state === "error") {
    tip = "The meaning-search model couldn't load (offline or blocked). Exact words still work.";
    content = (
      <Link href={ROUTES.data} className="rounded-full" data-testid="meaning-status-link">
        <Badge tone="warning" className="transition-colors hover:bg-amber-500/15">
          Exact words only · <span className="underline underline-offset-2">Why?</span>
        </Badge>
      </Link>
    );
  } else if (model.state === "ready") {
    tip = "Your memories are being prepared for meaning search. Results get smarter in a moment.";
    content = (
      <Badge tone="info" icon={<Spinner size="xs" />}>
        Preparing meaning search…
      </Badge>
    );
  } else {
    const pct = typeof model.progress === "number" && model.progress > 0 ? ` ${Math.round(Math.min(1, model.progress) * 100)}%` : "";
    tip = `Downloading the meaning-search model once (about ${formatBytes(MODELS.embedder.approxBytes, 0)}). Exact-word results are shown meanwhile.`;
    content = (
      <Badge tone="info" icon={<Spinner size="xs" />}>
        Meaning search loading…<span className="tabular-nums">{pct}</span>
      </Badge>
    );
  }

  return (
    <Tooltip content={tip} side="bottom" align="end" describe={false}>
      <span className="inline-flex" data-testid="meaning-status">
        {content}
        <span className="sr-only">. {tip}</span>
      </span>
    </Tooltip>
  );
}
