import type { Status } from "@/components/status-stamp";

const TZ = "Asia/Manila";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

// All formatters return null for missing or invalid input and never throw.

export function formatPeso(n: number | null | undefined, { perMonth = true } = {}): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const s = `₱${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)}`;
  return perMonth ? `${s} / month` : s;
}

// Date-only strings are calendar dates: format them in UTC so no device zone shifts the day.
// Anything with a time is an instant: format it in Manila. A time without an offset is read as
// Manila wall time (the Philippines has no DST), never as the device's zone.
function parse(value: string | null | undefined): { date: Date; zone: string } | null {
  if (!value) return null;
  const dateOnly = DATE_ONLY.test(value);
  const iso = dateOnly || HAS_OFFSET.test(value) ? value : `${value}+08:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : { date, zone: dateOnly ? "UTC" : TZ };
}

export function formatDate(value: string | null | undefined): string | null {
  const p = parse(value);
  if (!p) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: p.zone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(p.date);
}

export function formatDateTimePHT(value: string | null | undefined): string | null {
  const p = parse(value);
  if (!p) return null;
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(p.date);
  // Newer ICU puts U+202F before AM/PM.
  return `${s.replace(/[  ]/g, " ")} PHT`;
}

export const NOT_APPLIED_YET = "Not applied yet";

// Saved rows without a date say so; other rows without a date show nothing.
export function dateAppliedLabel(date: string | null | undefined, status: Status): string | null {
  return formatDate(date) ?? (status === "saved" ? NOT_APPLIED_YET : null);
}
