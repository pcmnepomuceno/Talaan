import { afterEach, describe, expect, it, vi } from "vitest";
import { dateAppliedLabel, formatDate, formatDateTimePHT, formatPeso } from "../src/lib/format";
import { sortInterviewsByDate } from "../src/lib/interviews";
import type { Interview } from "../src/lib/types";

afterEach(() => vi.unstubAllEnvs());

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
});
