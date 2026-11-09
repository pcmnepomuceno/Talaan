import { afterEach, describe, expect, it } from "vitest";
import { fromPhtInput, phtYearOk, toPhtInput } from "../src/lib/pht";

describe("toPhtInput", () => {
  it.each([
    ["2026-11-20T15:30:00Z", "2026-11-20T23:30"], // 23:30 PHT
    ["2026-11-20T16:30:00Z", "2026-11-21T00:30"], // 00:30 PHT is the previous day in UTC
    ["2026-11-20T15:30:00+00:00", "2026-11-20T23:30"],
    ["2026-11-20T23:30:00+08:00", "2026-11-20T23:30"],
    ["2026-11-20T10:30:00-05:00", "2026-11-20T23:30"],
    ["2026-11-20T15:30:45.123Z", "2026-11-20T23:30"], // seconds and ms dropped
    ["2026-11-20T15:30:45.123456Z", "2026-11-20T23:30"],
    ["2026-11-20T23:30", "2026-11-20T23:30"], // no offset = already Manila wall time
    ["2026-12-31T16:00:00Z", "2027-01-01T00:00"],
  ])("%s -> %s", (api, want) => expect(toPhtInput(api)).toBe(want));

  it.each([[""], [null], [undefined], ["garbage"], ["2026-02-30T10:00:00Z"], ["2026-11-20"]])("invalid %s -> null", (v) =>
    expect(toPhtInput(v as string)).toBeNull(),
  );
});

it("no year range inside the converters: 2200-12-31T20:00:00Z round-trips as 2201-01-01T04:00 PHT", () => {
  expect(toPhtInput("2200-12-31T20:00:00Z")).toBe("2201-01-01T04:00");
  expect(fromPhtInput("2201-01-01T04:00")).toBe("2201-01-01T04:00:00+08:00");
});

describe("fromPhtInput", () => {
  it.each([
    ["2026-11-20T23:30", "2026-11-20T23:30:00+08:00"],
    ["2026-11-20T00:30", "2026-11-20T00:30:00+08:00"],
    ["2026-11-20T23:30:59", "2026-11-20T23:30:00+08:00"],
    ["2026-11-20T23:30:59.5", "2026-11-20T23:30:00+08:00"],
    ["2028-02-29T09:00", "2028-02-29T09:00:00+08:00"],
    ["0050-01-01T10:00", "0050-01-01T10:00:00+08:00"], // Date.UTC would map years 0-99 to 1900-1999
    ["0099-12-31T23:59", "0099-12-31T23:59:00+08:00"],
  ])("%s -> %s", (input, want) => expect(fromPhtInput(input)).toBe(want));

  it.each([[""], [null], ["2026-11-20"], ["2026-11-20T24:00"], ["2026-02-30T10:00"], ["2027-02-29T10:00"], ["2026-13-01T10:00"], ["2026-11-20 10:00"], ["x"]])(
    "invalid %s -> null",
    (v) => expect(fromPhtInput(v as string)).toBeNull(),
  );

  it("round trips through the API's UTC form", () => {
    const iso = fromPhtInput("2026-11-20T23:30")!;
    expect(toPhtInput(new Date(iso).toISOString())).toBe("2026-11-20T23:30");
  });
});

it("year range mirrors the backend (1900-2200)", () => {
  expect(phtYearOk("1900-01-01T00:00")).toBe(true);
  expect(phtYearOk("2200-12-31T23:59")).toBe(true);
  expect(phtYearOk("1899-12-31T23:59")).toBe(false);
  expect(phtYearOk("2201-01-01T00:00")).toBe(false);
});

// The helpers must not depend on the device zone. Node applies a runtime TZ change.
describe("device timezone does not matter", () => {
  const original = process.env.TZ;
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  const run = () => ({
    a: toPhtInput("2026-11-20T15:30:45.123Z"),
    b: toPhtInput("2026-11-20T16:30:00Z"),
    c: toPhtInput("2026-11-20T23:30"),
    d: fromPhtInput("2026-11-20T23:30"),
    e: fromPhtInput("2026-03-08T02:30"), // a spring-forward gap in Los Angeles
    f: fromPhtInput("2026-04-05T02:30"), // a DST end in Auckland
    g: fromPhtInput("0050-01-01T10:00"), // a two-digit year
  });

  it("gives identical output in UTC, Auckland and Los Angeles", () => {
    const offsets = new Set<number>();
    const results: string[] = [];
    for (const tz of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
      process.env.TZ = tz;
      offsets.add(new Date(2026, 10, 20, 12).getTimezoneOffset());
      results.push(JSON.stringify(run()));
    }
    expect(offsets.size).toBe(3); // the switch really took effect
    expect(new Set(results).size).toBe(1);
    expect(JSON.parse(results[0]).b).toBe("2026-11-21T00:30");
    expect(JSON.parse(results[0]).g).toBe("0050-01-01T10:00:00+08:00");
  });
});
