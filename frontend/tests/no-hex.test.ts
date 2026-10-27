import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// icon.svg is a standalone file and cannot read CSS variables.
const allowed = new Set([join("src", "styles", "tokens.css"), join("src", "app", "icon.svg")]);

// A hex color, except where `#` starts a URL fragment or a numeric entity: after `&` (&#8212;),
// after a word character or `/` (/jobs#add), or as the start of an href value (href="#bed").
// A bare quoted "#add" outside href still matches; it is indistinguishable from a color string.
const hex = /(?<![&\w/]|href=\{?["'`])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
// Literal colors through CSS color functions. Named colors (red, white) are out of scope: they
// collide with ordinary words and identifiers, so they are left to review.
const colorFn = /(?<![\w-])(?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(/i;

export function hasLiteralColor(text: string) {
  return hex.test(text) || colorFn.test(text);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

it("has no literal colors in src outside tokens.css and icon.svg", () => {
  const offenders = walk("src")
    .filter((f) => !allowed.has(f))
    .filter((f) => hasLiteralColor(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});

describe("hasLiteralColor", () => {
  const ok = [
    '<a href="#add">Add</a>',
    '<a href="#bed">Bed</a>',
    "<Link href={'#cafe'}>",
    'router.push("/applications#add")',
    "Dates &#8212; times",
    "border-color-subtle", // a token class, not color()
    "setColor(value)",
  ];
  const bad = [
    'style={{ color: "#fff" }}',
    "#1F3A6E",
    "bg-[#1f3a6e]",
    "fill: #ABCD;",
    "rgb(255, 0, 0)",
    "rgba(0, 0, 0, 0.5)",
    "bg-[rgb(255,0,0)]",
    "hsl(0 100% 50%)",
    "hsla(0, 100%, 50%, 1)",
    "oklch(0.7 0.1 200)",
    "oklab(0.7 0.1 0.1)",
    "lab(50% 40 59)",
    "lch(50% 40 59)",
    "color(display-p3 1 0 0)",
    "color-mix(in srgb, red, blue)",
    "RGB(1, 2, 3)",
  ];
  it.each(ok)("allows %s", (s) => expect(hasLiteralColor(s)).toBe(false));
  it.each(bad)("flags %s", (s) => expect(hasLiteralColor(s)).toBe(true));
});
