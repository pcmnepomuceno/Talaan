import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  daysInMonth,
  formatMonthHeading,
  gridDays,
  gridRange,
  inLimits,
  MAX_MONTH,
  MIN_MONTH,
  monthOf,
  moveDay,
  parseDay,
  parseMonth,
  phtToday,
  weekday,
} from "../src/lib/calendar";
import { formatTimePht } from "../src/lib/format";

const ZONES = ["UTC", "America/Los_Angeles", "Pacific/Auckland"];

function suite() {
  it("builds Sunday-first grids of 4, 5 or 6 whole weeks", () => {
    const feb26 = gridDays("2026-02"); // Feb 1 2026 is a Sunday and the month has 28 days
    expect(feb26).toHaveLength(28);
    expect([feb26[0], feb26[27]]).toEqual(["2026-02-01", "2026-02-28"]);
    const nov26 = gridDays("2026-11"); // starts on a Sunday, 30 days -> 5 rows
    expect(nov26).toHaveLength(35);
    expect([nov26[0], nov26[34]]).toEqual(["2026-11-01", "2026-12-05"]);
    const aug26 = gridDays("2026-08"); // starts on a Saturday, 31 days -> 6 rows
    expect(aug26).toHaveLength(42);
    expect([aug26[0], aug26[41]]).toEqual(["2026-07-26", "2026-09-05"]);
    for (const m of ["2026-02", "2026-08", "2026-11", "2027-02", "2028-02"]) {
      const days = gridDays(m);
      expect(days.length % 7).toBe(0);
      expect(weekday(days[0])).toBe(0);
    }
  });

  it("has leading and trailing days of the neighbouring months", () => {
    const g = gridDays("2026-10"); // Oct 1 2026 is a Thursday
    expect(g.slice(0, 5)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(g[g.length - 1]).toBe("2026-10-31");
    expect(gridDays("2026-12").at(-1)).toBe("2027-01-02");
  });

  it("knows February in a leap and a non-leap year", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2027-02")).toBe(28);
    expect(daysInMonth("2100-02")).toBe(28); // century, not a leap year
    expect(daysInMonth("2000-02")).toBe(29);
    expect(gridDays("2028-02")).toContain("2028-02-29");
    expect(gridDays("2027-02").filter((d) => d.startsWith("2027-02"))).toHaveLength(28);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("starts January's grid in the previous year and ends December's in the next", () => {
    expect(gridDays("2027-01")[0]).toBe("2026-12-27");
    expect(gridDays("2026-12").at(-1)).toBe("2027-01-02");
    expect(gridRange("2027-01")).toEqual({ from: "2026-12-27", to: "2027-02-06" });
  });

  it("moves months across year ends", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-11", 14)).toBe("2028-01");
    expect(addMonths("2026-01", -13)).toBe("2024-12");
  });

  it("clamps the requested range to the years the API accepts", () => {
    expect(gridRange(MIN_MONTH)).toEqual({ from: "1900-01-01", to: "1900-02-03" });
    expect(gridRange(MAX_MONTH)).toEqual({ from: "2200-11-30", to: "2200-12-31" });
    expect(inLimits("1899-12-31")).toBe(false);
    expect(inLimits("2201-01-01")).toBe(false);
  });

  it("keeps every requested range within the API's 62 days", () => {
    for (const m of ["2026-02", "2026-08", "2028-02", "1900-01", "2200-12"]) {
      const { from, to } = gridRange(m);
      expect((Date.parse(to) - Date.parse(from)) / 864e5 + 1).toBeLessThanOrEqual(42);
    }
  });

  it("parses ?month: invalid or missing falls back to the current month", () => {
    const today = "2026-11-12";
    expect(parseMonth("2026-03", today)).toEqual({ month: "2026-03", valid: true });
    for (const bad of ["2026-13", "2026-00", "abc", "", null, undefined, "1899-12", "2201-01", "2026-3", "2026-03-01", "202611"]) {
      expect(parseMonth(bad, today)).toEqual({ month: "2026-11", valid: false });
    }
    expect(parseMonth("1900-01", today).valid).toBe(true);
    expect(parseMonth("2200-12", today).valid).toBe(true);
  });

  it("parses ?day: a real day in the grid, else today if in the month, else the 1st", () => {
    expect(parseDay("2026-11-10", "2026-11", "2026-11-12")).toBe("2026-11-10");
    expect(parseDay("2026-12-02", "2026-11", "2026-11-12")).toBe("2026-12-02"); // trailing day of the grid
    expect(parseDay("2026-10-30", "2026-11", "2026-11-12")).toBe("2026-11-12"); // outside the grid (Nov starts on the 1st)
    expect(parseDay("2026-02-30", "2026-02", "2026-02-10")).toBe("2026-02-10"); // not a real day
    expect(parseDay("abc", "2026-03", "2026-11-12")).toBe("2026-03-01");
    expect(parseDay(null, "2026-03", "2026-11-12")).toBe("2026-03-01");
    expect(parseDay("2026-3-1", "2026-03", "2026-11-12")).toBe("2026-03-01");
  });

  it("moves the active day with the keys", () => {
    expect(moveDay("2026-11-10", "ArrowLeft")).toBe("2026-11-09");
    expect(moveDay("2026-11-10", "ArrowRight")).toBe("2026-11-11");
    expect(moveDay("2026-11-10", "ArrowUp")).toBe("2026-11-03");
    expect(moveDay("2026-11-10", "ArrowDown")).toBe("2026-11-17");
    expect(moveDay("2026-11-10", "Home")).toBe("2026-11-08"); // Tuesday -> Sunday
    expect(moveDay("2026-11-10", "End")).toBe("2026-11-14"); // -> Saturday
    expect(moveDay("2026-11-08", "Home")).toBe("2026-11-08");
    expect(moveDay("2026-11-14", "End")).toBe("2026-11-14");
    expect(moveDay("2026-11-01", "ArrowLeft")).toBe("2026-10-31");
    expect(moveDay("2026-12-31", "ArrowRight")).toBe("2027-01-01");
  });

  it("PageUp and PageDown keep the day of the month, clamped to the shorter month", () => {
    expect(moveDay("2026-11-10", "PageDown")).toBe("2026-12-10");
    expect(moveDay("2026-12-10", "PageDown")).toBe("2027-01-10");
    expect(moveDay("2027-01-10", "PageUp")).toBe("2026-12-10");
    expect(moveDay("2027-01-31", "PageDown")).toBe("2027-02-28");
    expect(moveDay("2028-01-31", "PageDown")).toBe("2028-02-29");
    expect(moveDay("2026-03-31", "PageUp")).toBe("2026-02-28");
  });

  it("never moves past the supported years", () => {
    expect(moveDay("1900-01-01", "ArrowLeft")).toBe("1900-01-01");
    expect(moveDay("1900-01-10", "PageUp")).toBe("1900-01-01");
    expect(moveDay("2200-12-31", "ArrowRight")).toBe("2200-12-31");
    expect(moveDay("2200-12-20", "PageDown")).toBe("2200-12-31");
  });

  it("takes today from the Philippine clock", () => {
    expect(phtToday(Date.parse("2026-11-10T15:59:59Z"))).toBe("2026-11-10");
    expect(phtToday(Date.parse("2026-11-10T16:00:00Z"))).toBe("2026-11-11"); // 00:00 PHT
    expect(phtToday(Date.parse("2026-12-31T16:30:00Z"))).toBe("2027-01-01");
  });

  it("formats the heading and the PHT time", () => {
    expect(formatMonthHeading("2026-11")).toBe("November 2026");
    expect(formatMonthHeading("2028-02")).toBe("February 2028");
    expect(monthOf("2026-11-10")).toBe("2026-11");
    expect(formatTimePht("2026-11-10T06:00:00Z")).toBe("2:00 PM");
    expect(formatTimePht("2026-11-10T15:30:00Z")).toBe("11:30 PM");
    expect(formatTimePht("2026-11-10T16:30:00Z")).toBe("12:30 AM"); // next PHT day
    expect(formatTimePht("2026-11-10T16:00:00Z")).toBe("12:00 AM");
    expect(formatTimePht("garbage")).toBeNull();
    expect(formatTimePht(null)).toBeNull();
  });
}

describe.each(ZONES)("calendar math with the device zone %s", (zone) => {
  let original: string | undefined;
  beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  suite();
});

it("gives identical results in every device zone", () => {
  const original = process.env.TZ;
  try {
    const out = ZONES.map((tz) => {
      process.env.TZ = tz;
      return JSON.stringify([
        gridDays("2026-11"),
        gridDays("2028-02"),
        gridRange("2027-01"),
        phtToday(Date.parse("2026-11-10T16:30:00Z")),
        moveDay("2027-01-31", "PageDown"),
        formatMonthHeading("2026-11"),
        formatTimePht("2026-11-10T16:30:00Z"),
      ]);
    });
    expect(new Set(out).size).toBe(1);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
