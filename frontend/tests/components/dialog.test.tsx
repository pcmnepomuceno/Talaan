// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
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

// onClose fires once per user-initiated close, never for a close the parent caused.
function Counted({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button onClick={() => setOpen(false)}>Parent close</button>
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Counted"
      >
        <button onClick={() => setOpen(false)}>Done</button>
      </Dialog>
    </>
  );
}

it("onClose: once for Escape, never for a parent close, once again after re-open", async () => {
  const onClose = vi.fn();
  render(<Counted onClose={onClose} />);
  const open = screen.getByRole("button", { name: "Open" });
  await userEvent.click(open);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);

  await userEvent.click(open);
  await userEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);

  await userEvent.click(open);
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("onClose fires for a native close the parent did not cause", async () => {
  const onClose = vi.fn();
  render(<Counted onClose={onClose} />);
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  act(() => (screen.getByRole("dialog") as HTMLDialogElement).close());
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("DeleteConfirm: Cancel calls onCancel once; confirm never calls onCancel", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  function Spy() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Delete</button>
        <DeleteConfirm
          open={open}
          onCancel={() => {
            onCancel();
            setOpen(false);
          }}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          title="Delete?"
          message="Gone for good."
          confirmLabel="Delete it"
        />
      </>
    );
  }
  render(<Spy />);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete it" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).toHaveBeenCalledTimes(1);
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
