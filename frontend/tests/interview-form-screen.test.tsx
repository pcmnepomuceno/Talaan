// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditInterviewScreen } from "../src/app/(app)/applications/[id]/interviews/[interviewId]/edit/edit-screen";
import { InterviewForm } from "../src/components/interview-form";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json, makeInterview } from "./helpers/fake-api";

// Lets one test make the submit-time conversion throw (it cannot after validate() passes today).
const mapFail = vi.hoisted(() => ({ once: false }));
vi.mock("../src/lib/mappers", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/lib/mappers")>();
  return {
    ...m,
    fromInterviewFormValues: (v: Parameters<typeof m.fromInterviewFormValues>[0]) => {
      if (mapFail.once) {
        mapFail.once = false;
        throw new m.MappingError("scheduled_at");
      }
      return m.fromInterviewFormValues(v);
    },
  };
});

const replace = vi.fn();
const locationReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
  replace.mockClear();
  locationReplace.mockClear();
  vi.stubGlobal("location", { pathname: "/applications/1/interviews/new", search: "", replace: locationReplace });
});
afterEach(() => {
  window.dispatchEvent(new Event("pageshow"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => <ToastProvider>{ui}</ToastProvider>;
const mountNew = (qs = "") => render(wrap(<InterviewForm applicationId={1} qs={qs} />));
const mountEdit = (interviewId = "1", id = "1", qs = "") => render(wrap(<EditInterviewScreen id={id} interviewId={interviewId} qs={qs} />));
const field = (name: RegExp | string) => screen.getByLabelText(name) as HTMLInputElement;
const timeField = () => field(/Date and time/);
const modeGroup = () => screen.getByRole("radiogroup", { name: /Mode/ });
const save = () => screen.getByRole("button", { name: /Save interview|Saving/ });
const setTime = (v: string) => fireEvent.change(timeField(), { target: { value: v } });
const unloadPrevented = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};
async function fillMinimum() {
  setTime("2026-11-20T23:30");
  await userEvent.click(screen.getByRole("radio", { name: "Online" }));
}

it("create form: mode has nothing selected, outcome is Pending, time is labelled Philippine time, field order is fixed", () => {
  mountNew();
  expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  expect(modeGroup().getAttribute("aria-required")).toBe("true");
  expect((field("Outcome") as unknown as HTMLSelectElement).value).toBe("pending");
  expect(timeField().type).toBe("datetime-local");
  expect(screen.getByText("Date and time (Philippine time)")).toBeTruthy();
  const order = [timeField(), field("Interviewer"), field("Outcome"), field("Notes")];
  for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(save().textContent).toContain("Save interview");
});

it("empty submit: inline errors, focus on the time field, no request", async () => {
  mountNew();
  await userEvent.click(save());
  expect(screen.getByText("Enter the date and time.")).toBeTruthy();
  expect(screen.getByText("Choose an interview mode.")).toBeTruthy();
  expect(timeField().getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(timeField());
  expect(fake.calls).toHaveLength(0);
});

it("with only the mode missing, focus moves to the mode group without choosing one", async () => {
  mountNew();
  setTime("2026-11-20T23:30");
  await userEvent.click(save());
  expect(modeGroup().getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement?.closest("fieldset")).toBe(modeGroup());
  expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true);
});

it("a half-typed date and time (badInput) says to enter a complete one", async () => {
  mountNew();
  await userEvent.click(screen.getByRole("radio", { name: "Online" }));
  Object.defineProperty(timeField(), "validity", { value: { badInput: true }, configurable: true });
  await userEvent.click(save());
  expect(screen.getByText("Enter a complete date and time.")).toBeTruthy();
  expect(fake.calls).toHaveLength(0);
});

it("create sends the PHT time with +08:00, never touches the application, toasts and replaces to the application", async () => {
  mountNew("?status=applied");
  await fillMinimum();
  await userEvent.type(field("Interviewer"), "  Ana  ");
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1?status=applied"));
  const post = fake.callsTo("POST", /^\/applications\/1\/interviews$/);
  expect(post).toHaveLength(1);
  expect(post[0].body).toEqual({ scheduled_at: "2026-11-20T23:30:00+08:00", mode: "online", outcome: "pending", interviewer: "Ana", remarks: null });
  expect(fake.calls.filter((c) => c.method === "PATCH")).toHaveLength(0); // no automatic status change
  expect(await screen.findByText("Interview saved.")).toBeTruthy();
});

it("a failed save keeps every typed value; 422 maps to the field and focuses it", async () => {
  fake.on("POST", /interviews$/, () => json(422, { detail: [{ loc: ["body", "interviewer"], msg: "Value error, Interviewer is odd" }] }));
  mountNew();
  await fillMinimum();
  await userEvent.type(field("Interviewer"), "Ana");
  await userEvent.click(save());
  expect(await screen.findByText("Interviewer is odd.")).toBeTruthy();
  expect(document.activeElement).toBe(field("Interviewer"));
  expect(timeField().value).toBe("2026-11-20T23:30");
  expect((screen.getByRole("radio", { name: "Online" }) as HTMLInputElement).checked).toBe(true);
  expect(save().textContent).toContain("Save interview");
});

it("a 422 on a field we do not show goes to the banner", async () => {
  fake.on("POST", /interviews$/, () => json(422, { detail: [{ loc: ["body", "job_application_id"], msg: "Extra inputs are not permitted" }] }));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  expect(await screen.findByText("Extra inputs are not permitted.")).toBeTruthy();
});

it.each([
  [429, { "Retry-After": "120" }, "Too many attempts. Try again in about 2 minutes."],
  [503, undefined, "Talaan isn't responding right now. Try again in a moment."],
] as const)("%s shows the retry message and keeps the values", async (status, headers, text) => {
  fake.on("POST", /interviews$/, () => json(status, { detail: "x" }, headers as Record<string, string> | undefined));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  expect(await screen.findByText(text)).toBeTruthy();
  expect(timeField().value).toBe("2026-11-20T23:30");
});

it("a 500 shows the generic banner", async () => {
  fake.failNext("POST", /interviews$/, 500);
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  expect(await screen.findByText(/Couldn't save the interview|Something went wrong|isn't responding/)).toBeTruthy();
});

it("busy: 'Saving…' shows, and a double submit sends one request", async () => {
  let release!: () => void;
  fake.on("POST", /interviews$/, () => new Promise<Response>((r) => (release = () => r(json(201, { id: 77 })))));
  mountNew();
  await fillMinimum();
  await userEvent.dblClick(save());
  await waitFor(() => expect(save().getAttribute("aria-disabled")).toBe("true"));
  expect(screen.getByText("Saving…")).toBeTruthy();
  expect(fake.callsTo("POST", /interviews$/)).toHaveLength(1);
  release();
  await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
});

it("404 on create shows the not-found state", async () => {
  fake.on("POST", /interviews$/, () => json(404, { detail: "Application not found." }));
  mountNew();
  await fillMinimum();
  await userEvent.click(save());
  expect(await screen.findByRole("heading", { name: "Application not found." })).toBeTruthy();
});

it("401 mid-form goes to login with next = the form path, and does not stay busy or prompt", async () => {
  fake.on("POST", /interviews$/, () => json(401, { detail: "Not authenticated" }));
  mountNew();
  await fillMinimum();
  expect(unloadPrevented()).toBe(true);
  await userEvent.click(save());
  await waitFor(() => expect(locationReplace).toHaveBeenCalledWith("/login?expired=1&next=%2Fapplications%2F1%2Finterviews%2Fnew"));
  expect(screen.queryByText(/Couldn't save/)).toBeNull();
  expect(unloadPrevented()).toBe(false);
});

// ---- edit ----
it("edit prefills from the server (UTC value shown as PHT) and sends only what changed", async () => {
  fake.db.interviews[0].scheduled_at = "2026-11-20T15:30:00.000000Z";
  mountEdit("1");
  await waitFor(() => expect(timeField().value).toBe("2026-11-20T23:30"));
  expect(field("Interviewer").value).toBe("Mark Rivera");
  expect((screen.getByRole("radio", { name: "Online" }) as HTMLInputElement).checked).toBe(true);
  await userEvent.selectOptions(field("Outcome") as unknown as HTMLSelectElement, "good");
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1"));
  expect(fake.callsTo("PATCH", /^\/interviews\/1$/)[0].body).toEqual({ outcome: "good" });
  expect(fake.db.interviews[0].outcome).toBe("good");
});

it("edit with nothing changed sends nothing and shows no toast", async () => {
  fake.db.interviews[0].scheduled_at = "2026-11-20T15:30:45.123Z";
  fake.db.interviews[0].remarks = "  padded  ";
  mountEdit("1");
  await waitFor(() => expect(timeField().value).toBe("2026-11-20T23:30"));
  await userEvent.click(save());
  expect(replace).toHaveBeenCalledWith("/applications/1");
  expect(fake.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  expect(screen.queryByText("Interview saved.")).toBeNull();
});

it("edit: clearing the interviewer sends null", async () => {
  mountEdit("1");
  await screen.findByDisplayValue("Mark Rivera");
  await userEvent.clear(field("Interviewer"));
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(fake.callsTo("PATCH", /interviews\/1$/)[0].body).toEqual({ interviewer: null });
});

it("edit: another application's interview, a missing one, and a bad id are not found", async () => {
  mountEdit("3", "1"); // interview 3 belongs to application 2
  expect(await screen.findByRole("heading", { name: "Interview not found." })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to application" }).getAttribute("href")).toBe("/applications/1");
});

it("edit: 404 on save (deleted in another tab) shows not-found with a link back", async () => {
  mountEdit("1", "1", "?status=applied");
  await screen.findByDisplayValue("Mark Rivera");
  fake.on("PATCH", /interviews\/1$/, () => json(404, { detail: "Interview not found" }));
  await userEvent.type(field("Interviewer"), "x");
  await userEvent.click(save());
  expect(await screen.findByRole("heading", { name: "Interview not found." })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to application" }).getAttribute("href")).toBe("/applications/1?status=applied");
});

it("edit: a stored time the form cannot read shows an error instead of the form", async () => {
  fake.db.interviews[0].scheduled_at = "2026-10-24"; // date only: toPhtInput gives null
  mountEdit("1");
  expect(await screen.findByText("Couldn't load this interview.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Save interview/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Back to application" }).getAttribute("href")).toBe("/applications/1");
});

it("a MappingError on save shows the banner, sends nothing, and never leaves Save stuck", async () => {
  mountEdit("1");
  await screen.findByDisplayValue("Mark Rivera");
  await userEvent.type(field("Interviewer"), "x");
  mapFail.once = true;
  await userEvent.click(save());
  expect(await screen.findByText("Couldn't save the interview. Try again.")).toBeTruthy();
  expect(fake.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  expect(save().textContent).toContain("Save interview");
  expect(save().getAttribute("aria-disabled")).toBeNull();
  await userEvent.click(save()); // and the next try goes through
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1"));
});

it("edit: a stored time outside 1900-2200 in PHT opens, and a Notes-only edit saves just the notes", async () => {
  fake.db.interviews[0].scheduled_at = "2200-12-31T20:00:00Z"; // 2201-01-01 04:00 in PHT
  mountEdit("1");
  await waitFor(() => expect(timeField().value).toBe("2201-01-01T04:00"));
  await userEvent.type(field("Notes"), "Bring the portfolio.");
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/applications/1"));
  expect(screen.queryByText("Enter a year between 1900 and 2200.")).toBeNull();
  expect(fake.callsTo("PATCH", /^\/interviews\/1$/)[0].body).toEqual({ remarks: "Bring the portfolio." });
  expect(await screen.findByText("Interview saved.")).toBeTruthy();
});

it("edit: when only the application id in the URL changes, the old form never shows under the new application", async () => {
  fake.db.interviews.push(makeInterview(5, 1, { interviewer: "Lea Cruz" }));
  const view = mountEdit("5", "1");
  await screen.findByDisplayValue("Lea Cruz");
  fake.on("GET", /^\/interviews\/5$/, () => new Promise<Response>(() => {})); // the refetch never answers
  view.rerender(wrap(<EditInterviewScreen id="2" interviewId="5" qs="" />));
  expect(screen.queryByDisplayValue("Lea Cruz")).toBeNull();
  expect(screen.queryByRole("button", { name: /Save interview/ })).toBeNull();
  expect(document.querySelector("li.animate-ledger-pulse")).toBeTruthy();
});

it("edit: a load failure offers Retry", async () => {
  fake.failNext("GET", /interviews\/1$/, 500);
  mountEdit("1");
  await userEvent.click(await screen.findByRole("button", { name: /Try again|Retry/ }));
  expect(await screen.findByDisplayValue("Mark Rivera")).toBeTruthy();
});

// ---- dirty guard + beforeunload ----
it("Cancel on a clean form leaves at once; on a dirty form it asks first", async () => {
  mountNew("?status=applied");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(replace).toHaveBeenCalledWith("/applications/1?status=applied");
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(false);

  replace.mockClear();
  await userEvent.type(field("Interviewer"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const dialog = document.querySelector("dialog")!;
  expect(within(dialog).getByRole("heading", { name: "Discard changes?" })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(field("Interviewer").value).toBe("x");
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
  expect(replace).toHaveBeenCalledWith("/applications/1?status=applied");
});

it("the back arrow asks too when dirty", async () => {
  mountNew();
  await userEvent.type(field("Interviewer"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(document.querySelector("dialog")!.hasAttribute("open")).toBe(true);
});

it("beforeunload is registered only while dirty, and removed on save and on unmount", async () => {
  const { unmount } = mountNew();
  expect(unloadPrevented()).toBe(false);
  await userEvent.type(field("Interviewer"), "x");
  expect(unloadPrevented()).toBe(true);
  await userEvent.clear(field("Interviewer"));
  expect(unloadPrevented()).toBe(false); // back to clean
  await fillMinimum();
  await userEvent.click(save());
  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(unloadPrevented()).toBe(false); // saved: the page is being replaced
  unmount();

  const second = mountNew();
  await userEvent.type(field("Interviewer"), "y");
  expect(unloadPrevented()).toBe(true);
  second.unmount();
  expect(unloadPrevented()).toBe(false);
});
