// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgendaScreen } from "../src/app/(app)/interviews/agenda-screen";
import { ToastProvider } from "../src/components/toast";
import { WAKE_MS } from "../src/components/waking-up";
import { createInterview, deleteApplication } from "../src/lib/api";
import { clearCaches, forgetLoaded, getCalendar } from "../src/lib/cache";
import { toInterviewInput } from "../src/lib/mappers";
import { type Fake, installFake, json, makeApp, makeInterview } from "./helpers/fake-api";

// A router whose replace() really changes the URL the screen reads, like Next does.
let search = "";
const subs = new Set<() => void>();
const push = vi.fn();
const replace = vi.fn((url: string) => {
  search = url.split("?")[1] ?? "";
  for (const f of [...subs]) f();
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({}),
  useSearchParams: () => {
    const s = useSyncExternalStore(
      (f) => (subs.add(f), () => void subs.delete(f)),
      () => search,
      () => search,
    );
    return useMemo(() => new URLSearchParams(s), [s]);
  },
  usePathname: () => "/interviews",
}));

const NOW = "2026-11-12T04:00:00Z"; // 12:00 PHT on Thursday Nov 12
const NOV = "2026-11-01/2026-12-05"; // the grid of November 2026
let fake: Fake;
const iv = (id: number, app: number, at: string) => makeInterview(id, app, { scheduled_at: at });
const SEED = [
  iv(1, 1, "2026-11-10T09:30:00+08:00"),
  iv(2, 2, "2026-11-10T14:00:00+08:00"),
  iv(3, 1, "2026-11-10T23:30:00+08:00"),
  iv(4, 2, "2026-11-11T00:30:00+08:00"),
  iv(5, 1, "2026-11-20T10:00:00+08:00"),
  iv(6, 2, "2026-12-02T09:00:00+08:00"),
];
const A = makeApp(1, { company: "Pinagsama Tech", job_name: "Frontend Engineer" });
const B = makeApp(2, { company: "Bayanihan Digital", job_name: "Product Designer" });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  clearCaches();
  forgetLoaded();
  search = "view=month&month=2026-11";
  push.mockClear();
  replace.mockClear();
  fake = installFake({ apps: [A, B], interviews: SEED.map((i) => ({ ...i })) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <ToastProvider>
      <AgendaScreen />
    </ToastProvider>,
  );
const grid = () => screen.getByRole("grid");
const cell = (d: string) => grid().querySelector<HTMLElement>(`button[data-day="${d}"]`)!;
const tinted = () => [...grid().querySelectorAll<HTMLElement>("button.bg-primary-tint")].map((b) => b.dataset.day);
const rows = () => [...document.querySelectorAll<HTMLAnchorElement>("a[data-interview-id]")];
const ready = () => waitFor(() => expect(grid().hasAttribute("aria-busy")).toBe(false));
const calendarCalls = () => fake.calls.filter((c) => c.path.startsWith("/interviews/calendar")).map((c) => c.path);
// The toast provider keeps empty alert regions mounted: look at the text, not at the role alone.
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent).join("|");
const heading = (name: string) => screen.getByRole("heading", { level: 2, name });

it("switches views with replace and keeps the choice in ?view", async () => {
  search = "";
  mount();
  const user = userEvent.setup({ advanceTimers: () => {} });
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Agenda" }).checked).toBe(true);
  await user.click(screen.getByRole("radio", { name: "Month" }));
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-11");
  await ready();
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Month" }).checked).toBe(true);
  expect(heading("November 2026")).toBeTruthy();
  await user.click(screen.getByRole("radio", { name: "Agenda" }));
  expect(replace).toHaveBeenLastCalledWith("/interviews");
  expect(screen.queryByRole("grid")).toBeNull();
  expect(push).not.toHaveBeenCalled();
});

it("asks for the whole visible grid, leading and trailing days included", async () => {
  mount();
  await ready();
  expect(calendarCalls()).toEqual(["/interviews/calendar?from=2026-11-01&to=2026-12-05"]);
  expect(cell("2026-12-02").getAttribute("aria-label")).toBe("Wednesday, Dec 2, 2026, 1 interview");
});

it("asks for six weeks when the month needs them", async () => {
  search = "view=month&month=2026-08";
  mount();
  await ready();
  expect(calendarCalls()).toEqual(["/interviews/calendar?from=2026-07-26&to=2026-09-05"]);
});

it.each(["2026-13", "abc", "1899-12", "2201-01", ""])("replaces an invalid ?month=%s with the current month", (bad) => {
  search = `view=month&month=${bad}`;
  mount();
  expect(replace).toHaveBeenCalledWith("/interviews?view=month&month=2026-11");
  expect(heading("November 2026")).toBeTruthy();
});

it("replaces a missing ?month", () => {
  search = "view=month";
  mount();
  expect(replace).toHaveBeenCalledWith("/interviews?view=month&month=2026-11");
});

