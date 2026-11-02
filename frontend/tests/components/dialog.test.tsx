// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DeleteConfirm } from "../../src/components/dialog";
import { Dialog } from "../../src/components/dialog";

function Demo({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete</button>
      <DeleteConfirm
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
        title="Delete this application?"
        message="Pinagsama Tech, Senior Frontend Engineer, and its interviews will be removed. This cannot be undone."
        confirmLabel="Delete application"
      />
    </>
  );
}

it("is hidden until opened, then named by its title and described by the message", async () => {
  render(<Demo />);
  expect(screen.queryByRole("dialog")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const d = screen.getByRole("dialog", { name: "Delete this application?" });
  expect(d.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Delete application" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
});

it("Escape closes and focus returns to the trigger", async () => {
  render(<Demo />);
  const trigger = screen.getByRole("button", { name: "Delete" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("Cancel closes; confirm calls back; reopening works", async () => {
  const onConfirm = vi.fn();
  render(<Demo onConfirm={onConfirm} />);
  const trigger = screen.getByRole("button", { name: "Delete" });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole("button", { name: "Delete application" }));
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("a scrim click does not close it", async () => {
  render(<Demo />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  const d = screen.getByRole("dialog");
  await userEvent.click(d);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("a second dialog opened on top: Escape closes only the top one", async () => {
  function Two() {
    const [a, setA] = useState(true);
    const [b, setB] = useState(true);
    return (
      <>
        <Dialog open={a} onClose={() => setA(false)} title="First">
          x
        </Dialog>
        <Dialog open={b} onClose={() => setB(false)} title="Second">
          y
        </Dialog>
      </>
    );
  }
  render(<Two />);
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  await userEvent.keyboard("{Escape}");
  expect(screen.getAllByRole("dialog").map((d) => d.getAttribute("aria-labelledby") && d.textContent)).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: "First" })).toBeTruthy();
});
