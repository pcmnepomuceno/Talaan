// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  changeStatus,
  createApplication,
  createInterview,
  deleteApplication,
  deleteInterview,
  getInterview,
  getApplication,
  getApplications,
  getInterviews,
  parseId,
  parseStatus,
  updateApplication,
  updateInterview,
} from "../src/lib/api";
import { cacheVersion, clearCaches, getDetail, getList, moveState, onApplicationStored, onCachesCleared, setDetail, setList } from "../src/lib/cache";
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

it("createApplication: POST with exactly the editable fields, returns the new id", async () => {
  const input = { ...toApplicationInput(makeApp(0)), job_name: "New", salary: null, date_applied: null };
  const id = await createApplication(input);
  const call = fake.calls.at(-1)!;
  expect([call.method, call.path]).toEqual(["POST", "/applications"]);
  expect(call.body).toEqual(input);
  expect(fake.db.apps.find((a) => a.id === id)?.job_name).toBe("New");
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
  const entry = { items: [], total: 0, nextOffset: 0 };
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

it("a write the server accepted clears the caches even when the response does not map", async () => {
  const entry = { items: [], total: 0, nextOffset: 0 };
  const initial = toApplicationInput(makeApp(1));
  fake.on("POST", /^\/applications$/, () => json(201, { ...makeApp(77), status: "hired" }));
  setList(undefined, entry);
  expect(await createApplication(initial)).toBe(77);
  expect(getList()).toBeUndefined();
  fake.on("PATCH", /^\/applications\/1$/, () => json(200, { ...makeApp(1), status: "hired" }));
  setList(undefined, entry);
  expect(await updateApplication(1, initial, { ...initial, company: "X" })).toBe(1);
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

// ---- interviews (F6) ----
const ivInput = { scheduled_at: "2026-11-20T23:30:00+08:00", mode: "online" as const, outcome: "pending" as const, interviewer: null, remarks: null };

it("createInterview: POST nested path, +08:00 body, resolves to the id only", async () => {
  const id = await createInterview(1, ivInput);
  const call = fake.callsTo("POST", /^\/applications\/1\/interviews$/)[0];
  expect(call.body).toEqual(ivInput);
  expect(fake.db.interviews.some((i) => i.id === id)).toBe(true);
  expect(typeof id).toBe("number");
});

it("updateInterview: flat PATCH with only changed fields; resolves to the id", async () => {
  const id = await updateInterview(1, 1, { ...ivInput }, { ...ivInput, outcome: "good" });
  expect(id).toBe(1);
  expect(fake.callsTo("PATCH", /^\/interviews\/1$/)[0].body).toEqual({ outcome: "good" });
});

it("deleteInterview: flat DELETE; 404 is success; other errors throw", async () => {
  await deleteInterview(1, 1);
  expect(fake.callsTo("DELETE", /^\/interviews\/1$/)).toHaveLength(1);
  await expect(deleteInterview(1, 999)).resolves.toBeUndefined();
  fake.failNext("DELETE", /^\/interviews\/2$/, 500);
  await expect(deleteInterview(1, 2)).rejects.toMatchObject({ status: 500 });
});

it("getInterview: 404 is null", async () => {
  expect((await getInterview(1))?.interviewer).toBe("Mark Rivera");
  expect(await getInterview(999)).toBeNull();
});

it("an accepted interview write clears the caches even when the response does not map", async () => {
  const cleared = vi.fn();
  const off = onCachesCleared(cleared);
  fake.on("POST", /interviews$/, () => json(201, { id: 55, mode: "phone", outcome: null }));
  expect(await createInterview(1, ivInput)).toBe(55);
  fake.on("PATCH", /^\/interviews\/1$/, () => json(200, { id: 1, mode: "phone", outcome: null }));
  expect(await updateInterview(1, 1, ivInput, { ...ivInput, outcome: "bad" })).toBe(1);
  expect(cleared).toHaveBeenCalledTimes(2);
  off();
});

it("a failed interview write leaves the caches alone; a 404 clears them", async () => {
  const entry = { items: [], total: 0, nextOffset: 0 };
  setList(undefined, entry);
  fake.failNext("PATCH", /^\/interviews\/1$/, 500);
  await updateInterview(1, 1, ivInput, { ...ivInput, outcome: "bad" }).catch(() => {});
  expect(getList()).toBe(entry);
  await expect(updateInterview(1, 999, ivInput, { ...ivInput, outcome: "bad" })).rejects.toMatchObject({ status: 404 });
  expect(getList()).toBeUndefined();
  setList(undefined, entry);
  await expect(createInterview(999, ivInput)).rejects.toMatchObject({ status: 404 });
  expect(getList()).toBeUndefined();
  setList(undefined, entry);
  await deleteInterview(1, 999); // already gone: the application may be gone too
  expect(getList()).toBeUndefined();
});

it.each([
  ["createInterview", () => createInterview(1, ivInput)],
  ["updateInterview", () => updateInterview(1, 1, ivInput, { ...ivInput, outcome: "bad" })],
  ["deleteInterview", () => deleteInterview(1, 1)],
])("%s clears only that application's detail: lists and other details survive", async (_n, write) => {
  const entry = { items: [], total: 0, nextOffset: 0 };
  setList(undefined, entry);
  setList("applied", entry);
  setDetail(1, { application: {} as never, interviews: null });
  setDetail(2, { application: {} as never, interviews: null });
  await write();
  expect(getList()).toBe(entry);
  expect(getList("applied")).toBe(entry);
  expect(getDetail(1)).toBeUndefined();
  expect(getDetail(2)).toBeDefined();
});

// ---- changeStatus: the fallbacks (PR #23 review round 2, finding 8) ----
const cached = () => {
  setList(undefined, { items: [makeApp(1)], total: 1, nextOffset: 1 });
  setList("applied", { items: [makeApp(1)], total: 1, nextOffset: 1 });
  setDetail(1, { application: makeApp(1), interviews: { items: [], total: 0 } });
};

it("changeStatus: an accepted PATCH whose response does not map clears every cache and patches nothing", async () => {
  cached();
  const stored = vi.fn();
  const off = onApplicationStored(stored);
  const v = cacheVersion();
  fake.on("PATCH", /^\/applications\/1$/, () => json(200, { ...makeApp(1), status: "hired" }));
  await expect(changeStatus(1, "offered", "applied")).resolves.toBeUndefined();
  expect([getList(), getList("applied"), getDetail(1)]).toEqual([undefined, undefined, undefined]);
  expect(cacheVersion()).toBe(v + 1);
  expect(stored).not.toHaveBeenCalled();
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  off();
});

it("changeStatus: a 404 rejects with it and clears every cache", async () => {
  cached();
  fake.on("PATCH", /^\/applications\/1$/, () => json(404, { detail: "Application not found." }));
  await expect(changeStatus(1, "offered", "applied")).rejects.toMatchObject({ status: 404 });
  expect([getList(), getList("applied"), getDetail(1)]).toEqual([undefined, undefined, undefined]);
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
});

it("changeStatus: a 500 rejects and leaves every cache as it was", async () => {
  cached();
  const before = [getList(), getList("applied"), getDetail(1)];
  fake.failNext("PATCH", /^\/applications\/1$/);
  await expect(changeStatus(1, "offered", "applied")).rejects.toMatchObject({ status: 500 });
  expect([getList(), getList("applied"), getDetail(1)]).toEqual(before);
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
});

it("changeStatus: success patches the caches and resolves to nothing (the caches are the result)", async () => {
  cached();
  await expect(changeStatus(1, "offered", "applied")).resolves.toBeUndefined();
  expect(getList()?.items[0].status).toBe("offered");
  expect(getList("applied")).toEqual({ items: [], total: 0, nextOffset: 0 });
  expect(getDetail(1)?.application.status).toBe("offered");
});
