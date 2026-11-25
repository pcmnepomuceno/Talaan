// Local end-to-end check of the browser extension popup (extension/) on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<chromium binary> E2E_API_PORT=8100 E2E_WEB_PORT=3100 \
//     node frontend/scripts/e2e-extension.cjs
//
// scripts/local-env.cjs starts the API and `next dev` on free ports against the *_test database and cleans up
// afterwards. The committed extension/ is copied to a fresh mkdtemp dir (inside E2E_TMP_DIR when set, else the OS temp dir); only that dir is deleted
// afterwards, and ONLY the copy is rewritten:
// API_BASE and TAB_QUERY in src/config.js, host_permissions in manifest.json. The popup is opened as a TAB
// (chrome-extension://<id>/popup.html), so it cannot prove a real toolbar-click activeTab grant or the real
// action popup's Sec-Fetch-Site. Screenshots go to the gitignored frontend/.screenshots/. Exit code 1 on any failure.
process.env.E2E_EXTENSION_ORIGINS ??= "chrome-extension://fjlnbbkeadlpibmnbpfhlgeingifocni";
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv, REPO } = require("./local-env.cjs");

const ID = "fjlnbbkeadlpibmnbpfhlgeingifocni";
const EXT = path.join(REPO, "extension");
const SHOTS = path.resolve(__dirname, "../.screenshots");
let failed = 0;
let passed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  ok ? passed++ : failed++;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "tests", "package-lock.json"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : !/\.png$/.test(e.name) && out.push(p);
  }
  return out;
}

function rewrite(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) throw new Error(`${file}: expected exactly one occurrence of ${from}`);
  fs.writeFileSync(file, text.replace(from, () => to));
}

function fixtureServer() {
  let port = 0;
  const jsonLd = (title, url) =>
    `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title, hiringOrganization: { "@type": "Organization", name: "Fixture Co" }, url })}</script>`;
  const pages = {
    "/job": () => `<!doctype html><html><head><title>Careers | JobBoard</title><meta property="og:site_name" content="JobBoard">${jsonLd("Backend Engineer &amp; SRE", `http://localhost:${port}/job`)}</head><body>Job</body></html>`,
    "/plain": () => `<!doctype html><html><head><title>Platform Engineer</title></head><body>Plain</body></html>`,
    "/stale": () => `<!doctype html><html><head><title>Stale Page Role</title>${jsonLd("Old Role", `http://localhost:${port}/other`)}</head><body>Stale</body></html>`,
  };
  const server = http.createServer((req, res) => {
    const page = pages[new URL(req.url, "http://x").pathname];
    res.writeHead(page ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
    res.end(page ? page() : "not found");
  });
  return new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve({ server, port }); }));
}

