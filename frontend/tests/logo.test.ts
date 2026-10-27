import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Logo, Wordmark } from "../src/components/logo";

it("Logo alone is a named image", () => {
  const html = renderToStaticMarkup(createElement(Logo, { variant: "on-paper" }));
  expect(html).toContain('role="img"');
  expect(html).toContain('aria-label="Talaan"');
});

it("Wordmark hides its Logo so the name is read once", () => {
  const html = renderToStaticMarkup(createElement(Wordmark, { variant: "on-ink" }));
  expect(html).toContain('aria-hidden="true"');
  expect(html).not.toContain("aria-label");
  expect(html).not.toContain('role="img"');
});
