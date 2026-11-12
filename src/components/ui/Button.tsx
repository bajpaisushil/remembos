import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "soft";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-lg";

interface ButtonOwnProps {
  /** primary = brand gradient · secondary = white/glass surface · outline = transparent with border ·
   *  ghost = text only · soft = brand tint · danger = destructive. Default "primary". */
  variant?: ButtonVariant;
  /** sm 32px · md 40px · lg 48px · icon/icon-sm/icon-lg = square icon buttons (always pass aria-label). */
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonAsButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & {
    href?: undefined;
    ref?: Ref<HTMLButtonElement>;
  };

export type ButtonAsLinkProps = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps | "href"> & {
    /** Renders a link (next/link for internal paths, <a target=_blank> for http(s) URLs). */
    href: string;
    /** Force opening in a new tab (automatic for absolute http(s) URLs). */
    external?: boolean;
    prefetch?: boolean;
    ref?: Ref<HTMLAnchorElement>;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium " +
  "transition-[background-color,border-color,color,box-shadow,filter,transform,opacity] duration-150 ease-out " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none " +
  "aria-disabled:opacity-50 [&_svg]:shrink-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "brand-gradient text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.22),0_6px_20px_-8px_rgb(124_58_237/0.7)] " +
    "hover:brightness-110 hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.28),0_10px_28px_-8px_rgb(124_58_237/0.8)]",
  secondary:
    "border border-zinc-200/90 bg-white text-zinc-900 shadow-soft hover:border-zinc-300 hover:bg-zinc-50 " +
    "dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-100 dark:hover:border-white/20 dark:hover:bg-white/10",
  outline:
    "border border-zinc-300/80 bg-transparent text-zinc-800 hover:border-zinc-400/80 hover:bg-zinc-900/[0.03] " +
    "dark:border-white/15 dark:text-zinc-100 dark:hover:border-white/25 dark:hover:bg-white/5",
  ghost:
    "text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white",
  soft:
    "bg-brand-500/10 text-brand-700 hover:bg-brand-500/15 dark:bg-brand-400/15 dark:text-brand-200 dark:hover:bg-brand-400/20",
  danger:
    "bg-rose-600 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18),0_6px_20px_-8px_rgb(225_29_72/0.7)] " +
    "hover:bg-rose-500 dark:bg-rose-600 dark:hover:bg-rose-500",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 rounded-lg px-3 text-[13px] [&_svg]:size-3.5",
  md: "h-10 rounded-xl px-4 text-sm [&_svg]:size-4",
  lg: "h-12 rounded-2xl px-6 text-[15px] [&_svg]:size-[18px]",
  "icon-sm": "size-8 rounded-lg [&_svg]:size-4",
  icon: "size-10 rounded-xl [&_svg]:size-[18px]",
  "icon-lg": "size-12 rounded-2xl [&_svg]:size-5",
};

/**
 * Class string for anything that should look like a Button (e.g. a <label> wrapping a file input).
 * Pass `size: "none"` to supply your own height/padding/radius classes without conflicts.
 */
export function buttonClasses(
  opts: { variant?: ButtonVariant; size?: ButtonSize | "none"; fullWidth?: boolean; className?: string } = {},
): string {
  const { variant = "primary", size = "md", fullWidth, className } = opts;
  return cn(BASE, VARIANTS[variant], size === "none" ? null : SIZES[size], fullWidth && "w-full", className);
}

/**
 * The one button. Renders a <button>, or a link when `href` is set.
 *
 * @example <Button leftIcon={<Plus />} onClick={add}>New note</Button>
 * @example <Button href="/data/" variant="secondary">Your data</Button>
 * @example <Button size="icon" variant="ghost" aria-label="Close"><X /></Button>
 */
export function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", loading = false, leftIcon, rightIcon, fullWidth, className, children } = props;
  const classes = buttonClasses({ variant, size, fullWidth, className });
  const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";
  const content = (
    <>
      {loading ? <Spinner size={size === "lg" || size === "icon-lg" ? "md" : "sm"} /> : leftIcon}
      {isIconOnly && loading ? null : children}
      {!loading || !isIconOnly ? rightIcon : null}
    </>
  );

  if (isLinkProps(props)) {
    const { href, external, prefetch, ref, ...rest } = omitOwn(props);
    const isExternal = external ?? /^https?:\/\//i.test(href);
    if (isExternal) {
      return (
        <a ref={ref} href={href} target="_blank" rel="noopener noreferrer" className={classes} aria-busy={loading || undefined} {...rest}>
          {content}
        </a>
      );
    }
    return (
      <Link ref={ref} href={href} prefetch={prefetch} className={classes} aria-busy={loading || undefined} {...rest}>
        {content}
      </Link>
    );
  }

  const { href: _href, ref, type = "button", disabled, ...rest } = omitOwn(props);
  void _href;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...rest}
    >
      {content}
    </button>
  );
}

const OWN_KEYS = ["variant", "size", "loading", "leftIcon", "rightIcon", "fullWidth", "className", "children"] as const;

function omitOwn<T extends ButtonOwnProps>(props: T): Omit<T, (typeof OWN_KEYS)[number]> {
  const rest = { ...props } as Record<string, unknown>;
  for (const key of OWN_KEYS) delete rest[key];
  return rest as Omit<T, (typeof OWN_KEYS)[number]>;
}

function isLinkProps(props: ButtonProps): props is ButtonAsLinkProps {
  return typeof props.href === "string";
}
