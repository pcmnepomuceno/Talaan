import type { IconName } from "@/components/icon";

// Values match the API enums exactly (app/applications/models.py ApplicationStatus,
// app/interviews/models.py InterviewOutcome).
export const STATUSES = [
  "saved",
  "applied",
  "screening",
  "interviewing",
  "offered",
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;
export const OUTCOMES = ["pending", "good", "bad"] as const;

export type Status = (typeof STATUSES)[number];
export type Outcome = (typeof OUTCOMES)[number];

// Field names match the API exactly (app/applications/schemas.py ApplicationRead,
// app/interviews/schemas.py InterviewRead). DESIGN.md says "job title" and "notes";
// the API says job_name and remarks.
export type WorkMode = "on_site" | "hybrid" | "remote";
export type InterviewMode = "on_site" | "online" | "async";

export const WORK_MODES = [
  { value: "on_site", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const satisfies readonly { value: WorkMode; label: string }[];

export const INTERVIEW_MODES = [
  { value: "on_site", label: "On-site", icon: "apartment" },
  { value: "online", label: "Online", icon: "videocam" },
  { value: "async", label: "Async", icon: "schedule" },
] as const satisfies readonly { value: InterviewMode; label: string; icon: IconName }[];

// The one place a mode value turns into its label (and icon).
export const workModeLabel = (m: WorkMode) => WORK_MODES.find((x) => x.value === m)?.label;
export const interviewMode = (m: InterviewMode) => INTERVIEW_MODES.find((x) => x.value === m);

export type Application = {
  id: number;
  company: string;
  job_name: string;
  contact_website: string | null;
  contact_email: string | null; // typed, not shown (not in DESIGN.md section 2)
  status: Status;
  salary: number | null; // monthly gross, PHP
  mode_of_work: WorkMode;
  remarks: string | null;
  date_applied: string | null; // "YYYY-MM-DD"
  created_at: string;
  updated_at: string;
};

export type Interview = {
  id: number;
  job_application_id: number;
  interviewer: string | null;
  scheduled_at: string; // ISO 8601 with offset
  mode: InterviewMode;
  outcome: Outcome;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

/** One row of the interviews agenda (GET /interviews): an interview plus its application's names. */
export type AgendaInterview = Interview & { company: string; job_name: string };

/** GET /interviews/calendar: the interviews of a PHT date range (at most 200; `truncated` = rows are missing). */
export type CalendarRange = { items: AgendaInterview[]; total: number; truncated: boolean; from: string; to: string };
