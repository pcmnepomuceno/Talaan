import { expect, it } from "vitest";
import {
  EMPTY_FORM,
  EMPTY_INTERVIEW_FORM,
  fromInterviewFormValues,
  toInterviewCreateBody,
  toInterviewFormValues,
  toInterviewPatchBody,
  fromApiApplication,
  fromApiInterview,
  fromApiPage,
  fromFormValues,
  MappingError,
  toApplicationInput,
  toCreateBody,
  toFormValues,
  toPatchBody,
} from "../src/lib/mappers";

const raw = {
  id: 7,
  company: "Pinagsama Tech",
  job_name: "Frontend Engineer",
  contact_website: "https://pinagsama.example.ph/",
  contact_email: "hr@pinagsama.example.ph",
  status: "applied",
  salary: 85000,
  mode_of_work: "hybrid",
  remarks: "Referred.",
  date_applied: "2026-10-14",
  created_at: "2026-10-14T01:00:00Z",
  updated_at: "2026-10-14T01:00:00Z",
};

it("maps an API application and keeps date-only strings untouched", () => {
  const a = fromApiApplication(raw);
  expect(a).toEqual(raw);
  expect(a.date_applied).toBe("2026-10-14");
});

it.each(["Pacific/Auckland", "America/Los_Angeles", "Asia/Manila"])("date never shifts in TZ %s", (tz) => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    const a = fromApiApplication({ ...raw, date_applied: "2026-10-31" });
    expect(toFormValues(a).date_applied).toBe("2026-10-31");
    expect(fromFormValues(toFormValues(a)).date_applied).toBe("2026-10-31");
  } finally {
    process.env.TZ = before;
  }
});

it("preserves null salary, 0 salary and null optional fields", () => {
  const a = fromApiApplication({ ...raw, salary: null, remarks: null, contact_website: null, date_applied: null });
  expect(a.salary).toBeNull();
  expect(toFormValues(a)).toMatchObject({ salary: "", remarks: "", contact_website: "", date_applied: "" });
  expect(fromFormValues(toFormValues(a))).toMatchObject({ salary: null, remarks: null, contact_website: null, date_applied: null });
  expect(fromApiApplication({ ...raw, salary: 0 }).salary).toBe(0);
  expect(fromFormValues({ ...toFormValues(fromApiApplication({ ...raw, salary: 0 })) }).salary).toBe(0);
});

it("round trip: application -> form -> input equals the application's editable fields", () => {
  const a = fromApiApplication(raw);
  expect(fromFormValues(toFormValues(a))).toEqual(toApplicationInput(a));
});

it("unknown enum or wrong type fails with MappingError", () => {
  for (const bad of [
    { ...raw, status: "hired" },
    { ...raw, mode_of_work: "office" },
    { ...raw, id: "7" },
    { ...raw, salary: 1.5 },
    { ...raw, company: null },
    { ...raw, date_applied: "14/10/2026" },
    null,
    "x",
  ])
    expect(() => fromApiApplication(bad)).toThrow(MappingError);
  expect(() => fromApiInterview({ id: 1, job_application_id: 7, interviewer: null, scheduled_at: "2026-10-18T02:00:00Z", mode: "phone", outcome: "good", remarks: null, created_at: "x", updated_at: "x" })).toThrow(MappingError);
});

it("page: maps items, rejects a bad shape", () => {
  expect(fromApiPage({ items: [raw], total: 3, limit: 50, offset: 0 }, fromApiApplication)).toEqual({ items: [raw], total: 3 });
  expect(() => fromApiPage({ items: [{ ...raw, status: "x" }], total: 1 }, fromApiApplication)).toThrow(MappingError);
  expect(() => fromApiPage({ items: "no", total: 1 }, fromApiApplication)).toThrow(MappingError);
  expect(() => fromApiPage({ items: [], total: -1 }, fromApiApplication)).toThrow(MappingError);
});

it("create body lists exactly the editable fields (no contact_email, no server fields)", () => {
  const body = toCreateBody({ ...toApplicationInput(fromApiApplication(raw)), contact_email: "x@y.z", id: 1 } as never);
  expect(Object.keys(body).sort()).toEqual(
    ["company", "contact_website", "date_applied", "job_name", "mode_of_work", "remarks", "salary", "status"],
  );
});

