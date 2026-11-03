// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen, panes } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json } from "./helpers/fake-api";

const replace = vi.fn();
let params: { id?: string } = {};
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

let fake: Fake;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  clearCaches();
  fake = installFake();
  replace.mockClear();
  params = {};
  search = "";
});

const screenUnderTest = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationDetailPage />
      </ApplicationsScreen>
    </ToastProvider>,
  );
// The toast error region is also role="alert" (empty), so find the banner by its text.
const bannerWith = async (text: string) => (await screen.findByText(text)).closest<HTMLElement>('[role="alert"]')!;
const rows = async () => within(await screen.findByRole("list", { name: "Applications" })).getAllByRole("link");

it("shows the skeleton, then rows newest first", async () => {
  screenUnderTest();
  expect(screen.getByText("Loading applications")).toBeTruthy();
  const links = await rows();
  expect(links.map((l) => l.getAttribute("href"))).toEqual([5, 4, 3, 2, 1].map((n) => `/applications/${n}`));
  expect(screen.queryByText("Loading applications")).toBeNull();
});

it("filters by ?status= and marks the tab pressed", async () => {
  search = "status=offered";
  screenUnderTest();
  expect(await rows()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Offered" }).getAttribute("aria-pressed")).toBe("true");
});

it("invalid status falls back to all", async () => {
  search = "status=bogus";
  screenUnderTest();
  expect(await rows()).toHaveLength(5);
  expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
});

it("clicking a tab replaces the URL", async () => {
  screenUnderTest();
  await rows();
  await userEvent.click(screen.getByRole("button", { name: "Applied" }));
  expect(replace).toHaveBeenCalledWith("/applications?status=applied");
  await userEvent.click(screen.getByRole("button", { name: "All" }));
  expect(replace).toHaveBeenLastCalledWith("/applications");
});

it("row links keep the filter", async () => {
  search = "status=offered";
  screenUnderTest();
  expect((await rows())[0].getAttribute("href")).toBe("/applications/2?status=offered");
});

it("filter with no matches says so (not the empty state)", async () => {
  search = "status=ghosted";
  screenUnderTest();
  expect(await screen.findByText("No applications with this status.")).toBeTruthy();
  expect(screen.queryByText("No applications yet.")).toBeNull();
});

it("empty state when there are no applications", async () => {
  fake.db.apps = [];
  screenUnderTest();
  expect(await screen.findByText("No applications yet.")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "Add application" }).length).toBeGreaterThan(0);
});

it("detail lists interviews oldest first", async () => {
  params = { id: "1" };
  screenUnderTest();
  const list = await screen.findByRole("list", { name: "Interviews" });
  const items = within(list).getAllByRole("listitem").map((li) => li.textContent);
  expect(items[0]).toContain("Oct 18, 2026");
  expect(items[1]).toContain("Oct 24, 2026");
});

it.each(["999", "abc", "01", "9007199254740993"])("unknown id %s shows not-found with a link back", async (id) => {
  params = { id };
  screenUnderTest();
  expect(await screen.findByText("Application not found.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to applications" }).getAttribute("href")).toBe("/applications");
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});

it("delete flow: confirm removes it, toasts, returns to the list", async () => {
  params = { id: "1" };
  search = "status=interviewing";
  screenUnderTest();
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  expect(await screen.findByText(/Pinagsama Tech, Frontend Engineer, and its interviews/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications?status=interviewing"));
  expect(screen.getByText("Application deleted.")).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole("list", { name: "Applications" })).toBeNull());
  expect(await screen.findByText("No applications with this status.")).toBeTruthy();
});

it("cancel keeps the application", async () => {
  params = { id: "1" };
  screenUnderTest();
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(replace).not.toHaveBeenCalled();
  expect((await rows()).length).toBe(5);
});

it("panes: separate screens below 1280, both from 1280", () => {
  expect(panes(false)).toEqual({ list: "", detail: "hidden xl:block" });
  expect(panes(true)).toEqual({ list: "hidden xl:block", detail: "" });
});

