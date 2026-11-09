// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches, getDetail } from "../src/lib/cache";
import { type Fake, installFake, json, makeInterview } from "./helpers/fake-api";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications/1",
}));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  replace.mockClear();
  search = "";
});
afterEach(() => vi.restoreAllMocks());

const mount = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationDetailPage />
      </ApplicationsScreen>
    </ToastProvider>,
  );
const detailSection = () => screen.getByRole("region", { name: "Application detail" });
const actions = () => [screen.getAllByRole("link", { name: "Edit" }), screen.getAllByRole("button", { name: "Delete" })].flat();

it("stale-while-revalidate: cached detail shows at once, Edit and Delete are disabled and aria-busy is set until fresh data lands", async () => {
  const first = mount();
  await screen.findByRole("list", { name: "Interviews" });
  first.unmount();

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\/1$/, async () => (await gate, json(200, { ...fake.db.apps[0], company: "Renamed Co" })));
  mount();
  // cached content, no skeleton
  expect(screen.getByRole("heading", { name: "Frontend Engineer" })).toBeTruthy();
  expect(screen.getByRole("list", { name: "Interviews" })).toBeTruthy();
  expect(detailSection().getAttribute("aria-busy")).toBe("true");
  expect(actions().length).toBeGreaterThan(0);
  for (const b of actions()) expect(b.getAttribute("aria-disabled")).toBe("true");

  release();
  await waitFor(() => expect(screen.getAllByText("Renamed Co").length).toBeGreaterThan(0));
  expect(detailSection().getAttribute("aria-busy")).toBeNull();
  expect(screen.getAllByRole("link", { name: "Edit" }).length).toBeGreaterThan(0);
  for (const b of actions()) expect(b.getAttribute("aria-disabled")).toBeNull();
});

