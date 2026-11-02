// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SkipLink } from "../../src/components/skip-link";

it("is a link to #content", () => {
  render(<SkipLink />);
  expect(screen.getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#content");
});
