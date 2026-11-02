// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ThemeSync, ThemeToggle } from "../src/components/theme-toggle";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

const storage = (newValue: string | null) =>
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue }));
  });
const checked = () => screen.getAllByRole<HTMLInputElement>("radio").find((r) => r.checked)?.value;

it("follows a theme change from another tab", () => {
  render(<ThemeToggle />);
  expect(checked()).toBe("system");
  storage("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(checked()).toBe("dark");
  storage("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(checked()).toBe("light");
});

it("falls back to system for an invalid or removed value", () => {
  render(<ThemeToggle />);
  storage("dark");
  storage("purple");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(checked()).toBe("system");
  storage("light");
  storage(null);
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(checked()).toBe("system");
});

it("ThemeSync alone follows other tabs", () => {
  render(<ThemeSync />);
  storage("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
