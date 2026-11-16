import { afterEach, describe, expect, it, vi } from "vitest";
import { dateAppliedLabel, followUpCount, followUpLabel, formatDate, formatDateTimePHT, formatDayHeading, formatPeso, plainSpaces } from "../src/lib/format";
import { sortInterviewsByDate } from "../src/lib/interviews";
import type { Interview } from "../src/lib/types";

afterEach(() => vi.unstubAllEnvs());

describe("plainSpaces", () => {
  it("maps U+202F and U+00A0 to a plain space", () => {
    expect(plainSpaces("2:00\u202fPM")).toBe("2:00 PM");
    expect(plainSpaces("2:00\u00a0PM")).toBe("2:00 PM");
  });
});

describe.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati"])("device zone %s", (tz) => {
  it("formats in Manila time", () => {
    vi.stubEnv("TZ", tz);
    expect(formatDateTimePHT("2026-10-24T06:00:00Z")).toBe("Oct 24, 2026, 2:00 PM PHT");
    expect(formatDateTimePHT("2026-10-24T14:00:00+08:00")).toBe("Oct 24, 2026, 2:00 PM PHT");
    expect(formatDateTimePHT("2026-10-24T14:00:00")).toBe("Oct 24, 2026, 2:00 PM PHT");
    expect(formatDateTimePHT("2026-10-23T23:30:00-08:00")).toBe("Oct 24, 2026, 3:30 PM PHT");
  });
  it("keeps a date-only string on its calendar day", () => {
    vi.stubEnv("TZ", tz);
    expect(formatDate("2026-10-14")).toBe("Oct 14, 2026");
  });
});

it("formatPeso", () => {
  expect(formatPeso(85000)).toBe("₱85,000 / month");
  expect(formatPeso(85000, { perMonth: false })).toBe("₱85,000");
  expect(formatPeso(0)).toBe("₱0 / month");
  for (const v of [null, undefined, NaN, -1]) expect(formatPeso(v)).toBeNull();
});

it("invalid or missing dates return null without throwing", () => {
  for (const v of [null, undefined, "", "not a date", "2026-13-45"]) {
    expect(formatDate(v)).toBeNull();
    expect(formatDateTimePHT(v)).toBeNull();
  }
});

it("days not on the calendar return null instead of rolling over", () => {
  for (const v of ["2026-02-30", "2027-02-29", "2026-04-31T10:00:00", "2026-02-30T10:00:00Z"]) {
    expect(formatDate(v)).toBeNull();
    expect(formatDateTimePHT(v)).toBeNull();
  }
  expect(formatDate("2028-02-29")).toBe("Feb 29, 2028");
  expect(formatDateTimePHT("2028-02-29T10:00:00")).toBe("Feb 29, 2028, 10:00 AM PHT");
});

it("dateAppliedLabel", () => {
  expect(dateAppliedLabel("2026-10-14", "applied")).toBe("Oct 14, 2026");
  expect(dateAppliedLabel(null, "saved")).toBe("Not applied yet");
  expect(dateAppliedLabel(null, "applied")).toBeNull();
  expect(dateAppliedLabel("garbage", "saved")).toBe("Not applied yet");
});

describe("sortInterviewsByDate", () => {
  const mk = (id: number, scheduled_at: string) => ({ id, scheduled_at }) as Interview;
  it("sorts ascending, ties by id, without mutating", () => {
    const input = [
      mk(3, "2026-10-24T06:00:00Z"),
      mk(2, "2026-10-18T02:00:00Z"),
      mk(1, "2026-10-24T14:00:00+08:00"),
      mk(4, "bad"),
    ];
    const copy = [...input];
    expect(sortInterviewsByDate(input).map((i) => i.id)).toEqual([2, 1, 3, 4]);
    expect(input).toEqual(copy);
  });
  // An offset-less time is Manila wall time, as formatDateTimePHT reads it: 14:00 PHT is 06:00Z.
  it.each(["UTC", "America/Los_Angeles"])("reads offset-less times as Manila time (device zone %s)", (tz) => {
    vi.stubEnv("TZ", tz);
    const input = [mk(2, "2026-10-24T08:00:00Z"), mk(1, "2026-10-24T14:00:00")];
    expect(sortInterviewsByDate(input).map((i) => i.id)).toEqual([1, 2]);
  });
});

describe("formatDayHeading", () => {
  it("writes the weekday and date of a calendar day, whatever the device zone", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      vi.stubEnv("TZ", tz);
      expect(formatDayHeading("2026-11-10")).toBe("Tuesday, Nov 10, 2026");
      expect(formatDayHeading("2026-12-31")).toBe("Thursday, Dec 31, 2026");
    }
    vi.unstubAllEnvs();
  });

  it("is null for an empty or impossible day", () => {
    expect(formatDayHeading("")).toBeNull();
    expect(formatDayHeading("2026-02-30")).toBeNull();
  });
});

describe("follow-up texts", () => {
  it("followUpLabel: applied and last interview, singular and plural", () => {
    expect(followUpLabel({ idle_days: 12, last_activity: "applied" })).toBe("Applied 12 days ago");
    expect(followUpLabel({ idle_days: 1, last_activity: "applied" })).toBe("Applied 1 day ago");
    expect(followUpLabel({ idle_days: 9, last_activity: "interview" })).toBe("Last interview 9 days ago");
    expect(followUpLabel({ idle_days: 1, last_activity: "interview" })).toBe("Last interview 1 day ago");
  });
  it("followUpLabel never crashes on 0 (the API sends at least 1)", () => {
    expect(followUpLabel({ idle_days: 0, last_activity: "applied" })).toBe("Applied 0 days ago");
  });
  it("followUpCount: singular and plural", () => {
    expect(followUpCount(1)).toBe("1 application needs a follow-up");
    expect(followUpCount(4)).toBe("4 applications need a follow-up");
  });
});
