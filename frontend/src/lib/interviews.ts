import { parse } from "./format";
import type { Interview } from "./types";

// Oldest first, ties by id. Returns a new array. An unparsable date sorts last.
// Uses the same parse() as formatDateTimePHT, so the order matches the times shown.
export function sortInterviewsByDate(interviews: readonly Interview[]): Interview[] {
  const t = (i: Interview) => parse(i.scheduled_at)?.date.getTime() ?? Infinity;
  return [...interviews].sort((a, b) => (t(a) === t(b) ? a.id - b.id : t(a) < t(b) ? -1 : 1));
}
