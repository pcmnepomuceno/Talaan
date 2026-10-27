import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// icon.svg is a standalone file and cannot read CSS variables.
const allowed = new Set([join("src", "styles", "tokens.css"), join("src", "app", "icon.svg")]);
const hex = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

it("has no hex colors in src outside tokens.css and icon.svg", () => {
  const offenders = walk("src")
    .filter((f) => !allowed.has(f))
    .filter((f) => hex.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
