// Client-side rules for the application form, mirroring app/applications/schemas.py:
//   company, job_name: trimmed, 1-200 characters      salary: whole number 0 to 2147483647 (or empty)
//   contact_website: http(s) URL, at most 2000        remarks: at most 5000
//   status, mode_of_work: required enums (the work mode starts with nothing chosen)
// Pydantic counts code points, JS .length counts UTF-16 units, so lengths use [...s].length;
// the inputs' own maxLength is 2x the limit, only a typing cap (see capFor).
import { type FormValues } from "./mappers";

export const LIMITS = { name: 200, website: 2000, remarks: 5000, salaryMax: 2_147_483_647 } as const;
/** maxLength for an input: 2x, because an emoji is 2 UTF-16 units but 1 code point. */
export const capFor = (limit: number) => limit * 2;

export type FieldName = keyof FormValues;
export type Errors = Partial<Record<FieldName, string>>;

/** Top to bottom, the order focus moves to the first invalid field. */
export const FIELD_ORDER: readonly FieldName[] = [
  "job_name",
  "company",
  "status",
  "date_applied",
  "mode_of_work",
  "salary",
  "contact_website",
  "remarks",
];

const points = (s: string) => [...s].length;

/** Commas and whitespace are dropped (a pasted "85,000" works); anything else is kept for validate() to reject. */
export const cleanSalaryInput = (raw: string) => raw.replace(/[,\s]/g, "");

function badUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return !((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "");
  } catch {
    return true;
  }
}

/** `dateBad`: the browser's date input holds text it cannot turn into a date (its value is then ""). */
export function validate(v: FormValues, { dateBad = false }: { dateBad?: boolean } = {}): Errors {
  const e: Errors = {};
  const name = (key: "job_name" | "company", label: string, empty: string) => {
    const t = v[key].trim();
    if (t === "") e[key] = empty;
    else if (points(t) > LIMITS.name) e[key] = `${label} must be ${LIMITS.name} characters or fewer.`;
  };
  name("job_name", "Job title", "Enter a job title.");
  name("company", "Company", "Enter a company name.");

  if (dateBad) e.date_applied = "Enter a complete date.";
  else if (v.date_applied !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v.date_applied)) e.date_applied = "Enter a valid date.";

  if (v.mode_of_work === "") e.mode_of_work = "Choose a work mode.";

  const salary = cleanSalaryInput(v.salary);
  if (salary !== "") {
    if (!/^\d+$/.test(salary)) e.salary = "Enter a whole number, 0 or more.";
    else if (BigInt(salary) > BigInt(LIMITS.salaryMax)) e.salary = "Enter an amount up to 2,147,483,647.";
  }

  const site = v.contact_website.trim();
  if (site !== "") {
    if (points(site) > LIMITS.website) e.contact_website = "Website must be 2,000 characters or fewer.";
    else if (badUrl(site)) e.contact_website = "Enter a full address starting with http:// or https://";
  }

  if (points(v.remarks.trim()) > LIMITS.remarks) e.remarks = "Notes must be 5,000 characters or fewer.";
  return e;
}

/** Values as they would be saved: trimmed, salary without separators. Used to compare, never to display. */
const normalize = (v: FormValues) => ({
  ...v,
  job_name: v.job_name.trim(),
  company: v.company.trim(),
  salary: cleanSalaryInput(v.salary),
  contact_website: v.contact_website.trim(),
  remarks: v.remarks.trim(),
});

export function isDirty(initial: FormValues, current: FormValues): boolean {
  const a = normalize(initial);
  const b = normalize(current);
  return FIELD_ORDER.some((k) => a[k] !== b[k]);
}

/**
 * 422 field errors (http.ts keeps the last `loc` segment, so keys are API field names, which equal
 * the form field names) onto fields. Anything else (contact_email, extra fields) goes to a banner.
 */
export function mapServerErrors(fieldErrors: Record<string, string>): { errors: Errors; other: string[] } {
  const errors: Errors = {};
  const other: string[] = [];
  const tidy = (m: string) => (/[.!?]$/.test(m) ? m : `${m}.`).replace(/^./, (c) => c.toUpperCase());
  for (const [k, msg] of Object.entries(fieldErrors)) {
    if ((FIELD_ORDER as readonly string[]).includes(k)) errors[k as FieldName] = tidy(msg);
    else other.push(tidy(msg));
  }
  return { errors, other };
}
