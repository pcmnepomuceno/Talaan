// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EmptyState } from "../../src/components/empty-state";
import { ApplicationRow, DetailRows, InterviewRow, LedgerSheet, LedgerSkeleton } from "../../src/components/ledger";
import { STATUSES, stampLabel } from "../../src/components/status-stamp";
import type { Application, Interview } from "../../src/lib/types";

const app = (o: Partial<Application> = {}): Application => ({
  id: 1,
  company: "Pinagsama Tech",
  job_name: "Senior Frontend Engineer",
  contact_website: "https://pinagsamatech.example.ph/",
  contact_email: null,
  status: "interviewing",
  salary: 85000,
  mode_of_work: "hybrid",
  remarks: null,
  date_applied: "2026-10-14",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
  ...o,
});
const itv = (o: Partial<Interview> = {}): Interview => ({
  id: 1,
  job_application_id: 1,
  interviewer: "Ana Santos",
  scheduled_at: "2026-10-18T02:00:00Z",
  mode: "online",
  outcome: "good",
  remarks: "Portfolio walkthrough.",
  created_at: "",
  updated_at: "",
  ...o,
});

it.each(STATUSES)("row renders status %s", (status) => {
  render(
    <LedgerSheet>
      <ApplicationRow application={app({ status })} href="/a/1" />
    </LedgerSheet>,
  );
  const link = screen.getByRole("link");
  expect(within(link).getByText(stampLabel(status))).toBeTruthy();
  expect(link.textContent).toContain("Senior Frontend Engineer");
  expect(link.textContent).toContain("Pinagsama Tech");
  expect(link.textContent).toContain("Hybrid · ₱85,000 / month");
  expect(link.textContent).toContain("Oct 14, 2026");
});

it("row without salary omits the separator and peso; Saved without date says so", () => {
  render(<ApplicationRow application={app({ salary: null, status: "saved", date_applied: null })} href="/a" />);
  const t = screen.getByRole("link").textContent ?? "";
  expect(t).not.toContain("₱");
  expect(t).not.toContain("·");
  expect(t).toContain("Not applied yet");
});

it("non-saved row without a date shows no date text", () => {
  render(<ApplicationRow application={app({ date_applied: null })} href="/a" />);
  expect(screen.getByRole("link").textContent).not.toMatch(/Not applied|2026/);
});

it("selected row: aria-current, button variant calls onSelect", async () => {
  const onSelect = vi.fn();
  const { rerender } = render(<ApplicationRow application={app()} onSelect={onSelect} selected />);
  const b = screen.getByRole("button");
  expect(b.getAttribute("aria-current")).toBe("true");
  await userEvent.click(b);
  expect(onSelect).toHaveBeenCalledOnce();
  rerender(<ApplicationRow application={app()} href="/a" selected />);
  expect(screen.getByRole("link").getAttribute("aria-current")).toBe("page");
  rerender(<ApplicationRow application={app()} href="/a" />);
  expect(screen.getByRole("link").hasAttribute("aria-current")).toBe(false);
});

it("interview row: PHT time, outcome always, optional parts", () => {
  const { rerender } = render(<InterviewRow interview={itv()} />);
  let li = screen.getByRole("listitem");
  expect(li.textContent).toContain("Oct 18, 2026, 10:00 AM PHT");
  expect(li.textContent).toContain("Good");
  expect(li.textContent).toContain("Online");
  expect(li.textContent).toContain("Ana Santos");
  expect(li.textContent).toContain("Portfolio walkthrough.");
  rerender(<InterviewRow interview={itv({ interviewer: null, remarks: null, outcome: "pending" })} />);
  li = screen.getByRole("listitem");
  expect(li.textContent).toContain("Pending");
  expect(li.textContent).not.toContain("·");
  expect(li.querySelectorAll("p")).toHaveLength(2);
  expect(li.textContent).not.toMatch(/Next|Upcoming/);
});

it("detail rows omit missing salary, date and website", () => {
  const { rerender } = render(<DetailRows application={app()} />);
  expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual([
    "Monthly gross salary",
    "Work mode",
    "Date applied",
    "Website",
  ]);
  const a = screen.getByRole("link", { name: "pinagsamatech.example.ph" });
  expect(a.getAttribute("href")).toBe("https://pinagsamatech.example.ph/");
  expect(a.getAttribute("rel")).toContain("noopener");
  rerender(<DetailRows application={app({ salary: null, date_applied: null, contact_website: null })} />);
  expect(screen.getAllByRole("term").map((t) => t.textContent)).toEqual(["Work mode"]);
});

it("detail rows do not link a non-http website", () => {
  render(<DetailRows application={app({ contact_website: "javascript:alert(1)" })} />);
  expect(screen.queryByRole("link")).toBeNull();
});

it("skeleton has a status name and hides the bars", () => {
  render(<LedgerSkeleton rows={2} />);
  expect(screen.getByRole("status").textContent).toBe("Loading applications");
  expect(screen.queryAllByRole("listitem")).toHaveLength(0); // aria-hidden list
});

it("empty state", () => {
  render(<EmptyState title="No applications yet" message="Add the first job you applied to." action={<button>Add application</button>} />);
  expect(screen.getByRole("heading", { name: "No applications yet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add application" })).toBeTruthy();
});

it("row title is clamped to 2 lines and carries the full text in title", () => {
  const long = "Senior Principal Staff Software Engineer, Platform Reliability and Developer Experience";
  render(<ApplicationRow application={app({ job_name: long })} href="/applications/1" />);
  const t = screen.getByText(long);
  expect(t.getAttribute("title")).toBe(long);
  expect(t.className).toContain("line-clamp-2");
});
