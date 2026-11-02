// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilterTabs } from "../../src/components/filter-tabs";

const scrollIntoView = vi.fn();
let observed: Element[] = [];
let resize: () => void = () => {};
let reduced = false;

beforeEach(() => {
  scrollIntoView.mockClear();
  observed = [];
  reduced = false;
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resize = cb;
      }
      observe(e: Element) {
        observed.push(e);
      }
      disconnect() {}
    },
  );
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes("reduce") })) as typeof window.matchMedia;
});
afterEach(() => vi.unstubAllGlobals());

const active = () => scrollIntoView.mock.contexts.at(-1) as HTMLElement;

it("scrolls the pressed tab into view on mount, instantly, without moving the page vertically", () => {
  render(<FilterTabs value="ghosted" onChange={() => {}} />);
  expect(scrollIntoView).toHaveBeenCalledWith({ inline: "nearest", block: "nearest", behavior: "instant" });
  expect(active().textContent).toBe("Ghosted");
});

it("under StrictMode (effects run twice) the first deep-link placement is still instant, as in production", () => {
  const { rerender } = render(
    <StrictMode>
      <FilterTabs value="ghosted" onChange={() => {}} />
    </StrictMode>,
  );
  expect(scrollIntoView).toHaveBeenCalled();
  for (const [arg] of scrollIntoView.mock.calls) expect(arg.behavior).toBe("instant");
  rerender(
    <StrictMode>
      <FilterTabs value="offered" onChange={() => {}} />
    </StrictMode>,
  );
  expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: "nearest", block: "nearest", behavior: "smooth" });
});

it("scrolls the new tab when the value changes, smooth unless reduced motion", () => {
  const { rerender } = render(<FilterTabs value="all" onChange={() => {}} />);
  rerender(<FilterTabs value="offered" onChange={() => {}} />);
  expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: "nearest", block: "nearest", behavior: "smooth" });
  expect(active().textContent).toBe("Offered");
  reduced = true;
  rerender(<FilterTabs value="applied" onChange={() => {}} />);
  expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: "nearest", block: "nearest", behavior: "instant" });
});

it("observes the row and every tab, and re-measures the fade when sizes change", () => {
  const { getByRole } = render(<FilterTabs value="all" onChange={() => {}} />);
  const group = getByRole("group");
  expect(observed).toContain(group);
  expect(observed.length).toBe(1 + group.querySelectorAll("button").length);
  Object.defineProperty(group, "scrollWidth", { configurable: true, value: 900 });
  Object.defineProperty(group, "clientWidth", { configurable: true, value: 300 });
  act(() => resize()); // webfont swap: tabs widened, no scroll or window resize event
  expect(group.className).toContain("mask-image");
});
