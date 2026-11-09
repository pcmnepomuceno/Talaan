// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json, makeInterview } from "./helpers/fake-api";

const replace = vi.fn();
let search = "";
let paramId = "1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({ id: paramId }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => `/applications/${paramId}`,
}));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  replace.mockClear();
  search = "";
  paramId = "1";
});
afterEach(() => vi.restoreAllMocks());

const ui = () => (
  <ToastProvider>
    <ApplicationsScreen>
      <ApplicationDetailPage />
    </ApplicationsScreen>
  </ToastProvider>
);
const mount = () => render(ui());
const list = () => screen.findByRole("list", { name: "Interviews" });
const DATE1 = "Oct 24, 2026, 2:00 PM PHT"; // seed interview 1
const ivDialog = () => [...document.querySelectorAll("dialog")].find((d) => d.textContent?.includes("Delete this interview?"))!;
const skeleton = () => screen.getByRole("region", { name: "Application detail" }).querySelector("li.animate-ledger-pulse");

it("Add interview is in the Interviews header and goes to the new-interview route, keeping the status filter", async () => {
  search = "status=interviewing";
  mount();
  await list();
  const add = screen.getAllByRole("link", { name: "Add interview" });
  expect(add).toHaveLength(1);
  expect(add[0].getAttribute("href")).toBe("/applications/1/interviews/new?status=interviewing");
});

it("the empty state offers the same action", async () => {
  fake.db.interviews = [];
  mount();
  expect(await screen.findByText("No interviews yet.")).toBeTruthy();
  const add = screen.getAllByRole("link", { name: "Add interview" });
  expect(add).toHaveLength(1);
  expect(add[0].getAttribute("href")).toBe("/applications/1/interviews/new");
});

it("no Add interview while interviews are loading or failed", async () => {
  fake.failNext("GET", /^\/applications\/1\/interviews/);
  mount();
  await screen.findByText("Couldn't load interviews.");
  expect(screen.queryByRole("link", { name: "Add interview" })).toBeNull();
});

it("each row has Edit and Delete whose accessible names include the date; Edit links to the edit route", async () => {
  search = "status=applied";
  mount();
  await list();
  const edit = screen.getByRole("link", { name: `Edit interview, ${DATE1}` });
  expect(edit.getAttribute("href")).toBe("/applications/1/interviews/1/edit?status=applied");
  expect(screen.getByRole("button", { name: `Delete interview, ${DATE1}` })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Edit interview, Oct 18, 2026, 10:00 AM PHT" })).toBeTruthy();
  expect(edit.textContent).toBe("Edit"); // visible label first, inside the accessible name
});

it("delete: the dialog names the date and mode; confirming removes the row at once, no skeleton, no not-found, and refetches", async () => {
  mount();
  await list();
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  expect(await screen.findByRole("heading", { name: "Delete this interview?" })).toBeTruthy();
  expect(ivDialog().textContent).toContain(`The Online interview on ${DATE1} will be removed. This cannot be undone.`);

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\/1\/interviews/, async () => (await gate, json(200, { items: fake.db.interviews.filter((i) => i.job_application_id === 1), total: 1, limit: 100, offset: 0 })));
  const bad: string[] = [];
  const obs = new MutationObserver(() => {
    if (document.body.textContent?.includes("not found")) bad.push("not found");
    if (skeleton()) bad.push("skeleton");
    if (!screen.queryByRole("list", { name: "Interviews" })) bad.push("list gone");
    if (!document.body.textContent?.includes("Frontend Engineer")) bad.push("page gone");
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  await userEvent.click(screen.getByRole("button", { name: "Delete interview" }));
  // gone while the refetch is still pending
  await waitFor(() => expect(screen.queryByRole("link", { name: `Edit interview, ${DATE1}` })).toBeNull());
  expect(fake.callsTo("GET", /^\/applications\/1\/interviews/).length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("link", { name: "Edit interview, Oct 18, 2026, 10:00 AM PHT" })).toBeTruthy();
  expect(await screen.findByText("Interview deleted.")).toBeTruthy();
  release();
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  expect(bad).toEqual([]);
  expect(fake.db.interviews.some((i) => i.id === 1)).toBe(false);
  expect(fake.callsTo("DELETE", /^\/interviews\/1$/)).toHaveLength(1);
});

it("delete: focus moves to the Interviews heading, or to Add interview when no rows remain", async () => {
  const view = mount();
  await list();
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete interview" }));
  await screen.findByText("Interview deleted.");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Interviews" })));
  view.unmount();

  clearCaches();
  fake.db.interviews = [makeInterview(9, 1, { scheduled_at: "2026-10-24T14:00:00+08:00" })];
  mount();
  await list();
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete interview" }));
  await screen.findByText("No interviews yet.");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("link", { name: "Add interview" })));
});

