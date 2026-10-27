import type { Metadata } from "next";
import { Logo, Wordmark } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Design system", robots: { index: false, follow: false } };

// Full class names so Tailwind can see them.
const swatches = [
  ["primary", "bg-primary"],
  ["primary-pressed", "bg-primary-pressed"],
  ["primary-tint", "bg-primary-tint"],
  ["bg-page", "bg-bg-page"],
  ["surface-card", "bg-surface-card"],
  ["surface-subtle", "bg-surface-subtle"],
  ["border-subtle", "bg-border-subtle"],
  ["border-input", "bg-border-input"],
  ["border-strong", "bg-border-strong"],
  ["text-primary", "bg-text-primary"],
  ["text-secondary", "bg-text-secondary"],
  ["text-muted", "bg-text-muted"],
  ["text-inverse", "bg-text-inverse"],
  ["focus-ring", "bg-focus-ring"],
  ["bar-bg", "bg-bar-bg"],
  ["bar-text", "bg-bar-text"],
  ["bar-stamp", "bg-bar-stamp"],
  ["stamp", "bg-stamp"],
  ["error-text", "bg-error-text"],
  ["error-bg", "bg-error-bg"],
  ["error-border", "bg-error-border"],
  ["destructive", "bg-destructive"],
  ["destructive-pressed", "bg-destructive-pressed"],
  ["success-text", "bg-success-text"],
  ["success-bg", "bg-success-bg"],
  ["success-border", "bg-success-border"],
  ["overlay", "bg-overlay"],
] as const;

const stamps = [
  ["Saved", "text-status-saved-text bg-status-saved-bg border-status-saved-border"],
  ["Applied", "text-status-applied-text bg-status-applied-bg border-status-applied-border"],
  ["Screening", "text-status-screening-text bg-status-screening-bg border-status-screening-border"],
  ["Interviewing", "text-status-interviewing-text bg-status-interviewing-bg border-status-interviewing-border"],
  ["Offered", "text-status-offered-text bg-status-offered-bg border-status-offered-border"],
  ["Accepted", "text-status-accepted-text bg-status-accepted-bg border-status-accepted-border"],
  ["Rejected", "text-status-rejected-text bg-status-rejected-bg border-status-rejected-border"],
  ["Withdrawn", "text-status-withdrawn-text bg-status-withdrawn-bg border-status-withdrawn-border"],
  ["Ghosted", "text-status-ghosted-text bg-status-ghosted-bg border-status-ghosted-border"],
  ["Pending", "text-status-saved-text bg-status-saved-bg border-status-saved-border"],
  ["Good", "text-status-offered-text bg-status-offered-bg border-status-offered-border"],
  ["Bad", "text-status-rejected-text bg-status-rejected-bg border-status-rejected-border"],
] as const;

const types = [
  ["Page title", "text-page-title", "24 / 32, 600"],
  ["Bar title", "text-bar-title", "18 / 24, 600"],
  ["Section title", "text-section-title", "18 / 26, 600"],
  ["Body", "text-body", "16 / 24, 400"],
  ["Body medium", "text-body-medium", "16 / 24, 500"],
  ["Row title", "text-row-title", "16 / 22, 600"],
  ["Caption", "text-caption", "14 / 20, 400"],
  ["Caption bold", "text-caption-bold", "14 / 20, 600"],
  ["Stamp", "text-stamp-label", "14 / 18, 500"],
] as const;

function Stamp({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex h-7 items-center rounded-xs border px-2.5 text-stamp-label ${cls}`}
    >
      {label}
    </span>
  );
}

function Panel({ theme, title }: { theme: "light" | "dark"; title: string }) {
  return (
    <section
      data-theme={theme}
      className="rounded-sm border border-border-subtle bg-bg-page p-4 text-text-primary"
    >
      <h3 className="mb-4 text-section-title">{title}</h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
        {swatches.map(([name, cls]) => (
          <li key={name} className="flex flex-col gap-1">
            <span className={`h-11 rounded-sm border border-border-subtle ${cls}`} />
            <span className="text-caption text-text-secondary">{name}</span>
          </li>
        ))}
      </ul>
      <h4 className="my-4 text-section-title">Stamps</h4>
      <div className="flex flex-wrap gap-2">
        {stamps.map(([l, c]) => (
          <Stamp key={l} label={l} cls={c} />
        ))}
      </div>
    </section>
  );
}

export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-[1120px] flex-col gap-8 p-4 pb-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-page-title">Design system</h1>
        <p className="text-caption text-text-muted">
          Tokens from DESIGN.md. The toggle below changes the page; the two panels are fixed.
        </p>
        <ThemeToggle />
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-section-title">Colors</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Panel theme="light" title="Light" />
          <Panel theme="dark" title="Dark" />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-section-title">Stamps in the current theme</h2>
        <div className="flex flex-wrap gap-2">
          {stamps.map(([l, c]) => (
            <Stamp key={l} label={l} cls={c} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-section-title">Type scale</h2>
        <ul className="overflow-hidden rounded-sm border border-border-subtle bg-surface-card">
          {types.map(([name, cls, spec]) => (
            <li
              key={name}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle p-4 last:border-b-0"
            >
              <span className={cls}>{name}</span>
              <span className="text-caption text-text-muted tabular-nums">{spec}</span>
            </li>
          ))}
          <li className="p-4 text-body tabular-nums">₱85,000 / month · Oct 14, 2026 · 2:00 PM PHT</li>
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-section-title">Logo</h2>
        <div className="flex flex-wrap gap-4">
          <div className="flex flex-wrap items-center gap-6 rounded-sm border border-border-subtle bg-bg-page p-4">
            <Logo variant="on-paper" size={64} />
            <Logo variant="on-paper" size={32} />
            <Wordmark variant="on-paper" />
          </div>
          <div className="flex flex-wrap items-center gap-6 rounded-sm bg-bar-bg p-4">
            <Logo variant="on-ink" size={64} />
            <Logo variant="on-ink" size={32} />
            <Wordmark variant="on-ink" />
          </div>
        </div>
      </section>
    </main>
  );
}