it("a write clears the cached detail, so a revisit shows the skeleton, never old fields", async () => {
  const first = mount();
  await screen.findByRole("list", { name: "Interviews" });
  first.unmount();
  clearCaches();
  fake.on("GET", /^\/applications\/1$/, () => new Promise<Response>(() => {}));
  mount();
  expect(screen.queryByRole("heading", { name: "Frontend Engineer" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

it("a detail fetch in flight when a write clears the caches is neither stored nor shown; the detail refetches", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\/1$/, async () => (await gate, json(200, { ...fake.db.apps[0], company: "Stale Co" })));
  mount();
  // The write and the stale response land in the same tick, before React re-renders.
  await act(async () => {
    clearCaches();
    release();
    await gate;
  });
  await screen.findByRole("list", { name: "Interviews" });
  await waitFor(() => expect(getDetail(1)?.application.company).toBe("Pinagsama Tech"));
  expect(screen.queryByText("Stale Co")).toBeNull();
  expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(2);
});

it("while the first load runs: aria-busy, and the live region says Loading application", async () => {
  mount();
  expect(detailSection().getAttribute("aria-busy")).toBe("true");
  expect(screen.getAllByRole("status")[0].textContent).toBe("Loading application");
  await screen.findByRole("list", { name: "Interviews" });
  expect(detailSection().getAttribute("aria-busy")).toBeNull();
});

it.each([
  ["the application", /^\/applications\/1$/],
  ["its interviews", /^\/applications\/1\/interviews/],
])("a 404 on %s evicts the cached detail: the next visit never flashes the deleted record", async (_what, path) => {
  const first = mount();
  await screen.findByRole("list", { name: "Interviews" });
  first.unmount();
  fake.on("GET", path, () => json(404, { detail: "Application not found." })); // deleted elsewhere
  const second = mount();
  expect(await screen.findByText("Application not found.")).toBeTruthy();
  second.unmount();
  fake.on("GET", /^\/applications\/1/, () => new Promise<Response>(() => {}), false);
  mount();
  expect(screen.queryByRole("heading", { name: "Frontend Engineer" })).toBeNull();
  expect(screen.getAllByRole("status")[0].textContent).toBe("Loading application");
});

it("a 404 on the application shows not-found even though interviews also 404", async () => {
  fake.db.apps = [];
  mount();
  expect(await screen.findByText("Application not found.")).toBeTruthy();
  expect(screen.queryByText("Couldn't load interviews.")).toBeNull();
});

it("the detail's not-found view goes back to the list keeping ?status=", async () => {
  search = "status=interviewing";
  fake.db.apps = [];
  mount();
  await screen.findByText("Application not found.");
  expect(screen.getByRole("link", { name: "Back to applications" }).getAttribute("href")).toBe("/applications?status=interviewing");
});

it("shows 'Showing the first 100 of N' when there are more interviews than fit", async () => {
  fake.db.interviews = Array.from({ length: 130 }, (_, i) => makeInterview(i + 1, 1, { scheduled_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:00+08:00` }));
  mount();
  expect(await screen.findByText("Showing the first 100 of 130 interviews.")).toBeTruthy();
});

it("no note when every interview is shown", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  expect(screen.queryByText(/Showing the first/)).toBeNull();
});

it("delete: 404 from the API counts as already gone, same toast, back to the list keeping ?status=", async () => {
  search = "status=interviewing";
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  fake.on("DELETE", /^\/applications\/1$/, () => json(404, { detail: "Application not found." }));
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications?status=interviewing"));
  expect(screen.getByText("Application deleted.")).toBeTruthy();
});

it("delete success: the open detail never refetches the deleted id and never says not found", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  const before = fake.callsTo("GET", /^\/applications\/1/).length;
  const seen: string[] = [];
  const obs = new MutationObserver(() => {
    if (document.body.textContent?.includes("Application not found")) seen.push("not found");
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications"));
  // replace is mocked, so the route stays on /applications/1: the worst case for a stray refetch.
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  expect(seen).toEqual([]);
  expect(screen.queryByText("Application not found.")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Frontend Engineer" })).toBeNull();
  expect(fake.callsTo("GET", /^\/applications\/1/)).toHaveLength(before);
});

it("delete failure: a later cache clear still refetches the open detail", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  fake.failNext("DELETE", /^\/applications\/1$/);
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await screen.findByText("Couldn't delete the application. Try again.");
  const before = fake.callsTo("GET", /^\/applications\/1$/).length;
  act(() => clearCaches());
  await waitFor(() => expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(before + 1));
});

it("delete: a server failure keeps the dialog open and the application", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  fake.failNext("DELETE", /^\/applications\/1$/);
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  expect(await screen.findByText("Couldn't delete the application. Try again.")).toBeTruthy();
  expect([...document.querySelectorAll("dialog")].find((d) => d.textContent?.includes("Delete this application?"))!.hasAttribute("open")).toBe(true);
  expect(replace).not.toHaveBeenCalled();
  expect(fake.db.apps.some((a) => a.id === 1)).toBe(true);
});

it("a mapping error (unknown status from the API) is the generic load error, not a crash", async () => {
  fake.on("GET", /^\/applications\/1$/, () => json(200, { ...fake.db.apps[0], status: "hired" }));
  mount();
  expect(await screen.findByText("Couldn't load this application.")).toBeTruthy();
});

// ---- Change status (P1) ----
const openStatus = async () => {
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getByRole("button", { name: "Change status" }));
  return screen.getByRole("dialog", { name: "Change status" });
};
const update = () => screen.getByRole("button", { name: "Update status" });
const skeletons = () => document.querySelectorAll(".animate-ledger-pulse").length;
// The dialog (and the status filter) also list every status; the page's own stamp is outside them.
const pageText = (t: string) => screen.queryAllByText(t).filter((el) => !el.closest("dialog, select"));
const patches = () => fake.callsTo("PATCH", /^\/applications\/1$/);
const SERVER_ROW = { status: "applied", date_applied: "2026-11-09" };

it("Change status opens a radio group of the nine statuses with the current one checked", async () => {
  mount();
  const dialog = await openStatus();
  const radios = within(dialog).getAllByRole("radio") as HTMLInputElement[];
  expect(radios.map((r) => r.closest("label")!.textContent)).toEqual([
    "Saved", "Applied", "Screening", "Interviewing", "Offered", "Accepted", "Rejected", "Withdrawn", "Ghosted",
  ]);
  expect(radios.filter((r) => r.checked).map((r) => r.closest("label")!.textContent)).toEqual(["Interviewing"]);
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("confirming sends only {status}, toasts, and shows the new status", async () => {
  mount();
  await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  expect(patches()).toHaveLength(0); // choosing alone sends nothing
  await userEvent.click(update());
  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(patches()[0].body).toEqual({ status: "applied" });
  expect(await screen.findByText("Status updated.")).toBeTruthy();
  await waitFor(() => expect(pageText("Applied").length).toBeGreaterThan(0));
  expect(pageText("Interviewing")).toHaveLength(0);
});

it("the server's row shows at once: no skeleton, new stamp, filled date, no refetch, actions enabled", async () => {
  Object.assign(fake.db.apps[0], { status: "saved", date_applied: null });
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  expect(pageText("Nov 9, 2026")).toHaveLength(0);
  fake.on("PATCH", /^\/applications\/1$/, () => json(200, { ...fake.db.apps[0], ...SERVER_ROW }));
  const gets = fake.callsTo("GET", /^\/applications\/1(\/|$)/).length;
  await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  await userEvent.click(update());
  await waitFor(() => expect(pageText("Applied").length).toBeGreaterThan(0));
  expect(pageText("Nov 9, 2026").length).toBeGreaterThan(0); // the date the server filled in
  expect(skeletons()).toBe(0);
  expect(screen.queryByText("Loading application")).toBeNull();
  expect(screen.getByRole("list", { name: "Interviews" })).toBeTruthy();
  // The PATCH response is the fresh row and a status cannot change interviews: nothing is refetched.
  await new Promise((r) => setTimeout(r, 30));
  expect(fake.callsTo("GET", /^\/applications\/1(\/|$)/)).toHaveLength(gets);
  expect(detailSection().getAttribute("aria-busy")).toBeNull();
  expect((screen.getByRole("button", { name: "Change status" }) as HTMLButtonElement).disabled).toBe(false);
  for (const b of actions()) expect(b.getAttribute("aria-disabled")).toBeNull();
});

it("the same status sends nothing and says nothing", async () => {
  mount();
  const dialog = await openStatus();
  await userEvent.click(update());
  expect(patches()).toHaveLength(0);
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(screen.queryByText("Status updated.")).toBeNull();
});

it("a double activation sends one request, and both buttons are aria-disabled while it runs", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("PATCH", /^\/applications\/1$/, async () => (await gate, json(200, { ...fake.db.apps[0], ...SERVER_ROW })));
  mount();
  await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  const btn = update();
  await act(async () => {
    btn.click();
    btn.click();
  });
  expect(patches()).toHaveLength(1);
  expect(update().getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
  release();
  expect(await screen.findByText("Status updated.")).toBeTruthy();
});

it("a failed save keeps the dialog open, shows an error, and writes nothing to the cache", async () => {
  fake.failNext("PATCH", /^\/applications\/1$/);
  mount();
  const dialog = await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  await userEvent.click(update());
  expect(await screen.findByText("Talaan isn't responding right now. Try again in a moment.")).toBeTruthy();
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(getDetail(1)?.application.status).toBe("interviewing");
  expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(1); // no refetch: nothing was cleared
  expect(update().getAttribute("aria-disabled")).toBeNull(); // can retry
  expect(screen.queryByText("Status updated.")).toBeNull();
});

it("a 404 on save shows the not-found view", async () => {
  mount();
  await openStatus();
  fake.on("PATCH", /^\/applications\/1$/, () => json(404, { detail: "Application not found." }));
  fake.on("GET", /^\/applications\/1$/, () => json(404, { detail: "Application not found." }));
  fake.on("GET", /^\/applications\/1\/interviews/, () => json(404, { detail: "Application not found." }));
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  await userEvent.click(update());
  expect(await screen.findByText("Application not found.")).toBeTruthy();
});

it("a response the client cannot map falls back to the skeleton and a refetch", async () => {
  fake.on("PATCH", /^\/applications\/1$/, () => json(200, { ...fake.db.apps[0], status: "archived" }));
  mount();
  await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  await userEvent.click(update());
  expect(await screen.findByText("Status updated.")).toBeTruthy();
  await waitFor(() => expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(2));
  await screen.findByRole("list", { name: "Interviews" });
});

it("keyboard only: arrow keys choose, Enter confirms, focus returns to Change status", async () => {
  const user = userEvent.setup();
  mount();
  await openStatus();
  (screen.getByRole("radio", { name: "Interviewing" }) as HTMLElement).focus();
  await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}"); // Interviewing -> Screening -> Applied -> Saved
  expect((screen.getByRole("radio", { name: "Saved" }) as HTMLInputElement).checked).toBe(true);
  await user.keyboard("{ArrowDown}"); // -> Applied
  expect(patches()).toHaveLength(0);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(patches()).toHaveLength(1));
  expect(patches()[0].body).toEqual({ status: "applied" });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Change status" })));
});

it("Cancel closes without a request", async () => {
  mount();
  const dialog = await openStatus();
  await userEvent.click(screen.getByRole("radio", { name: "Ghosted" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(patches()).toHaveLength(0);
  // reopening starts from the current status again
  await userEvent.click(screen.getByRole("button", { name: "Change status" }));
  expect((screen.getByRole("radio", { name: "Interviewing" }) as HTMLInputElement).checked).toBe(true);
});