it("delete: a 404 (already gone) is success", async () => {
  mount();
  await list();
  fake.db.interviews = fake.db.interviews.filter((i) => i.id !== 1); // another tab deleted it
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete interview" }));
  expect(await screen.findByText("Interview deleted.")).toBeTruthy();
  expect(screen.queryByRole("link", { name: `Edit interview, ${DATE1}` })).toBeNull();
});

it("delete: a server failure keeps the dialog open and the row, with an error toast", async () => {
  mount();
  await list();
  fake.failNext("DELETE", /^\/interviews\/1$/);
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  await userEvent.click(await screen.findByRole("button", { name: "Delete interview" }));
  expect(await screen.findByText("Couldn't delete the interview. Try again.")).toBeTruthy();
  expect(ivDialog().hasAttribute("open")).toBe(true);
  expect(fake.db.interviews.some((i) => i.id === 1)).toBe(true);
  expect(screen.getByRole("link", { name: `Edit interview, ${DATE1}` })).toBeTruthy();
  // and the kept copy was released: a later clear refetches normally (skeleton, then fresh)
  await userEvent.click(screen.getAllByRole("button", { name: "Cancel" }).find((b) => ivDialog().contains(b))!);
  expect(ivDialog().hasAttribute("open")).toBe(false);
});

it("the 'first 100 of N' note follows a new interview (101 -> 102 rows on the server)", async () => {
  fake.db.interviews = Array.from({ length: 101 }, (_, i) => makeInterview(i + 1, 1, { scheduled_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:00+08:00` }));
  mount();
  expect(await screen.findByText("Showing the first 100 of 101 interviews.")).toBeTruthy();
  fake.db.interviews.push(makeInterview(500, 1)); // added on the form route, which clears the caches
  act(() => clearCaches());
  expect(await screen.findByText("Showing the first 100 of 102 interviews.")).toBeTruthy();
});

it("a cache clear without an in-place delete (a write on another route) shows the skeleton, never the pre-write data", async () => {
  const first = mount();
  await list();
  first.unmount();
  act(() => clearCaches()); // an interview or application saved on a form route
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\/1$/, async () => (await gate, json(200, { ...fake.db.apps[0], company: "Edited Co" })));
  mount();
  expect(screen.queryByRole("heading", { name: "Frontend Engineer" })).toBeNull();
  expect(screen.queryByRole("list", { name: "Interviews" })).toBeNull();
  expect(skeleton()).toBeTruthy();
  release();
  await waitFor(() => expect(screen.getAllByText("Edited Co").length).toBeGreaterThan(0));
});

it("opening another application never shows the previous one's kept data", async () => {
  const view = mount();
  await list();
  await userEvent.click(screen.getByRole("button", { name: `Delete interview, ${DATE1}` }));
  fake.on("GET", /^\/applications\/2$/, () => new Promise<Response>(() => {})); // never answers
  paramId = "2";
  view.rerender(ui());
  expect(screen.queryByRole("heading", { name: "Frontend Engineer" })).toBeNull();
  expect(screen.queryByRole("link", { name: `Edit interview, ${DATE1}` })).toBeNull();
});
