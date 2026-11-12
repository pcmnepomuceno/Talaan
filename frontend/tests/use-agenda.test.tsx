// @vitest-environment jsdom
// useAgenda races (review round 1, findings 3 and 10). Hook level: a `when` prop change is exactly a tab switch.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgenda } from "../src/app/(app)/interviews/use-agenda";
import type { AgendaKey } from "../src/lib/cache";
import { clearCaches, forgetLoaded } from "../src/lib/cache";
import { type Fake, installFake, json, makeApp, makeInterview } from "./helpers/fake-api";

const AS_OF = "2026-11-10T12:00:00Z";
const A = makeApp(1, { company: "Pinagsama Tech", job_name: "Frontend Engineer" });
const at = (y: number, h: number) => new Date(Date.UTC(y, 0, 1, h)).toISOString();
const up = (n: number, from = 1) => Array.from({ length: n }, (_, k) => makeInterview(from + k, 1, { scheduled_at: at(2099, k) }));
const past = (n: number, from = 1001) => Array.from({ length: n }, (_, k) => makeInterview(from + k, 1, { scheduled_at: at(2020, 100 - k) }));
const named = (rows: ReturnType<typeof makeInterview>[]) => rows.map((r) => ({ ...r, company: "STALE", job_name: "STALE" }));
const page = (items: unknown[], total: number, offset: number) => json(200, { items, total, limit: 50, offset, as_of: AS_OF });
function gate() {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
}
const ready = (r: { current: ReturnType<typeof useAgenda> }) => {
  const v = r.current.view;
  if (v.kind !== "ready") throw new Error(`view is ${v.kind}`);
  return v;
};
const ids = (r: { current: ReturnType<typeof useAgenda> }) => ready(r).items.map((i) => i.id);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  forgetLoaded();
});
afterEach(() => vi.restoreAllMocks());

const mount = (when: AgendaKey = "upcoming") => renderHook(({ w }) => useAgenda(w), { initialProps: { w: when } });

it("Upcoming -> Past -> Upcoming with a Load more in flight: the old Load more never overwrites the fresh page 1", async () => {
  fake = installFake({ apps: [A], interviews: up(120) });
  const { result, rerender } = mount();
  await waitFor(() => expect(ids(result)).toHaveLength(50));
  const g = gate();
  fake.on("GET", /when=upcoming.*offset=50/, async () => (await g.p, page(named(up(50, 51)), 120, 50)));
  let more!: Promise<void>;
  act(() => void (more = result.current.loadMore()));
  rerender({ w: "past" });
  // While away, an earlier interview appears: the fresh page 1 starts with it.
  fake.db.interviews.push(makeInterview(500, 1, { scheduled_at: at(2098, 0) }));
  rerender({ w: "upcoming" });
  expect(ready(result).refreshing).toBe(true); // the cached rows are not yet the answer to this visit
  await waitFor(() => expect(ids(result)[0]).toBe(500));
  expect(ready(result).refreshing).toBe(false);
  g.release();
  await act(async () => void (await more));
  await settle();
  expect(ids(result)[0]).toBe(500);
  expect(ids(result)).toHaveLength(50);
  expect(ready(result).items.some((i) => i.company === "STALE")).toBe(false);
});

it("Load more on Past goes out while Upcoming's is still loading", async () => {
  fake = installFake({ apps: [A], interviews: [...up(60), ...past(60)] });
  const { result, rerender } = mount();
  await waitFor(() => expect(ids(result)).toHaveLength(50));
  const g = gate();
  fake.on("GET", /when=upcoming.*offset=50/, async () => (await g.p, page([], 60, 50)));
  act(() => void result.current.loadMore());
  rerender({ w: "past" });
  await waitFor(() => expect(ready(result).refreshing).toBe(false));
  expect(ids(result)).toHaveLength(50);
  await act(async () => void (await result.current.loadMore()));
  expect(fake.callsTo("GET", /when=past.*offset=50/)).toHaveLength(1);
  expect(ids(result)).toHaveLength(60);
  g.release();
  await settle();
});
