// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../../src/components/toast";

type Api = ReturnType<typeof useToast>;
const held: { api: Api | null } = { api: null };
// Reading `api` after render: the hook result is stored in an effect, not during render.
const api = {
  success: (m: string) => held.api?.success(m),
  error: (m: string) => held.api?.error(m),
};
function Grab() {
  const t = useToast();
  useEffect(() => {
    held.api = t;
  });
  return null;
}
function setup() {
  render(
    <ToastProvider>
      <Grab />
    </ToastProvider>,
  );
}
const fire = (fn: () => void) => act(fn);
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("both live regions exist before any toast", () => {
  setup();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.getByRole("alert")).toBeTruthy();
});

it("success goes in the status region and disappears after 4s", () => {
  setup();
  fire(() => api.success("Application saved"));
  expect(screen.getByRole("status").textContent).toContain("Application saved");
  tick(3999);
  expect(screen.queryByText("Application saved")).not.toBeNull();
  tick(1);
  expect(screen.queryByText("Application saved")).toBeNull();
});

it("timer pauses on hover, resumes with the time left", () => {
  setup();
  fire(() => api.success("Saved"));
  tick(3000);
  const toast = screen.getByText("Saved").parentElement as HTMLElement;
  fireEvent.mouseEnter(toast);
  tick(10000);
  expect(screen.queryByText("Saved")).not.toBeNull();
  fireEvent.mouseLeave(toast);
  tick(999);
  expect(screen.queryByText("Saved")).not.toBeNull();
  tick(1);
  expect(screen.queryByText("Saved")).toBeNull();
});

it("timer pauses while focused", () => {
  setup();
  fire(() => api.success("Saved"));
  fireEvent.focus(screen.getByRole("button", { name: "Dismiss notification" }));
  tick(10000);
  expect(screen.queryByText("Saved")).not.toBeNull();
  fireEvent.blur(screen.getByRole("button", { name: "Dismiss notification" }));
  tick(4000);
  expect(screen.queryByText("Saved")).toBeNull();
});

it("error goes in the alert region, stays, and dismisses on click", () => {
  setup();
  fire(() => api.error("Could not save"));
  expect(screen.getByRole("alert").textContent).toContain("Could not save");
  tick(60000);
  expect(screen.queryByText("Could not save")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(screen.queryByText("Could not save")).toBeNull();
});

it("two toasts in the same tick both show", () => {
  setup();
  fire(() => {
    api.success("One");
    api.success("Two");
  });
  expect(screen.queryByText("One")).not.toBeNull();
  expect(screen.queryByText("Two")).not.toBeNull();
});

it("caps are per kind: a success shows even with 3 errors on screen", () => {
  setup();
  fire(() => ["E1", "E2", "E3"].forEach((m) => api.error(m)));
  fire(() => api.success("Application saved"));
  for (const t of ["E1", "E2", "E3", "Application saved"]) expect(screen.queryByText(t)).not.toBeNull();
});

it("over 3 successes: the oldest success is dropped, errors untouched", () => {
  setup();
  fire(() => {
    api.error("E1");
    ["S1", "S2", "S3", "S4"].forEach((m) => api.success(m));
  });
  expect(screen.queryByText("S1")).toBeNull();
  for (const t of ["E1", "S2", "S3", "S4"]) expect(screen.queryByText(t)).not.toBeNull();
});

it("over 3 errors: the oldest error is dropped", () => {
  setup();
  fire(() => ["E1", "E2", "E3", "E4"].forEach((m) => api.error(m)));
  expect(screen.queryByText("E1")).toBeNull();
  for (const t of ["E2", "E3", "E4"]) expect(screen.queryByText(t)).not.toBeNull();
});

it("a toast fired after the caller unmounted still shows", () => {
  function App({ show }: { show: boolean }) {
    return <ToastProvider>{show && <Grab />}</ToastProvider>;
  }
  const { rerender } = render(<App show />);
  const saved = held.api as Api;
  rerender(<App show={false} />);
  fire(() => saved.success("Late"));
  expect(screen.queryByText("Late")).not.toBeNull();
});

it("useToast outside a provider throws", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Grab />)).toThrow(/ToastProvider/);
});
