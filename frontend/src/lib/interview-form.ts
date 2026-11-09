// Client-side rules for the interview form, mirroring app/interviews/schemas.py:
//   scheduled_at: a real date and time (read as Philippine time), year 1900-2200, past allowed
//   mode: required        interviewer: trimmed, at most 200 (or empty)     remarks: at most 5000
//   outcome: always one of pending/good/bad (a select, so never empty)
// Lengths count code points like Pydantic; the inputs' own maxLength is 2x (see capFor).
import { LIMITS } from "./application-form";
import { type InterviewFormValues } from "./mappers";
import { fromPhtInput, phtYearOk } from "./pht";

export type FieldName = keyof InterviewFormValues;
export type Errors = Partial<Record<FieldName, string>>;

/** Top to bottom (DESIGN 8.5), the order focus moves to the first invalid field. */
export const FIELD_ORDER: readonly FieldName[] = ["scheduled_at", "mode", "interviewer", "outcome", "remarks"];

const points = (s: string) => [...s].length;

/**
 * `timeBad`: the browser's input holds a partial date it cannot turn into a value (its value is then "").
 * `initialTime`: the edit form's starting value. An untouched time skips the year check: the API took it
 * in the offset it was sent in, so its PHT year can be 2201 or 1899 and it must not block other edits.
 */
export function validate(v: InterviewFormValues, { timeBad = false, initialTime }: { timeBad?: boolean; initialTime?: string } = {}): Errors {
  const e: Errors = {};
  const changed = initialTime === undefined || v.scheduled_at.slice(0, 16) !== initialTime.slice(0, 16);
  if (timeBad) e.scheduled_at = "Enter a complete date and time.";
  else if (v.scheduled_at === "") e.scheduled_at = "Enter the date and time.";
  else if (fromPhtInput(v.scheduled_at) === null) e.scheduled_at = "Enter a valid date and time.";
  else if (changed && !phtYearOk(v.scheduled_at)) e.scheduled_at = "Enter a year between 1900 and 2200.";

  if (v.mode === "") e.mode = "Choose an interview mode.";
  if (points(v.interviewer.trim()) > LIMITS.name) e.interviewer = `Interviewer must be ${LIMITS.name} characters or fewer.`;
  if (points(v.remarks.trim()) > LIMITS.remarks) e.remarks = "Notes must be 5,000 characters or fewer.";
  return e;
}

/** Values as they would be saved (trimmed; the time to the minute). Used to compare, never to display. */
const normalize = (v: InterviewFormValues) => ({
  ...v,
  scheduled_at: v.scheduled_at.slice(0, 16),
  interviewer: v.interviewer.trim(),
  remarks: v.remarks.trim(),
});

export function isDirty(initial: InterviewFormValues, current: InterviewFormValues): boolean {
  const a = normalize(initial);
  const b = normalize(current);
  return FIELD_ORDER.some((k) => a[k] !== b[k]);
}
