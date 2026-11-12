import { ChevronDown } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type FieldSize = "sm" | "md" | "lg";

/** Shared look for text-like controls (exported for custom controls that should match). */
export const fieldBaseClasses =
  "w-full min-w-0 border bg-white text-zinc-900 placeholder:text-zinc-400 shadow-[0_1px_2px_rgb(20_20_43/0.04)] " +
  "transition-[border-color,box-shadow,background-color] duration-150 ease-out " +
  "border-zinc-200/90 hover:border-zinc-300 " +
  "focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/20 " +
  "dark:focus:border-brand-400/70 dark:focus:ring-brand-400/20";

const invalidClasses =
  "border-rose-400 hover:border-rose-400 focus:border-rose-500 focus:ring-rose-500/15 dark:border-rose-400/60 dark:focus:border-rose-400";

const SIZE: Record<FieldSize, { h: string; text: string; padX: string; padL: string; padR: string; icon: string; radius: string }> = {
  sm: { h: "h-9", text: "text-[13px]", padX: "px-3", padL: "pl-9", padR: "pr-9", icon: "left-3 [&_svg]:size-4", radius: "rounded-lg" },
  md: { h: "h-11", text: "text-sm", padX: "px-3.5", padL: "pl-10", padR: "pr-10", icon: "left-3.5 [&_svg]:size-[18px]", radius: "rounded-xl" },
  lg: { h: "h-14", text: "text-base", padX: "px-4", padL: "pl-12", padR: "pr-12", icon: "left-4 [&_svg]:size-5", radius: "rounded-2xl" },
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** sm 36px · md 44px (default) · lg 56px (hero search). */
  size?: FieldSize;
  /** Icon inside the left edge (e.g. <Search />). */
  leftIcon?: ReactNode;
  /** Content inside the right edge (e.g. a <Kbd> hint or a clear button). */
  rightSlot?: ReactNode;
  invalid?: boolean;
  /** Classes for the wrapper div (layout); `className` goes to the <input>. */
  wrapperClassName?: string;
  ref?: Ref<HTMLInputElement>;
}

/** Text input with optional left icon and right slot. */
export function Input({ size = "md", leftIcon, rightSlot, invalid, className, wrapperClassName, ref, ...rest }: InputProps) {
  const s = SIZE[size];
  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      {leftIcon ? (
        <span aria-hidden className={cn("pointer-events-none absolute flex text-zinc-400 dark:text-zinc-500", s.icon)}>
          {leftIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldBaseClasses,
          s.h,
          s.text,
          s.radius,
          s.padX,
          leftIcon ? s.padL : null,
          rightSlot ? s.padR : null,
          invalid && invalidClasses,
          className,
        )}
        {...rest}
      />
      {rightSlot ? <span className="absolute right-2 flex items-center gap-1">{rightSlot}</span> : null}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  /** Grow with content (CSS field-sizing; falls back to a resizable box). Default true. */
  autoGrow?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line text field. */
export function Textarea({ invalid, autoGrow = true, className, rows = 4, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        fieldBaseClasses,
        "block rounded-xl px-3.5 py-3 text-sm leading-relaxed",
        autoGrow ? "field-sizing-content min-h-28 max-h-[60vh] resize-y" : "resize-y",
        invalid && invalidClasses,
        className,
      )}
      {...rest}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  /** Options shorthand; or pass <option> children. */
  options?: SelectOption[];
  size?: FieldSize;
  leftIcon?: ReactNode;
  invalid?: boolean;
  wrapperClassName?: string;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select, styled to match Input. */
export function Select({ options, size = "md", leftIcon, invalid, className, wrapperClassName, children, ref, ...rest }: SelectProps) {
  const s = SIZE[size];
  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      {leftIcon ? (
        <span aria-hidden className={cn("pointer-events-none absolute flex text-zinc-400 dark:text-zinc-500", s.icon)}>
          {leftIcon}
        </span>
      ) : null}
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          fieldBaseClasses,
          "appearance-none truncate",
          s.h,
          s.text,
          s.radius,
          s.padX,
          leftIcon ? s.padL : null,
          s.padR,
          "dark:[&>option]:bg-ink-800",
          invalid && invalidClasses,
          className,
        )}
        {...rest}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 size-4 text-zinc-400 dark:text-zinc-500" />
    </div>
  );
}

export interface FieldProps {
  label: ReactNode;
  /** id of the control the label points at. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Small "Optional" marker next to the label. */
  optional?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error stack. */
export function Field({ label, htmlFor, hint, error, optional, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
        <span>{label}</span>
        {optional ? <span className="text-xs font-normal text-muted">Optional</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
