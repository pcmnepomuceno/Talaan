import { parse } from "./format";
import { toPhtInput } from "./pht";
import { type AgendaInterview, type Interview, interviewMode } from "./types";

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

/**
 * The agenda's rows grouped by their Philippine calendar day ("YYYY-MM-DD"), in the order given
 * (the server's order, so a day that continues on the next page joins its group). A row whose date
 * cannot be read goes in a last group with the day "". Never reads the device zone.
 */
export function groupByPhtDay(items: readonly AgendaInterview[]): { day: string; items: AgendaInterview[] }[] {
  const groups = new Map<string, AgendaInterview[]>();
  for (const i of items) {
    const day = toPhtInput(i.scheduled_at)?.slice(0, 10) ?? "";
    const g = groups.get(day);
    if (g) g.push(i);
    else groups.set(day, [i]);
  }
  const unreadable = groups.get("");
  groups.delete("");
  return [...groups, ...(unreadable ? [["", unreadable] as const] : [])].map(([day, items]) => ({ day, items }));
}

/** The interview is at or after this moment (the file for it is still of use). Unreadable dates are not upcoming. */
export function isUpcoming(i: Pick<Interview, "scheduled_at">, now: number = Date.now()): boolean {
  return (parse(i.scheduled_at)?.date.getTime() ?? -Infinity) >= now;
}
