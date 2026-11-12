import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface GuideSectionProps {
  /** Anchor id (the "On this page" links point here); the heading gets `${id}-title`. */
  id: string;
  eyebrow: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** One chapter of the storage guide: small eyebrow, h2, intro line, content. */
export function GuideSection({ id, eyebrow, icon, title, description, children, className, "data-testid": testId }: GuideSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} data-testid={testId} className={cn("pt-16 sm:pt-24", className)}>
      <div className="mb-6 max-w-2xl sm:mb-8">
        <p className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.14em] text-brand-600 uppercase dark:text-brand-300 [&_svg]:size-3.5">
          {icon}
          {eyebrow}
        </p>
        <h2 id={`${id}-title`} className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-white">
          {title}
        </h2>
        {description ? <p className="mt-2.5 text-[15px] leading-relaxed text-muted sm:text-base">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
