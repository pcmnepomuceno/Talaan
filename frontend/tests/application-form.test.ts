import { expect, it } from "vitest";
import { capFor, cleanSalaryInput, FIELD_ORDER, isDirty, LIMITS, mapServerErrors, validate } from "../src/lib/application-form";
import { EMPTY_FORM, type FormValues } from "../src/lib/mappers";

const ok: FormValues = { ...EMPTY_FORM, job_name: "Dev", company: "Acme", mode_of_work: "remote" };

it("a minimal valid form has no errors", () => {
  expect(validate(ok)).toEqual({});
});

it("job title and company are required, trimmed, at most 200 code points", () => {
  expect(validate({ ...ok, job_name: "   " }).job_name).toBe("Enter a job title.");
  expect(validate({ ...ok, company: "" }).company).toBe("Enter a company name.");
  expect(validate({ ...ok, job_name: "a".repeat(200) }).job_name).toBeUndefined();
  expect(validate({ ...ok, job_name: "a".repeat(201) }).job_name).toBe("Job title must be 200 characters or fewer.");
  expect(validate({ ...ok, company: ` ${"a".repeat(200)} ` }).company).toBeUndefined(); // trimmed first
  expect(validate({ ...ok, company: "a".repeat(201) }).company).toBe("Company must be 200 characters or fewer.");
});

it("counts emoji and non-Latin text as code points, like the server", () => {
  expect(validate({ ...ok, job_name: "😀".repeat(200) }).job_name).toBeUndefined(); // 400 UTF-16 units
  expect(validate({ ...ok, job_name: "😀".repeat(201) }).job_name).toBeTruthy();
  expect(validate({ ...ok, company: "株式会社".repeat(50) }).company).toBeUndefined();
  expect(capFor(LIMITS.name)).toBe(400); // the typing cap never blocks a valid 200-emoji value
});

it("work mode has no default: empty is an error", () => {
  expect(validate({ ...ok, mode_of_work: "" }).mode_of_work).toBe("Choose a work mode.");
});

it("salary: empty and 0 are valid, separators are dropped, negatives and decimals are rejected", () => {
  for (const good of ["", "0", "85000", "85,000", " 85 000 ", "007", "2147483647"]) expect(validate({ ...ok, salary: good }).salary, good).toBeUndefined();
  for (const bad of ["-5", "1.5", "1e3", "abc", "₱5", "+5", "5.", ".5"]) expect(validate({ ...ok, salary: bad }).salary, bad).toBe("Enter a whole number, 0 or more.");
  expect(validate({ ...ok, salary: "2147483648" }).salary).toBe("Enter an amount up to 2,147,483,647.");
  expect(validate({ ...ok, salary: "9".repeat(40) }).salary).toBe("Enter an amount up to 2,147,483,647.");
  expect(cleanSalaryInput("85,000")).toBe("85000");
});

it("website: empty ok; http and https only; at most 2000", () => {
  for (const good of ["", "https://a.ph", "http://localhost:3000/x?y=1", "  https://a.ph  "]) expect(validate({ ...ok, contact_website: good }).contact_website, good).toBeUndefined();
  for (const bad of ["example.com", "ftp://a.ph", "javascript:alert(1)", "http://", "https://a b.ph", "//a.ph"])
    expect(validate({ ...ok, contact_website: bad }).contact_website, bad).toBe("Enter a full address starting with http:// or https://");
  expect(validate({ ...ok, contact_website: `https://a.ph/${"a".repeat(2000)}` }).contact_website).toBe("Website must be 2,000 characters or fewer.");
});

it("notes: at most 5000", () => {
  expect(validate({ ...ok, remarks: "a".repeat(5000) }).remarks).toBeUndefined();
  expect(validate({ ...ok, remarks: "a".repeat(5001) }).remarks).toBe("Notes must be 5,000 characters or fewer.");
});

it("date: native input text it cannot parse is an error; a YYYY-MM-DD string is fine", () => {
  expect(validate({ ...ok, date_applied: "2026-10-14" }).date_applied).toBeUndefined();
  expect(validate({ ...ok, date_applied: "" }, { dateBad: true }).date_applied).toBe("Enter a complete date.");
  expect(validate({ ...ok, date_applied: "275760-09-13" }).date_applied).toBe("Enter a valid date.");
});

it("reports every broken field at once", () => {
  expect(Object.keys(validate(EMPTY_FORM)).sort()).toEqual(["company", "job_name", "mode_of_work"]);
  expect(FIELD_ORDER[0]).toBe("job_name");
});

it("dirty: false for identical or whitespace-only differences, true for any real change", () => {
  const init: FormValues = { ...ok, remarks: "note", salary: "85000" };
  expect(isDirty(init, { ...init })).toBe(false);
  expect(isDirty(init, { ...init, job_name: "  Dev  ", salary: "85,000", remarks: "note " })).toBe(false);
  for (const change of [{ job_name: "Dev2" }, { status: "applied" }, { mode_of_work: "hybrid" }, { date_applied: "2026-01-01" }, { salary: "" }, { contact_website: "https://a.ph" }, { remarks: "" }] as Partial<FormValues>[])
    expect(isDirty(init, { ...init, ...change }), JSON.stringify(change)).toBe(true);
  expect(isDirty(EMPTY_FORM, EMPTY_FORM)).toBe(false);
  expect(isDirty(EMPTY_FORM, { ...EMPTY_FORM, status: "applied" })).toBe(true);
});

it("maps 422 field errors to fields and the rest to a banner list", () => {
  const { errors, other } = mapServerErrors({ company: "String should have at least 1 character", salary: "Input should be less than or equal to 2147483647", contact_email: "value is not a valid email address", body: "Extra inputs are not permitted" });
  expect(errors).toEqual({ company: "String should have at least 1 character.", salary: "Input should be less than or equal to 2147483647." });
  expect(other).toEqual(["Value is not a valid email address.", "Extra inputs are not permitted."]);
});
