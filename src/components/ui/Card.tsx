import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

type CardTag = "div" | "section" | "article" | "aside" | "li";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render. Default "div". */
  as?: CardTag;
  /** default = white/glassy hairline card · glass = frosted translucent · muted = quiet tinted panel · dashed = drop-target style. */
  variant?: "default" | "glass" | "muted" | "dashed";
  /** Inner padding. Default "md" (p-5 sm:p-6). */
  padding?: "none" | "sm" | "md" | "lg";
  /** Big cards use 3xl (default), medium cards 2xl. */
  radius?: "xl" | "2xl" | "3xl";
  /** Hover lift + stronger shadow, for clickable cards. */
  interactive?: boolean;
  ref?: Ref<HTMLElement>;
}

const VARIANTS = {
  default: "border border-zinc-200/70 bg-white shadow-card dark:border-white/10 dark:bg-white/[0.04]",
  glass: "glass border border-white/60 shadow-card dark:border-white/10",
  muted: "border border-zinc-200/60 bg-zinc-50/80 dark:border-white/[0.07] dark:bg-white/[0.025]",
  dashed: "border-2 border-dashed border-zinc-300/80 bg-white/50 dark:border-white/15 dark:bg-white/[0.02]",
} as const;

const PADDING = { none: "", sm: "p-4", md: "p-5 sm:p-6", lg: "p-6 sm:p-8" } as const;
const RADIUS = { xl: "rounded-xl", "2xl": "rounded-2xl", "3xl": "rounded-3xl" } as const;

/** Surface container. */
export function Card({
  as: Tag = "div",
  variant = "default",
  padding = "md",
  radius = "3xl",
  interactive = false,
  className,
  ref,
  ...rest
}: CardProps) {
  // All allowed tags share HTMLElement props; type as div for JSX.
  const Comp = Tag as "div";
  return (
    <Comp
      ref={ref as Ref<HTMLDivElement>}
      className={cn(
        "relative",
        VARIANTS[variant],
        PADDING[padding],
        RADIUS[radius],
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-300/80 hover:shadow-lift dark:hover:border-white/20",
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Leading visual, e.g. <KindIcon kind="pdf" /> or a lucide icon. */
  icon?: ReactNode;
  /** Trailing actions (buttons, menu). */
  actions?: ReactNode;
  /** Heading level for the title. Default 3. */
  level?: 2 | 3 | 4;
  className?: string;
}

/** Title row for a Card: icon · title/description · actions. */
export function CardHeader({ title, description, icon, actions, level = 3, className }: CardHeaderProps) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div className={cn("flex items-start gap-3", className)}>
      {icon ? (
        <div className="shrink-0 text-brand-600 dark:text-brand-300 [&>svg]:size-5">{icon}</div>
      ) : null}
      <div className="min-w-0 flex-1">
        <H className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</H>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
