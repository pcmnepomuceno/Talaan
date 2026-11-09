import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

// DESIGN.md 6.1. It defines only a pressed state; hover reuses it. Secondary hover also takes
// border-strong (3.1). Focus ring comes from :focus-visible in globals.css.
const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-text-inverse hover:bg-primary-pressed active:bg-primary-pressed disabled:bg-surface-subtle aria-disabled:bg-surface-subtle disabled:text-text-muted aria-disabled:text-text-muted",
  secondary:
    "border border-border-input bg-surface-card text-text-primary hover:border-border-strong hover:bg-surface-subtle active:bg-surface-subtle disabled:border-border-subtle aria-disabled:border-border-subtle disabled:bg-surface-card aria-disabled:bg-surface-card disabled:text-text-muted aria-disabled:text-text-muted",
  ghost:
    "text-primary hover:bg-primary-tint active:bg-primary-tint disabled:bg-transparent aria-disabled:bg-transparent disabled:text-text-muted aria-disabled:text-text-muted",
  destructive:
    "bg-destructive text-text-inverse hover:bg-destructive-pressed active:bg-destructive-pressed disabled:bg-error-bg aria-disabled:bg-error-bg disabled:text-error-border aria-disabled:text-error-border",
};

const base =
  "inline-flex h-12 min-w-11 items-center justify-center gap-2 rounded-sm px-4 text-center text-body-medium transition-colors duration-100 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

// A link cannot be disabled, so `href` and `disabled` are mutually exclusive.
type Props =
  | ({ variant?: Variant; href?: undefined } & ComponentProps<"button">)
  | ({ variant?: Variant; href: string; disabled?: never } & Omit<ComponentProps<typeof Link>, "href">);

export function Button({ variant = "primary", className = "", ...props }: Props) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (props.href !== undefined) return <Link {...props} className={cls} />;
  return <button type="button" {...props} className={cls} />;
}

// The one 44px text action (Edit, Delete). `href` renders a link, `onClick` a button. `disabled` keeps
// the same element (aria-disabled, click ignored): swapping elements during a background refresh would
// remount the node and drop keyboard focus. `bar` inherits the app bar's colour.
type Tone = "bar" | "primary" | "danger";
const tones: Record<Tone, { on: string; off: string }> = {
  bar: { on: "", off: "text-bar-text/60" },
  primary: { on: "text-primary", off: "text-text-muted" },
  danger: { on: "text-error-text", off: "text-text-muted" },
};
const action = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 text-body-medium aria-disabled:cursor-not-allowed";

export function TextAction({
  href,
  onClick,
  disabled = false,
  tone = "primary",
  "aria-label": ariaLabel,
  children,
}: {
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  "aria-label"?: string;
  children: ReactNode;
}) {
  const cls = `${action} ${disabled ? tones[tone].off : tones[tone].on}`;
  const off = disabled || undefined;
  return href ? (
    // Next's Link skips navigation when the click's default is prevented.
    <Link href={href} aria-disabled={off} onClick={(e) => disabled && e.preventDefault()} aria-label={ariaLabel} className={cls}>
      {children}
    </Link>
  ) : (
    <button type="button" aria-disabled={off} onClick={() => !disabled && onClick?.()} aria-label={ariaLabel} className={cls}>
      {children}
    </button>
  );
}
