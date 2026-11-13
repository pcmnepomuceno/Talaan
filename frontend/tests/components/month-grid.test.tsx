// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { MonthGrid } from "../../src/components/month-grid";
import { monthOf } from "../../src/lib/calendar";
import type { AgendaInterview } from "../../src/lib/types";
import { makeInterview } from "../helpers/fake-api";

const iv = (id: number, at: string, company = `Company ${id}`): AgendaInterview => ({ ...makeInterview(id, 1, { scheduled_at: at }), company, job_name: "Dev" });
const byDay = (rows: AgendaInterview[]) => {
  const m = new Map<string, AgendaInterview[]>();
  for (const r of rows) {
    const day = new Date(Date.parse(r.scheduled_at) + 8 * 3600e3).toISOString().slice(0, 10);
    m.set(day, [...(m.get(day) ?? []), r]);
  }
  return m;
};
// Nov 10 2026 (Tuesday): 2 interviews. Nov 11: 1. Nov 20 has 3 (for "+1 more"). Dec 2 (a trailing day of the Nov grid): 1.
const ROWS = [
  iv(1, "2026-11-10T14:00:00+08:00", "Pinagsama Tech"),
  iv(2, "2026-11-10T09:30:00+08:00", "Kape Digital"),
  iv(3, "2026-11-11T23:30:00+08:00"),
  iv(4, "2026-11-20T09:00:00+08:00", "A"),
  iv(5, "2026-11-20T10:00:00+08:00", "B"),
  iv(6, "2026-11-20T11:00:00+08:00", "C"),
  iv(7, "2026-12-02T09:00:00+08:00"),
];

type Props = Partial<React.ComponentProps<typeof MonthGrid>>;
function mount(props: Props = {}) {
  const onSelect = vi.fn();
  const onMonth = vi.fn();
  const utils = render(
    <>
      <h2 id="m">Month</h2>
      <MonthGrid month="2026-11" today="2026-11-12" selected="2026-11-10" days={sortedDays()} labelledBy="m" onSelect={onSelect} onMonth={onMonth} {...props} />
    </>,
  );
  const grid = screen.getByRole("grid");
  const cell = (d: string) => grid.querySelector<HTMLElement>(`button[data-day="${d}"]`)!;
  return { ...utils, grid, cell, onSelect, onMonth };
}
function sortedDays() {
  const m = byDay(ROWS);
  for (const [k, v] of m) m.set(k, [...v].sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)));
  return m;
}

