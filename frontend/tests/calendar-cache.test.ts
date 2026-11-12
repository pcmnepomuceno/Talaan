// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeStatus, createApplication, createInterview, deleteApplication, deleteInterview, getCalendarRange, updateApplication, updateInterview } from "../src/lib/api";
import { deleteAccount, login, logout } from "../src/lib/auth";
import { agendaVersion, clearCaches, clearDetail, getCalendar as cached, onCachesCleared, replaceDetail, resetCaches, setCalendar, setDetail, storeApplication } from "../src/lib/cache";
import { MappingError, toApplicationInput, toInterviewInput } from "../src/lib/mappers";
import { type Fake, installFake, json, makeApp, makeInterview } from "./helpers/fake-api";

const KEY = "2026-11-01/2026-12-05";
const OTHER = "2026-10-01/2026-11-07";
const entry = { items: [], total: 0, truncated: false };
let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  vi.stubGlobal("location", { pathname: "/interviews", search: "", replace: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fill = () => {
  setCalendar(KEY, entry);
  setCalendar(OTHER, entry);
};
const empty = () => cached(KEY) === undefined && cached(OTHER) === undefined;

// 2026-11-10 14:00 PHT = 06:00Z; 2026-11-10 23:30 PHT = 15:30Z; 2026-11-11 00:30 PHT = 16:30Z.
const put = (id: number, at: string) => fake.db.interviews.push(makeInterview(id, 1, { scheduled_at: at }));

it("getCalendarRange: path, no paging params, and the rows with their application's names", async () => {
  put(60, "2026-11-10T06:00:00Z");
  put(61, "2026-11-10T15:30:00Z");
  put(62, "2026-11-10T16:30:00Z");
  const r = await getCalendarRange("2026-11-10", "2026-11-10");
  expect(fake.calls.at(-1)!.path).toBe("/interviews/calendar?from=2026-11-10&to=2026-11-10");
  expect(r.items.map((i) => i.id)).toEqual([60, 61]);
  expect(r.items[0]).toMatchObject({ job_application_id: 1, company: "Pinagsama Tech", job_name: "Frontend Engineer" });
  expect(r).toMatchObject({ total: 2, truncated: false, from: "2026-11-10", to: "2026-11-10" });
});

it("getCalendarRange maps truncated and total as the server sent them", async () => {
  fake.on("GET", /^\/interviews\/calendar/, () => json(200, { items: [], total: 201, truncated: true, from: "2026-11-01", to: "2026-11-30" }));
  expect(await getCalendarRange("2026-11-01", "2026-11-30")).toEqual({ items: [], total: 201, truncated: true, from: "2026-11-01", to: "2026-11-30" });
});

it("getCalendarRange rejects a body it cannot map", async () => {
  const ok = { items: [], total: 0, truncated: false, from: "2026-11-01", to: "2026-11-30" };
  const bad: object[] = [
    { ...ok, truncated: "yes" },
    { ...ok, truncated: undefined },
    { ...ok, total: "0" },
    { ...ok, items: undefined },
    { ...ok, from: undefined },
    { ...ok, to: 5 },
    { ...ok, items: [{ nothing: true }] },
  ];
  for (const body of bad) {
    fake.on("GET", /^\/interviews\/calendar/, () => json(200, body));
    await expect(getCalendarRange("2026-11-01", "2026-11-30")).rejects.toBeInstanceOf(MappingError);
  }
});

it("setCalendar and getCalendar keep one entry per range", () => {
  const e = { ...entry, total: 3 };
  setCalendar(KEY, e);
  expect(cached(KEY)).toBe(e);
  expect(cached(OTHER)).toBeUndefined();
});

it("clearCaches empties every range, bumps the shared version and notifies without an id", () => {
  fill();
  const fn = vi.fn();
  const off = onCachesCleared(fn);
  const v = agendaVersion();
  clearCaches();
  off();
  expect(empty()).toBe(true);
  expect(agendaVersion()).toBe(v + 1);
  expect(fn).toHaveBeenCalledWith();
});

it("clearDetail and replaceDetail empty the ranges and bump the version, with the id", () => {
  for (const act of [() => clearDetail(1), () => replaceDetail(1, { application: makeApp(1), interviews: null })]) {
    fill();
    const fn = vi.fn();
    const off = onCachesCleared(fn);
    const v = agendaVersion();
    act();
    off();
    expect(empty()).toBe(true);
    expect(agendaVersion()).toBe(v + 1);
    expect(fn).toHaveBeenCalledWith(1);
  }
});

it("resetCaches empties the ranges", () => {
  fill();
  resetCaches();
  expect(empty()).toBe(true);
});

it.each([
  ["login", () => login("a@example.com", "x")],
  ["logout", () => logout()],
  ["account deletion", () => deleteAccount("x")],
])("%s empties the ranges", async (_n, act) => {
  fake.on("POST", /./, () => json(200, { detail: "ok" }));
  fake.on("GET", /./, () => json(200, {}));
  fill();
  await act().catch(() => {});
  expect(empty()).toBe(true);
});

it("interview create, edit and delete empty the ranges", async () => {
  const input = toInterviewInput(fake.db.interviews[0]);
  fill();
  await createInterview(1, input);
  expect(empty()).toBe(true);
  fill();
  await updateInterview(1, 1, input, { ...input, mode: "on_site" });
  expect(empty()).toBe(true);
  fill();
  await deleteInterview(1, 1);
  expect(empty()).toBe(true);
  setDetail(1, { application: makeApp(1), interviews: { items: [makeInterview(2, 1)], total: 1 } });
  fill();
  await deleteInterview(1, 2);
  expect(empty()).toBe(true);
});

it("an interview write that answers 404 empties the ranges", async () => {
  const input = toInterviewInput(fake.db.interviews[0]);
  fill();
  await updateInterview(1, 999, input, { ...input, mode: "on_site" }).catch(() => {});
  expect(empty()).toBe(true);
  fill();
  await deleteInterview(1, 999);
  expect(empty()).toBe(true);
});

it("application create, edit and delete empty the ranges", async () => {
  const input = toApplicationInput(fake.db.apps[0]);
  fill();
  await createApplication(input);
  expect(empty()).toBe(true);
  fill();
  await updateApplication(1, input, { ...input, company: "Renamed" });
  expect(empty()).toBe(true);
  fill();
  await deleteApplication(1);
  expect(empty()).toBe(true);
});

it("a status change keeps the ranges, like the agenda", async () => {
  fill();
  const v = agendaVersion();
  await changeStatus(1, "offered", "interviewing");
  storeApplication(makeApp(1, { status: "rejected" }), "offered");
  expect(cached(KEY)).toBe(entry);
  expect(agendaVersion()).toBe(v);
});

it("a status change with no answer clears everything, the ranges included", async () => {
  fill();
  fake.on("PATCH", /^\/applications\/1$/, () => {
    throw new TypeError("network down");
  });
  await changeStatus(1, "offered", "interviewing").catch(() => {});
  expect(empty()).toBe(true);
});
