import { describe, expect, it } from "vitest";
import { groupByPhtDay, interviewDeleteMessage } from "../src/lib/interviews";
import type { Interview } from "../src/lib/types";
import { makeInterview } from "./helpers/fake-api";

const WHEN = "Oct 24, 2026, 2:00 PM PHT";

it("the delete message puts the mode label in sentence case", () => {
  expect(interviewDeleteMessage(makeInterview(1, 1, { mode: "online" }), WHEN)).toBe(
    `The online interview on ${WHEN} will be removed. This cannot be undone.`,
  );
  expect(interviewDeleteMessage(makeInterview(1, 1, { mode: "on_site" }), WHEN)).toBe(
    `The on-site interview on ${WHEN} will be removed. This cannot be undone.`,
  );
});

it("a missing mode label leaves no double space", () => {
  const odd = makeInterview(1, 1, { mode: "video" as Interview["mode"] });
  expect(interviewDeleteMessage(odd, WHEN)).toBe(`The interview on ${WHEN} will be removed. This cannot be undone.`);
});

describe("groupByPhtDay", () => {
  const at = (id: number, scheduled_at: string) => ({ ...makeInterview(id, 1, { scheduled_at }), company: "C", job_name: "J" });

  it("groups by the PHT calendar day and keeps the given order", () => {
    const groups = groupByPhtDay([at(1, "2026-11-20T23:30:00+08:00"), at(2, "2026-11-21T00:30:00+08:00"), at(3, "2026-11-21T09:00:00+08:00")]);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.id)])).toEqual([
      ["2026-11-20", [1]],
      ["2026-11-21", [2, 3]],
    ]);
  });

  it("uses the PHT day, not the UTC one (23:30 PHT is 15:30Z, 00:30 PHT is 16:30Z the day before)", () => {
    const groups = groupByPhtDay([at(1, "2026-11-20T15:30:00Z"), at(2, "2026-11-20T16:30:00Z")]);
    expect(groups.map((g) => g.day)).toEqual(["2026-11-20", "2026-11-21"]);
  });

  it("is the same in every device zone", () => {
    const original = process.env.TZ;
    try {
      const out = ["UTC", "Pacific/Auckland", "America/Los_Angeles"].map((tz) => {
        process.env.TZ = tz;
        return JSON.stringify(groupByPhtDay([at(1, "2026-11-20T15:30:00Z"), at(2, "2026-11-20T16:30:00Z")]).map((g) => g.day));
      });
      expect(new Set(out).size).toBe(1);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("puts a row with an unreadable date in its own last group, and handles an empty list", () => {
    expect(groupByPhtDay([])).toEqual([]);
    const groups = groupByPhtDay([at(1, "nope"), at(2, "2026-11-20T10:00:00+08:00")]);
    expect(groups.map((g) => g.day)).toEqual(["2026-11-20", ""]);
  });

  it("two rows at the same minute share a group", () => {
    expect(groupByPhtDay([at(1, "2026-11-20T10:00:00+08:00"), at(2, "2026-11-20T10:00:00+08:00")])).toHaveLength(1);
  });
});
