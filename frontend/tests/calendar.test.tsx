// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { AddToCalendar, CalendarGuide } from "../src/components/calendar";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import type { AgendaInterview } from "../src/lib/types";
import { type Fake, installFake, makeInterview } from "./helpers/fake-api";

let paramId = "1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: paramId }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => `/applications/${paramId}`,
}));

const iv = (rest: Partial<AgendaInterview> = {}): AgendaInterview => ({
  ...makeInterview(7, 12, { scheduled_at: "2099-03-10T14:00:00+08:00", interviewer: "Ana Santos", remarks: "PRIVATE NOTES" }),
  company: "Pinagsama Tech",
  job_name: "Frontend Engineer",
  ...rest,
});

let blobs: { parts: unknown[]; type?: string }[];
let anchors: { download: string; href: string }[];
let revoked: string[];
beforeEach(() => {
  clearCaches();
  paramId = "1";
  blobs = [];
  anchors = [];
  revoked = [];
  vi.stubGlobal(
    "Blob",
    class {
      constructor(parts: unknown[], opts?: { type?: string }) {
        blobs.push({ parts, type: opts?.type });
      }
    },
  );
  URL.createObjectURL = vi.fn(() => `blob:talaan-${blobs.length}`);
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const withToasts = (ui: React.ReactNode) => <ToastProvider>{ui}</ToastProvider>;
const NAME = /^Add to calendar, Pinagsama Tech, Mar 10, 2099, 2:00 PM PHT$/;

it("the action is a button whose name has the company and the PHT date and time", () => {
  render(withToasts(<AddToCalendar interview={iv()} />));
  const b = screen.getByRole("button", { name: NAME });
  expect(b.textContent).toBe("Add to calendar");
  expect(b.className).toContain("min-h-11"); // the 44px target
});

it("download: a text/calendar Blob with the file, an anchor with the file name, then a toast", async () => {
  render(withToasts(<AddToCalendar interview={iv()} />));
  await userEvent.click(screen.getByRole("button", { name: NAME }));
  expect(blobs).toHaveLength(1);
  expect(blobs[0].type).toBe("text/calendar;charset=utf-8");
  const text = String(blobs[0].parts[0]);
  expect(text).toContain("BEGIN:VCALENDAR\r\n");
  expect(text).toContain("UID:talaan-interview-7@talaan\r\n");
  expect(text).toContain("DTSTART:20990310T060000Z\r\n");
  expect(text).not.toContain("PRIVATE NOTES");
  expect(text).toContain(`/applications/12`); // the link back to the application
  expect(anchors).toEqual([{ download: "talaan-interview-pinagsama-tech-2099-03-10.ics", href: "blob:talaan-1" }]);
  expect(await screen.findByText("Calendar file downloaded.")).toBeTruthy();
});

it("the object URL is revoked after the click, not before it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  render(withToasts(<AddToCalendar interview={iv()} />));
  await act(async () => screen.getByRole("button", { name: NAME }).click());
  expect(anchors).toHaveLength(1);
  expect(revoked).toEqual([]);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(revoked).toEqual(["blob:talaan-1"]);
});

it("pressing twice quickly downloads twice (same UID, so a calendar sees one event) and revokes both URLs", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  render(withToasts(<AddToCalendar interview={iv()} />));
  const b = screen.getByRole("button", { name: NAME });
  await act(async () => {
    b.click();
    b.click();
  });
  expect(anchors).toHaveLength(2);
  expect(screen.getAllByText("Calendar file downloaded.")).toHaveLength(2);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(revoked).toHaveLength(2);
});

it("offers nothing for a date it cannot read", () => {
  render(withToasts(<AddToCalendar interview={iv({ scheduled_at: "nope" })} />));
  expect(screen.queryByRole("button")).toBeNull();
});

function Detail() {
  return withToasts(
    <ApplicationsScreen>
      <ApplicationDetailPage />
    </ApplicationsScreen>,
  );
}

it("the detail offers Add to calendar on upcoming interviews only, and the guide once under the list", async () => {
  const fake: Fake = installFake();
  fake.db.interviews.push(makeInterview(9, 1, { scheduled_at: "2099-03-10T14:00:00+08:00" }));
  render(<Detail />);
  const list = await screen.findByRole("list", { name: "Interviews" });
  const buttons = within(list).getAllByRole("button", { name: /^Add to calendar/ });
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Add to calendar, Pinagsama Tech, Mar 10, 2099, 2:00 PM PHT"]);
  expect(screen.getAllByRole("button", { name: "How to add this to your calendar" })).toHaveLength(1);
  await userEvent.click(buttons[0]);
  expect(String(blobs[0].parts[0])).toContain("SUMMARY:Interview: Frontend Engineer at Pinagsama Tech");
  expect(anchors[0].download).toBe("talaan-interview-pinagsama-tech-2099-03-10.ics");
});

it("the detail with only past interviews has neither the action nor the guide", async () => {
  installFake();
  render(<Detail />);
  await screen.findByRole("list", { name: "Interviews" });
  expect(screen.queryByRole("button", { name: /Add to calendar/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "How to add this to your calendar" })).toBeNull();
});

// ---- the guide ----
const open = async () => {
  render(<CalendarGuide />);
  const trigger = screen.getByRole("button", { name: "How to add this to your calendar" });
  await userEvent.click(trigger);
  return { trigger, dialog: screen.getByRole("dialog", { name: "How to add this to your calendar" }) };
};

it("opens with the one-time-copy line first, then one list per calendar app", async () => {
  const { dialog } = await open();
  const text = dialog.textContent!;
  expect(text.indexOf("one-time copy")).toBeGreaterThan(-1);
  expect(text).toMatch(/download a new file and delete the old event in your calendar first/);
  for (const h of ["Google Calendar", "Apple Calendar on a Mac", "Outlook on the web", "Outlook for Windows (classic)"]) {
    expect(within(dialog).getByRole("heading", { name: h, level: 3 })).toBeTruthy();
  }
  expect(text.indexOf("one-time copy")).toBeLessThan(text.indexOf("Google Calendar"));
  expect(dialog.querySelectorAll("ol").length).toBe(4);
  const google = within(dialog).getByRole("heading", { name: "Google Calendar" }).nextElementSibling!;
  expect(google.tagName).toBe("OL");
  expect(google.querySelectorAll("li")).toHaveLength(6);
});

it("is plain: no exclamation marks and no emoji", async () => {
  const { dialog } = await open();
  expect(dialog.textContent).not.toMatch(/!/);
  expect(dialog.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
});

it("starts on the title (a long body must not open scrolled to the bottom), and has one Secondary Close", async () => {
  const { dialog } = await open();
  expect(document.activeElement).toBe(within(dialog).getByRole("heading", { name: "How to add this to your calendar", level: 2 }));
  const close = within(dialog).getAllByRole("button", { name: "Close" });
  expect(close).toHaveLength(1);
  expect(close[0].className).toContain("border-border-input");
});

it("Close closes it and focus returns to the trigger", async () => {
  const { trigger } = await open();
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("Escape closes it and focus returns to the trigger", async () => {
  const { trigger } = await open();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("can be opened again after closing", async () => {
  const { trigger } = await open();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "How to add this to your calendar" })).toBeTruthy();
});
