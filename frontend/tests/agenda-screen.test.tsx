// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgendaScreen } from "../src/app/(app)/interviews/agenda-screen";
import { ToastProvider } from "../src/components/toast";
import { WAKE_MS } from "../src/components/waking-up";
import { createInterview, deleteApplication } from "../src/lib/api";
import { ANNOUNCE_MS } from "../src/app/(app)/applications/(ledger)/use-list";
import { clearCaches, forgetLoaded } from "../src/lib/cache";
import { type Fake, installFake, json, makeApp, makeInterview } from "./helpers/fake-api";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/interviews",
}));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  forgetLoaded();
  search = "";
  replace.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const A = makeApp(1, { company: "Pinagsama Tech", job_name: "Frontend Engineer" });
const B = makeApp(2, { company: "Bayanihan Digital", job_name: "Product Designer" });
const iv = (id: number, app: number, at: string, rest = {}) => makeInterview(id, app, { scheduled_at: at, ...rest });
const setup = (interviews: ReturnType<typeof iv>[], apps = [A, B]) => {
  fake = installFake({ apps, interviews });
};
const mount = () =>
  render(
    <ToastProvider>
      <AgendaScreen />
    </ToastProvider>,
  );
const rows = () => screen.queryAllByRole("link").filter((l) => l.getAttribute("data-interview-id"));
const status = () => screen.getAllByRole("status")[0];
const many = (n: number) => Array.from({ length: n }, (_, i) => iv(i + 1, 1, new Date(Date.UTC(2099, 0, 1, i)).toISOString()));

it("asks for the first 50 upcoming interviews and shows each row's fields", async () => {
  setup([
    iv(1, 1, "2099-03-10T14:00:00+08:00", { interviewer: "Ana Santos", outcome: "good", remarks: "private note" }),
    iv(2, 2, "2099-03-11T09:00:00+08:00", { mode: "async" }),
  ]);
  mount();
  await screen.findAllByRole("link", { name: /Frontend Engineer/ });
  expect(fake.calls[0].path).toBe("/interviews?when=upcoming&limit=50&offset=0");
  const [first, second] = rows();
  expect(first.getAttribute("href")).toBe("/applications/1");
  expect(first.textContent).toContain("Mar 10, 2099, 2:00 PM PHT");
  expect(first.textContent).toContain("Frontend Engineer");
  expect(first.textContent).toContain("Pinagsama Tech");
  expect(first.textContent).toContain("Online");
  expect(first.textContent).toContain("Ana Santos");
  expect(within(first).getByText("Good")).toBeTruthy();
  expect(document.body.textContent).not.toContain("private note"); // notes are not shown
  expect(second.getAttribute("href")).toBe("/applications/2");
  expect(second.textContent).toContain("Async");
  expect(second.textContent).not.toContain("Ana Santos"); // no interviewer: nothing shown, no placeholder
  expect(within(second).getByText("Pending")).toBeTruthy();
});

it("has one h1, one h2 per PHT day, and splits 11:30 PM and 12:30 AM into two days", async () => {
  setup([iv(1, 1, "2099-03-10T23:30:00+08:00"), iv(2, 2, "2099-03-11T00:30:00+08:00"), iv(3, 1, "2099-03-11T09:00:00+08:00")]);
  mount();
  await screen.findAllByRole("heading", { level: 2 });
  expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Interviews"]);
  const days = screen.getAllByRole("heading", { level: 2 });
  expect(days.map((h) => h.textContent)).toEqual(["Tuesday, Mar 10, 2099", "Wednesday, Mar 11, 2099"]);
  const groups = days.map((h) => screen.getByRole("region", { name: h.textContent! }));
  expect(groups.map((g) => within(g).getAllByRole("link").length)).toEqual([1, 2]);
});

it("the same day stays one group in a zone far from PHT", async () => {
  const original = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    setup([iv(1, 1, "2099-03-10T15:30:00Z"), iv(2, 1, "2099-03-10T16:30:00Z")]); // 23:30 and 00:30 PHT
    mount();
    await screen.findAllByRole("heading", { level: 2 });
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Tuesday, Mar 10, 2099", "Wednesday, Mar 11, 2099"]);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

it("Past asks for when=past and lists newest first", async () => {
  search = "when=past";
  setup([iv(1, 1, "2020-05-04T10:00:00+08:00"), iv(2, 1, "2020-05-06T10:00:00+08:00")]);
  mount();
  await screen.findAllByRole("heading", { level: 2 });
  expect(fake.calls[0].path).toBe("/interviews?when=past&limit=50&offset=0");
  expect(rows().map((l) => l.getAttribute("data-interview-id"))).toEqual(["2", "1"]);
});

it("the segmented control shows the tab and switches it through the URL", async () => {
  setup([]);
  const { unmount } = mount();
  const up = screen.getByRole("radio", { name: "Upcoming" }) as HTMLInputElement;
  expect(up.checked).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "Past" }));
  expect(replace).toHaveBeenCalledWith("/interviews?when=past");
  unmount();
  search = "when=past";
  mount();
  expect((screen.getByRole("radio", { name: "Past" }) as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "Upcoming" }));
  expect(replace).toHaveBeenLastCalledWith("/interviews");
});

it("shows the skeleton and announces the loading, then the rows", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews/, async () => (await gate, json(200, { items: [{ ...iv(1, 1, "2099-03-10T14:00:00+08:00"), company: "C", job_name: "J" }], total: 1, limit: 50, offset: 0 })));
  mount();
  expect(status().textContent).toBe("Loading interviews");
  expect(rows()).toHaveLength(0);
  release();
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(status().textContent).toBe("");
});

