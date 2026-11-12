import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** A lucide icon element, e.g. <SearchX />, or a <KindIcon size="xl" />. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons/links (rendered in a wrapping row). */
  action?: ReactNode;
  /** Anything extra under the actions (tips, small print). */
  children?: ReactNode;
  /** Less vertical padding (for cards/panels). */
  compact?: boolean;
  /** Dashed outline container. */
  bordered?: boolean;
  /** Heading level for the title (default h3; use h1 when the empty state is the whole page). */
  titleAs?: "h1" | "h2" | "h3";
  className?: string;
  "data-testid"?: string;
}

/** Friendly "nothing here yet" block with a soft gradient-blob illustration. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  compact,
  bordered,
  titleAs: Title = "h3",
  className,
  "data-testid": testId,
}: EmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "relative flex flex-col items-center px-6 text-center",
        compact ? "py-10" : "py-16 sm:py-20",
        bordered && "rounded-3xl border-2 border-dashed border-zinc-200 dark:border-white/10",
        className,
      )}
    >
      {icon ? (
        <div className="relative mb-6 grid place-items-center">
          <div
            aria-hidden
            className="absolute size-32 rounded-full bg-linear-to-br from-indigo-400/35 via-violet-400/25 to-fuchsia-400/35 blur-2xl dark:from-indigo-500/30 dark:via-violet-500/25 dark:to-fuchsia-500/30"
          />
          <div aria-hidden className="absolute size-24 animate-spin-slow rounded-full border border-dashed border-brand-400/30 dark:border-brand-300/20" />
          <div className="relative grid size-16 place-items-center rounded-2xl border border-white/80 bg-white/85 text-brand-600 shadow-lift backdrop-blur-md dark:border-white/10 dark:bg-white/10 dark:text-brand-200 [&>svg]:size-7">
            {icon}
          </div>
        </div>
      ) : null}
      <Title className="text-lg font-semibold tracking-tight text-zinc-900 sm:text-xl dark:text-white">{title}</Title>
      {description ? <div className="mt-2 max-w-md text-sm leading-relaxed text-muted sm:text-[15px]">{description}</div> : null}
      {action ? <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{action}</div> : null}
      {children ? <div className="mt-5 text-sm text-muted">{children}</div> : null}
    </div>
  );
}
