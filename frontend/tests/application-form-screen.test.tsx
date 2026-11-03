// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditScreen } from "../src/app/(app)/applications/[id]/edit/edit-screen";
import { ApplicationForm } from "../src/components/application-form";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json } from "./helpers/fake-api";

const replace = vi.fn();
const locationReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  replace.mockClear();
  locationReplace.mockClear();
  vi.stubGlobal("location", { pathname: "/applications/1/edit", search: "", replace: locationReplace });
});
afterEach(() => {
  window.dispatchEvent(new Event("pageshow")); // a page shown again is no longer leaving (http.ts)
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => <ToastProvider>{ui}</ToastProvider>;
const mountNew = (qs = "") => render(wrap(<ApplicationForm qs={qs} />));
const mountEdit = (id = "1", qs = "") => render(wrap(<EditScreen id={id} qs={qs} />));
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const modeGroup = () => screen.getByRole("radiogroup", { name: /Work mode/ });
const save = () => screen.getByRole("button", { name: /Save application|Saving/ });
async function fillMinimum() {
  await userEvent.type(field("Job title"), "Dev");
  await userEvent.type(field("Company"), "Acme");
  await userEvent.click(screen.getByRole("radio", { name: "Remote" }));
}

it("create form: status defaults to Saved, work mode has nothing selected, field order is fixed", () => {
  mountNew();
  expect((field("Status") as unknown as HTMLSelectElement).value).toBe("saved");
  expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  expect(modeGroup().getAttribute("aria-required")).toBe("true");
  const order = ["Job title", "Company", "Status", "Date applied", "Monthly gross salary (PHP)", "Company website", "Notes"].map((l) => field(l));
  for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByLabelText(/email/i)).toBeNull();
});

it("empty submit: inline errors, aria wiring, focus on the first invalid field, no request", async () => {
  mountNew();
  await userEvent.click(save());
  const job = field("Job title");
  expect(screen.getByText("Enter a job title.")).toBeTruthy();
  expect(screen.getByText("Enter a company name.")).toBeTruthy();
  expect(screen.getByText("Choose a work mode.")).toBeTruthy();
  expect(job.getAttribute("aria-invalid")).toBe("true");
  expect(job.getAttribute("aria-describedby")).toContain(`${job.id}-error`);
  expect(document.activeElement).toBe(job);
  expect(fake.calls).toHaveLength(0);
});

it("with only the work mode missing, focus moves to the work mode group", async () => {
  mountNew();
  await userEvent.type(field("Job title"), "Dev");
  await userEvent.type(field("Company"), "Acme");
  await userEvent.click(save());
  expect(modeGroup().getAttribute("aria-invalid")).toBe("true");
  expect(modeGroup().getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText("Choose a work mode.")).toBeTruthy();
  expect(document.activeElement?.closest("fieldset")).toBe(modeGroup());
  // focusing the group did not choose a mode
  expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  await userEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
  expect(screen.queryByText("Choose a work mode.")).toBeNull();
});

it("typing into a field clears its error", async () => {
  mountNew();
  await userEvent.click(save());
  await userEvent.type(field("Job title"), "x");
  expect(screen.queryByText("Enter a job title.")).toBeNull();
  expect(screen.getByText("Enter a company name.")).toBeTruthy();
});

it("every other rule shows inline: website, salary, notes length, name length", async () => {
  mountNew();
  await fillMinimum();
  await userEvent.type(field("Company website"), "example.com");
  await userEvent.type(field("Monthly gross salary (PHP)"), "1.5");
  await userEvent.click(save());
  expect(screen.getByText("Enter a full address starting with http:// or https://")).toBeTruthy();
  expect(screen.getByText("Enter a whole number, 0 or more.")).toBeTruthy();
  expect(document.activeElement).toBe(field("Monthly gross salary (PHP)")); // salary comes before website
  expect(fake.calls).toHaveLength(0);
});

it("salary: pasted 85,000 becomes 85000; -5 is rejected on submit; 0 is sent as 0; empty as null", async () => {
  mountNew();
  await fillMinimum();
  const salary = field("Monthly gross salary (PHP)");
  expect(salary.getAttribute("inputmode")).toBe("numeric");
  await userEvent.click(salary);
  await userEvent.paste("85,000");
  expect(salary.value).toBe("85000");
  await userEvent.clear(salary);
  await userEvent.type(salary, "-5");
  await userEvent.click(save());
  expect(screen.getByText("Enter a whole number, 0 or more.")).toBeTruthy();
  await userEvent.clear(salary);
  await userEvent.type(salary, "0");
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(fake.callsTo("POST", /./)[0].body).toMatchObject({ salary: 0 });
});

it("maxLength is 2x the limit, never the exact limit", () => {
  mountNew();
  expect(field("Job title").maxLength).toBe(400);
  expect(field("Company website").maxLength).toBe(4000);
  expect(field("Notes").maxLength).toBe(10000);
});

it("create: trims, sends exactly the form fields, toasts, and replaces to the detail keeping ?status=", async () => {
  mountNew("?status=saved");
  await userEvent.type(field("Job title"), "  Développeur 🚀  ");
  await userEvent.type(field("Company"), " 株式会社 ");
  await userEvent.type(field("Notes"), "   ");
  await userEvent.click(screen.getByRole("radio", { name: "Hybrid" }));
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1000?status=saved"));
  expect(replace).toHaveBeenCalledTimes(1);
  expect(fake.callsTo("POST", /./)[0].body).toEqual({
    company: "株式会社",
    job_name: "Développeur 🚀",
    status: "saved",
    mode_of_work: "hybrid",
    date_applied: null,
    salary: null,
    contact_website: null,
    remarks: null,
  });
  expect(screen.getByText("Application saved.")).toBeTruthy();
});

it("date helper follows the status", async () => {
  mountNew();
  expect(screen.getByText("Leave blank if you haven't applied.")).toBeTruthy();
  await userEvent.selectOptions(field("Status"), "applied");
  expect(screen.getByText("Leave blank to use today's date.")).toBeTruthy();
});

it("slow save: Saving…, one request on a double click, nothing is cleared, no size change in the label cell", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("POST", /^\/applications$/, async () => (await gate, json(201, { ...fake.db.apps[0], id: 77 })));
  mountNew();
  await fillMinimum();
  await userEvent.dblClick(save());
  expect(fake.callsTo("POST", /./)).toHaveLength(1);
  expect(save().getAttribute("aria-disabled")).toBe("true");
  expect(within(save()).getByText("Saving…")).toBeTruthy();
  expect(within(save()).getByText("Save application")).toBeTruthy(); // still rendered: sizes the button
  expect(field("Job title").value).toBe("Dev");
  release();
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/77"));
});

