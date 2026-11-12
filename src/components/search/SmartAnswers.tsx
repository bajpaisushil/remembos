"use client";

import { ArrowRight, ExternalLink, Mail, Phone, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { buttonClasses, Card, CopyButton, ENTITY_ICONS, KindIcon } from "@/components/ui";
import { ENTITY_META, KIND_META } from "@/lib/config";
import { locateValue } from "@/lib/search/rank";
import type { SmartAnswer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ANSWER_LABEL, answerAction, formatAnswerValue, memoryHref, type AnswerActionKind } from "./format";
import { Highlight } from "./Highlight";

const ACTION_ICONS: Record<AnswerActionKind, LucideIcon> = { call: Phone, email: Mail, open: ExternalLink };
const INITIAL_VISIBLE = 4;

export interface SmartAnswersProps {
  answers: SmartAnswer[];
  /** The question, carried to the memory page for highlighting. */
  query: string;
  /** Called when an answer is used (copied, called, opened) — e.g. to remember the search. */
  onUse?: () => void;
}

/** Big, friendly cards with the exact phone numbers, amounts, emails, links or dates that were asked for. */
export function SmartAnswers({ answers, query, onUse }: SmartAnswersProps) {
  const [expanded, setExpanded] = useState(false);
  if (!answers.length) return null;
  const single = answers.length === 1;
  const visible = expanded ? answers : answers.slice(0, INITIAL_VISIBLE);
  const hidden = answers.length - visible.length;

  return (
    <section aria-labelledby="smart-answers-heading" data-testid="smart-answers" className="animate-slide-up">
      <h2 id="smart-answers-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white">
        <span className="grid size-6 place-items-center rounded-lg brand-gradient text-white shadow-glow">
          <Sparkles aria-hidden className="size-3.5" />
        </span>
        {single ? "Here's what you asked for" : `Found ${answers.length} answers in your memories`}
      </h2>
      <ul className={cn("grid gap-3 sm:gap-4", !single && "sm:grid-cols-2")}>
        {visible.map((a) => (
          <AnswerCard key={`${a.type}:${a.value}:${a.itemId}`} answer={a} query={query} large={single} onUse={onUse} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "mt-2" })}
          data-testid="smart-answers-more"
        >
          Show {hidden} more {hidden === 1 ? "answer" : "answers"}
        </button>
      ) : null}
    </section>
  );
}

function AnswerCard({ answer, query, large, onUse }: { answer: SmartAnswer; query: string; large: boolean; onUse?: () => void }) {
  const meta = ENTITY_META[answer.type];
  const Icon = ENTITY_ICONS[answer.type];
  const action = answerAction(answer.type, answer.value);
  const ActionIcon = action ? ACTION_ICONS[action.kind] : null;
  const display = formatAnswerValue(answer.type, answer.value);
  const at = answer.context ? locateValue(answer.context, answer.value, answer.type) : null;
  const longValue = display.length > 28;

  return (
    <Card
      as="li"
      padding="none"
      className="flex min-w-0 flex-col overflow-hidden"
      data-testid="smart-answer"
      data-answer-type={answer.type}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-90 dark:opacity-100"
        style={{ backgroundImage: `radial-gradient(120% 100% at 0% 0%, ${meta.hex}24, transparent 70%)` }}
      />
      <div className={cn("relative flex flex-1 flex-col p-5", large && "sm:p-7")}>
        <p className={cn("flex items-center gap-1.5 text-xs font-semibold tracking-[0.12em] uppercase", meta.color)}>
          <Icon aria-hidden className="size-3.5" strokeWidth={2.4} />
          {ANSWER_LABEL[answer.type]}
        </p>
        <p
          className={cn(
            "mt-2 font-semibold tracking-tight text-zinc-900 tabular-nums select-all dark:text-white",
            answer.type === "url" || answer.type === "email" ? "break-all" : "break-words",
            large ? (longValue ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl") : longValue ? "text-lg sm:text-xl" : "text-2xl sm:text-[1.75rem]",
          )}
          data-testid="smart-answer-value"
          title={answer.value}
        >
          {display}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {action && ActionIcon ? (
            <a
              href={action.href}
              onClick={onUse}
              {...(action.kind === "open" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={buttonClasses({ variant: "primary", size: "sm" })}
              data-testid={`smart-answer-${action.kind}`}
            >
              <ActionIcon aria-hidden />
              {action.label}
              {action.kind === "open" ? <span className="sr-only"> (opens in a new tab)</span> : null}
            </a>
          ) : null}
          <span onClickCapture={onUse} className="contents">
            <CopyButton value={answer.value} variant="secondary" label="Copy" data-testid="smart-answer-copy" />
          </span>
        </div>

        {answer.context ? (
          <blockquote
            className={cn(
              "mt-4 rounded-2xl bg-zinc-50/90 px-3.5 py-3 text-sm leading-relaxed text-zinc-600 ring-1 ring-zinc-200/70 ring-inset",
              "dark:bg-white/[0.03] dark:text-zinc-300 dark:ring-white/[0.07]",
            )}
          >
            <Highlight text={answer.context} ranges={at ? [[at.index, at.index + at.length]] : undefined} />
          </blockquote>
        ) : null}

        <div className={cn("mt-auto", answer.context ? "pt-3" : "pt-4")}>
          <Link
            href={memoryHref(answer.itemId, query)}
            onClick={onUse}
            className="group/source -mx-2 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors hover:bg-zinc-900/[0.04] dark:hover:bg-white/[0.05]"
            data-testid="smart-answer-source"
          >
            <KindIcon kind={answer.itemKind} size="sm" label={KIND_META[answer.itemKind].label} />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">From </span>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{answer.itemTitle || "Untitled memory"}</span>
            </span>
            <ArrowRight
              aria-hidden
              className="size-4 shrink-0 text-zinc-400 transition-transform group-hover/source:translate-x-0.5 group-hover/source:text-brand-600 dark:group-hover/source:text-brand-300"
            />
          </Link>
        </div>
      </div>
    </Card>
  );
}
