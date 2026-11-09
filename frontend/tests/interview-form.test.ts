import { expect, it } from "vitest";
import { LIMITS } from "../src/lib/application-form";
import { isDirty, validate } from "../src/lib/interview-form";
import { EMPTY_INTERVIEW_FORM, type InterviewFormValues } from "../src/lib/mappers";

const ok: InterviewFormValues = { ...EMPTY_INTERVIEW_FORM, scheduled_at: "2026-11-20T23:30", mode: "online" };

it("a complete form has no errors; the past is fine", () => {
  expect(validate(ok)).toEqual({});
  expect(validate({ ...ok, scheduled_at: "2001-01-01T08:00" })).toEqual({});
});

it("an empty form asks for time and mode only", () => {
  expect(validate(EMPTY_INTERVIEW_FORM)).toEqual({ scheduled_at: "Enter the date and time.", mode: "Choose an interview mode." });
});

it("time: badInput, impossible dates, year range", () => {
  expect(validate({ ...ok, scheduled_at: "" }, { timeBad: true }).scheduled_at).toBe("Enter a complete date and time.");
  expect(validate({ ...ok, scheduled_at: "2026-02-30T10:00" }).scheduled_at).toBe("Enter a valid date and time.");
  expect(validate({ ...ok, scheduled_at: "1899-12-31T23:59" }).scheduled_at).toBe("Enter a year between 1900 and 2200.");
  expect(validate({ ...ok, scheduled_at: "2201-01-01T00:00" }).scheduled_at).toBe("Enter a year between 1900 and 2200.");
  expect(validate({ ...ok, scheduled_at: "0050-01-01T10:00" }).scheduled_at).toBe("Enter a year between 1900 and 2200.");
  expect(validate({ ...ok, scheduled_at: "1900-01-01T00:00" })).toEqual({});
  expect(validate({ ...ok, scheduled_at: "2200-12-31T23:59" })).toEqual({});
});

it("year range only when the time was changed: an untouched stored 2201 PHT time passes", () => {
  const stored = { ...ok, scheduled_at: "2201-01-01T04:00" };
  expect(validate(stored, { initialTime: "2201-01-01T04:00" })).toEqual({});
  expect(validate({ ...ok, scheduled_at: "2201-01-01T05:00" }, { initialTime: "2201-01-01T04:00" }).scheduled_at).toBe("Enter a year between 1900 and 2200.");
  expect(validate(stored, { initialTime: "" }).scheduled_at).toBe("Enter a year between 1900 and 2200."); // create
  expect(validate(stored).scheduled_at).toBe("Enter a year between 1900 and 2200.");
});

it("interviewer: 200 code points after trim (emoji and CJK count once)", () => {
  expect(validate({ ...ok, interviewer: "😀".repeat(200) }).interviewer).toBeUndefined();
  expect(validate({ ...ok, interviewer: "李".repeat(200) }).interviewer).toBeUndefined();
  expect(validate({ ...ok, interviewer: `  ${"a".repeat(200)}  ` }).interviewer).toBeUndefined();
  expect(validate({ ...ok, interviewer: "😀".repeat(201) }).interviewer).toBe("Interviewer must be 200 characters or fewer.");
  expect(validate({ ...ok, interviewer: "   " }).interviewer).toBeUndefined(); // blank = none
});

it("notes: 5000 code points after trim", () => {
  expect(validate({ ...ok, remarks: "😀".repeat(LIMITS.remarks) }).remarks).toBeUndefined();
  expect(validate({ ...ok, remarks: "😀".repeat(LIMITS.remarks + 1) }).remarks).toBe("Notes must be 5,000 characters or fewer.");
});

it("isDirty ignores surrounding whitespace and seconds, sees real changes", () => {
  expect(isDirty(ok, { ...ok })).toBe(false);
  expect(isDirty(ok, { ...ok, interviewer: "  ", remarks: "\n" })).toBe(false);
  expect(isDirty(ok, { ...ok, scheduled_at: "2026-11-20T23:30:15" })).toBe(false);
  expect(isDirty(ok, { ...ok, scheduled_at: "2026-11-20T23:31" })).toBe(true);
  expect(isDirty(ok, { ...ok, mode: "async" })).toBe(true);
  expect(isDirty(ok, { ...ok, outcome: "good" })).toBe(true);
  expect(isDirty(EMPTY_INTERVIEW_FORM, EMPTY_INTERVIEW_FORM)).toBe(false);
});
