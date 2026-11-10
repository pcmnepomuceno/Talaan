// One interview as an iCalendar (RFC 5545) file. Pure: no network, no storage, no device zone.
// The start is the stored instant written in UTC (Z), so no VTIMEZONE is needed and the event lands
// at the same moment in any calendar. The end is start + 1 hour (a fixed default; the app has no
// duration field). Notes (remarks) are never read: they are private and can be long.
import { parse } from "./format";
import { toPhtInput } from "./pht";
import { type AgendaInterview, interviewMode } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const enc = new TextEncoder();
const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-11-20T06:00:00Z -> "20261120T060000Z" (UTC getters only). */
function utc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** TEXT values (RFC 5545 3.3.11): backslash first, then separators, then line breaks as \n. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds one content line at 75 octets (3.1): continuation lines start with a space. Splits only between code points. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let used = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (used + n > 75) {
      out.push(cur);
      cur = " ";
      used = 1;
    }
    cur += ch;
    used += n;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** null when the interview's date cannot be read (the caller offers no file then). */
export function buildIcs(i: AgendaInterview, { now, origin }: { now: Date; origin: string }): string | null {
  const start = parse(i.scheduled_at)?.date;
  if (!start) return null;
  const mode = interviewMode(i.mode)?.label;
  const description = [
    mode && `Mode: ${mode}`,
    i.interviewer && `Interviewer: ${i.interviewer}`,
    `Application: ${origin}/applications/${i.job_application_id}`,
  ].filter(Boolean) as string[];
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Talaan//Interviews//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // A constant suffix, not the host: a later domain change must not break re-import de-duplication.
    `UID:talaan-interview-${i.id}@talaan`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(new Date(start.getTime() + HOUR_MS))}`,
    `SUMMARY:${escapeText(`Interview: ${i.job_name} at ${i.company}`)}`,
    `DESCRIPTION:${description.map(escapeText).join("\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return content.map(fold).join("\r\n") + "\r\n";
}

/** talaan-interview-<company-slug>-<yyyy-mm-dd in PHT>.ics, ASCII only. */
export function icsFileName(i: AgendaInterview): string {
  const slug =
    i.company
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "company";
  const day = toPhtInput(i.scheduled_at)?.slice(0, 10);
  return `talaan-interview-${slug}${day ? `-${day}` : ""}.ics`;
}
