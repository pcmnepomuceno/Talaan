// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button, TextAction } from "../../src/components/button";
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

// TextAction must keep its element when `disabled` toggles (a background refresh): swapping a link
// for a disabled button remounts the node and drops keyboard focus to <body>.
it("TextAction link: same node and focus while disabled, aria-disabled, and a click does not navigate", async () => {
  const { rerender } = render(<TextAction href="/applications/1/edit">Edit</TextAction>);
  const before = screen.getByRole("link", { name: "Edit" });
  before.focus();
  rerender(<TextAction href="/applications/1/edit" disabled>Edit</TextAction>);
  const during = screen.getByRole("link", { name: "Edit" });
  expect(during).toBe(before);
  expect(document.activeElement).toBe(before);
  expect(during.getAttribute("aria-disabled")).toBe("true");
  expect(fireEvent.click(during)).toBe(false); // default prevented: no navigation
  rerender(<TextAction href="/applications/1/edit">Edit</TextAction>);
  expect(screen.getByRole("link", { name: "Edit" })).toBe(before);
  expect(document.activeElement).toBe(before);
  expect(before.getAttribute("aria-disabled")).toBeNull();
});

it("TextAction button: same node and focus while disabled, and a click does nothing", async () => {
  const onClick = vi.fn();
  const { rerender } = render(<TextAction onClick={onClick}>Delete</TextAction>);
  const before = screen.getByRole("button", { name: "Delete" });
  before.focus();
  rerender(<TextAction onClick={onClick} disabled>Delete</TextAction>);
  expect(screen.getByRole("button", { name: "Delete" })).toBe(before);
  expect(document.activeElement).toBe(before);
  expect(before.getAttribute("aria-disabled")).toBe("true");
  await userEvent.click(before);
  expect(onClick).not.toHaveBeenCalled();
  rerender(<TextAction onClick={onClick}>Delete</TextAction>);
  await userEvent.click(before);
  expect(onClick).toHaveBeenCalledOnce();
});
