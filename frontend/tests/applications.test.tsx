// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen, panes } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import * as api from "../src/lib/api";
import { deleteApplication, resetMock } from "../src/lib/api";

const push = vi.fn();
const replace = vi.fn();
let params: { id?: string } = {};
let search = "";
vi.mock("../src/lib/api", async (orig) => {
  const real = await orig<typeof import("../src/lib/api")>();
  return { ...real, deleteApplication: vi.fn(real.deleteApplication) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

beforeEach(() => {
  resetMock();
  push.mockClear();
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
  for (const id of [1, 2, 3, 4, 5]) await deleteApplication(id);
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

it.each(["999", "abc"])("unknown id %s shows not-found with a link back", async (id) => {
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
  await waitFor(() => expect(push).toHaveBeenCalledWith("/applications?status=interviewing"));
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
  expect(push).not.toHaveBeenCalled();
  expect((await rows()).length).toBe(5);
});

it("panes: separate screens below 1280, both from 1280", () => {
  expect(panes(false)).toEqual({ list: "", detail: "hidden xl:block" });
  expect(panes(true)).toEqual({ list: "hidden xl:block", detail: "" });
});

it("one delete = one deleteApplication call and one toast, also under StrictMode", async () => {
  params = { id: "1" };
  vi.mocked(api.deleteApplication).mockClear();
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
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(api.deleteApplication).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("Application deleted.")).toHaveLength(1);
});

it("failed delete: error toast, dialog stays open, Cancel and Escape still work", async () => {
  params = { id: "1" };
  screenUnderTest();
  await screen.findByRole("list", { name: "Interviews" });
  const dialog = () => document.querySelector("dialog")!;
  vi.mocked(api.deleteApplication).mockRejectedValueOnce(new Error("500"));
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  expect(await screen.findByText("Couldn't delete the application. Try again.")).toBeTruthy();
  expect(push).not.toHaveBeenCalled();
  expect(dialog().hasAttribute("open")).toBe(true);
  expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Delete application" }) as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(dialog().hasAttribute("open")).toBe(false);
  // reopen: Escape closes it too
  vi.mocked(api.deleteApplication).mockRejectedValueOnce(new Error("500"));
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  await waitFor(() => expect(screen.getAllByText("Couldn't delete the application. Try again.")).toHaveLength(2));
  await userEvent.keyboard("{Escape}");
  expect(dialog().hasAttribute("open")).toBe(false);
});
