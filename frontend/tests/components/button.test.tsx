// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "../../src/components/button";
import { Icon } from "../../src/components/icon";

it("is a named button that defaults to type=button", () => {
  render(<Button>Save application</Button>);
  expect(screen.getByRole("button", { name: "Save application" }).getAttribute("type")).toBe("button");
});

it.each(["{Enter}", " "])("activates with %s", async (key) => {
  const onClick = vi.fn();
  render(<Button onClick={onClick}>Save</Button>);
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button"));
  await user.keyboard(key);
  expect(onClick).toHaveBeenCalledOnce();
});

it("is skipped by Tab and ignores clicks when disabled", async () => {
  const onClick = vi.fn();
  render(
    <>
      <Button disabled onClick={onClick}>Off</Button>
      <Button variant="secondary">On</Button>
    </>,
  );
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "On" }));
  await user.click(screen.getByRole("button", { name: "Off" }));
  expect(onClick).not.toHaveBeenCalled();
});

it("renders a link when given href", () => {
  render(
    <Button href="/design" variant="ghost">
      <Icon name="arrow_back" />
      Back
    </Button>,
  );
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/design");
  expect(screen.queryByRole("button")).toBeNull();
});
