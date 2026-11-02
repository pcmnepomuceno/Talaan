import type { Interview } from "./types";

// Oldest first, ties by id. Returns a new array. An unparsable date sorts last.
export function sortInterviewsByDate(interviews: readonly Interview[]): Interview[] {
  const t = (i: Interview) => {
    const n = Date.parse(i.scheduled_at);
    return Number.isNaN(n) ? Infinity : n;
  };
  return [...interviews].sort((a, b) => (t(a) === t(b) ? a.id - b.id : t(a) < t(b) ? -1 : 1));
}
