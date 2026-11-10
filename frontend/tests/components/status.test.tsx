// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { Banner } from "../../src/components/banner";
import { type Filter, StatusFilter } from "../../src/components/status-filter";
import { OUTCOMES, STATUSES, StatusStamp } from "../../src/components/status-stamp";

const labels = {
  saved: "Saved",
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offered: "Offered",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
  pending: "Pending",
  good: "Good",
  bad: "Bad",
} as const;

it.each(Object.entries(labels))("stamp %s reads exactly %s", (value, label) => {
  const { container } = render(<StatusStamp value={value as keyof typeof labels} />);
  expect(container.textContent).toBe(label);
});

// (A literal `new URL(path, import.meta.url)` is rewritten by Vite into an asset import.)
const here = dirname(fileURLToPath(import.meta.url));

// Values from the Python enum class body: NAME = "value". The path is relative to this file, not
// the working directory, and the body ends at the first blank line (LF or CRLF).
function enumValues(file: string, cls: string) {
  const source = readFileSync(resolve(here, "../../../app", file), "utf8");
  const body = source.split(`class ${cls}(`)[1].split(/\r?\n\s*\r?\n/)[0];
  return [...body.matchAll(/=\s*"(\w+)"/g)].map((m) => m[1]);
}

it("matches the API enum values", () => {
  const statuses = enumValues("applications/models.py", "ApplicationStatus");
  const outcomes = enumValues("interviews/models.py", "InterviewOutcome");
  // Exact counts, so a parse that finds nothing or runs into the next class fails loudly.
  expect(statuses).toHaveLength(9);
  expect(outcomes).toHaveLength(3);
  expect(STATUSES).toEqual(statuses);
  expect(OUTCOMES).toEqual(outcomes);
  expect(enumValues("applications/models.py", "ModeOfWork")).toEqual(["on_site", "hybrid", "remote"]);
  expect(enumValues("interviews/models.py", "InterviewMode")).toEqual(["on_site", "online", "async"]);
});

function Harness() {
  const [v, setV] = useState<Filter>("all");
  return <StatusFilter value={v} onChange={setV} />;
}

it("StatusFilter: labelled select, All plus nine statuses, reachable by Tab, changes value", async () => {
  render(<Harness />);
  const select = screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement;
  expect([...select.options].map((o) => o.textContent)).toEqual(["All", ...STATUSES.map((s) => labels[s])]);
  expect(select.value).toBe("all");
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(select);
  // user-event does not emulate a native select's arrow keys; the keyboard path is in the e2e.
  await user.selectOptions(select, "applied");
  expect(select.value).toBe("applied");
});

it("Banner is an alert with title and text", () => {
  render(<Banner title="Could not log in">Incorrect email or password.</Banner>);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe("Could not log in" + "Incorrect email or password.");
});

it.each([
  ["a paragraph", <p key="p">Check the fields.</p>],
  [
    "a list",
    <ul key="ul">
      <li>Company is required</li>
      <li>Enter a full URL</li>
    </ul>,
  ],
])("Banner accepts %s as children without a nesting warning", (_, child) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<Banner title="Could not save">{child}</Banner>);
    expect(error).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").querySelector("p p, p ul")).toBeNull();
  } finally {
    error.mockRestore();
  }
});
