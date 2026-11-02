import { STATUSES, type Status } from "../components/status-stamp";
import type { Application, Interview } from "./types";

// F3 mock data layer. Screens import ONLY the functions below; F5 replaces the bodies with fetch
// calls to /api/v1 and keeps these signatures. The seed is private on purpose.
// Fake latency: 300ms in dev (so skeletons show), 0 under Vitest. setMockDelay overrides it.
let delay = process.env.NODE_ENV === "test" ? 0 : 300;
export const setMockDelay = (ms: number) => {
  delay = ms;
};
const wait = () => new Promise<void>((r) => setTimeout(r, delay));

const stamp = "2026-10-01T09:00:00+08:00";
const app = (id: number, rest: Omit<Application, "id" | "contact_email" | "created_at" | "updated_at">): Application => ({
  id,
  contact_email: null,
  created_at: `2026-10-${String(10 + id).padStart(2, "0")}T09:00:00+08:00`,
  updated_at: stamp,
  ...rest,
});

const seedApplications = (): Application[] => [
  app(1, {
    company: "Pinagsama Tech",
    job_name: "Frontend Engineer",
    contact_website: "https://pinagsama.example.ph",
    status: "interviewing",
    salary: 85000,
    mode_of_work: "hybrid",
    remarks: "Referred by a former teammate.\nAsk about the team size.",
    date_applied: "2026-10-14",
  }),
  app(2, {
    company: "Bayanihan Digital",
    job_name: "Product Designer",
    contact_website: "https://bayanihan.example.ph/careers",
    status: "offered",
    salary: 95000,
    mode_of_work: "remote",
    remarks: null,
    date_applied: "2026-09-28",
  }),
  app(3, {
    company: "Mayon Software Labs",
    job_name: "Full Stack Developer",
    contact_website: null,
    status: "applied",
    salary: null,
    mode_of_work: "on_site",
    remarks: null,
    date_applied: "2026-10-19",
  }),
  app(4, {
    company: "Kalayaan Logistics",
    job_name: "Operations Analyst",
    contact_website: "https://kalayaan.example.ph",
    status: "saved",
    salary: 50000,
    mode_of_work: "remote",
    remarks: "Apply after the holidays.",
    date_applied: null,
  }),
  app(5, {
    company: "Haraya Solutions International Holdings and Technology Services",
    job_name: "Senior Principal Staff Software Engineer, Platform Reliability and Developer Experience",
    contact_website: "https://haraya.example.ph",
    status: "rejected",
    salary: 120000,
    mode_of_work: "hybrid",
    remarks: null,
    date_applied: "2026-10-02",
  }),
];

// Stored out of date order on purpose: screens must sort.
const seedInterviews = (): Interview[] => {
  const i = (id: number, job_application_id: number, rest: Partial<Interview> & Pick<Interview, "scheduled_at" | "mode" | "outcome">): Interview => ({
    id,
    job_application_id,
    interviewer: null,
    remarks: null,
    created_at: stamp,
    updated_at: stamp,
    ...rest,
  });
  return [
    i(1, 1, { scheduled_at: "2026-10-24T14:00:00+08:00", mode: "online", outcome: "pending", interviewer: "Mark Rivera" }),
    i(2, 1, {
      scheduled_at: "2026-10-18T10:00:00+08:00",
      mode: "online",
      outcome: "good",
      interviewer: "Ana Santos",
      remarks: "Portfolio walkthrough.",
    }),
    i(3, 2, { scheduled_at: "2026-09-30T15:30:00+08:00", mode: "on_site", outcome: "good" }),
    i(4, 5, { scheduled_at: "2026-10-09T09:00:00+08:00", mode: "async", outcome: "bad", remarks: "Take-home test." }),
  ];
};

let applications = seedApplications();
let interviews = seedInterviews();

/** Test helper: restore the seed. */
export function resetMock() {
  applications = seedApplications();
  interviews = seedInterviews();
}

/** Unknown or missing values mean "all". */
export const parseStatus = (raw: string | null | undefined): Status | undefined =>
  STATUSES.find((s) => s === raw);

// Newest first (created_at desc, id desc), like GET /applications.
export async function getApplications(status?: Status): Promise<Application[]> {
  await wait();
  return applications
    .filter((a) => !status || a.status === status)
    .sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1))
    .map((a) => ({ ...a }));
}

export async function getApplication(id: number): Promise<Application | null> {
  await wait();
  const a = applications.find((x) => x.id === id);
  return a ? { ...a } : null;
}

// Unsorted, like the API's list; the screen sorts with sortInterviewsByDate.
export async function getInterviews(applicationId: number): Promise<Interview[]> {
  await wait();
  return interviews.filter((i) => i.job_application_id === applicationId).map((i) => ({ ...i }));
}

export async function deleteApplication(id: number): Promise<void> {
  await wait();
  applications = applications.filter((a) => a.id !== id);
  interviews = interviews.filter((i) => i.job_application_id !== id);
}
