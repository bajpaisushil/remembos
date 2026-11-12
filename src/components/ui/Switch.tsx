"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Visible label. When given, renders a full settings row (label + description on the left, switch on the right). */
  label?: ReactNode;
  description?: ReactNode;
  /** Required when there is no visible `label`. */
  "aria-label"?: string;
  size?: "sm" | "md";
  id?: string;
  className?: string;
  "data-testid"?: string;
}

/** Accessible on/off toggle (role="switch"). */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  description,
  "aria-label": ariaLabel,
  size = "md",
  id,
  className,
  "data-testid": testId,
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const descId = description ? `${switchId}-desc` : undefined;

  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-describedby={descId}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-[background-color,box-shadow] duration-200 ease-out",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-5 w-9" : "h-6 w-11",
        checked
          ? "brand-gradient shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_4px_12px_-4px_rgb(124_58_237/0.6)]"
          : "bg-zinc-300/80 dark:bg-white/15",
        !label && className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-spring",
          size === "sm" ? "size-4" : "size-5",
          checked ? (size === "sm" ? "translate-x-4" : "translate-x-5") : "translate-x-0",
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={switchId} className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </label>
        {description ? (
          <p id={descId} className="mt-0.5 text-[13px] leading-snug text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="pt-0.5">{control}</div>
    </div>
  );
}