/** Lets real I/O callbacks and the faked setTimeout run until `done()` holds (waitFor would stall on the faked timers). */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(10);
    });
  }
  expect(done()).toBe(true);
}

function slow() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/interviews/, async () => (await gate, json(200, { items: [], total: 0, limit: 50, offset: 0 })));
  return () => release();
}

it("the slow-start line shows after 3 s of the first load, and not for a later reload", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  const release = slow();
  mount();
  await act(async () => void (await vi.advanceTimersByTimeAsync(WAKE_MS - 100)));
  expect(screen.queryByText(/Starting up/)).toBeNull();
  await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
  expect(screen.getByText(/Starting up/)).toBeTruthy();
  release();
  await until(() => screen.queryByText("No upcoming interviews.") !== null);
  expect(screen.queryByText(/Starting up/)).toBeNull();
  // Something has loaded in this tab: a reload after a clear is not a cold start.
  const release2 = slow();
  act(() => clearCaches());
  await act(async () => void (await vi.advanceTimersByTimeAsync(WAKE_MS * 2)));
  expect(screen.queryByText(/Starting up/)).toBeNull();
  release2();
});

it("a failed load shows the error with Retry, and Retry loads the rows", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  fake.failNext("GET", /^\/interviews/);
  mount();
  await screen.findByText("Couldn't load interviews.");
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(screen.queryByText("Couldn't load interviews.")).toBeNull();
});

it.each([
  ["", "No upcoming interviews."],
  ["when=past", "No past interviews."],
])("empty (%s): the message, a Secondary link to the applications and no primary button", async (q, title) => {
  search = q;
  setup([]);
  mount();
  await screen.findByText(title);
  const go = screen.getByRole("link", { name: "Go to applications" });
  expect(go.getAttribute("href")).toBe("/applications");
  expect(go.className).toContain("border-border-input"); // the Secondary variant
  expect(go.className).not.toContain("bg-primary");
  expect(screen.queryByRole("link", { name: /Add/ })).toBeNull();
});

it("a user with only past interviews sees the upcoming empty state", async () => {
  setup([iv(1, 1, "2020-05-04T10:00:00+08:00")]);
  mount();
  await screen.findByText("No upcoming interviews.");
});

it("Load more: 50, then 100, then 120; announces each page, focuses the first new row, then disappears", async () => {
  setup(many(120));
  mount();
  await waitFor(() => expect(rows()).toHaveLength(50));
  expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rows()).toHaveLength(100));
  expect(fake.calls.at(-1)!.path).toBe("/interviews?when=upcoming&limit=50&offset=50");
  expect(status().textContent).toBe("50 more interviews loaded");
  expect(document.activeElement).toBe(rows()[50]);
  expect(rows()[50].getAttribute("data-interview-id")).toBe("51");
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rows()).toHaveLength(120));
  expect(status().textContent).toBe("20 more interviews loaded");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
}, 20_000);

it("a failed Load more keeps the rows and offers Retry", async () => {
  setup(many(60));
  mount();
  await waitFor(() => expect(rows()).toHaveLength(50));
  fake.failNext("GET", /offset=50/);
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Couldn't load more interviews.");
  expect(rows()).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rows()).toHaveLength(60));
});

it("the announcement is cleared after ANNOUNCE_MS", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  setup(many(60));
  mount();
  await until(() => rows().length === 50);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await until(() => status().textContent === "10 more interviews loaded");
  await act(async () => void (await vi.advanceTimersByTimeAsync(ANNOUNCE_MS + 10)));
  expect(status().textContent).toBe("");
});

it("an interview created elsewhere shows up: the agenda refetches after the write", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  mount();
  await waitFor(() => expect(rows()).toHaveLength(1));
  await act(async () => void (await createInterview(2, { scheduled_at: "2099-03-09T10:00:00+08:00", mode: "online", outcome: "pending", interviewer: null, remarks: null } as never)));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(rows()[0].textContent).toContain("Bayanihan Digital"); // earliest first
});

it("deleting an application that has interviews empties them from the cached agenda", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00"), iv(2, 2, "2099-03-11T14:00:00+08:00")]);
  mount();
  await waitFor(() => expect(rows()).toHaveLength(2));
  await act(async () => deleteApplication(1));
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(rows()[0].getAttribute("href")).toBe("/applications/2");
});

it("a response requested before a clear is dropped, never shown", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const stale = { ...iv(9, 1, "2099-03-10T14:00:00+08:00"), company: "STALE", job_name: "STALE" };
  fake.on("GET", /^\/interviews/, async () => (await gate, json(200, { items: [stale], total: 1, limit: 50, offset: 0 })));
  mount();
  act(() => clearCaches()); // the first request is now outdated; its refetch answers from the fake db
  await waitFor(() => expect(rows()).toHaveLength(1));
  expect(rows()[0].getAttribute("data-interview-id")).toBe("1");
  release();
  await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
  expect(document.body.textContent).not.toContain("STALE");
});

it("coming back shows the cached rows at once while page 1 is refetched", async () => {
  setup([iv(1, 1, "2099-03-10T14:00:00+08:00")]);
  const first = mount();
  await waitFor(() => expect(rows()).toHaveLength(1));
  first.unmount();
  slow(); // the refetch stays pending
  mount();
  expect(rows()).toHaveLength(1); // no skeleton
  expect(status().textContent).toBe("");
});
