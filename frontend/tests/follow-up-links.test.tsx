// @vitest-environment jsdom
// Amendment A2: ?status=follow_up survives every back, cancel and redirect link, and is never used as
// a status value (the new-application form still starts at its default status).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import EditApplicationPage from "../src/app/(app)/applications/[id]/edit/page";
import EditInterviewPage from "../src/app/(app)/applications/[id]/interviews/[interviewId]/edit/page";
import NewInterviewPage from "../src/app/(app)/applications/[id]/interviews/new/page";
import NewApplicationPage from "../src/app/(app)/applications/new/page";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json } from "./helpers/fake-api";

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
  vi.stubGlobal("location", { pathname: "/applications/1", search: "", replace: vi.fn() });
});
afterEach(() => {
  window.dispatchEvent(new Event("pageshow"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const FU = "?status=follow_up";
const sp = (status?: string) => Promise.resolve({ status });
const wrap = (ui: React.ReactNode) => <ToastProvider>{ui}</ToastProvider>;
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const cancel = () => userEvent.click(screen.getByRole("button", { name: "Cancel" }));
const save = (name: RegExp) => userEvent.click(screen.getByRole("button", { name }));

it("new application: the status select starts at its default, never from ?status=follow_up", async () => {
  render(wrap(await NewApplicationPage({ searchParams: sp("follow_up") })));
  expect((field("Status") as unknown as HTMLSelectElement).value).toBe("saved");
  await userEvent.type(field("Job title"), "Dev");
  await userEvent.type(field("Company"), "Acme");
  await userEvent.click(screen.getByRole("radio", { name: "Remote" }));
  await save(/Save application/);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/applications/1000${FU}`));
  expect((fake.callsTo("POST", /^\/applications$/)[0].body as { status: string }).status).toBe("saved");
});

it("new application: cancel returns to the follow-up list", async () => {
  render(wrap(await NewApplicationPage({ searchParams: sp("follow_up") })));
  await cancel();
  expect(replace).toHaveBeenCalledWith(`/applications${FU}`);
});

it("edit application: cancel and the save redirect keep ?status=follow_up", async () => {
  render(wrap(await EditApplicationPage({ params: Promise.resolve({ id: "1" }), searchParams: sp("follow_up") })));
  await screen.findByDisplayValue("Pinagsama Tech");
  await cancel();
  expect(replace).toHaveBeenCalledWith(`/applications/1${FU}`);
  replace.mockClear();
  await userEvent.type(field("Company"), " Ltd");
  await save(/Save application/);
  await waitFor(() => expect(replace).toHaveBeenCalledWith(`/applications/1${FU}`));
});

it("edit application of a missing id: both links keep ?status=follow_up", async () => {
  render(wrap(await EditApplicationPage({ params: Promise.resolve({ id: "999" }), searchParams: sp("follow_up") })));
  await screen.findByText("Application not found.");
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe(`/applications/999${FU}`);
  expect(screen.getByRole("link", { name: "Back to applications" }).getAttribute("href")).toBe(`/applications${FU}`);
});

it("new interview: cancel and the save redirect keep ?status=follow_up; a missing application too", async () => {
  render(wrap(await NewInterviewPage({ params: Promise.resolve({ id: "1" }), searchParams: sp("follow_up") })));
  await screen.findByLabelText(/Date and time/);
  await cancel();
  expect(replace).toHaveBeenCalledWith(`/applications/1${FU}`);
});

it("new interview of a missing application: Back and the not-found link keep ?status=follow_up", async () => {
  render(wrap(await NewInterviewPage({ params: Promise.resolve({ id: "999" }), searchParams: sp("follow_up") })));
  await screen.findByRole("heading", { name: "Application not found." });
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe(`/applications/999${FU}`);
  expect(screen.getByRole("link", { name: "Back to applications" }).getAttribute("href")).toBe(`/applications${FU}`);
});

it("edit interview: cancel keeps ?status=follow_up", async () => {
  render(wrap(await EditInterviewPage({ params: Promise.resolve({ id: "1", interviewId: "1" }), searchParams: sp("follow_up") })));
  await screen.findByLabelText(/Date and time/);
  await cancel();
  expect(replace).toHaveBeenCalledWith(`/applications/1${FU}`);
});

it("a junk filter is dropped from the links", async () => {
  render(wrap(await NewApplicationPage({ searchParams: sp("follow_up,x") })));
  await cancel();
  expect(replace).toHaveBeenCalledWith("/applications");
});

// ---- the ledger screen: list rows, add, and the detail's interview links ----
const followRows = () =>
  fake.on(
    "GET",
    /follow_up=true/,
    () => json(200, { items: [{ ...fake.db.apps[0], idle_days: 12, last_activity: "applied" }], total: 1, limit: 50, offset: 0 }),
    false,
  );

it("list screen on ?status=follow_up: row and add links keep the filter", async () => {
  search = "status=follow_up";
  followRows();
  render(wrap(<ApplicationsScreen>{null}</ApplicationsScreen>));
  const list = await screen.findByRole("list", { name: "Applications" });
  expect(list.querySelector("a")!.getAttribute("href")).toBe(`/applications/1${FU}`);
  expect(screen.getAllByRole("link", { name: "Add application" })[0].getAttribute("href")).toBe(`/applications/new${FU}`);
  expect(fake.calls[0].path).toBe("/applications?limit=50&offset=0&follow_up=true");
});

it("detail on ?status=follow_up: the add-interview and edit links keep the filter", async () => {
  search = "status=follow_up";
  followRows();
  render(wrap(<ApplicationsScreen><ApplicationDetailPage /></ApplicationsScreen>));
  await screen.findByRole("list", { name: "Interviews" });
  const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
  expect(hrefs).toContain(`/applications/1/interviews/new${FU}`);
  expect(hrefs).toContain(`/applications/1/interviews/1/edit${FU}`);
  expect(hrefs).toContain(`/applications/1/edit${FU}`);
});
