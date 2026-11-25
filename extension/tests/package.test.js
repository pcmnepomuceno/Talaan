import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { keep, pack } from "../scripts/package.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const realBytes = () => readFileSync(join(root, "manifest.json"));
const real = JSON.parse(realBytes());
const TOP = ["manifest.json", "popup.html", "popup.css", "popup.js"];

const scriptPath = join(root, "scripts", "package.js");
// Files the packer ships under base: the walk applies the same filter as the packer.
function walk(base, dir) {
  return readdirSync(join(base, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(base, posix.join(dir, e.name)) : [posix.join(dir, e.name)],
  ).filter(keep);
}
const files = (base) => [...TOP, ...walk(base, "src"), ...walk(base, "icons")].sort();
const shipped = files(root);

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
      writeFileSync(join(d, "icons", ".DS_Store"), "");
      writeFileSync(join(d, `${Object.values(m.icons)[0]}~`), "");
    });
    const { store, friends } = pack({ root: dir, outDir: temp() });
    expect(files(dir)).not.toContain("src/.DS_Store");
    expect(files(dir)).not.toContain("icons/.DS_Store");
    expect(files(dir)).not.toContain(`${real.icons["128"]}~`);
    expect(list(store)).toEqual(files(dir));
    expect(list(friends)).toEqual(files(dir));
  });

  it("leaves zips from an earlier run in place", () => {
    const out = temp();
    const old = "talaan-extension-store-0.0.1.zip";
    writeFileSync(join(out, old), "old");
    pack({ outDir: out });
    expect(readFileSync(join(out, old), "utf8")).toBe("old");
    expect(readdirSync(out).sort()).toEqual([old, ...names(real.version)].sort());
  });

  it.each([
    ["an absolute", (linkDir) => scriptPath],
    ["a relative", (linkDir) => relative(linkDir, scriptPath)],
  ])("runs through %s symlink", (_, target) => {
    const linkDir = temp();
    const link = join(linkDir, "package.js");
    symlinkSync(target(linkDir), link);
    const out = temp();
    execFileSync(process.execPath, [link, "--out", out]);
    expect(readdirSync(out).sort()).toEqual(names(real.version));
  });

  it("runs when started without the .js extension", () => {
    const out = temp();
    execFileSync(process.execPath, [join(root, "scripts", "package"), "--out", out]);
    expect(readdirSync(out).sort()).toEqual(names(real.version));
  });

  it("does nothing when imported and argv[1] is a missing path", () => {
    const stdout = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(scriptPath).href)})`, join(temp(), "no-such-file")],
      { encoding: "utf8" },
    );
    expect(stdout).toBe("");
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
    ["a part over 65535", (m) => (m.version = "1.70000"), /part "70000"/],
    ["a leading zero", (m) => (m.version = "01.2"), /part "01"/],
    ["five parts", (m) => (m.version = "1.2.3.4.5"), /1 to 4/],
    ["an empty middle part", (m) => (m.version = "1..2"), /part ""/],
    ["an empty version", (m) => (m.version = ""), /part ""/],
    ["version 0", (m) => (m.version = "0"), /all zeros/],
    ["version 0.0.0.0", (m) => (m.version = "0.0.0.0"), /all zeros/],
  ])("rejects %s", (_, edit, message) => rejects(edit, message));

  it.each(["0.1.0", "1", "65535.0.0.1"])("accepts version %s", (version) => {
    const dir = fixture((m) => (m.version = version));
    const out = temp();
    pack({ root: dir, outDir: out });
    expect(readdirSync(out).sort()).toEqual(names(version));
  });

  it("rejects a referenced hidden file the packer would drop", () => {
    rejects((m, d) => {
      copyFileSync(join(d, m.icons["128"]), join(d, "icons/.icon-128.png"));
      m.icons["128"] = "icons/.icon-128.png";
    }, /left out of the zip/);
  });
});
