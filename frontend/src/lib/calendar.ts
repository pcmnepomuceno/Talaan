// Month-grid math for the interviews calendar (DESIGN.md 6.13). Pure: days are "YYYY-MM-DD" strings
// and months "YYYY-MM"; every calculation goes through UTC getters on UTC dates, so the device zone
// can never move a day (the same rule as pht.ts). "Today" is the Philippine day.
export type Day = string;
export type Month = string;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const MS_DAY = 86_400_000;
const PHT_OFFSET_MS = 8 * 3_600_000;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The API accepts years 1900-2200 (the interview form too), so the calendar stops there. */
export const MIN_MONTH: Month = "1900-01";
export const MAX_MONTH: Month = "2200-12";
export const MIN_DAY: Day = "1900-01-01";
export const MAX_DAY: Day = "2200-12-31";

const toDate = (day: Day) => new Date(`${day}T00:00:00Z`);
const toDay = (d: Date): Day => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** A real calendar day in canonical form ("2026-02-30" and "2026-2-3" are not). */
export function isDay(raw: string | null | undefined): raw is Day {
  const m = raw ? DAY.exec(raw) : null;
  if (!m) return false;
  const d = toDate(raw as string);
  return !Number.isNaN(d.getTime()) && toDay(d) === raw;
}

export const isMonth = (raw: string | null | undefined): raw is Month => {
  const m = raw ? MONTH.exec(raw) : null;
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
};

/** The Philippine calendar day of an instant (ms). */
export const phtToday = (now: number = Date.now()): Day => toDay(new Date(now + PHT_OFFSET_MS));

export const monthOf = (day: Day): Month => day.slice(0, 7);
export const inLimits = (day: Day) => day >= MIN_DAY && day <= MAX_DAY; // fixed-width strings sort as dates
export const monthInLimits = (month: Month) => month >= MIN_MONTH && month <= MAX_MONTH;

/** Missing, malformed or out-of-range -> the current month and `valid: false` (the caller replaces the URL). */
export function parseMonth(raw: string | null | undefined, today: Day): { month: Month; valid: boolean } {
  if (isMonth(raw) && monthInLimits(raw)) return { month: raw, valid: true };
  return { month: monthOf(today), valid: false };
}

export function addDays(day: Day, n: number): Day {
  return toDay(new Date(toDate(day).getTime() + n * MS_DAY));
}

/** 0 = Sunday. */
export const weekday = (day: Day) => toDate(day).getUTCDay();

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(i / 12), 4)}-${pad((i % 12) + 1)}`;
}

export function daysInMonth(month: Month): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The visible grid: whole Sunday-first weeks (4, 5 or 6) covering the month, so 28, 35 or 42 days. */
export function gridDays(month: Month): Day[] {
  const first = `${month}-01`;
  const lead = weekday(first);
  const weeks = Math.ceil((lead + daysInMonth(month)) / 7);
  const start = addDays(first, -lead);
  return Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
}

/** What to ask the API for: the whole grid, clamped to the years the API accepts. */
export function gridRange(month: Month): { from: Day; to: Day } {
  const days = gridDays(month);
  const from = days[0] < MIN_DAY ? MIN_DAY : days[0];
  const last = days[days.length - 1];
  return { from, to: last > MAX_DAY ? MAX_DAY : last };
}

/** The selected day: `raw` when it is a real day inside the grid; else today when it is in the month; else the 1st. */
export function parseDay(raw: string | null | undefined, month: Month, today: Day): Day {
  if (isDay(raw) && inLimits(raw) && gridDays(month).includes(raw)) return raw;
  return monthOf(today) === month ? today : `${month}-01`;
}

export type MoveKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

/** Where a key moves the active day. Page keys keep the day of the month, clamped to the shorter month. Never leaves the supported years. */
export function moveDay(day: Day, key: MoveKey): Day {
  let next: Day;
  switch (key) {
    case "ArrowLeft":
      next = addDays(day, -1);
      break;
    case "ArrowRight":
      next = addDays(day, 1);
      break;
    case "ArrowUp":
      next = addDays(day, -7);
      break;
    case "ArrowDown":
      next = addDays(day, 7);
      break;
    case "Home":
      next = addDays(day, -weekday(day));
      break;
    case "End":
      next = addDays(day, 6 - weekday(day));
      break;
    default: {
      const month = addMonths(monthOf(day), key === "PageUp" ? -1 : 1);
      next = `${month}-${pad(Math.min(Number(day.slice(8)), daysInMonth(month)))}`;
    }
  }
  return next < MIN_DAY ? MIN_DAY : next > MAX_DAY ? MAX_DAY : next;
}

const MONTH_HEADING = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
/** "2026-11" -> "November 2026". */
export const formatMonthHeading = (month: Month) => MONTH_HEADING.format(new Date(`${month}-01T00:00:00Z`));
