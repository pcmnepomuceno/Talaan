// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SegmentedControl } from "../../src/components/segmented-control";

const modes = [
  { value: "on_site", label: "On-site" },
  { value: "hybrid", label: "Hybrid" },
  { value: "remote", label: "Remote" },
] as const;

function WorkMode() {
  const [v, setV] = useState<(typeof modes)[number]["value"]>("hybrid");
  return <SegmentedControl label="Work mode" options={modes} value={v} onChange={setV} />;
}

it("is a named group of radios with one checked", () => {
  render(<WorkMode />);
  expect(screen.getByRole("group", { name: "Work mode" })).toBeTruthy();
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Hybrid" }).checked).toBe(true);
});

it("moves the selection with the arrow keys", async () => {
  render(<WorkMode />);
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Hybrid" }));
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Remote" }).checked).toBe(true);
  await user.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "On-site" }).checked).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "On-site" }));
});

it("gives each instance its own radio group name", () => {
  render(
    <>
      <WorkMode />
      <WorkMode />
    </>,
  );
  const names = screen.getAllByRole<HTMLInputElement>("radio").map((r) => r.name);
  expect(new Set(names).size).toBe(2);
});
