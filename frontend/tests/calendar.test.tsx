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

// Every object URL is unique across tests: the component revokes 1 s after the click on a REAL timer,
// and one still pending from an earlier test must not be counted by a later one (seen under load).
let seq = 0;
let mine: string[];
let blobs: { parts: unknown[]; type?: string }[];
let anchors: { download: string; href: string }[];
let revoked: string[];
beforeEach(() => {
  clearCaches();
  paramId = "1";
  blobs = [];
  anchors = [];
  revoked = [];
  mine = [];
  vi.stubGlobal(
    "Blob",
    class {
      constructor(parts: unknown[], opts?: { type?: string }) {
        blobs.push({ parts, type: opts?.type });
      }
    },
  );
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:talaan-${++seq}`;
    mine.push(u);
    return u;
  });
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

/** Revocations of the URLs this test created (never a late one from an earlier test). */
const revokedHere = () => revoked.filter((u) => mine.includes(u));
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
  expect(anchors).toEqual([{ download: "talaan-interview-pinagsama-tech-2099-03-10.ics", href: mine[0] }]);
  expect(await screen.findByText("Calendar file created.")).toBeTruthy();
});

it("the object URL is revoked after the click, not before it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  render(withToasts(<AddToCalendar interview={iv()} />));
  await act(async () => screen.getByRole("button", { name: NAME }).click());
  expect(anchors).toHaveLength(1);
  expect(revokedHere()).toEqual([]);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(revokedHere()).toEqual(mine);
  expect(mine).toHaveLength(1);
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
  expect(screen.getAllByText("Calendar file created.")).toHaveLength(2);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
  expect(revokedHere()).toEqual(mine);
  expect(mine).toHaveLength(2);
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
  const list = await screen.findByRole("list", { name: "Interviews" }, { timeout: 5000 });
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
  await screen.findByRole("list", { name: "Interviews" }, { timeout: 5000 });
  expect(screen.queryByRole("button", { name: /Add to calendar/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "How to add this to your calendar" })).toBeNull();
});

it("the guide stays open when the only upcoming interview passes, and closing it focuses the Interviews heading (review round 1, finding 4)", async () => {
  const t0 = Date.now();
  const fake: Fake = installFake();
  fake.db.interviews = [makeInterview(9, 1, { scheduled_at: new Date(t0 + 60_000).toISOString() })];
  const { rerender } = render(<Detail />);
  const list = await screen.findByRole("list", { name: "Interviews" }, { timeout: 5000 });
  expect(within(list).getAllByRole("button", { name: /^Add to calendar/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "How to add this to your calendar" }));
  const dialog = screen.getByRole("dialog", { name: "How to add this to your calendar" }) as HTMLDialogElement;
  vi.spyOn(Date, "now").mockReturnValue(t0 + 120_000); // the interview has started
  rerender(<Detail />); // any re-render (a toast, a refresh) recomputes "upcoming"
  expect(screen.queryByRole("button", { name: /^Add to calendar/ })).toBeNull();
  expect(dialog.isConnected && dialog.open).toBe(true);
  expect(document.activeElement).not.toBe(document.body);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("button", { name: "How to add this to your calendar" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Interviews" }));
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

it("steps that name a menu item or button match the vendors' help pages (checked 2026-11-12)", async () => {
  const { dialog } = await open();
  const items = within(dialog).getAllByRole("listitem").map((li) => li.textContent);
  // Apple (support.apple.com, icl1023): "Choose File > Import, select the exported calendar file, then click Import."
  expect(items).toContain("Drag the downloaded file into the Calendar window, or choose File, then Import, select the file, then select Import.");
  // Classic Outlook (support.microsoft.com, 8e8364e1): step 9 is "Select Open as New", not Import.
  expect(items.at(-1)).toBe("Select Open as New.");
});
