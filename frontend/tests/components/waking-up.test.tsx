// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WAKE_MS, WakingUp } from "../../src/components/waking-up";

const TEXT = "Starting up. This can take up to a minute the first time.";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it("is a polite live region that exists from the start, empty until 3 s have passed", async () => {
  const { container } = render(<WakingUp pending />);
  const region = container.querySelector('[aria-live="polite"]');
  expect(region).not.toBeNull();
  expect(WAKE_MS).toBe(3000);
  await tick(2999);
  expect(screen.queryByText(TEXT)).toBeNull();
  await tick(1);
  expect(screen.getByText(TEXT)).toBe(region);
});

it("goes away when the request settles (success or error look the same: pending ends)", async () => {
  const { rerender } = render(<WakingUp pending />);
  await tick(3000);
  expect(screen.getByText(TEXT)).toBeTruthy();
  rerender(<WakingUp pending={false} />);
  expect(screen.queryByText(TEXT)).toBeNull();
});

it("never shows for a request that settles before 3 s, and the clock restarts for the next one", async () => {
  const { rerender } = render(<WakingUp pending />);
  await tick(2000);
  rerender(<WakingUp pending={false} />);
  await tick(5000);
  expect(screen.queryByText(TEXT)).toBeNull();
  rerender(<WakingUp pending />);
  await tick(2999);
  expect(screen.queryByText(TEXT)).toBeNull();
  await tick(1);
  expect(screen.getByText(TEXT)).toBeTruthy();
});
