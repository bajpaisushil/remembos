import { ChevronDown } from "lucide-react";
import type { ReactNode, SyntheticEvent } from "react";
import { cn } from "@/lib/utils";

export interface AccordionProps {
  children: ReactNode;
  /** "card" = bordered list in one card (default) · "separate" = each item its own card. */
  variant?: "card" | "separate";
  className?: string;
}

/** Container for AccordionItems. */
export function Accordion({ children, variant = "card", className }: AccordionProps) {
  return (
    <div
      className={cn(
        variant === "card"
          ? "divide-y divide-zinc-200/70 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white shadow-soft dark:divide-white/[0.08] dark:border-white/10 dark:bg-white/[0.03]"
          : "flex flex-col gap-3 [&>details]:rounded-2xl [&>details]:border [&>details]:border-zinc-200/70 [&>details]:bg-white [&>details]:shadow-soft dark:[&>details]:border-white/10 dark:[&>details]:bg-white/[0.03]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface AccordionItemProps {
  title: ReactNode;
  /** Muted line under the title. */
  subtitle?: ReactNode;
  /** Leading icon/visual. */
  icon?: ReactNode;
  /** Small element on the right before the chevron (e.g. a <Badge>). */
  meta?: ReactNode;
  /** Initially open (updating it later re-opens, e.g. auto-expanding the user's browser). */
  defaultOpen?: boolean;
  /** Controlled open state (pair with onOpenChange). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Items sharing a `name` behave exclusively (only one open at a time). */
  name?: string;
  id?: string;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** Native <details>/<summary> disclosure, styled. Works without JavaScript. */
export function AccordionItem({
  title,
  subtitle,
  icon,
  meta,
  defaultOpen,
  open,
  onOpenChange,
  name,
  id,
  children,
  className,
  "data-testid": testId,
}: AccordionItemProps) {
  return (
    <details
      id={id}
      name={name}
      open={open ?? defaultOpen}
      onToggle={onOpenChange ? (e: SyntheticEvent<HTMLDetailsElement>) => onOpenChange(e.currentTarget.open) : undefined}
      data-testid={testId}
      className={cn("group/acc", className)}
    >
      <summary
        className={cn(
          "flex list-none items-center gap-3 px-4 py-3.5 select-none sm:px-5 [&::-webkit-details-marker]:hidden",
          "transition-colors hover:bg-zinc-50/80 dark:hover:bg-white/[0.03]",
          "focus-visible:-outline-offset-2",
        )}
      >
        {icon ? <span className="flex shrink-0 text-brand-600 dark:text-brand-300 [&>svg]:size-5">{icon}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
          {subtitle ? <span className="mt-0.5 block text-[13px] text-muted">{subtitle}</span> : null}
        </span>
        {meta ? <span className="shrink-0">{meta}</span> : null}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 group-open/acc:rotate-180 dark:text-zinc-500"
        />
      </summary>
      <div className="px-4 pt-1 pb-5 text-sm leading-relaxed text-zinc-600 sm:px-5 dark:text-zinc-300">{children}</div>
    </details>
  );
}