it("tints the days with interviews, puts today in the outline, selects today by default", async () => {
  mount();
  await ready();
  expect(tinted()).toEqual(["2026-11-10", "2026-11-11", "2026-11-20", "2026-12-02"]);
  expect(cell("2026-11-12").getAttribute("aria-current")).toBe("date");
  expect(cell("2026-11-12").closest('[role="gridcell"]')!.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Thursday, Nov 12, 2026");
  expect(screen.getByText("No interviews on this day.")).toBeTruthy();
});

it("splits 23:30 PHT and 00:30 PHT the next day onto different days", async () => {
  mount();
  await ready();
  expect(cell("2026-11-10").getAttribute("aria-label")).toContain("3 interviews");
  expect(cell("2026-11-11").getAttribute("aria-label")).toContain("1 interview");
});

it("lists the selected day's interviews as agenda rows, with Add to calendar only on upcoming ones", async () => {
  search = "view=month&month=2026-11&day=2026-11-10";
  mount();
  await ready();
  expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Tuesday, Nov 10, 2026");
  expect(rows().map((r) => r.dataset.interviewId)).toEqual(["1", "2", "3"]);
  expect(rows()[0].getAttribute("href")).toBe("/applications/1");
  expect(screen.queryAllByRole("button", { name: /^Add to calendar/ })).toHaveLength(0); // all in the past
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.click(cell("2026-11-20"));
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-11&day=2026-11-20");
  expect(rows().map((r) => r.dataset.interviewId)).toEqual(["5"]);
  expect(screen.getAllByRole("button", { name: /^Add to calendar/ })).toHaveLength(1);
});

it("ignores a ?day outside the visible grid", async () => {
  search = "view=month&month=2026-11&day=2026-02-01";
  mount();
  await ready();
  expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Thursday, Nov 12, 2026");
});

it("selecting a day of the next month moves the view there (replace, no push)", async () => {
  mount();
  await ready();
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.click(cell("2026-12-02"));
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-12&day=2026-12-02");
  expect(heading("December 2026")).toBeTruthy();
  expect(document.activeElement).toBe(cell("2026-12-02"));
  expect(push).not.toHaveBeenCalled();
});

it("Previous, Next and Today change the month with replace and announce it politely", async () => {
  mount();
  await ready();
  const user = userEvent.setup({ advanceTimers: () => {} });
  const prev = screen.getByRole("button", { name: "Previous month" });
  const next = screen.getByRole("button", { name: "Next month" });
  await user.click(next);
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-12");
  expect(heading("December 2026")).toBeTruthy();
  await waitFor(() => expect(screen.getAllByRole("status")[0].textContent).toBe("December 2026"));
  await user.click(prev);
  await user.click(prev);
  expect(heading("October 2026")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Today" }));
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-11");
  expect(heading("November 2026")).toBeTruthy();
  expect(push).not.toHaveBeenCalled();
});

it("Previous and Next are aria-disabled, not disabled, at 1900-01 and 2200-12", async () => {
  search = "view=month&month=1900-01";
  const { unmount } = mount();
  const prev = screen.getByRole("button", { name: "Previous month" });
  expect(prev.getAttribute("aria-disabled")).toBe("true");
  prev.focus();
  fireEvent.click(prev);
  expect(replace).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(prev);
  expect(screen.getByRole("button", { name: "Next month" }).getAttribute("aria-disabled")).toBeNull();
  unmount();
  search = "view=month&month=2200-12";
  mount();
  expect(screen.getByRole("button", { name: "Next month" }).getAttribute("aria-disabled")).toBe("true");
  expect(calendarCalls().at(-1)).toBe("/interviews/calendar?from=2200-11-30&to=2200-12-31");
});

it("handles rapid Next presses: ends on the last month asked, one history entry kind only", async () => {
  mount();
  await ready();
  const next = screen.getByRole("button", { name: "Next month" });
  act(() => {
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
  });
  expect(heading("February 2027")).toBeTruthy();
  await ready();
  expect(push).not.toHaveBeenCalled();
});

it("drops a response for a month that is no longer shown", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews\/calendar\?from=2026-11-01/, async () => {
    await gate;
    return json(200, { items: [], total: 0, truncated: false, from: "2026-11-01", to: "2026-12-05" });
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(calendarCalls()).toHaveLength(2));
  await ready();
  const dec = tinted();
  await act(async () => release());
  await new Promise((r) => setTimeout(r, 20));
  expect(getCalendar(NOV)).toBeUndefined();
  expect(heading("December 2026")).toBeTruthy();
  expect(tinted()).toEqual(dec);
});

it("stores nothing when the screen is gone before the answer", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews\/calendar/, async () => {
    await gate;
    return json(200, { items: [], total: 0, truncated: false, from: "2026-11-01", to: "2026-12-05" });
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const { unmount } = mount();
  unmount();
  await act(async () => release());
  await new Promise((r) => setTimeout(r, 20));
  expect(getCalendar(NOV)).toBeUndefined();
  expect(error).not.toHaveBeenCalled();
});

it("shows the loading state, with the grid in place and no markers, until the first answer", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews\/calendar/, async () => {
    await gate;
    return json(200, { items: [], total: 0, truncated: false, from: "2026-11-01", to: "2026-12-05" });
  });
  mount();
  expect(grid().getAttribute("aria-busy")).toBe("true");
  expect(grid().querySelectorAll("button")).toHaveLength(35);
  expect(screen.getAllByRole("status")[0].textContent).toBe("Loading interviews");
  expect(tinted()).toEqual([]);
  await act(async () => release());
  await ready();
});

