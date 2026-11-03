// The only place that knows the API's JSON shapes. Field names already match the UI types
// (job_name, remarks, contact_website, mode_of_work, scheduled_at), so the work here is
// validation on the way in and explicit field lists on the way out:
//  - an unknown enum value or a wrong type throws MappingError (screens show the generic error);
//  - date-only strings ("2026-10-14") are passed through untouched, never via Date;
//  - request bodies list their fields by name, so contact_email and server-managed fields
//    (id, created_at, updated_at) can never be sent by accident.
import {
  type Application,
  type Interview,
  INTERVIEW_MODES,
  OUTCOMES,
  STATUSES,
  WORK_MODES,
  type Status,
  type WorkMode,
} from "./types";

export class MappingError extends Error {
  constructor(what: string) {
    super(`Unexpected API response: ${what}`);
    this.name = "MappingError";
  }
}

type Raw = Record<string, unknown>;
const obj = (v: unknown, what: string): Raw => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new MappingError(what);
  return v as Raw;
};
const str = (r: Raw, k: string): string => {
  if (typeof r[k] !== "string") throw new MappingError(k);
  return r[k] as string;
};
const strOrNull = (r: Raw, k: string): string | null => (r[k] === null ? null : str(r, k));
const int = (r: Raw, k: string): number => {
  if (!Number.isSafeInteger(r[k])) throw new MappingError(k);
  return r[k] as number;
};
const oneOf = <T extends string>(r: Raw, k: string, allowed: readonly T[]): T => {
  const v = r[k];
  const hit = allowed.find((a) => a === v);
  if (hit === undefined) throw new MappingError(k);
  return hit;
};

/** Only the id of a row (a write response): every other field may be one this client cannot map yet. */
export const idOf = (v: unknown): number => int(obj(v, "application"), "id");

export function fromApiApplication(v: unknown): Application {
  const r = obj(v, "application");
  const date = strOrNull(r, "date_applied");
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new MappingError("date_applied");
  return {
    id: int(r, "id"),
    company: str(r, "company"),
    job_name: str(r, "job_name"),
    contact_website: strOrNull(r, "contact_website"),
    contact_email: strOrNull(r, "contact_email"),
    status: oneOf(r, "status", STATUSES),
    salary: r.salary === null ? null : int(r, "salary"),
    mode_of_work: oneOf(r, "mode_of_work", WORK_MODES.map((m) => m.value)),
    remarks: strOrNull(r, "remarks"),
    date_applied: date,
    created_at: str(r, "created_at"),
    updated_at: str(r, "updated_at"),
  };
}

export function fromApiInterview(v: unknown): Interview {
  const r = obj(v, "interview");
  return {
    id: int(r, "id"),
    job_application_id: int(r, "job_application_id"),
    interviewer: strOrNull(r, "interviewer"),
    scheduled_at: str(r, "scheduled_at"),
    mode: oneOf(r, "mode", INTERVIEW_MODES.map((m) => m.value)),
    outcome: oneOf(r, "outcome", OUTCOMES),
    remarks: strOrNull(r, "remarks"),
    created_at: str(r, "created_at"),
    updated_at: str(r, "updated_at"),
  };
}

export type Page<T> = { items: T[]; total: number };

export function fromApiPage<T>(v: unknown, item: (x: unknown) => T): Page<T> {
  const r = obj(v, "page");
  if (!Array.isArray(r.items)) throw new MappingError("items");
  const total = int(r, "total");
  if (total < 0) throw new MappingError("total");
  return { items: r.items.map(item), total };
}

/** What the form edits, in API types. contact_email is deliberately absent. */
export type ApplicationInput = {
  company: string;
  job_name: string;
  status: Status;
  mode_of_work: WorkMode;
  date_applied: string | null;
  salary: number | null;
  contact_website: string | null;
  remarks: string | null;
};

const FIELDS = [
  "company",
  "job_name",
  "status",
  "mode_of_work",
  "date_applied",
  "salary",
  "contact_website",
  "remarks",
] as const satisfies readonly (keyof ApplicationInput)[];

export const toApplicationInput = (a: Application): ApplicationInput => ({
  company: a.company,
  job_name: a.job_name,
  status: a.status,
  mode_of_work: a.mode_of_work,
  date_applied: a.date_applied,
  salary: a.salary,
  contact_website: a.contact_website,
  remarks: a.remarks,
});

export const toCreateBody = (i: ApplicationInput): ApplicationInput => {
  const body: Record<string, unknown> = {};
  for (const k of FIELDS) body[k] = i[k];
  return body as ApplicationInput;
};

/** Only the fields that differ from `initial`; `{}` means nothing to save. null clears a nullable field. */
export function toPatchBody(initial: ApplicationInput, next: ApplicationInput): Partial<ApplicationInput> {
  const body: Record<string, unknown> = {};
  for (const k of FIELDS) if (initial[k] !== next[k]) body[k] = next[k];
  return body as Partial<ApplicationInput>;
}

/** The form holds strings only; "" means empty. mode_of_work is "" until the user chooses one. */
export type FormValues = {
  job_name: string;
  company: string;
  status: Status;
  date_applied: string;
  mode_of_work: WorkMode | "";
  salary: string;
  contact_website: string;
  remarks: string;
};

export const toFormValues = (a: Application): FormValues => ({
  job_name: a.job_name,
  company: a.company,
  status: a.status,
  date_applied: a.date_applied ?? "",
  mode_of_work: a.mode_of_work,
  salary: a.salary === null ? "" : String(a.salary),
  contact_website: a.contact_website ?? "",
  remarks: a.remarks ?? "",
});

export const EMPTY_FORM: FormValues = {
  job_name: "",
  company: "",
  status: "saved",
  date_applied: "",
  mode_of_work: "",
  salary: "",
  contact_website: "",
  remarks: "",
};

/** Call only on values that passed validate(): trims, "" becomes null, salary is a digit string. */
export function fromFormValues(v: FormValues): ApplicationInput {
  if (v.mode_of_work === "") throw new MappingError("mode_of_work");
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    company: v.company.trim(),
    job_name: v.job_name.trim(),
    status: v.status,
    mode_of_work: v.mode_of_work,
    date_applied: v.date_applied === "" ? null : v.date_applied,
    salary: v.salary === "" ? null : Number(v.salary),
    contact_website: orNull(v.contact_website),
    remarks: orNull(v.remarks),
  };
}
