// @vitest-environment jsdom
// The Status select under fast arrow keys: it holds its own choice, the URL follows (replace lags behind).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { STATUSES } from "../src/components/status-stamp";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, makeApp } from "./helpers/fake-api";

let search = "";
// Does NOT update `search`: models a URL that lags behind the replace calls.
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  search = "";
  replace.mockClear();
  fake = installFake({
    apps: STATUSES.map((s, i) => makeApp(i + 1, { status: s, company: `Co ${s}` })),
    interviews: [],
  });
});
afterEach(() => vi.restoreAllMocks());

const ui = () => (
  <ToastProvider>
    <ApplicationsScreen>{null}</ApplicationsScreen>
  </ToastProvider>
);
const select = () => screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
const lastUrl = () => replace.mock.calls.at(-1)?.[0];
const listCalls = () => fake.callsTo("GET", /^\/applications\?limit/);
const wait = async (name: string) => {
  await screen.findByRole("list", { name: "Applications" });
  await screen.findByText(name);
};

// What a browser does on ArrowDown/ArrowUp: step from the select's CURRENT DOM value, clamped, no event when clamped.
const arrow = (dir: 1 | -1) => {
  const el = select();
  const next = el.selectedIndex + dir;
  if (next < 0 || next >= el.options.length) return;
  el.selectedIndex = next;
  fireEvent.change(el);
};
const press = (...dirs: (1 | -1)[]) => dirs.forEach(arrow);
const land = (r: { rerender: (u: React.ReactNode) => void }, q: string) => {
  search = q;
  r.rerender(ui());
};

it("jsdom check: userEvent.keyboard does not move a select, so the helper steps selectedIndex", async () => {
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  select().focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(select().value).toBe("all");
  r.unmount();
});

it("a burst of arrow keys lands on the right option, one replace each, one fetch for the final status", async () => {
  const r = render(ui());
  await wait(`Co ${STATUSES[0]}`);
  press(1, 1, 1);
  expect(select().value).toBe(STATUSES[2]);
  expect(lastUrl()).toBe(`/applications?status=${STATUSES[2]}`);
  expect(replace).toHaveBeenCalledTimes(3);
  expect(new Set(replace.mock.calls.map((c) => c[0])).size).toBe(3);
  land(r, `status=${STATUSES[2]}`);
  await wait(`Co ${STATUSES[2]}`);
  expect(screen.queryByText(`Co ${STATUSES[0]}`)).toBeNull();
  expect(listCalls().map((c) => c.path)).toEqual(["/applications?limit=50&offset=0", `/applications?limit=50&offset=0&status=${STATUSES[2]}`]);
  expect(select().value).toBe(STATUSES[2]);
});

it("past the last option stays on Needs follow-up (no extra replace); past the first stays on All", async () => {
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  press(...Array<1>(12).fill(1));
  expect(select().value).toBe("follow_up");
  expect(replace).toHaveBeenCalledTimes(STATUSES.length + 1);
  expect(lastUrl()).toBe("/applications?status=follow_up");
  land(r, "status=follow_up");
  press(...Array<-1>(14).fill(-1));
  expect(select().value).toBe("all");
  expect(lastUrl()).toBe("/applications");
});

it("a burst that ends on the URL's own value ends there", async () => {
  render(ui());
  await screen.findByRole("list", { name: "Applications" });
  press(1, 1, -1, -1);
  expect(select().value).toBe("all");
  expect(lastUrl()).toBe("/applications");
});

it("an outside URL change (Back, a link) resyncs the select and the list", async () => {
  search = `status=${STATUSES[0]}`;
  const r = render(ui());
  await wait(`Co ${STATUSES[0]}`);
  press(1, 1);
  expect(select().value).toBe(STATUSES[2]);
  land(r, `status=${STATUSES[5]}`);
  expect(select().value).toBe(STATUSES[5]);
  await wait(`Co ${STATUSES[5]}`);
});

it("onto Needs follow-up and off it quickly, then the URL lands on the last value", async () => {
  const last = STATUSES.at(-1)!;
  search = `status=${last}`;
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  press(1, -1, -1);
  expect(select().value).toBe(STATUSES.at(-2));
  land(r, `status=${STATUSES.at(-2)}`);
  expect(select().value).toBe(STATUSES.at(-2));
});

it("an intermediate replace landing does not snap the select back", async () => {
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  press(1, 1, 1);
  land(r, `status=${STATUSES[0]}`); // only the first replace lands; two still pending
  expect(select().value).toBe(STATUSES[2]);
  land(r, `status=${STATUSES[2]}`);
  expect(select().value).toBe(STATUSES[2]);
  await wait(`Co ${STATUSES[2]}`);
});

it("a burst Down, Up back onto the URL's value leaves no stale entry: an outside link to the value passed on the way resyncs", async () => {
  const r = render(ui());
  await screen.findByRole("list", { name: "Applications" });
  press(1, -1);
  expect(select().value).toBe("all");
  land(r, `status=${STATUSES[0]}`);
  expect(select().value).toBe(STATUSES[0]);
  await wait(`Co ${STATUSES[0]}`);
});

it("strict mode: one replace per key, none from the resync", async () => {
  const r = render(<StrictMode>{ui()}</StrictMode>);
  await screen.findByRole("list", { name: "Applications" });
  press(1, 1);
  expect(replace).toHaveBeenCalledTimes(2);
  search = `status=${STATUSES[1]}`;
  r.rerender(<StrictMode>{ui()}</StrictMode>);
  await waitFor(() => expect(select().value).toBe(STATUSES[1]));
  expect(replace).toHaveBeenCalledTimes(2);
});
