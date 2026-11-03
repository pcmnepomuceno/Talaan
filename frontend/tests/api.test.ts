// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createApplication,
  deleteApplication,
  getApplication,
  getApplications,
  getInterviews,
  parseId,
  parseStatus,
  updateApplication,
} from "../src/lib/api";
import { clearCaches, getList, setList } from "../src/lib/cache";
import { ApiError } from "../src/lib/http";
import { MappingError, toApplicationInput } from "../src/lib/mappers";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  vi.stubGlobal("location", { pathname: "/applications", search: "", replace: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("getApplications: path, page size 50, offset and status filter", async () => {
  await getApplications();
  await getApplications("applied", 50);
  expect(fake.calls.map((c) => c.path)).toEqual([
    "/applications?limit=50&offset=0",
    "/applications?limit=50&offset=50&status=applied",
  ]);
});

it("getApplications returns the page's rows and the filtered total", async () => {
  const page = await getApplications("offered");
  expect(page.items.map((a) => a.id)).toEqual([2]);
  expect(page.total).toBe(1);
  expect((await getApplications()).items.map((a) => a.id)).toEqual([5, 4, 3, 2, 1]);
});

it("getApplication: 404 is null, other errors throw", async () => {
  expect((await getApplication(1))?.company).toBe("Pinagsama Tech");
  expect(await getApplication(999)).toBeNull();
  fake.failNext("GET", /^\/applications\/1$/, 500);
  await expect(getApplication(1)).rejects.toMatchObject({ status: 500 });
});

it("getApplication rejects an unknown enum instead of returning it", async () => {
  fake.on("GET", /^\/applications\/1$/, () => json(200, { ...fake.db.apps[0], status: "hired" }));
  await expect(getApplication(1)).rejects.toBeInstanceOf(MappingError);
});

it("getInterviews asks for 100 and is isolated from the application", async () => {
  const page = await getInterviews(1);
  expect(fake.calls[0].path).toBe("/applications/1/interviews?limit=100&offset=0");
  expect(page.items).toHaveLength(2);
  expect(page.total).toBe(2);
  fake.failNext("GET", /interviews/, 500);
  await expect(getInterviews(1)).rejects.toBeInstanceOf(ApiError);
  expect(await getApplication(1)).not.toBeNull();
  await expect(getInterviews(999)).rejects.toMatchObject({ status: 404 });
});

it("createApplication: POST with exactly the editable fields, returns the row", async () => {
  const input = { ...toApplicationInput(makeApp(0)), job_name: "New", salary: null, date_applied: null };
  const row = await createApplication(input);
  const call = fake.calls.at(-1)!;
  expect([call.method, call.path]).toEqual(["POST", "/applications"]);
  expect(call.body).toEqual(input);
  expect(row.job_name).toBe("New");
});

it("updateApplication: PATCH sends only changed fields", async () => {
  const initial = toApplicationInput((await getApplication(1))!);
  await updateApplication(1, initial, { ...initial, status: "offered", salary: null });
  const call = fake.calls.at(-1)!;
  expect([call.method, call.path, call.body]).toEqual(["PATCH", "/applications/1", { status: "offered", salary: null }]);
});

it("deleteApplication: DELETE, and 404 counts as success", async () => {
  await deleteApplication(1);
  expect(fake.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/applications/1" });
  await expect(deleteApplication(1)).resolves.toBeUndefined(); // already gone: the API answers 404
  fake.failNext("DELETE", /^\/applications\/2$/, 500);
  await expect(deleteApplication(2)).rejects.toMatchObject({ status: 500 });
});

it("writes clear the caches; a failed write does not", async () => {
  const entry = { items: [], total: 0 };
  setList(undefined, entry);
  fake.failNext("DELETE", /^\/applications\/2$/, 500);
  await deleteApplication(2).catch(() => {});
  expect(getList()).toBe(entry);
  const initial = toApplicationInput(makeApp(1));
  await createApplication(initial);
  expect(getList()).toBeUndefined();
  setList(undefined, entry);
  await updateApplication(1, initial, { ...initial, company: "X" });
  expect(getList()).toBeUndefined();
  setList(undefined, entry);
  await deleteApplication(3);
  expect(getList()).toBeUndefined();
});

it("parseStatus falls back to undefined", () => {
  expect(parseStatus("offered")).toBe("offered");
  expect(parseStatus("bogus")).toBeUndefined();
  expect(parseStatus(null)).toBeUndefined();
});

it("parseId accepts canonical safe integers only", () => {
  expect(parseId("1")).toBe(1);
  expect(parseId("0")).toBe(0);
  for (const bad of ["01", "1.0", "1e3", "+1", " 1", "", "abc", "9007199254740993", "99999999999999999999"])
    expect(parseId(bad), bad).toBeNull();
});
