import Link from "next/link";
import type { ReactNode } from "react";
import { dateAppliedLabel, formatDateTimePHT, formatPeso } from "../lib/format";
import { type AgendaInterview, type Application, type Interview, interviewMode, workModeLabel } from "../lib/types";
import { Icon } from "./icon";
import { StatusStamp } from "./status-stamp";

// DESIGN.md 6.5: one bordered sheet, rows split by 1px rules. `overflow-hidden` clips the selected
// tint to the rounded corners, so row focus rings are drawn inset.
const sheet = "overflow-hidden rounded-sm border border-border-subtle bg-surface-card";
const rules = "divide-y divide-border-subtle";
const wrap = "[overflow-wrap:anywhere]";

export function LedgerSheet({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className={`${sheet} ${rules}`}>
      {children}
    </ul>
  );
}

type RowTarget = { href: string; onSelect?: undefined } | { href?: undefined; onSelect: () => void };

// The whole row is the link or button (min 44px tall; padding makes it far taller).
export function ApplicationRow({
  application: a,
  selected = false,
  ...target
}: { application: Application; selected?: boolean } & RowTarget) {
  const salary = formatPeso(a.salary);
  const mode = workModeLabel(a.mode_of_work);
  const date = dateAppliedLabel(a.date_applied, a.status);
  const cls = `flex w-full min-h-11 flex-col gap-1 p-4 text-left focus-visible:-outline-offset-2 ${
    selected ? "bg-primary-tint" : ""
  }`;
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span title={a.job_name} className={`line-clamp-2 min-w-0 text-row-title text-text-primary ${wrap}`}>
          {a.job_name}
        </span>
        <StatusStamp value={a.status} />
      </span>
      <span className={`text-caption text-text-secondary ${wrap}`}>{a.company}</span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-caption">
        <span className="text-text-secondary">
          {mode}
          {salary && (
            <>
              {" · "}
              <span className="text-caption-bold tabular-nums text-text-primary">{salary}</span>
            </>
          )}
        </span>
        {date && <span className="tabular-nums text-text-muted">{date}</span>}
      </span>
    </>
  );
  return (
    <li>
      {target.href !== undefined ? (
        <Link href={target.href} aria-current={selected ? "page" : undefined} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={target.onSelect} aria-current={selected ? "true" : undefined} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

// The mode with its icon and, only when present, the interviewer (DESIGN.md 6.6). Shared by the
// detail's interview rows and the agenda rows.
function InterviewMeta({ interview: i }: { interview: Interview }) {
  const mode = interviewMode(i.mode);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-caption text-text-secondary">
      <span className="flex items-center gap-1">
        {mode && <Icon name={mode.icon} size={20} />}
        {mode?.label}
      </span>
      {i.interviewer && (
        <>
          <span aria-hidden>·</span>
          <span className={`flex min-w-0 items-center gap-1 ${wrap}`}>
            <Icon name="person" size={20} />
            {i.interviewer}
          </span>
        </>
      )}
    </p>
  );
}

// DESIGN.md 6.6. The outcome stamp always shows; interviewer and notes only when present.
// `actions` (Edit, Delete) sit under the notes; the detail passes them, read-only lists omit them.
export function InterviewRow({ interview: i, actions }: { interview: Interview; actions?: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className={`min-w-0 text-row-title tabular-nums text-text-primary ${wrap}`}>
          {formatDateTimePHT(i.scheduled_at) ?? "Date unavailable"}
        </p>
        <StatusStamp value={i.outcome} />
      </div>
      <InterviewMeta interview={i} />
      {i.remarks && <p className={`whitespace-pre-line text-caption text-text-muted ${wrap}`}>{i.remarks}</p>}
      {actions && <div className="-mx-2 -mb-2 flex flex-wrap items-center">{actions}</div>}
    </li>
  );
}

// DESIGN.md 8.8 (agenda row). The link covers the whole row and goes to that application's detail;
// `action` (Add to calendar) sits under it, outside the link, so no interactive element is nested.
// The notes are not shown. `data-interview-id` lets the screen focus the first row of a new page.
export function AgendaRow({ interview: i, action }: { interview: AgendaInterview; action?: ReactNode }) {
  return (
    <li>
      <Link
        href={`/applications/${i.job_application_id}`}
        data-interview-id={i.id}
        className="flex w-full min-h-11 flex-col gap-1 p-4 text-left focus-visible:-outline-offset-2"
      >
        <span className="flex items-start justify-between gap-3">
          <span className={`min-w-0 text-row-title tabular-nums text-text-primary ${wrap}`}>
            {formatDateTimePHT(i.scheduled_at) ?? "Date unavailable"}
          </span>
          <StatusStamp value={i.outcome} />
        </span>
        <span className={`text-body-medium text-text-primary ${wrap}`}>{i.job_name}</span>
        <span className={`text-caption text-text-secondary ${wrap}`}>{i.company}</span>
        <InterviewMeta interview={i} />
      </Link>
      {action && <div className="px-2 pb-2">{action}</div>}
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-3">
      <dt className="text-body text-text-secondary">{label}</dt>
      <dd className={`min-w-0 text-right text-body font-semibold tabular-nums text-text-primary ${wrap}`}>
        {children}
      </dd>
    </div>
  );
}

// Text shown for a URL: no scheme, no trailing slash.
const shortUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/\/$/, "");

// Missing optional values leave their row out (never "₱0" or a dash).
export function DetailRows({ application: a }: { application: Application }) {
  const salary = formatPeso(a.salary);
  const date = dateAppliedLabel(a.date_applied, a.status);
  const mode = workModeLabel(a.mode_of_work);
  const safe = a.contact_website && /^https?:\/\//i.test(a.contact_website);
  return (
    <dl className={`${sheet} ${rules}`}>
      {salary && <DetailRow label="Monthly gross salary">{salary}</DetailRow>}
      <DetailRow label="Work mode">{mode}</DetailRow>
      {date && <DetailRow label="Date applied">{date}</DetailRow>}
      {a.contact_website && (
        <DetailRow label="Website">
          {safe ? (
            <a
              href={a.contact_website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center font-normal text-primary underline"
            >
              {shortUrl(a.contact_website)}
            </a>
          ) : (
            shortUrl(a.contact_website)
          )}
        </DetailRow>
      )}
    </dl>
  );
}

// DESIGN.md 6.12: the same sheet and rules, three bars per row.
// `silent`: the page owns a persistent live region and announces the loading itself (a status
// region that mounts together with its text is often not announced).
export function LedgerSkeleton({ rows = 3, label = "Loading applications", silent = false }: { rows?: number; label?: string; silent?: boolean }) {
  return (
    <div role={silent ? undefined : "status"}>
      {!silent && <span className="sr-only">{label}</span>}
      <ul aria-hidden className={`${sheet} ${rules}`}>
        {Array.from({ length: rows }, (_, n) => (
          <li key={n} className="flex animate-ledger-pulse flex-col gap-3 p-4 motion-reduce:animate-none">
            <span className="h-5 w-2/3 rounded-sm bg-border-subtle" />
            <span className="h-4 w-1/2 rounded-sm bg-border-subtle" />
            <span className="h-4 w-3/4 rounded-sm bg-border-subtle" />
          </li>
        ))}
      </ul>
    </div>
  );
}