it("is a named grid of Sunday-first weeks with seven weekday headers", () => {
  const { grid } = mount();
  expect(grid.getAttribute("aria-labelledby")).toBe("m");
  const heads = [...grid.querySelectorAll('[role="columnheader"]')];
  expect(heads.map((h) => h.getAttribute("aria-label"))).toEqual(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  expect(heads.map((h) => h.textContent)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  expect(grid.querySelectorAll('[role="row"]')).toHaveLength(6); // header + 5 weeks
  expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(35);
});

it.each([
  ["2026-02", 4],
  ["2026-11", 5],
  ["2026-08", 6],
])("shows %s in %i week rows", (month, weeks) => {
  const { grid } = mount({ month, selected: `${month}-01`, today: `${month}-01` });
  expect(grid.querySelectorAll('[role="row"]')).toHaveLength(weeks + 1);
  expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(weeks * 7);
});

it("names every day button with the weekday, date and number of interviews", () => {
  const { cell } = mount();
  expect(cell("2026-11-10").getAttribute("aria-label")).toBe("Tuesday, Nov 10, 2026, 2 interviews");
  expect(cell("2026-11-11").getAttribute("aria-label")).toBe("Wednesday, Nov 11, 2026, 1 interview");
  expect(cell("2026-11-01").getAttribute("aria-label")).toBe("Sunday, Nov 1, 2026, no interviews");
  expect(cell("2026-12-02").getAttribute("aria-label")).toBe("Wednesday, Dec 2, 2026, 1 interview"); // a trailing day counts too
});

it("leaves the count out of the names and marks the grid busy while there is no data", () => {
  const { cell, grid } = mount({ days: null });
  expect(grid.getAttribute("aria-busy")).toBe("true");
  expect(cell("2026-11-10").getAttribute("aria-label")).toBe("Tuesday, Nov 10, 2026");
  expect(grid.querySelector(".bg-primary-tint")).toBeNull();
});

it("tints a day with interviews as reinforcement; no other day is tinted", async () => {
  const { grid } = mount({ selected: "2026-11-01" });
  const tinted = [...grid.querySelectorAll<HTMLElement>("button.bg-primary-tint")].map((b) => b.dataset.day);
  expect(tinted).toEqual(["2026-11-10", "2026-11-11", "2026-11-20", "2026-12-02"]);
});

// The tint alone is 1.20:1 (light) and 1.16:1 (dark) against the cell, so the number weight is the
// cue that does not rely on color: 400 without interviews, 600 with, 600 on the selected day.
it("sets the number weight 400 on a day without interviews and 600 on a day with them", () => {
  const { cell } = mount({ selected: "2026-11-01" });
  const num = (d: string) => cell(d).querySelector<HTMLElement>("[data-number]")!;
  for (const d of ["2026-11-03", "2026-11-12", "2026-12-05"]) {
    expect(num(d).className).toContain("font-normal");
    expect(num(d).className).not.toMatch(/font-(medium|semibold)/);
  }
  for (const d of ["2026-11-10", "2026-11-20", "2026-12-02"]) {
    expect(num(d).className).toContain("font-semibold");
    expect(num(d).className).not.toContain("font-normal");
  }
});

it.each(["2026-11-03", "2026-11-10"])("keeps the selected day's number at 600 and its fill (%s)", (day) => {
  const { cell } = mount({ selected: day });
  expect(cell(day).querySelector("[data-number]")!.className).toContain("font-semibold");
  expect(cell(day).className).toContain("bg-primary");
});

it("outlines today with a 1px primary border and marks it aria-current", () => {
  const { cell, grid } = mount();
  expect(cell("2026-11-12").className).toContain("border-primary");
  expect(cell("2026-11-12").getAttribute("aria-current")).toBe("date");
  expect(grid.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  expect(cell("2026-11-13").className).toContain("border-transparent");
});

it("fills the selected day and sets aria-selected on its cell only", () => {
  const { cell, grid } = mount();
  expect(cell("2026-11-10").className).toContain("bg-primary");
  expect(cell("2026-11-10").className).toContain("text-text-inverse");
  expect(cell("2026-11-10").className).not.toContain("bg-primary-tint");
  expect(grid.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
  expect(cell("2026-11-10").closest('[role="gridcell"]')!.getAttribute("aria-selected")).toBe("true");
});

it("dims days of the neighbouring months but keeps them interactive", () => {
  const { cell, onSelect } = mount({ selected: "2026-11-01" });
  const out = cell("2026-12-05");
  expect(out.className).toContain("text-text-muted");
  expect(out.getAttribute("aria-disabled")).toBeNull();
  out.click();
  expect(onSelect).toHaveBeenCalledWith("2026-12-05");
});

it("shows up to two entries, time on one line and the company on the next, then '+N more' (from 1280)", () => {
  const { cell } = mount();
  const entries = (d: string) => [...cell(d).querySelectorAll("[data-line]")].map((l) => [l.querySelector("[data-time]")!.textContent, l.querySelector("[data-company]")!.textContent]);
  expect(entries("2026-11-10")).toEqual([["9:30 AM", "Kape Digital"], ["2:00 PM", "Pinagsama Tech"]]);
  expect(entries("2026-11-20")).toEqual([["9:00 AM", "A"], ["10:00 AM", "B"]]);
  const more = cell("2026-11-20").querySelector("[data-more]")!;
  expect(more.textContent).toBe("+1 more");
  expect(cell("2026-11-10").querySelector("[data-more]")).toBeNull();
  const box = cell("2026-11-10").querySelector("[data-lines]")!;
  expect(box.getAttribute("aria-hidden")).toBe("true");
  expect(box.className).toMatch(/\bhidden\b.*\bxl:/);
  // The company gets a whole line to itself and is the part that is cut with an ellipsis.
  const company = cell("2026-11-10").querySelector("[data-company]")!;
  expect(company.className).toContain("truncate");
  expect(company.className).toContain("block");
  expect(cell("2026-11-10").querySelector("[data-time]")!.className).not.toContain("truncate");
  expect(cell("2026-11-03").querySelector("[data-lines]")).toBeNull();
});

it("has one tab stop, on the selected day", () => {
  const { grid, cell } = mount();
  const stops = [...grid.querySelectorAll<HTMLElement>("button")].filter((b) => b.tabIndex === 0);
  expect(stops).toEqual([cell("2026-11-10")]);
});

it("moves the tab stop with the arrow keys and puts it back on the selected day when focus leaves", async () => {
  const user = userEvent.setup();
  const { grid, cell } = mount();
  cell("2026-11-10").focus();
  await user.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(cell("2026-11-11"));
  const stops = () => [...grid.querySelectorAll<HTMLElement>("button")].filter((b) => b.tabIndex === 0);
  expect(stops()).toEqual([cell("2026-11-11")]);
  await act(async () => (document.activeElement as HTMLElement).blur());
  expect(stops()).toEqual([cell("2026-11-10")]);
});

it.each([
  ["{ArrowLeft}", "2026-11-09"],
  ["{ArrowRight}", "2026-11-11"],
  ["{ArrowUp}", "2026-11-03"],
  ["{ArrowDown}", "2026-11-17"],
  ["{Home}", "2026-11-08"],
  ["{End}", "2026-11-14"],
])("%s moves focus inside the grid without selecting or changing month", async (key, day) => {
  const user = userEvent.setup();
  const { cell, onSelect, onMonth } = mount();
  cell("2026-11-10").focus();
  await user.keyboard(key);
  expect(document.activeElement).toBe(cell(day));
  expect(onSelect).not.toHaveBeenCalled();
  expect(onMonth).not.toHaveBeenCalled();
});

it.each([
  ["{PageDown}", "2026-12", "2026-12-10"],
  ["{PageUp}", "2026-10", "2026-10-10"],
])("%s asks for the next or previous month, keeping the day", async (key, month, day) => {
  const user = userEvent.setup();
  const { cell, onMonth } = mount();
  cell("2026-11-10").focus();
  await user.keyboard(key);
  expect(onMonth).toHaveBeenLastCalledWith(month, day);
});

it("keys pressed before the month has changed add up from the day the first one asked for", async () => {
  const user = userEvent.setup();
  const { cell, onMonth } = mount(); // the parent does not re-render here: the first move stays pending
  cell("2026-11-10").focus();
  await user.keyboard("{PageDown}{PageDown}{PageUp}");
  expect(onMonth.mock.calls.map((c) => c[1])).toEqual(["2026-12-10", "2027-01-10", "2026-12-10"]);
});

it("an arrow past the visible grid asks for the neighbouring month", async () => {
  const user = userEvent.setup();
  const { cell, onMonth } = mount({ selected: "2026-11-01" });
  cell("2026-11-01").focus();
  await user.keyboard("{ArrowLeft}"); // Nov 1 is the first cell: Oct 31 is outside the grid
  expect(onMonth).toHaveBeenLastCalledWith("2026-10", "2026-10-31");
});

it("an arrow right from the last cell asks for the month of the next day", async () => {
  const user = userEvent.setup();
  const { cell, onMonth } = mount({ selected: "2026-12-05" });
  cell("2026-12-05").focus();
  await user.keyboard("{ArrowRight}");
  expect(onMonth).toHaveBeenLastCalledWith("2026-12", "2026-12-06");
});

it("Enter and Space select the focused day; so does a click", async () => {
  const user = userEvent.setup();
  const { cell, onSelect } = mount();
  cell("2026-11-10").focus();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onSelect).toHaveBeenLastCalledWith("2026-11-17");
  await user.keyboard("{ArrowRight} ");
  expect(onSelect).toHaveBeenLastCalledWith("2026-11-18");
  await user.click(cell("2026-11-19"));
  expect(onSelect).toHaveBeenLastCalledWith("2026-11-19");
});

it("the days outside the supported years are inert", () => {
  const { grid, onSelect } = mount({ month: "1900-01", selected: "1900-01-01", today: "2026-11-12", days: new Map() });
  const dead = grid.querySelector<HTMLElement>('button[data-day="1899-12-31"]')!;
  expect(dead.getAttribute("aria-disabled")).toBe("true");
  expect(dead.tabIndex).toBe(-1);
  dead.click();
  expect(onSelect).not.toHaveBeenCalled();
});

// A parent that behaves like the screen: a month change re-renders the grid with the new month.
function Harness({ start = "2026-11", selected = "2026-11-10" }: { start?: string; selected?: string }) {
  const [state, set] = useState({ month: start, selected });
  return (
    <>
      <h2 id="m">Month</h2>
      <button>before</button>
      <MonthGrid
        month={state.month}
        today="2026-11-12"
        selected={state.selected}
        days={new Map()}
        labelledBy="m"
        onSelect={(d) => set({ month: monthOf(d), selected: d })}
        onMonth={(month) => set({ month, selected: `${month}-01` })}
      />
    </>
  );
}

it("keeps focus on the day it lands on when a key changes the month", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const cell = (d: string) => screen.getByRole("grid").querySelector<HTMLElement>(`button[data-day="${d}"]`)!;
  cell("2026-11-10").focus();
  await user.keyboard("{PageDown}");
  expect(document.activeElement).toBe(cell("2026-12-10"));
  await user.keyboard("{PageUp}{PageUp}");
  expect(document.activeElement).toBe(cell("2026-10-10"));
  expect(document.activeElement).not.toBe(document.body);
});

it("keeps focus after an arrow crosses into the next month and after the grid's shape changes", async () => {
  const user = userEvent.setup();
  render(<Harness start="2026-11" selected="2026-11-30" />);
  const cell = (d: string) => screen.getByRole("grid").querySelector<HTMLElement>(`button[data-day="${d}"]`)!;
  cell("2026-11-30").focus();
  await user.keyboard("{ArrowDown}"); // Dec 7: outside the 5-week Nov grid
  expect(document.activeElement).toBe(cell("2026-12-07"));
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(cell("2026-12-07"));
});

it("keeps focus on a clicked neighbouring-month day after the month changes under it", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const cell = (d: string) => screen.getByRole("grid").querySelector<HTMLElement>(`button[data-day="${d}"]`)!;
  await user.click(cell("2026-12-04")); // a trailing day: the view moves to December, the button is rebuilt
  expect(document.activeElement).toBe(cell("2026-12-04"));
});