it("shows an error with Retry when nothing is cached, and Retry loads it", async () => {
  fake.failNext("GET", /^\/interviews\/calendar/);
  mount();
  await waitFor(() => expect(alerts()).toContain("Couldn't load interviews."));
  expect(grid().querySelectorAll("button")).toHaveLength(35); // the grid stays
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect(alerts()).toBe("");
  expect(tinted()).toContain("2026-11-10");
});

it("keeps the cached month on screen when its refresh fails", async () => {
  mount();
  await ready();
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await ready();
  fake.failNext("GET", /^\/interviews\/calendar/);
  await user.click(screen.getByRole("button", { name: "Previous month" }));
  await waitFor(() => expect(alerts()).toContain("Couldn't refresh the interviews. Showing the last loaded rows."));
  expect(tinted()).toContain("2026-11-10");
});

it("says so when the server cut the month at 200 rows", async () => {
  fake.on("GET", /^\/interviews\/calendar/, () => json(200, { items: [], total: 201, truncated: true, from: "2026-11-01", to: "2026-12-05" }));
  mount();
  await waitFor(() => expect(alerts()).toContain("Showing the first 200 interviews. Some are not shown."));
});

it("needs no special state for a month with no interviews", async () => {
  search = "view=month&month=2027-06";
  mount();
  await ready();
  expect(tinted()).toEqual([]);
  expect(alerts()).toBe("");
});

it("refetches after an interview is created, and after an application is deleted", async () => {
  mount();
  await ready();
  expect(calendarCalls()).toHaveLength(1);
  const input = { ...toInterviewInput(SEED[0]), scheduled_at: "2026-11-25T10:00:00+08:00" };
  await act(async () => void (await createInterview(1, input)));
  await waitFor(() => expect(tinted()).toContain("2026-11-25"));
  expect(calendarCalls()).toHaveLength(2);
  await act(async () => deleteApplication(2));
  await waitFor(() => expect(tinted()).not.toContain("2026-12-02"));
  expect(calendarCalls()).toHaveLength(3);
});

it("shows the empty-day message when the only interview of the selected day is deleted elsewhere", async () => {
  search = "view=month&month=2026-11&day=2026-11-20";
  mount();
  await ready();
  expect(rows()).toHaveLength(1);
  fake.db.interviews = fake.db.interviews.filter((i) => i.id !== 5);
  act(() => clearCaches());
  await screen.findByText("No interviews on this day.");
  expect(rows()).toHaveLength(0);
  expect(tinted()).not.toContain("2026-11-20");
});

it("keeps focus on a day when the keyboard changes the month, and does not select it", async () => {
  mount();
  await ready();
  cell("2026-11-12").focus();
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.keyboard("{PageDown}");
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-12");
  expect(heading("December 2026")).toBeTruthy();
  expect(document.activeElement).toBe(cell("2026-12-12"));
  expect(document.activeElement).not.toBe(document.body);
  await user.keyboard("{ArrowDown}{Enter}");
  expect(replace).toHaveBeenLastCalledWith("/interviews?view=month&month=2026-12&day=2026-12-19");
  expect(push).not.toHaveBeenCalled();
});

it("Back after several month moves leaves the screen: only replace is ever used", async () => {
  search = "view=month&month=2026-11&day=2026-11-10";
  mount();
  await ready();
  const user = userEvent.setup({ advanceTimers: () => {} });
  await user.click(screen.getByRole("button", { name: "Next month" }));
  await user.click(cell("2026-12-05"));
  cell("2026-12-05").focus();
  await user.keyboard("{PageUp}");
  await user.click(screen.getByRole("radio", { name: "Agenda" }));
  expect(replace.mock.calls.length).toBeGreaterThanOrEqual(4);
  expect(push).not.toHaveBeenCalled();
});

it("shows the slow-start line on the first load only", async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date(NOW));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews\/calendar/, async () => {
    await gate;
    return json(200, { items: [], total: 0, truncated: false, from: "2026-11-01", to: "2026-12-05" });
  });
  mount();
  expect(screen.queryByText(/Starting up/)).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(WAKE_MS));
  expect(screen.getByText(/Starting up/)).toBeTruthy();
  await act(async () => release());
  for (let i = 0; i < 100 && grid().hasAttribute("aria-busy"); i++) await act(async () => void (await new Promise((r) => setImmediate(r))));
  expect(screen.queryByText(/Starting up/)).toBeNull();
  // a reload after a clear: no line, however long it takes
  fake.on("GET", /^\/interviews\/calendar/, () => new Promise<Response>(() => {}));
  act(() => clearCaches());
  await act(() => vi.advanceTimersByTimeAsync(WAKE_MS * 2));
  expect(screen.queryByText(/Starting up/)).toBeNull();
});
