// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
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
const actions = () => [screen.getAllByRole("button", { name: "Edit" }), screen.getAllByRole("button", { name: "Delete" })].flat();

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
  for (const b of actions()) expect((b as HTMLButtonElement).disabled).toBe(true);

  release();
  await waitFor(() => expect(screen.getAllByText("Renamed Co").length).toBeGreaterThan(0));
  expect(detailSection().getAttribute("aria-busy")).toBeNull();
  expect(screen.getAllByRole("link", { name: "Edit" }).length).toBeGreaterThan(0);
  expect((screen.getAllByRole("button", { name: "Delete" })[0] as HTMLButtonElement).disabled).toBe(false);
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

it("while the first load runs: aria-busy, and the live region says Loading application", async () => {
  mount();
  expect(detailSection().getAttribute("aria-busy")).toBe("true");
  expect(screen.getAllByRole("status")[0].textContent).toBe("Loading application");
  await screen.findByRole("list", { name: "Interviews" });
  expect(detailSection().getAttribute("aria-busy")).toBeNull();
});

it("a 404 on the application shows not-found even though interviews also 404", async () => {
  fake.db.apps = [];
  mount();
  expect(await screen.findByText("Application not found.")).toBeTruthy();
  expect(screen.queryByText("Couldn't load interviews.")).toBeNull();
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

it("delete: a server failure keeps the dialog open and the application", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  fake.failNext("DELETE", /^\/applications\/1$/);
  await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete application" }));
  expect(await screen.findByText("Couldn't delete the application. Try again.")).toBeTruthy();
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
  expect(replace).not.toHaveBeenCalled();
  expect(fake.db.apps.some((a) => a.id === 1)).toBe(true);
});

it("a mapping error (unknown status from the API) is the generic load error, not a crash", async () => {
  fake.on("GET", /^\/applications\/1$/, () => json(200, { ...fake.db.apps[0], status: "hired" }));
  mount();
  expect(await screen.findByText("Couldn't load this application.")).toBeTruthy();
});
