"use client";

import { ChevronDown, Eraser, RotateCw, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { KindIcon } from "@/components/ui/KindIcon";
import { Progress, ProgressRing } from "@/components/ui/Progress";
import { itemHref } from "@/lib/config";
import { cancelJob, clearFinishedJobs, dismissJob, retryItem, useQueue } from "@/lib/ingest";
import type { QueueJob } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";
import { canOpen, isFinished, stageLabel, steadyProgress, summarize } from "./queue-labels";

/** How long the dock lingers after everything has finished before tucking itself away. */
const AUTO_HIDE_MS = 4500;
/** While someone is pointing at / keyboard-focused in the dock, check again after this long. */
const ENGAGED_RECHECK_MS = 1500;

/** The person is using the dock right now (hovering it, or keyboard focus inside it). */
function isEngaged(el: HTMLElement | null): boolean {
  if (!el) return false;
  return el.matches(":hover") || el.querySelector(":focus-visible") !== null;
}

const ICON_BUTTON =
  "grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-900/5 hover:text-zinc-900 " +
  "dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white [&_svg]:size-4";

const JobRow = memo(function JobRow({ job }: { job: QueueJob }) {
  const finished = isFinished(job);
  const failed = job.stage === "error";
  const label = stageLabel(job);
  const name = job.name || "Untitled";

  function retry() {
    dismissJob(job.id);
    void retryItem(job.itemId);
  }

  return (
    <li
      data-testid="queue-job"
      data-stage={job.stage}
      className="flex items-center gap-3 rounded-2xl px-2.5 py-2 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1 starting:opacity-0 motion-reduce:transition-none"
    >
      <KindIcon kind={job.kind} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100" title={name}>
          {name}
        </p>
        <p
          className={cn(
            "text-xs",
            failed
              ? "line-clamp-2 text-rose-600 dark:text-rose-400"
              : cn("truncate", job.stage === "done" ? "text-emerald-700 dark:text-emerald-400" : "text-muted"),
          )}
          title={label}
        >
          {label}
          {job.stage === "done" && job.size > 0 ? <span className="text-muted"> · {formatBytes(job.size)}</span> : null}
        </p>
        {!finished ? (
          <Progress
            value={steadyProgress(job)}
            indeterminate={job.stage === "queued"}
            tone={job.stage === "embedding" ? "success" : "brand"}
            size="xs"
            label={`${name}: ${label}`}
            className="mt-1.5"
          />
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {canOpen(job) ? (
          <Button href={itemHref(job.itemId)} variant="soft" size="sm" data-testid="queue-job-open" aria-label={`Open ${name}`}>
            Open
          </Button>
        ) : null}
        {failed ? (
          <Button variant="soft" size="sm" leftIcon={<RotateCw />} onClick={retry} data-testid="queue-job-retry" aria-label={`Retry ${name}`}>
            Retry
          </Button>
        ) : null}
        {finished ? (
          <button
            type="button"
            onClick={() => dismissJob(job.id)}
            aria-label={`Hide ${name} from this list`}
            data-testid="queue-job-dismiss"
            className={ICON_BUTTON}
          >
            <X aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => cancelJob(job.id)}
            aria-label={job.stage === "embedding" ? `Hide ${name} (it's already saved)` : `Cancel ${name}`}
            data-testid="queue-job-cancel"
            className={ICON_BUTTON}
          >
            <X aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
});

/** CSS variable read by globals.css to lift toasts above the dock on phones. */
const DOCK_SPACE_VAR = "--queue-dock-space";

/**
 * Floating "Remembering…" panel (bottom-left, above the mobile tab bar) listing files being processed:
 * what is happening to each, progress, cancel / retry / open. Collapsible; tucks itself away a few
 * seconds after everything finishes (and comes back when new files arrive). Mounted once by the shell.
 */
export function QueueDock() {
  const jobs = useQueue();
  const summary = summarize(jobs);
  const [collapsed, setCollapsed] = useState(false);
  /** Jobs the dock has already been tucked away for; any new job brings it back. */
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Finished-state key the dock auto-collapsed for (errors keep a small pill instead of hiding). */
  const [collapsedFor, setCollapsedFor] = useState<string | null>(null);
  const dockRef = useRef<HTMLElement>(null);

  // More work arrived → open up again so people see it started.
  const [prevActive, setPrevActive] = useState(summary.active);
  if (prevActive !== summary.active) {
    setPrevActive(summary.active);
    if (summary.active > prevActive && collapsed) setCollapsed(false);
  }

  // Everything was pruned → forget which jobs we hid, and start fresh next time.
  if (jobs.length === 0 && (hiddenIds.size > 0 || collapsedFor !== null)) {
    setHiddenIds(new Set());
    setCollapsedFor(null);
  }

  const visible = jobs.some((j) => !hiddenIds.has(j.id));
  const finishedKey = summary.allFinished && jobs.length ? jobs.map((j) => `${j.id}:${j.stage}`).join("|") : null;

  useEffect(() => {
    if (!finishedKey || !visible) return;
    const ids = finishedKey.split("|").map((part) => part.slice(0, part.lastIndexOf(":")));
    let timer = 0;
    const settle = () => {
      // Checked when the timer fires (not tracked with enter/leave events, which go missing when rows
      // disappear from under the pointer).
      if (isEngaged(dockRef.current)) {
        timer = window.setTimeout(settle, ENGAGED_RECHECK_MS);
        return;
      }
      if (summary.failed > 0) {
        // Keep a small "needs attention" pill around; the batch toast already offered Retry.
        if (collapsedFor !== finishedKey) {
          setCollapsedFor(finishedKey);
          setCollapsed(true);
        }
      } else {
        setHiddenIds(new Set(ids));
      }
    };
    timer = window.setTimeout(settle, AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [finishedKey, visible, summary.failed, collapsedFor]);

  // On phones the dock and toasts share the bottom edge: publish the dock's height so toasts stack above it.
  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    if (!visible || !el) return;
    const update = () => root.style.setProperty(DOCK_SPACE_VAR, `${Math.ceil(el.offsetHeight) + 8}px`);
    update();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(DOCK_SPACE_VAR);
    };
  }, [visible]);

  if (!jobs.length) return null;

  const finishedCount = jobs.filter(isFinished).length;
  const headerTone = summary.failed > 0 && summary.allFinished ? "danger" : summary.allFinished ? "success" : "brand";
  const listId = "queue-dock-list";

  return (
    <section
      ref={dockRef}
      aria-label="Files being remembered"
      data-testid="queue-dock"
      data-collapsed={collapsed || undefined}
      data-hidden={!visible || undefined}
      inert={!visible}
      className={cn(
        "glass fixed right-3 bottom-[calc(var(--app-bottom-inset)+0.75rem)] left-3 z-50 overflow-hidden rounded-3xl border shadow-pop",
        "border-zinc-200/80 dark:border-white/10",
        "sm:right-auto sm:bottom-[calc(var(--app-bottom-inset)+1.25rem)] sm:left-5 sm:w-[23rem]",
        "transition-[opacity,translate,visibility] duration-300 ease-spring motion-reduce:transition-none",
        "starting:translate-y-4 starting:opacity-0",
        visible ? "visible translate-y-0 opacity-100" : "pointer-events-none invisible translate-y-4 opacity-0",
      )}
    >
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-testid="queue-dock-toggle"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-1 pr-1 text-left"
        >
          <ProgressRing
            value={summary.allFinished ? 1 : summary.progress}
            size={30}
            stroke={3.5}
            tone={headerTone}
            label="Overall progress"
          >
            <span className={cn("text-[9px]", headerTone === "danger" ? "text-rose-600 dark:text-rose-400" : "text-zinc-600 dark:text-zinc-300")}>
              {summary.allFinished ? (summary.failed > 0 ? "!" : "✓") : `${Math.round(summary.progress * 100)}`}
            </span>
          </ProgressRing>
          <span className="min-w-0 flex-1">
            <span aria-live="polite" className="block truncate text-sm font-semibold text-zinc-900 dark:text-white">
              {summary.title}
            </span>
            <span className="block truncate text-xs text-muted">
              {summary.allFinished
                ? "Saved on this device only"
                : summary.active > 0
                  ? "Nothing leaves this device"
                  : "Saved · finishing meaning search"}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-zinc-500 transition-transform duration-200 motion-reduce:transition-none dark:text-zinc-400",
              collapsed && "rotate-180",
            )}
          />
          <span className="sr-only">{collapsed ? "Show details" : "Hide details"}</span>
        </button>
        {finishedCount > 0 ? (
          <button
            type="button"
            onClick={clearFinishedJobs}
            aria-label="Clear finished files from this list"
            title="Clear finished"
            data-testid="queue-dock-clear"
            className={ICON_BUTTON}
          >
            {summary.allFinished ? <X aria-hidden /> : <Eraser aria-hidden />}
          </button>
        ) : null}
      </div>

      <div
        id={listId}
        hidden={collapsed}
        className="border-t border-zinc-200/70 dark:border-white/[0.08]"
      >
        <ul className="max-h-[min(19rem,34dvh)] space-y-0.5 sm:max-h-[min(19rem,45dvh)] overflow-y-auto overscroll-contain p-1.5">
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      </div>
    </section>
  );
}
