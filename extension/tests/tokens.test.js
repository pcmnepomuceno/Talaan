import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const popupCss = readFileSync(path.resolve(root, "popup.css"), "utf8");
const popupHtml = readFileSync(path.resolve(root, "popup.html"), "utf8");
const tokensCss = readFileSync(path.resolve(root, "../frontend/src/styles/tokens.css"), "utf8");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const declared = (css) =>
  new Map([...css.matchAll(/(--color-[a-z0-9-]+)\s*:\s*(light-dark\([^;]*\))\s*;/g)].map((m) => [m[1], norm(m[2])]));

describe("popup.css tokens", () => {
  const mine = declared(popupCss);
  const source = declared(tokensCss);

  it("declares at least 10 color tokens", () => {
    expect(mine.size).toBeGreaterThanOrEqual(10);
  });

  it("every copied token has the same name and value as frontend tokens.css", () => {
    for (const [name, value] of mine) expect(source.get(name), name).toBe(value);
  });

  it("uses light-dark with both schemes", () => {
    expect(popupCss).toMatch(/color-scheme:\s*light dark/);
  });

  it("keeps hex values inside the token block only", () => {
    const outside = popupCss.replace(/--color-[a-z0-9-]+\s*:[^;]*;/g, "");
    expect(outside).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("loads nothing: no url(), @import or @font-face", () => {
    expect(popupCss).not.toMatch(/url\(/i);
    expect(popupCss).not.toMatch(/@import/i);
    expect(popupCss).not.toMatch(/@font-face/i);
  });

  it("uses no uppercase transform and only the Plex stack", () => {
    expect(popupCss).not.toMatch(/uppercase/i);
    expect(popupCss).toContain('font-family: "IBM Plex Sans", system-ui, sans-serif');
    expect(popupCss).not.toMatch(/monospace/i);
  });

  it("turns the fade off for reduced motion", () => {
    const block = popupCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? "";
    expect(block).toMatch(/animation:\s*none/);
    expect(block).not.toMatch(/\d(ms|s)\b/);
    if (/transition\s*:/.test(popupCss)) expect(block).toMatch(/transition:\s*none/);
  });

  it("keeps every animation and transition at 100ms or less", () => {
    const outside = popupCss.replace(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\}\s*\}/, "");
    const decls = [...outside.matchAll(/(?:animation|transition)(?:-duration|-delay)?\s*:\s*([^;}]*)/g)].map((m) => m[1]);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      for (const [, n, unit] of d.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
        expect(Number(n) * (unit === "s" ? 1000 : 1), d).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("popup.html", () => {
  it("has no inline script, inline style or inline handler", () => {
    expect(popupHtml).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(popupHtml).not.toMatch(/\sstyle\s*=/i);
    expect(popupHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(popupHtml).not.toMatch(/<style/i);
  });

  it("has one module script and one stylesheet, both local", () => {
    expect(popupHtml.match(/<script\b/gi)).toHaveLength(1);
    expect(popupHtml).toContain('<script type="module" src="popup.js"></script>');
    expect(popupHtml).toContain('<link rel="stylesheet" href="popup.css">');
  });

  it("has no password input", () => {
    expect(popupHtml).not.toMatch(/type\s*=\s*["']?password/i);
  });
});
