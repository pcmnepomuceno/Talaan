// The enum lists live in lib/types.ts (lib never imports from components); re-exported here.
import { OUTCOMES, STATUSES, type Outcome, type Status } from "../lib/types";

export { OUTCOMES, STATUSES, type Outcome, type Status };

// DESIGN.md 3.2: sentence-case label plus text, bg and border tokens. Full class names so
// Tailwind can see them. Outcomes reuse saved, offered and rejected.
const stamps: Record<Status | Outcome, [label: string, cls: string]> = {
  saved: ["Saved", "text-status-saved-text bg-status-saved-bg border-status-saved-border"],
  applied: ["Applied", "text-status-applied-text bg-status-applied-bg border-status-applied-border"],
  screening: ["Screening", "text-status-screening-text bg-status-screening-bg border-status-screening-border"],
  interviewing: [
    "Interviewing",
    "text-status-interviewing-text bg-status-interviewing-bg border-status-interviewing-border",
  ],
  offered: ["Offered", "text-status-offered-text bg-status-offered-bg border-status-offered-border"],
  accepted: ["Accepted", "text-status-accepted-text bg-status-accepted-bg border-status-accepted-border"],
  rejected: ["Rejected", "text-status-rejected-text bg-status-rejected-bg border-status-rejected-border"],
  withdrawn: ["Withdrawn", "text-status-withdrawn-text bg-status-withdrawn-bg border-status-withdrawn-border"],
  ghosted: ["Ghosted", "text-status-ghosted-text bg-status-ghosted-bg border-status-ghosted-border"],
  pending: ["Pending", "text-status-saved-text bg-status-saved-bg border-status-saved-border"],
  good: ["Good", "text-status-offered-text bg-status-offered-bg border-status-offered-border"],
  bad: ["Bad", "text-status-rejected-text bg-status-rejected-bg border-status-rejected-border"],
};

export function stampLabel(value: Status | Outcome) {
  return stamps[value][0];
}

// DESIGN.md 6.4: flat rectangle, no dot or icon; the label always shows.
export function StatusStamp({ value }: { value: Status | Outcome }) {
  const [label, cls] = stamps[value];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center rounded-xs border px-2.5 text-stamp-label whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
