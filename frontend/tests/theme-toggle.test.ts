import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ThemeToggle } from "../src/components/theme-toggle";

it("gives each ThemeToggle its own radio group", () => {
  const html = renderToStaticMarkup(
    createElement(Fragment, null, createElement(ThemeToggle), createElement(ThemeToggle)),
  );
  const names = [...html.matchAll(/<input type="radio"[^>]* name="([^"]+)"/g)].map((m) => m[1]);
  expect(names).toHaveLength(6);
  expect(new Set(names).size).toBe(2);
});
