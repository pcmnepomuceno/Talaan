"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { Wordmark } from "./logo";

const items: { href: string; label: string; icon: "table_chart" | "manage_accounts" }[] = [
  { href: "/applications", label: "Applications", icon: "table_chart" },
  { href: "/account", label: "Account", icon: "manage_accounts" },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

// DESIGN 6.7 and 7. One <nav>, restyled per breakpoint: bottom bar (under 768), 88px rail (768),
// 240px ink side nav with the logo (1280). On the ink nav the tint pill is nearly invisible in dark,
// so the active item gets a lighter fill (15% bar-text) and a 3px left marker instead.
export function MainNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 max-md:box-content border-t border-border-subtle bg-surface-card pb-[env(safe-area-inset-bottom)] md:inset-y-0 md:right-auto md:h-auto md:w-22 md:flex-col md:border-t-0 md:border-r md:pb-0 xl:w-60 xl:border-r-0 xl:bg-bar-bg xl:px-5 xl:pt-6"
    >
      <div className="mb-8 hidden xl:block">
        <Wordmark variant="on-ink" />
      </div>
      <ul className="flex flex-1 md:w-full md:flex-none md:flex-col md:items-center md:gap-2 md:px-1 md:pt-3 xl:items-stretch xl:px-0 xl:pt-0">
        {items.map(({ href, label, icon }) => {
          const active = isActive(path, href);
          const name: IconName = active ? `${icon}_fill` : icon;
          return (
            <li key={href} className="flex flex-1 items-center justify-center md:w-full md:flex-none xl:block">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-5 py-1.5 text-caption md:w-full md:px-0 xl:w-auto xl:flex-row xl:justify-start xl:gap-3 xl:px-4 xl:py-2.5 ${
                  active
                    ? "bg-primary-tint text-primary xl:relative xl:bg-bar-text/15 xl:text-bar-text xl:before:absolute xl:before:inset-y-2 xl:before:left-0 xl:before:w-[3px] xl:before:rounded-full xl:before:bg-bar-text xl:before:content-['']"
                    : "text-text-secondary xl:text-bar-text"
                }`}
              >
                <Icon name={name} />
                <span className={`md:tracking-tight xl:tracking-normal ${active ? "text-caption-bold" : ""}`}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