it("one delete = one deleteApplication call and one toast, also under StrictMode", async () => {
  params = { id: "1" };
  render(
    <StrictMode>
      <ToastProvider>
        <ApplicationsScreen>
          <ApplicationDetailPage />
        </ApplicationsScreen>
      </ToastProvider>
    </StrictMode>,
  );
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  expect(fake.callsTo("DELETE", /./)).toHaveLength(1);
  expect(screen.getAllByText("Application deleted.")).toHaveLength(1);
});

it("failed delete: error toast, dialog stays open, Cancel and Escape still work", async () => {
  params = { id: "1" };
  screenUnderTest();
  await screen.findByRole("list", { name: "Interviews" });
  const dialog = () => document.querySelector("dialog")!;
  fake.failNext("DELETE", /^\/applications\/1$/);
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  expect(await screen.findByText("Couldn't delete the application. Try again.")).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  expect(dialog().hasAttribute("open")).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Delete application" }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dialog().hasAttribute("open")).toBe(false);
  // reopen: Escape closes it too
  fake.failNext("DELETE", /^\/applications\/1$/);
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(screen.getAllByText("Couldn't delete the application. Try again.")).toHaveLength(2));
  await userEvent.keyboard("{Escape}");
  expect(dialog().hasAttribute("open")).toBe(false);
});

it("list fetch failure: alert with Retry, no endless skeleton; Retry recovers", async () => {
  fake.failNext("GET", /^\/applications\?/);
  screenUnderTest();
  const alert = await bannerWith("Couldn't load applications.");
  expect(screen.queryByText("Loading applications")).toBeNull();
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await rows()).toHaveLength(5);
  expect(screen.queryByText(/Couldn't load/)).toBeNull();
});

it("detail fetch failure: alert with Retry, no endless loading; Retry recovers", async () => {
  params = { id: "1" };
  fake.failNext("GET", /^\/applications\/1$/);
  screenUnderTest();
  const alert = await bannerWith("Couldn't load this application.");
  expect(screen.queryByText("Loading application")).toBeNull();
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("list", { name: "Interviews" })).toBeTruthy();
  expect(screen.queryByText(/Couldn't load/)).toBeNull();
});

it("interviews fetch failure keeps the application visible with an inline Retry", async () => {
  params = { id: "1" };
  fake.failNext("GET", /interviews/);
  screenUnderTest();
  const alert = await bannerWith("Couldn't load interviews.");
  expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Frontend Engineer" })).toBeTruthy();
  expect(screen.queryByText("Couldn't load this application.")).toBeNull();
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("list", { name: "Interviews" })).toBeTruthy();
  expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(1); // only interviews were refetched
});

it("Back to a deleted id shows loading then not-found, never the old content", async () => {
  params = { id: "1" };
  // A new element each time: React skips re-rendering an identical element, and the screen reads params in render.
  const tree = () => (
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationDetailPage />
      </ApplicationsScreen>
    </ToastProvider>
  );
  const { rerender } = render(tree());
  await screen.findByRole("heading", { name: "Details" });
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(replace).toHaveBeenCalled());
  params = {}; // router.replace to the list
  rerender(tree());
  params = { id: "1" }; // browser Back
  rerender(tree());
  expect(screen.queryByRole("heading", { name: "Details" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  expect(await screen.findByText("Application not found.")).toBeTruthy();
});

it("detail requests the application and its interviews together", async () => {
  params = { id: "1" };
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\/1$/, async () => (await gate, json(200, fake.db.apps[0])));
  screenUnderTest();
  // The application is still pending, yet interviews were already requested.
  await waitFor(() => expect(fake.callsTo("GET", /interviews/)).toHaveLength(1));
  release();
  expect(await screen.findByRole("list", { name: "Interviews" })).toBeTruthy();
});

it("Edit keeps ?status=", async () => {
  params = { id: "2" };
  search = "status=offered";
  screenUnderTest();
  await screen.findByRole("list", { name: "Interviews" });
  expect(screen.getAllByRole("link", { name: "Edit" })[0].getAttribute("href")).toBe("/applications/2/edit?status=offered");
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/applications?status=offered");
});
