import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { pack } from "../scripts/package.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const realBytes = () => readFileSync(join(root, "manifest.json"));
const real = JSON.parse(realBytes());
const TOP = ["manifest.json", "popup.html", "popup.css", "popup.js"];

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(posix.join(dir, e.name)) : [posix.join(dir, e.name)],
  );
}
const shipped = [...TOP, ...walk("src"), ...walk("icons")].sort();

const made = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "talaan-pack-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const list = (zip) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n").sort();
const entry = (zip, name) => execFileSync("unzip", ["-p", zip, name]);
const names = (version) => [
  `talaan-extension-friends-${version}.zip`,
  `talaan-extension-store-${version}.zip`,
];

// A copy of the shipping files whose manifest the caller may edit.
function fixture(edit) {
  const dir = temp();
  for (const name of [...TOP, "src", "icons"]) cpSync(join(root, name), join(dir, name), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json")));
  edit?.(manifest, dir);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

describe("package", () => {
  it("builds both zips with exactly the shipping files", () => {
    const out = temp();
    const { store, friends } = pack({ outDir: out });
    expect(store).toBe(join(out, `talaan-extension-store-${real.version}.zip`));
    expect(friends).toBe(join(out, `talaan-extension-friends-${real.version}.zip`));
    expect(readdirSync(out).sort()).toEqual(names(real.version));
    expect(list(store)).toEqual(shipped);
    expect(list(friends)).toEqual(shipped);
  });

  it("drops the key for the store only and keeps everything else identical", () => {
    const sha = () => createHash("sha256").update(realBytes()).digest("hex");
    const before = sha();
    const { store, friends } = pack({ outDir: temp() });
    const { key, ...withoutKey } = real;
    expect(key).toBeTruthy();
    expect(JSON.parse(entry(store, "manifest.json"))).toStrictEqual(withoutKey);
    expect(entry(friends, "manifest.json").equals(realBytes())).toBe(true);
    for (const name of shipped.filter((n) => n !== "manifest.json")) {
      expect(entry(store, name).equals(entry(friends, name)), name).toBe(true);
    }
    expect(sha()).toBe(before);
  });

  it("can run twice into the same directory without stale entries", () => {
    const dir = fixture((_, d) => writeFileSync(join(d, "src", "stale.js"), ""));
    const out = temp();
    pack({ root: dir, outDir: out });
    rmSync(join(dir, "src", "stale.js"));
    const { store, friends } = pack({ root: dir, outDir: out });
    expect(list(store)).toEqual(shipped);
    expect(list(friends)).toEqual(shipped);
  });

  it("leaves hidden and backup files out", () => {
    const dir = fixture((m, d) => {
      writeFileSync(join(d, "src", ".DS_Store"), "");
      writeFileSync(join(d, `${Object.values(m.icons)[0]}~`), "");
    });
    const { store, friends } = pack({ root: dir, outDir: temp() });
    expect(list(store)).toEqual(shipped);
    expect(list(friends)).toEqual(shipped);
  });

  it("runs from any working directory", () => {
    const out = temp();
    execFileSync(process.execPath, [join(root, "scripts", "package.js"), "--out", out], { cwd: temp() });
    expect(readdirSync(out).sort()).toEqual(names(real.version));
  });

  it("accepts a name of 75 and a description of 132 characters", () => {
    const dir = fixture((m) => {
      m.name = "n".repeat(75);
      m.description = "d".repeat(132);
    });
    expect(() => pack({ root: dir, outDir: temp() })).not.toThrow();
  });

  function rejects(edit, message) {
    const dir = fixture(edit);
    const out = temp();
    expect(() => pack({ root: dir, outDir: out })).toThrow(message);
    expect(readdirSync(out)).toEqual([]);
  }

  it("rejects a missing icon file and names it", () => {
    let icon;
    const dir = fixture((m, d) => {
      icon = Object.values(m.icons)[0];
      rmSync(join(d, icon));
    });
    const out = temp();
    expect(() => pack({ root: dir, outDir: out })).toThrow(icon);
    expect(readdirSync(out)).toEqual([]);
  });

  it("rejects a referenced file outside the shipping set", () => {
    rejects((m, d) => {
      writeFileSync(join(d, "README.md"), "");
      m.action.default_popup = "README.md";
    }, /README\.md/);
  });

  it.each([
    ["no 128 icon", (m) => delete m.icons["128"], /128/],
    ["manifest_version 2", (m) => (m.manifest_version = 2), /manifest_version/],
    ["a long name", (m) => (m.name = "n".repeat(76)), /name.*75/],
    ["a long description", (m) => (m.description = "d".repeat(133)), /description.*132/],
    ["an extra permission", (m) => m.permissions.push("tabs"), /^permissions/],
    ["an extra host permission", (m) => m.host_permissions.push("https://example.com/*"), /host_permissions/],
    ["no key", (m) => delete m.key, /key/],
    ["a suffixed version", (m) => (m.version = "0.2.0-beta"), /version_name/],
  ])("rejects %s", (_, edit, message) => rejects(edit, message));
});
