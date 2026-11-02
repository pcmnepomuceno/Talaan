import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { Wordmark } from "./logo";

// DESIGN 6.7. Hidden from 1280: desktop has no top bar (the side nav carries the logo).
const bar =
  "flex h-14 items-center gap-2 bg-bar-bg px-4 pt-[env(safe-area-inset-top)] text-bar-text xl:hidden box-content";

type Props =
  | { title?: undefined; backHref?: undefined; actions?: undefined }
  | { title: string; backHref: string; actions?: ReactNode };

// Main screens: logo mark + wordmark. Inner screens: back arrow, sentence-case title, text actions.
export function AppBar({ title, backHref, actions }: Props) {
  if (title === undefined) {
    return (
      <header className={bar}>
        <Wordmark variant="on-ink" />
      </header>
    );
  }
  return (
    <header className={bar}>
      <Link
        href={backHref}
        aria-label="Back"
        className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-sm"
      >
        <Icon name="arrow_back" />
      </Link>
      <h1 className="min-w-0 flex-1 truncate text-bar-title">{title}</h1>
      {actions && <div className="flex shrink-0 items-center">{actions}</div>}
    </header>
  );
}

const action = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 text-body-medium";

// Text action for the bar (Edit, Delete): a link when `href` is given, else a button.
export function BarAction({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  return href ? (
    <Link href={href} className={action}>
      {children}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={action}>
      {children}
    </button>
  );
}
