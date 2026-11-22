import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

function textFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (["node_modules", "tests", "package-lock.json", ".git"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...textFiles(p));
    else if (!/\.(png|woff2?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("manifest", () => {
  it("has the fixed identity", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Talaan");
    expect(manifest.version).toBe("0.1.0");
    expect(manifest.minimum_chrome_version).toBe("123");
    expect(manifest.action.default_popup).toBe("popup.html");
  });

  it("asks for the minimum permissions", () => {
    expect(manifest.permissions).toEqual(["activeTab", "scripting"]);
    expect(manifest.host_permissions).toEqual(["https://talaan-phi.vercel.app/*"]);
    for (const k of [
      "background",
      "content_scripts",
      "optional_permissions",
      "optional_host_permissions",
      "externally_connectable",
      "web_accessible_resources",
      "commands",
    ]) {
      expect(manifest, k).not.toHaveProperty(k);
    }
  });

  it("has no localhost in the manifest or any extension source file", () => {
    expect(JSON.stringify(manifest).toLowerCase()).not.toContain("localhost");
    for (const f of textFiles(root)) {
      expect(readFileSync(f, "utf8").toLowerCase(), relative(root, f)).not.toContain("localhost");
    }
  });

  it("has no private key material", () => {
    for (const f of textFiles(root)) {
      expect(readFileSync(f, "utf8"), relative(root, f)).not.toMatch(/-----BEGIN/);
    }
  });

  it("ships the four icons", () => {
    for (const n of [16, 32, 48, 128]) {
      expect(existsSync(join(root, `icons/icon-${n}.png`)), `icon-${n}`).toBe(true);
    }
  });

  it("pins the extension ID", () => {
    const der = Buffer.from(manifest.key, "base64");
    const id = [...createHash("sha256").update(der).digest().subarray(0, 16)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
    console.log(`extension ID: ${id}`);
    expect(id).toBe("fjlnbbkeadlpibmnbpfhlgeingifocni");
  });
});
