// Builds the store zip (no "key") and the friends zip (keeps the pinned ID) into dist/.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

const SHIP = ["manifest.json", "popup.html", "popup.css", "popup.js", "src", "icons"];
const PERMISSIONS = ["activeTab", "scripting"];
const HOSTS = ["https://talaan-phi.vercel.app/*"];
// Editor and OS strays. Basename only: the extension may itself sit under a dot-directory.
const keep = (path) => !basename(path).startsWith(".") && !path.endsWith("~");

function validate(manifest, root) {
  const check = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  check(manifest.manifest_version === 3, "manifest_version must be 3");
  const v = manifest.version;
  const parts = typeof v === "string" ? v.split(".") : [];
  check(parts.length >= 1 && parts.length <= 4,
    `version "${v}" must be 1 to 4 dot-separated integers (put a label in version_name)`);
  for (const part of parts)
    check(/^(0|[1-9]\d*)$/.test(part) && Number(part) <= 65535,
      `version "${v}": part "${part}" must be an integer from 0 to 65535 with no leading zero (put a label in version_name)`);
  check(parts.some((p) => p !== "0"), `version "${v}" must not be all zeros`);
  check(manifest.name?.length <= 75, "name must be at most 75 characters");
  check(manifest.description?.length <= 132, "description must be at most 132 characters");
  check(manifest.icons?.["128"], 'icons must include a "128" entry');
  const { default_icon, default_popup } = manifest.action ?? {};
  const paths = [manifest.icons, default_icon, default_popup].flatMap((v) =>
    typeof v === "object" ? Object.values(v) : (v ?? []),
  );
  for (const path of paths) {
    check(existsSync(join(root, path)), `missing file: ${path}`);
    check(keep(path), `file would be left out of the zip (hidden or ~ backup): ${path}`);
    // normalize first, so "src/../README.md" does not pass as "src".
    check(SHIP.includes(posix.normalize(path).split("/")[0]), `file is not in the shipping set: ${path}`);
  }
  check(isDeepStrictEqual(manifest.permissions, PERMISSIONS), `permissions must be ${JSON.stringify(PERMISSIONS)}`);
  check(isDeepStrictEqual(manifest.host_permissions, HOSTS), `host_permissions must be ${JSON.stringify(HOSTS)}`);
  check(typeof manifest.key === "string" && manifest.key, "key is missing (the friends zip needs it to pin the ID)");
}

export function pack({ root = fileURLToPath(new URL("..", import.meta.url)), outDir = join(root, "dist") } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  validate(manifest, root);

  const stage = mkdtempSync(join(tmpdir(), "talaan-stage-"));
  try {
    const built = ["store", "friends"].map((variant) => {
      const dir = join(stage, variant);
      for (const name of SHIP) cpSync(join(root, name), join(dir, name), { recursive: true, filter: keep });
      if (variant === "store") {
        const { key, ...withoutKey } = manifest;
        writeFileSync(join(dir, "manifest.json"), JSON.stringify(withoutKey, null, 2) + "\n");
      }
      const file = `talaan-extension-${variant}-${manifest.version}.zip`;
      // -D: no directory entries; -X: no uid/gid or extra timestamps.
      execFileSync("zip", ["-qrXD", join(stage, file), ...SHIP], { cwd: dir });
      return [variant, file];
    });
    // Copy only after both built, so a failure leaves nothing in outDir. Overwrites; zip never appends.
    mkdirSync(outDir, { recursive: true });
    return Object.fromEntries(
      built.map(([variant, file]) => {
        const target = resolve(outDir, file);
        copyFileSync(join(stage, file), target);
        return [variant, target];
      }),
    );
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { out: { type: "string" } } });
    const { store, friends } = pack({ outDir: values.out });
    console.log(`${store}\n${friends}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
