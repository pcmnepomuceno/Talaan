// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { DeleteConfirm, StatusDialog } from "../../src/components/dialog";
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

it("DeleteConfirm busy: double-click confirms once, buttons disabled, aria-busy, Escape ignored", async () => {
  const onConfirm = vi.fn();
  function Busy() {
    const [open, setOpen] = useState(true);
    const [busy, setBusy] = useState(false);
    return (
      <DeleteConfirm
        open={open}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          onConfirm();
          setBusy(true); // the DELETE request is still in flight
        }}
        title="Delete?"
        message="Gone for good."
        confirmLabel="Delete it"
      />
    );
  }
  render(<Busy />);
  await userEvent.dblClick(screen.getByRole("button", { name: "Delete it" }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  const d = screen.getByRole("dialog");
  expect(d.getAttribute("aria-busy")).toBe("true");
  for (const name of ["Delete it", "Cancel"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  await userEvent.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBe(d);
});

// Chrome can close a modal without a cancelable `cancel` (a second Escape with no click between).
it("DeleteConfirm busy: a native close re-opens the dialog and calls neither callback", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <DeleteConfirm
      open
      busy
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Delete?"
      message="Gone for good."
      confirmLabel="Delete it"
    />,
  );
  const d = screen.getByRole("dialog") as HTMLDialogElement;
  act(() => d.close());
  expect(d.open).toBe(true);
  expect(screen.getByRole("dialog")).toBe(d);
  expect(onCancel).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
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

// ---- StatusDialog busy (PR #23 review item 2) ----
function statusUi(busy: boolean, onConfirm = vi.fn(), onCancel = vi.fn()) {
  return <StatusDialog open current="interviewing" busy={busy} onCancel={onCancel} onConfirm={onConfirm} />;
}

it("StatusDialog busy: focus stays on the focused control, nothing is disabled, and input is ignored", async () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const { rerender } = render(statusUi(false, onConfirm, onCancel));
  const applied = screen.getByRole("radio", { name: "Applied" }) as HTMLInputElement;
  await userEvent.click(applied);
  rerender(statusUi(true, onConfirm, onCancel));
  expect(document.activeElement).toBe(applied);
  const dialog = screen.getByRole("dialog", { name: "Change status" });
  // `disabled` drops focus to <body> in browsers; the busy state uses aria-disabled instead.
  expect(dialog.querySelectorAll(":disabled")).toHaveLength(0);
  for (const r of screen.getAllByRole("radio")) expect(r.getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Update status" }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByRole("button", { name: "Cancel" }).getAttribute("aria-disabled")).toBe("true");
  await userEvent.click(screen.getByRole("radio", { name: "Ghosted" }));
  expect(applied.checked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Update status" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

it("StatusDialog: when busy ends with the dialog still open (a failed save), the checked radio has focus", async () => {
  const { rerender } = render(statusUi(false));
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  const update = screen.getByRole("button", { name: "Update status" });
  update.focus();
  rerender(statusUi(true));
  rerender(statusUi(false));
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Applied" }));
});
