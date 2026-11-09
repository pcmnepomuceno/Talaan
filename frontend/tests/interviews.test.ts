import { expect, it } from "vitest";
import { interviewDeleteMessage } from "../src/lib/interviews";
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
