import { beforeEach, expect, it } from "vitest";
import { deleteApplication, getApplication, getApplications, getInterviews, parseStatus, resetMock } from "../src/lib/api";

beforeEach(resetMock);

it("lists 5 newest first and filters by status", async () => {
  const all = await getApplications();
  expect(all).toHaveLength(5);
  expect(all.map((a) => a.id)).toEqual([5, 4, 3, 2, 1]);
  expect((await getApplications("offered")).map((a) => a.id)).toEqual([2]);
  expect(await getApplications("ghosted")).toEqual([]);
});

it("returns copies", async () => {
  const a = (await getApplication(1))!;
  a.company = "changed";
  expect((await getApplication(1))!.company).toBe("Pinagsama Tech");
});

it("unknown id is null", async () => {
  expect(await getApplication(999)).toBeNull();
});

it("delete removes the application and its interviews", async () => {
  expect(await getInterviews(1)).toHaveLength(2);
  await deleteApplication(1);
  expect(await getApplication(1)).toBeNull();
  expect(await getInterviews(1)).toEqual([]);
  expect(await getApplications()).toHaveLength(4);
});

it("parseStatus falls back to undefined", () => {
  expect(parseStatus("offered")).toBe("offered");
  expect(parseStatus("bogus")).toBeUndefined();
  expect(parseStatus(null)).toBeUndefined();
});
