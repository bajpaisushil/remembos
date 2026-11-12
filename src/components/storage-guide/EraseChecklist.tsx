import { CircleCheck, CircleX, ShieldCheck, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { BackupButton } from "./actions";
import { ERASES, SAFE, type ChecklistEntry } from "./content";

function Checklist({
  entries,
  tone,
  title,
  subtitle,
  headIcon: HeadIcon,
  itemIcon: ItemIcon,
  testId,
  footer,
}: {
  entries: ChecklistEntry[];
  tone: "danger" | "safe";
  title: string;
  subtitle: string;
  headIcon: LucideIcon;
  itemIcon: LucideIcon;
  testId: string;
  footer?: ReactNode;
}) {
  const danger = tone === "danger";
  return (
    <Card padding="none" className="flex flex-col overflow-hidden" data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div
        className={cn(
          "flex items-center gap-3.5 border-b px-5 py-4 sm:px-6",
          danger
            ? "border-rose-500/15 bg-rose-500/[0.06] dark:border-rose-400/15 dark:bg-rose-400/[0.07]"
            : "border-emerald-500/15 bg-emerald-500/[0.06] dark:border-emerald-400/15 dark:bg-emerald-400/[0.06]",
        )}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl text-white",
            danger ? "bg-rose-600 shadow-[0_8px_20px_-8px_rgb(225_29_72/0.7)] dark:bg-rose-500" : "bg-emerald-600 shadow-[0_8px_20px_-8px_rgb(5_150_105/0.7)] dark:bg-emerald-500",
          )}
        >
          <HeadIcon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 id={`${testId}-title`} className={cn("text-base font-semibold tracking-tight", danger ? "text-rose-900 dark:text-rose-100" : "text-emerald-900 dark:text-emerald-100")}>
            {title}
          </h3>
          <p className={cn("text-[13px]", danger ? "text-rose-900/75 dark:text-rose-100/75" : "text-emerald-900/75 dark:text-emerald-100/75")}>{subtitle}</p>
        </div>
      </div>
      <ul className="flex-1 divide-y divide-zinc-200/70 px-5 sm:px-6 dark:divide-white/[0.07]">
        {entries.map((e) => (
          <li key={e.title} className="flex gap-3 py-3.5">
            <ItemIcon aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", danger ? "text-rose-500 dark:text-rose-400" : "text-emerald-500 dark:text-emerald-400")} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">{e.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{e.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {footer}
    </Card>
  );
}

/** "These erase your memories" vs "These are safe". */
export function EraseChecklist() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Checklist
        entries={ERASES}
        tone="danger"
        title="These erase your memories"
        subtitle="Avoid them — or back up first."
        headIcon={TriangleAlert}
        itemIcon={CircleX}
        testId="erase-checklist"
      />
      <Checklist
        entries={SAFE}
        tone="safe"
        title="These are safe"
        subtitle="Your memories stay right where they are."
        headIcon={ShieldCheck}
        itemIcon={CircleCheck}
        testId="safe-checklist"
        footer={
          <div className="m-4 mt-1 rounded-2xl border border-zinc-200/70 bg-zinc-50/80 p-4 sm:m-5 sm:mt-1 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <p className="text-sm font-semibold text-zinc-900 dark:text-white">Not sure about a setting?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Download a backup first — it takes a few seconds, and you can restore everything from it on any browser.
            </p>
            <BackupButton size="sm" variant="secondary" className="mt-3" data-testid="checklist-backup-button" />
          </div>
        }
      />
    </div>
  );
}
