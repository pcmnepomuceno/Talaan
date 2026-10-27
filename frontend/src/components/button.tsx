import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

// DESIGN.md 6.1. It defines only a pressed state; hover reuses it. Secondary hover also takes
// border-strong (3.1). Focus ring comes from :focus-visible in globals.css.
const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-text-inverse hover:bg-primary-pressed active:bg-primary-pressed disabled:bg-surface-subtle disabled:text-text-muted",
  secondary:
    "border border-border-input bg-surface-card text-text-primary hover:border-border-strong hover:bg-surface-subtle active:bg-surface-subtle disabled:border-border-subtle disabled:bg-surface-card disabled:text-text-muted",
  ghost:
    "text-primary hover:bg-primary-tint active:bg-primary-tint disabled:bg-transparent disabled:text-text-muted",
  destructive:
    "bg-destructive text-text-inverse hover:bg-destructive-pressed active:bg-destructive-pressed disabled:bg-error-bg disabled:text-error-border",
};

const base =
  "inline-flex h-12 min-w-11 items-center justify-center gap-2 rounded-sm px-4 text-center text-body-medium transition-colors duration-100 disabled:cursor-not-allowed";

// A link cannot be disabled, so `href` and `disabled` are mutually exclusive.
type Props =
  | ({ variant?: Variant; href?: undefined } & ComponentProps<"button">)
  | ({ variant?: Variant; href: string; disabled?: never } & Omit<ComponentProps<typeof Link>, "href">);

export function Button({ variant = "primary", className = "", ...props }: Props) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (props.href !== undefined) return <Link {...props} className={cls} />;
  return <button type="button" {...props} className={cls} />;
}
