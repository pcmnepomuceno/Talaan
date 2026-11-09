import { parse } from "./format";
import { type Interview, interviewMode } from "./types";

// Oldest first, ties by id. Returns a new array. An unparsable date sorts last.
// Uses the same parse() as formatDateTimePHT, so the order matches the times shown.
export function sortInterviewsByDate(interviews: readonly Interview[]): Interview[] {
  const t = (i: Interview) => parse(i.scheduled_at)?.date.getTime() ?? Infinity;
  return [...interviews].sort((a, b) => (t(a) === t(b) ? a.id - b.id : t(a) < t(b) ? -1 : 1));
}

/** The delete dialog's sentence. The mode label goes mid-sentence, so lowercase; no label, no gap. */
export function interviewDeleteMessage(i: Interview, when: string): string {
  const mode = interviewMode(i.mode)?.label.toLowerCase();
  return `The ${mode ? `${mode} ` : ""}interview on ${when} will be removed. This cannot be undone.`;
}
