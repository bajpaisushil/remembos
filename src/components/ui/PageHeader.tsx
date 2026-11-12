import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AccentProps {
  children: ReactNode;
  /** Use the brand gradient (default) or plain current color. */
  gradient?: boolean;
  className?: string;
}

/** Serif-italic accent word for headings: <h1>Never <Accent>forget</Accent> a thing</h1>. */
export function Accent({ children, gradient = true, className }: AccentProps) {
  return (
    <span className={cn("font-serif font-normal italic tracking-normal pr-[0.08em]", gradient && "text-gradient", className)}>
      {children}
    </span>
  );
}

export interface PageHeaderProps {
  /** Small uppercase line above the title. */
  eyebrow?: ReactNode;
  /** Page title (ReactNode, so it can contain <Accent>). Rendered as the page's <h1>. */
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right (wrap below on phones). */
  actions?: ReactNode;
  /** Leading visual next to the title block. */
  icon?: ReactNode;
  /** "lg" for hero-like page intros. Default "md". */
  size?: "md" | "lg";
  align?: "left" | "center";
  /** Extra content under the description (search bar, tabs…). */
  children?: ReactNode;
  className?: string;
}

/** Consistent page intro: eyebrow · title · description · actions. */
export function PageHeader({ eyebrow, title, description, actions, icon, size = "md", align = "left", children, className }: PageHeaderProps) {
  const centered = align === "center";
  return (
    <header className={cn("pb-6 sm:pb-8", className)}>
      <div className={cn("flex flex-col gap-4", centered ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between")}>
        <div className={cn("flex min-w-0 gap-4", centered ? "flex-col items-center" : "items-start")}>
          {icon ? <div className="shrink-0 pt-1">{icon}</div> : null}
          <div className="min-w-0">
            {eyebrow ? (
              <p className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300 [&_svg]:size-3.5">
                {eyebrow}
              </p>
            ) : null}
            <h1
              className={cn(
                "font-semibold tracking-tight text-zinc-900 dark:text-white",
                size === "lg" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
              )}
            >
              {title}
            </h1>
            {description ? (
              <div className={cn("mt-2.5 text-base leading-relaxed text-muted sm:text-[17px]", centered ? "mx-auto max-w-2xl" : "max-w-2xl")}>
                {description}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </header>
  );
}

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level. Default 2. */
  level?: 2 | 3;
  id?: string;
  className?: string;
}

/** Heading row for a section inside a page. */
export function SectionHeader({ title, description, actions, level = 2, id, className }: SectionHeaderProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <H id={id} className={cn("font-semibold tracking-tight text-zinc-900 dark:text-white", level === 2 ? "text-xl" : "text-base")}>
          {title}
        </H>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface ContainerProps {
  /** sm 768px · md 960px · lg 1152px (default, max-w-6xl) · xl 1280px */
  size?: "sm" | "md" | "lg" | "xl";
  as?: "div" | "section" | "main" | "article";
  className?: string;
  children?: ReactNode;
}

const CONTAINER = { sm: "max-w-3xl", md: "max-w-5xl", lg: "max-w-6xl", xl: "max-w-7xl" } as const;

/** Centered content column with the app's standard gutters (px-4 sm:px-6). */
export function Container({ size = "lg", as: Tag = "div", className, children }: ContainerProps) {
  return <Tag className={cn("mx-auto w-full px-4 sm:px-6", CONTAINER[size], className)}>{children}</Tag>;
}
