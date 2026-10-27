import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Parses `--color-x: light-dark(#aaa, #bbb);` from tokens.css.
const css = readFileSync("src/styles/tokens.css", "utf8");
const tokens: Record<string, { light: string; dark: string }> = {};
for (const m of css.matchAll(/--color-([\w-]+):\s*light-dark\((#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/g)) {
  tokens[m[1]] = { light: m[2], dark: m[3] };
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    // 0.03928 is the threshold WCAG 2.x writes in its relative luminance definition; keep it so the
    // ratios match the spec we claim. sRGB's 0.04045 gives identical results for 8-bit hex: no
    // channel value falls between the two (10/255 = 0.0392, 11/255 = 0.0431).
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [foreground, background, minimum ratio]. Disabled states are exempt (WCAG 1.4.3) and not listed.
const statuses = ["saved", "applied", "screening", "interviewing", "offered", "accepted", "rejected", "withdrawn", "ghosted"];
const pairs: [string, string, number][] = [
  ...["text-primary", "text-secondary", "text-muted"].flatMap((t): [string, string, number][] => [
    [t, "bg-page", 4.5],
    [t, "surface-card", 4.5],
  ]),
  ["text-secondary", "surface-subtle", 4.5],
  ["text-inverse", "primary", 4.5],
  ["text-inverse", "primary-pressed", 4.5],
  ["text-inverse", "destructive", 4.5],
  ["text-inverse", "destructive-pressed", 4.5],
  ["primary", "bg-page", 4.5],
  ["primary", "surface-card", 4.5],
  ["primary", "primary-tint", 4.5],
  ["bar-text", "bar-bg", 4.5],
  ["error-text", "error-bg", 4.5],
  ["error-text", "surface-card", 4.5],
  ["success-text", "success-bg", 4.5],
  ...statuses.map((s): [string, string, number] => [`status-${s}-text`, `status-${s}-bg`, 4.5]),
  ["border-input", "surface-card", 3],
  ["focus-ring", "bg-page", 3],
  ["focus-ring", "surface-card", 3],
  // Logo margin line: icons need 3:1 (DESIGN.md, WCAG 1.4.11).
  ["stamp", "bg-page", 3],
  ["bar-stamp", "bar-bg", 3],
];

describe("tokens.css contrast", () => {
  it("parses the tokens", () => {
    expect(Object.keys(tokens).length).toBeGreaterThan(50);
  });
  for (const theme of ["light", "dark"] as const) {
    for (const [fg, bg, min] of pairs) {
      it(`${theme}: ${fg} on ${bg} >= ${min}:1`, () => {
        expect(tokens[fg], `missing token ${fg}`).toBeDefined();
        expect(tokens[bg], `missing token ${bg}`).toBeDefined();
        expect(ratio(tokens[fg][theme], tokens[bg][theme])).toBeGreaterThanOrEqual(min);
      });
    }
  }
});
