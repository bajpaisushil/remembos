import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { splitHighlights, type HighlightRange } from "./format";

/** Brand-tinted marker used for every search highlight. */
export const MARK_CLASSES =
  "rounded-[0.3em] bg-brand-500/15 px-[0.12em] font-medium text-brand-800 [box-decoration-break:clone] [-webkit-box-decoration-break:clone] " +
  "dark:bg-brand-400/25 dark:text-brand-50";

export interface HighlightProps {
  text: string;
  /** [start, end) ranges inside `text`; may overlap or be unsorted. */
  ranges?: readonly HighlightRange[];
  className?: string;
  markClassName?: string;
}

/** Text with the matched parts wrapped in <mark>. */
export function Highlight({ text, ranges, className, markClassName }: HighlightProps) {
  const parts = splitHighlights(text, ranges);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className={cn(MARK_CLASSES, markClassName)}>
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </span>
  );
}