withEnv(async ({ base, createInvite }) => {
  // The committed tree must not know about localhost.
  const hits = walk(EXT).filter((f) => fs.readFileSync(f, "utf8").includes("localhost"));
  check("committed extension/ contains no 'localhost'", hits.length === 0, hits.join(" "));
  if (hits.length) return;

  const tmp = fs.mkdtempSync(path.join(process.env.E2E_TMP_DIR || os.tmpdir(), "talaan-e2e-ext-"));
  const { server, port } = await fixtureServer();
  const copy = path.join(tmp, "ext");
  const profile = path.join(tmp, "profile");
  let ctx;
  const pageErrors = [];
  try {
    fs.cpSync(EXT, copy, {
      recursive: true,
      filter: (src) => !["node_modules", "tests", "README.md", "package.json", "package-lock.json", "vitest.config.js"].includes(path.basename(src)),
    });
    rewrite(path.join(copy, "src/config.js"), 'export const API_BASE = "https://talaan-phi.vercel.app";', `export const API_BASE = "${base}";`);
    rewrite(path.join(copy, "src/config.js"), "export const TAB_QUERY = { active: true, currentWindow: true };", `export const TAB_QUERY = { url: "http://localhost:${port}/*" };`);
    rewrite(path.join(copy, "manifest.json"), '"host_permissions": ["https://talaan-phi.vercel.app/*"]', `"host_permissions": ["${base}/*", "http://localhost:${port}/*"]`);

    ctx = await chromium.launchPersistentContext(profile, {
      headless: true,
      ...chromiumOptions(),
      viewport: { width: 1280, height: 900 },
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, "--disable-features=DisableLoadExtensionCommandLineSwitch"],
    });
    fs.mkdirSync(SHOTS, { recursive: true });
    const stamp = Date.now();
    const fx = (p) => `http://localhost:${port}${p}`;
    const popupUrl = `chrome-extension://${ID}/popup.html`;

    // 1. sign up through the web app so the cookie is set
    const web = await ctx.newPage();
    web.on("pageerror", (e) => pageErrors.push("web: " + e.message));
    await web.goto(`${base}/login`);
    await web.getByRole("radio", { name: "Create account" }).check({ force: true });
    await web.getByLabel("Invite code").fill(createInvite("e2b e2e"));
    await web.getByLabel("Account name").fill("E2E Tester");
    await web.getByLabel("Email").fill(`e2e-e2b-${stamp}@example.com`);
    await web.getByLabel("Password", { exact: true }).fill("Passw0rd!e2e");
    await web.getByRole("button", { name: "Create account", exact: true }).click();
    await web.waitForURL(/\/applications$/, { timeout: 15000 });
    check("signed up through the web app", true);
    const total = async () => (await (await ctx.request.get(`${base}/api/v1/applications`)).json()).total;

    // 2. fixture tab stays open; popup in a second tab
    const fixture = await ctx.newPage();
    await fixture.goto(fx("/job"));
    const popup = await ctx.newPage();
    popup.on("pageerror", (e) => pageErrors.push("popup: " + e.message));
    await popup.setViewportSize({ width: 360, height: 700 });
    const posts = [];
    popup.on("request", (r) => r.method() === "POST" && posts.push(r));
    const shoot = async (name) => {
      for (const theme of ["light", "dark"]) {
        await popup.emulateMedia({ colorScheme: theme });
        await popup.waitForTimeout(150);
        await popup.screenshot({ path: path.join(SHOTS, `e2b-${theme}-${name}.png`), fullPage: true });
      }
      await popup.emulateMedia({ colorScheme: "light" });
    };
    const label = (t, exact = true) => popup.getByLabel(t, { exact });
    const form = popup.locator("#form");

    let loaded = true;
    try {
      await popup.goto(popupUrl);
    } catch (e) {
      loaded = false;
      check(`popup loads at ${popupUrl} (extension id is ${ID})`, false, e.message);
    }
    if (!loaded) return;
    check(`popup loads at ${popupUrl}`, (await popup.title()) === "Talaan");
    await form.waitFor({ state: "visible", timeout: 15000 });
    check("form visible", true);
    const disclosureCheck = async (state) => {
      const el = popup.locator("#disclosure");
      const text =
        "Reads this page's link, title and job details when you open Talaan, and sends the link to your Talaan account to check for duplicates. Nothing is saved until you press Save. Privacy";
      check(`${state}: disclosure visible with the exact text`, (await el.isVisible()) && (await el.innerText()).trim() === text, await el.innerText());
      const a = el.getByRole("link", { name: "Privacy" });
      check(`${state}: disclosure link href, target and rel`, (await a.getAttribute("href")) === "https://talaan-phi.vercel.app/privacy" && (await a.getAttribute("target")) === "_blank" && (await a.getAttribute("rel")) === "noopener noreferrer", await a.getAttribute("href"));
      const box = await a.boundingBox();
      check(`${state}: disclosure link is at least 44x44`, box.width >= 44 && box.height >= 44, `${box.width}x${box.height}`);
    };
    await disclosureCheck("form");
    await popup.locator("#company").waitFor();
    check("prefill: Company is 'Fixture Co'", (await label("Company").inputValue()) === "Fixture Co", await label("Company").inputValue());
    check("prefill: Job title is 'Backend Engineer & SRE' (entity decoded)", (await label("Job title").inputValue()) === "Backend Engineer & SRE", await label("Job title").inputValue());
    check("prefill: Job posting URL is the fixture /job URL", (await label("Job posting URL").inputValue()) === fx("/job"), await label("Job posting URL").inputValue());
    check("prefill: no work mode checked", (await popup.locator('input[name="mode_of_work"]:checked').count()) === 0);
    check("prefill: status select is 'saved'", (await popup.locator("#status-select").inputValue()) === "saved");
    await shoot("prefilled-form");

    // 3. Remote, double-click Save, saved view, exactly one POST
    await popup.getByRole("radio", { name: "Remote" }).check({ force: true });
    await popup.getByRole("button", { name: "Save", exact: true }).dblclick();
    await popup.getByRole("heading", { name: "Saved" }).waitFor({ timeout: 15000 });
    check("saved view shows 'Saved'", true);
    await disclosureCheck("saved");
    const href = await popup.getByRole("link", { name: "Open in Talaan" }).getAttribute("href");
    const m = /^(.*)\/applications\/(\d+)$/.exec(href || "");
    check("'Open in Talaan' href is <base>/applications/<id>", !!m && m[1] === base, href);
    const id = m && m[2];
    check("the API holds exactly 1 application", (await total()) === 1, String(await total()));
    const apps = posts.filter((r) => new URL(r.url()).pathname === "/api/v1/applications");
    check("exactly one POST /api/v1/applications from the popup", apps.length === 1, `${apps.length}`);
    const hdr = apps.length ? await apps[0].allHeaders() : {};
    check(`the POST Origin is chrome-extension://${ID}`, hdr.origin === `chrome-extension://${ID}`, String(hdr.origin));
    console.log(`INFO  POST Sec-Fetch-Site: ${hdr["sec-fetch-site"]}; Sec-Fetch-Mode: ${hdr["sec-fetch-mode"]}; Sec-Fetch-Dest: ${hdr["sec-fetch-dest"]}`);
    await shoot("saved");

    // 4. reload: duplicate note, then Save anyway
    await popup.reload();
    const dup = popup.locator("#dup");
    await dup.waitFor({ state: "visible", timeout: 15000 });
    check("duplicate note text", (await dup.innerText()).includes("You already saved this posting"), await dup.innerText());
    const dl = dup.getByRole("link");
    check("duplicate link href is <base>/applications/<id>", (await dl.getAttribute("href")) === `${base}/applications/${id}`, await dl.getAttribute("href"));
    check("duplicate link target=_blank", (await dl.getAttribute("target")) === "_blank");
    await shoot("duplicate-note");
    await popup.getByRole("radio", { name: "Remote" }).check({ force: true });
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await popup.getByRole("heading", { name: "Saved" }).waitFor({ timeout: 15000 });
    check("Save anyway on a duplicate works (total 2)", (await total()) === 2, String(await total()));

    // 5. plain page: title only
    await fixture.goto(fx("/plain"));
    await fixture.bringToFront();
    await popup.bringToFront();
    await popup.reload();
    await form.waitFor({ state: "visible", timeout: 15000 });
    check("/plain: Job title 'Platform Engineer'", (await label("Job title").inputValue()) === "Platform Engineer", await label("Job title").inputValue());
    check("/plain: Company empty", (await label("Company").inputValue()) === "");

    // 6. stale JSON-LD is ignored
    await fixture.goto(fx("/stale"));
    await popup.reload();
    await form.waitFor({ state: "visible", timeout: 15000 });
    check("/stale: Company empty (stale JSON-LD ignored)", (await label("Company").inputValue()) === "", await label("Company").inputValue());
    check("/stale: Job title from the page title, not the stale JSON-LD", (await label("Job title").inputValue()) === "Stale Page Role", await label("Job title").inputValue());

    // 7. 401 on Save keeps the typed values; Check again returns to the form
    await fixture.goto(fx("/job"));
    await popup.reload();
    await form.waitFor({ state: "visible", timeout: 15000 });
    await label("Company").fill("Typed Co");
    await popup.getByRole("radio", { name: "Remote" }).check({ force: true });
    const saved = await ctx.cookies();
    await ctx.clearCookies();
    await popup.getByRole("button", { name: "Save", exact: true }).click();
    await popup.locator("#signedOut").waitFor({ state: "visible", timeout: 15000 });
    check("401 on Save: signed-out view appears", true);
    await ctx.addCookies(saved);
    await popup.getByRole("button", { name: "Check again" }).click();
    await form.waitFor({ state: "visible", timeout: 15000 });
    check("after Check again the form returns with the typed Company kept", (await label("Company").inputValue()) === "Typed Co", await label("Company").inputValue());

    // signed out from the start
    await ctx.clearCookies();
    await popup.reload();
    await popup.locator("#signedOut").waitFor({ state: "visible", timeout: 15000 });
    check("signed out: 'Open Talaan to sign in' visible", await popup.getByRole("button", { name: "Open Talaan to sign in" }).isVisible());
    check("signed out: no password input", (await popup.locator("input[type=password]").count()) === 0);
    await shoot("signed-out");

    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await ctx?.close().catch(() => {});
    await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
