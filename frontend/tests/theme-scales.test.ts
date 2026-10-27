import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";
import { expect, it } from "vitest";

// Compiles the real globals.css with Tailwind and checks which utilities come out.
// tokens.css resets only the namespaces it replaces; the built-in scales below must survive.
async function build(candidates: string[]) {
  const compiler = await compile(readFileSync("src/app/globals.css", "utf8"), {
    base: "src/app",
    loadStylesheet: async (id) => {
      const path = id === "tailwindcss" ? "node_modules/tailwindcss/index.css" : `src/styles/${id.split("/").pop()}`;
      return { path, base: "src/app", content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

it("keeps the container, animate, ease, leading and tracking scales", async () => {
  const css = await build(["max-w-xl", "animate-pulse", "ease-out", "leading-tight", "tracking-tight"]);
  expect(css).toMatch(/\.max-w-xl\s*\{/);
  expect(css).toMatch(/\.animate-pulse\s*\{/);
  expect(css).toMatch(/@keyframes pulse\b/);
  expect(css).toMatch(/\.ease-out\s*\{/);
  expect(css).toMatch(/\.leading-tight\s*\{/);
  expect(css).toMatch(/\.tracking-tight\s*\{/);
});

it("still drops the default palette, type sizes, radii and shadows", async () => {
  const css = await build(["bg-red-500", "text-sm", "rounded-lg", "shadow-md", "font-mono"]);
  for (const c of ["bg-red-500", "text-sm", "rounded-lg", "shadow-md", "font-mono"]) {
    expect(css).not.toMatch(new RegExp(`\\.${c}\\s*\\{`));
  }
});
