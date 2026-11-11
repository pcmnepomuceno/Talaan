// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeStatus, createApplication, createInterview, deleteApplication, deleteInterview, getAgenda, updateApplication, updateInterview } from "../src/lib/api";
import { deleteAccount, login, logout } from "../src/lib/auth";
import { agendaVersion, clearCaches, clearDetail, getAgenda as cached, onCachesCleared, replaceDetail, resetCaches, setAgenda, setDetail, storeApplication } from "../src/lib/cache";
import { MappingError, toApplicationInput, toInterviewInput } from "../src/lib/mappers";
import { type Fake, installFake, json, makeApp, makeInterview } from "./helpers/fake-api";

const entry = { items: [], total: 0, nextOffset: 0, asOf: "2026-11-10T12:00:00Z" };
const FUTURE = "2099-01-01T10:00:00+08:00";
let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  fake.db.interviews.push(makeInterview(50, 1, { scheduled_at: FUTURE }));
  vi.stubGlobal("location", { pathname: "/interviews", search: "", replace: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fill = () => {
  setAgenda("upcoming", entry);
  setAgenda("past", entry);
};
const empty = () => [cached("upcoming"), cached("past")].every((e) => e === undefined);

it("getAgenda: path, page size 50, offset; maps the application's names", async () => {
  const page = await getAgenda("upcoming");
  await getAgenda("past", 50);
  expect(fake.calls.map((c) => c.path)).toEqual(["/interviews?when=upcoming&limit=50&offset=0", "/interviews?when=past&limit=50&offset=50"]);
  expect(page.total).toBe(1);
  expect(page.items[0]).toMatchObject({ id: 50, job_application_id: 1, company: "Pinagsama Tech", job_name: "Frontend Engineer" });
});

it("getAgenda: page 1 sends no as_of and returns the server's; a later page sends it percent-encoded", async () => {
  const first = await getAgenda("upcoming");
  expect(Number.isNaN(Date.parse(first.asOf))).toBe(false);
  const later = await getAgenda("upcoming", 50, "2026-11-10T22:00:00+08:00");
  expect(fake.calls.at(-1)!.path).toBe("/interviews?when=upcoming&limit=50&offset=50&as_of=2026-11-10T22%3A00%3A00%2B08%3A00");
  expect(later.asOf).toBe("2026-11-10T22:00:00+08:00");
  await getAgenda("past", 50, "2026-11-10T14:00:00Z");
  expect(fake.calls.at(-1)!.path).toBe("/interviews?when=past&limit=50&offset=50&as_of=2026-11-10T14%3A00%3A00Z");
});

it("getAgenda rejects a page without a readable as_of", async () => {
  for (const as_of of [undefined, null, 5, "not a date"]) {
    fake.on("GET", /^\/interviews/, () => json(200, { items: [], total: 0, limit: 50, offset: 0, as_of }));
    await expect(getAgenda("upcoming")).rejects.toBeInstanceOf(MappingError);
  }
});

it("getAgenda: upcoming and past split at now", async () => {
  expect((await getAgenda("upcoming")).items.map((i) => i.id)).toEqual([50]);
  expect((await getAgenda("past")).items.map((i) => i.id)).toEqual([1, 2, 3]); // the seed: ids 1 and 2 on app 1, 3 on app 2; newest first
});

it("getAgenda rejects a row without its names or with an unknown mode", async () => {
  const row = { ...fake.db.interviews[3], company: "X", job_name: "Y" };
  const page = (r: object) => json(200, { items: [r], total: 1, limit: 50, offset: 0, as_of: "2026-11-10T12:00:00Z" });
  fake.on("GET", /^\/interviews/, () => page({ ...row, company: undefined }));
  await expect(getAgenda("upcoming")).rejects.toBeInstanceOf(MappingError);
  fake.on("GET", /^\/interviews/, () => page({ ...row, job_name: 5 }));
  await expect(getAgenda("upcoming")).rejects.toBeInstanceOf(MappingError);
  fake.on("GET", /^\/interviews/, () => page({ ...row, mode: "telepathy" }));
  await expect(getAgenda("upcoming")).rejects.toBeInstanceOf(MappingError);
});

it("setAgenda and getAgenda keep one entry per tab", () => {
  const up = { ...entry, total: 3 };
  setAgenda("upcoming", up);
  expect(cached("upcoming")).toBe(up);
  expect(cached("past")).toBeUndefined();
});

it("clearCaches empties the agenda, bumps its version and notifies without an id", () => {
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

it("clearDetail and replaceDetail (interview writes) empty the agenda and bump its version, with the id", () => {
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

it("resetCaches empties the agenda", () => {
  fill();
  resetCaches();
  expect(empty()).toBe(true);
});

it.each([
  ["login", () => login("a@example.com", "x")],
  ["logout", () => logout()],
  ["account deletion", () => deleteAccount("x")],
])("%s empties the agenda", async (_n, act) => {
  fake.on("POST", /./, () => json(200, { detail: "ok" }));
  fake.on("GET", /./, () => json(200, {}));
  fill();
  await act().catch(() => {});
  expect(empty()).toBe(true);
});

it("interview create, edit and delete empty the agenda", async () => {
  const input = toInterviewInput(fake.db.interviews[0]);
  fill();
  await createInterview(1, input);
  expect(empty()).toBe(true);
  fill();
  await updateInterview(1, 1, input, { ...input, mode: "on_site" });
  expect(empty()).toBe(true);
  fill();
  await deleteInterview(1, 1); // with no cached detail
  expect(empty()).toBe(true);
  setDetail(1, { application: makeApp(1), interviews: { items: [makeInterview(2, 1)], total: 1 } });
  fill();
  await deleteInterview(1, 2); // with a cached detail (replaceDetail)
  expect(empty()).toBe(true);
});

it("an interview write that answers 404 empties the agenda", async () => {
  const input = toInterviewInput(fake.db.interviews[0]);
  fill();
  await updateInterview(1, 999, input, { ...input, mode: "on_site" }).catch(() => {});
  expect(empty()).toBe(true);
  fill();
  await deleteInterview(1, 999);
  expect(empty()).toBe(true);
});

it("application create, edit and delete empty the agenda", async () => {
  const input = toApplicationInput(fake.db.apps[0]);
  fill();
  await createApplication(input);
  expect(empty()).toBe(true);
  fill();
  await updateApplication(1, input, { ...input, company: "Renamed" }); // the company shows in every agenda row
  expect(empty()).toBe(true);
  fill();
  await deleteApplication(1); // its interviews leave the agenda with it
  expect(empty()).toBe(true);
});

it("a status change keeps the agenda: a row shows no status and a status cannot change its fields", async () => {
  fill();
  const v = agendaVersion();
  await changeStatus(1, "offered", "interviewing");
  storeApplication(makeApp(1, { status: "rejected" }), "offered");
  expect(cached("upcoming")).toBe(entry);
  expect(agendaVersion()).toBe(v);
});

it("a status change with no answer clears everything, the agenda included", async () => {
  fill();
  fake.on("PATCH", /^\/applications\/1$/, () => {
    throw new TypeError("network down");
  });
  await changeStatus(1, "offered", "interviewing").catch(() => {});
  expect(empty()).toBe(true);
});
