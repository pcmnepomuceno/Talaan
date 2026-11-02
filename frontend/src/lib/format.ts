import type { Status } from "@/components/status-stamp";

const TZ = "Asia/Manila";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

// All formatters return null for missing or invalid input and never throw.
// Intl formatters are built once here, not per call (ledger rows call these several times each).
const PESO = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const day = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric" });
const DAY: Record<string, Intl.DateTimeFormat> = { UTC: day("UTC"), [TZ]: day(TZ) };
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatPeso(n: number | null | undefined, { perMonth = true } = {}): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const s = `₱${PESO.format(n)}`;
  return perMonth ? `${s} / month` : s;
}

// new Date() rolls 2026-02-30 over to Mar 2, so the leading YYYY-MM-DD must survive a UTC round trip.
function onCalendar(value: string): boolean {
  const ymd = value.slice(0, 10);
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

// Date-only strings are calendar dates: format them in UTC so no device zone shifts the day.
// Anything with a time is an instant: format it in Manila. A time without an offset is read as
// Manila wall time (the Philippines has no DST), never as the device's zone.

export function parse(value: string | null | undefined): { date: Date; zone: string } | null {
  if (!value || !onCalendar(value)) return null;
  const dateOnly = DATE_ONLY.test(value);
  const iso = dateOnly || HAS_OFFSET.test(value) ? value : `${value}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : { date, zone: dateOnly ? "UTC" : TZ };
}

export function formatDate(value: string | null | undefined): string | null {
  const p = parse(value);
  if (!p) return null;
  return DAY[p.zone].format(p.date);
}

export function formatDateTimePHT(value: string | null | undefined): string | null {
  const p = parse(value);
  if (!p) return null;
  const s = DATE_TIME.format(p.date);
  // Newer ICU puts U+202F before AM/PM.
  return `${s.replace(/[  ]/g, " ")} PHT`;
}

export const NOT_APPLIED_YET = "Not applied yet";

// Saved rows without a date say so; other rows without a date show nothing.
export function dateAppliedLabel(date: string | null | undefined, status: Status): string | null {
  return formatDate(date) ?? (status === "saved" ? NOT_APPLIED_YET : null);
}