it("a failed save keeps every typed value; 422 maps to the field and focuses it", async () => {
  fake.on("POST", /^\/applications$/, () => json(422, { detail: [{ loc: ["body", "company"], msg: "Value error, Company already used" }] }));
  mountNew();
  await fillMinimum();
  await userEvent.type(field("Notes"), "keep me");
  await userEvent.click(save());
  expect(await screen.findByText("Company already used.")).toBeTruthy();
  expect(document.activeElement).toBe(field("Company"));
  expect(field("Job title").value).toBe("Dev");
  expect(field("Notes").value).toBe("keep me");
  expect((screen.getByRole("radio", { name: "Remote" }) as HTMLInputElement).checked).toBe(true);
  expect(save().getAttribute("aria-disabled")).toBeNull(); // can retry
  expect(replace).not.toHaveBeenCalled();
});

it("a 422 on a field we do not show goes to the banner", async () => {
  fake.on("POST", /^\/applications$/, () => json(422, { detail: [{ loc: ["body", "contact_email"], msg: "value is not a valid email address" }] }));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  const banner = (await screen.findByText("Value is not a valid email address.")).closest('[role="alert"]');
  expect(banner).toBeTruthy();
});

it.each([
  [500, {}, "Talaan isn't responding right now. Try again in a moment."],
  [503, {}, "Talaan isn't responding right now. Try again in a moment."],
  [429, { "Retry-After": "120" }, "Too many attempts. Try again in about 2 minutes."],
  [403, {}, "This request was blocked. Reload the page and try again."],
  [409, {}, "Couldn't save the application. Try again."],
])("status %s shows a banner and keeps the form", async (status, headers, text) => {
  fake.on("POST", /^\/applications$/, () => json(status, { detail: "x" }, headers));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  const alert = (await screen.findByText(text)).closest('[role="alert"]');
  expect(alert).toBeTruthy();
  expect(field("Job title").value).toBe("Dev");
});