it("patch body: unchanged is empty, one change is one key, cleared nullable is null", () => {
  const init = toApplicationInput(fromApiApplication(raw));
  expect(toPatchBody(init, { ...init })).toEqual({});
  expect(toPatchBody(init, { ...init, status: "offered" })).toEqual({ status: "offered" });
  expect(toPatchBody(init, { ...init, salary: null, remarks: null })).toEqual({ salary: null, remarks: null });
});

it("fromFormValues trims, turns blanks into null and needs a work mode", () => {
  const v = { ...EMPTY_FORM, job_name: "  Dev  ", company: " Acme ", remarks: "   ", contact_website: " https://a.ph ", mode_of_work: "remote" as const, salary: "007" };
  expect(fromFormValues(v)).toMatchObject({ job_name: "Dev", company: "Acme", remarks: null, contact_website: "https://a.ph", salary: 7 });
  expect(() => fromFormValues(EMPTY_FORM)).toThrow(MappingError);
});

// ---- interviews (F6) ----
const rawIv = {
  id: 7,
  job_application_id: 1,
  interviewer: "Ana",
  scheduled_at: "2026-11-20T15:30:45.123456Z",
  mode: "online",
  outcome: "good",
  remarks: null,
  created_at: "2026-11-01T00:00:00Z",
  updated_at: "2026-11-01T00:00:00Z",
};

it("interview mapping is strict: unknown, null or missing enums fail", () => {
  expect(fromApiInterview(rawIv).outcome).toBe("good");
  for (const bad of [{ outcome: null }, { outcome: undefined }, { outcome: "great" }, { mode: null }, { mode: "phone" }, { mode: "hybrid" }])
    expect(() => fromApiInterview({ ...rawIv, ...bad }), JSON.stringify(bad)).toThrow(MappingError);
});

it("interview form values: UTC API time shows as PHT, and back to +08:00", () => {
  const v = toInterviewFormValues(fromApiInterview(rawIv));
  expect(v).toMatchObject({ scheduled_at: "2026-11-20T23:30", mode: "online", outcome: "good", interviewer: "Ana", remarks: "" });
  expect(fromInterviewFormValues(v).scheduled_at).toBe("2026-11-20T23:30:00+08:00");
});

it("new interview form: nothing chosen for mode, outcome pending; mode is required to map", () => {
  expect(EMPTY_INTERVIEW_FORM.mode).toBe("");
  expect(EMPTY_INTERVIEW_FORM.outcome).toBe("pending");
  expect(() => fromInterviewFormValues({ ...EMPTY_INTERVIEW_FORM, scheduled_at: "2026-11-20T10:00" })).toThrow(MappingError);
  expect(() => fromInterviewFormValues({ ...EMPTY_INTERVIEW_FORM, mode: "online" })).toThrow(MappingError);
});

it("interview form values trim and turn blanks into null", () => {
  const v = { ...EMPTY_INTERVIEW_FORM, scheduled_at: "2026-11-20T10:00", mode: "async" as const, interviewer: "  ", remarks: " hi " };
  expect(fromInterviewFormValues(v)).toEqual({ scheduled_at: "2026-11-20T10:00:00+08:00", mode: "async", outcome: "pending", interviewer: null, remarks: "hi" });
});

it("interview bodies: create lists its five fields; patch only the changed ones", () => {
  const init = fromInterviewFormValues(toInterviewFormValues(fromApiInterview(rawIv)));
  expect(Object.keys(toInterviewCreateBody({ ...init, job_application_id: 1 } as never)).sort()).toEqual(
    ["interviewer", "mode", "outcome", "remarks", "scheduled_at"],
  );
  expect(toInterviewPatchBody(init, { ...init })).toEqual({});
  expect(toInterviewPatchBody(init, { ...init, outcome: "bad" })).toEqual({ outcome: "bad" });
  expect(toInterviewPatchBody(init, { ...init, interviewer: null, remarks: "x" })).toEqual({ interviewer: null, remarks: "x" });
});