it("network failure shows the retry message", async () => {
  fake.spy.mockRejectedValueOnce(new TypeError("offline"));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  expect(await screen.findByText("Talaan isn't responding right now. Try again in a moment.")).toBeTruthy();
});

it("401 mid-form goes to the login page with next pointing back at the edit page", async () => {
  fake.on("PATCH", /./, () => json(401, { detail: "Not authenticated" }));
  mountEdit("1");
  await screen.findByDisplayValue("Frontend Engineer");
  await userEvent.type(field("Company"), " Ltd");
  await userEvent.click(save());
  await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login?expired=1&next=%2Fapplications%2F1%2Fedit"));
  expect(screen.queryByText(/Couldn't save/)).toBeNull();
});

it("401 on a dirty form: the beforeunload prompt stays out of the login redirect", async () => {
  fake.on("PATCH", /./, () => json(401, { detail: "Not authenticated" }));
  mountEdit("1");
  await screen.findByDisplayValue("Frontend Engineer");
  await userEvent.type(field("Company"), " Ltd");
  expect(unloadPrevented()).toBe(true); // dirty: reload and tab close are guarded
  await userEvent.click(save());
  await waitFor(() => expect(locationReplace).toHaveBeenCalled());
  // The redirect's unload must not prompt: a "Stay" would leave the form saving forever, with
  // Cancel and Back disabled. With no prompt the page always leaves, so nothing can be stuck.
  expect(unloadPrevented()).toBe(false);
});

// ---- dirty guard ----
it("Cancel on a clean form leaves at once, no dialog", async () => {
  mountNew("?status=applied");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(replace).toHaveBeenCalledWith("/applications?status=applied");
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(false);
});

it("Cancel on a dirty form asks first; Keep editing stays, Discard leaves", async () => {
  mountNew();
  await userEvent.type(field("Job title"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const dialog = document.querySelector("dialog")!;
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(within(dialog).getByRole("heading", { name: "Discard changes?" })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(dialog.hasAttribute("open")).toBe(false);
  expect(field("Job title").value).toBe("x");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
  expect(replace).toHaveBeenCalledWith("/applications");
});

it("the app-bar back arrow is guarded the same way", async () => {
  mountNew();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(replace).toHaveBeenCalledWith("/applications"); // clean: straight back
  replace.mockClear();
  await userEvent.type(field("Job title"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
  expect(replace).not.toHaveBeenCalled();
});

it("changing a value back to the original is clean again", async () => {
  mountNew();
  await userEvent.type(field("Job title"), "x");
  await userEvent.clear(field("Job title"));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(replace).toHaveBeenCalledWith("/applications");
});

// ---- beforeunload ----
const unloadPrevented = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

it("beforeunload is registered only while dirty, and removed on unmount", async () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { unmount } = mountNew();
  expect(add.mock.calls.filter(([t]) => t === "beforeunload")).toHaveLength(0);
  expect(unloadPrevented()).toBe(false);
  await userEvent.type(field("Job title"), "x");
  expect(add.mock.calls.filter(([t]) => t === "beforeunload")).toHaveLength(1);
  expect(unloadPrevented()).toBe(true);
  await userEvent.clear(field("Job title")); // clean again: removed
  expect(unloadPrevented()).toBe(false);
  await userEvent.type(field("Job title"), "y");
  expect(unloadPrevented()).toBe(true);
  unmount();
  expect(remove.mock.calls.filter(([t]) => t === "beforeunload").length).toBeGreaterThan(0);
  expect(unloadPrevented()).toBe(false);
});

it("beforeunload is removed after a successful save", async () => {
  mountNew();
  await fillMinimum();
  expect(unloadPrevented()).toBe(true);
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(unloadPrevented()).toBe(false);
});

it("beforeunload stays while a failed save leaves the form dirty", async () => {
  fake.failNext("POST", /^\/applications$/);
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  await screen.findByText("Talaan isn't responding right now. Try again in a moment.");
  expect(unloadPrevented()).toBe(true);
});

// ---- edit ----
it("edit pre-fills from the server, with the stored work mode selected", async () => {
  mountEdit("1");
  expect(await screen.findByDisplayValue("Frontend Engineer")).toBeTruthy();
  expect(field("Company").value).toBe("Pinagsama Tech");
  expect((field("Status") as unknown as HTMLSelectElement).value).toBe("interviewing");
  expect(field("Date applied").value).toBe("2026-10-14");
  expect(field("Monthly gross salary (PHP)").value).toBe("85000");
  expect(field("Company website").value).toBe("https://pinagsama.example.ph");
  expect(field("Notes").value).toBe("Referred by a former teammate.");
  expect((screen.getByRole("radio", { name: "Hybrid" }) as HTMLInputElement).checked).toBe(true);
});

it("edit reloads correctly: a fresh mount refetches and shows the server's current data", async () => {
  const first = mountEdit("1");
  await screen.findByDisplayValue("Pinagsama Tech");
  first.unmount();
  fake.db.apps[0].company = "Changed Elsewhere";
  mountEdit("1");
  expect(await screen.findByDisplayValue("Changed Elsewhere")).toBeTruthy();
  expect(fake.callsTo("GET", /^\/applications\/1$/)).toHaveLength(2);
});

it("edit sends only the changed fields, toasts, and replaces to the detail with ?status=", async () => {
  mountEdit("1", "?status=interviewing");
  await screen.findByDisplayValue("Pinagsama Tech");
  await userEvent.selectOptions(field("Status"), "offered");
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1?status=interviewing"));
  expect(fake.callsTo("PATCH", /./)[0].body).toEqual({ status: "offered" });
  expect(screen.getByText("Application saved.")).toBeTruthy();
});

it("edit: clearing a nullable field sends null", async () => {
  mountEdit("1");
  await screen.findByDisplayValue("Pinagsama Tech");
  await userEvent.clear(field("Monthly gross salary (PHP)"));
  await userEvent.clear(field("Notes"));
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(fake.callsTo("PATCH", /./)[0].body).toEqual({ salary: null, remarks: null });
});

it("edit with no changes: no request, no toast, just back", async () => {
  mountEdit("1", "?status=interviewing");
  await screen.findByDisplayValue("Pinagsama Tech");
  await userEvent.click(save());
  expect(replace).toHaveBeenCalledWith("/applications/1?status=interviewing");
  expect(fake.callsTo("PATCH", /./)).toHaveLength(0);
  expect(screen.queryByText("Application saved.")).toBeNull();
});

it("edit whitespace-only changes count as no changes", async () => {
  mountEdit("1");
  await screen.findByDisplayValue("Pinagsama Tech");
  await userEvent.type(field("Company"), "   ");
  await userEvent.click(save());
  expect(fake.callsTo("PATCH", /./)).toHaveLength(0);
});

it.each(["999", "abc", "01"])("edit of unknown id %s shows not-found", async (id) => {
  mountEdit(id);
  expect(await screen.findByText("Application not found.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save application" })).toBeNull();
});

it("edit load failure shows Retry, which recovers", async () => {
  fake.failNext("GET", /^\/applications\/1$/);
  mountEdit("1");
  const alert = (await screen.findByText("Couldn't load this application.")).closest<HTMLElement>('[role="alert"]')!;
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByDisplayValue("Pinagsama Tech")).toBeTruthy();
});

it("saving an application that was deleted meanwhile shows not-found", async () => {
  mountEdit("1");
  await screen.findByDisplayValue("Pinagsama Tech");
  fake.db.apps = fake.db.apps.filter((a) => a.id !== 1);
  await userEvent.type(field("Company"), " Ltd");
  await userEvent.click(save());
  expect(await screen.findByText("Application not found.")).toBeTruthy();
});
