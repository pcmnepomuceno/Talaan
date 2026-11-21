// SPIKE ONLY: never merge to main. Reproducer for ROADMAP S0.
//   NODE_PATH=... PW_CHROMIUM=... E2E_API_PORT=8100 E2E_WEB_PORT=3100 SPIKE_DEBUG=1 \
//     node extension-spike/run.cjs [--allow-ours] [--3pc=default|block-pref|phaseout-flag]
// --allow-ours sets EXTENSION_ORIGINS to our extension's origin (same as exporting it yourself).
const { chromium } = require("playwright");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { withEnv, chromiumOptions, REPO } = require("../frontend/scripts/local-env.cjs");
const { ensureKeys, idFromPath, SCRATCH } = require("./keys.cjs");
const fixtures = require("./fixtures.cjs");

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split("=")[1];
const MODE3PC = arg("3pc", "default");
const ALLOW = process.argv.includes("--allow-ours");
const HERE = __dirname;
const RUN = path.join(SCRATCH, `run-${process.pid}`);
const PW = "Passw0rd!spike";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (t) => console.log(`\n=== ${t} ===`);

function maskedTestUrl() {
  let dev = process.env.DATABASE_URL;
  if (!dev) for (const l of fs.readFileSync(path.join(REPO, ".env"), "utf8").split("\n")) { const m = l.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/); if (m) dev = m[1].replace(/^["']|["']$/g, ""); }
  const test = process.env.TEST_DATABASE_URL || dev.replace(/([^/?]+)(\?.*)?$/, "$1_test$2");
  const masked = test.replace(/(\/\/[^:/@]+:)[^@]*@/, "$1***@");
  if (!/_test(\?.*)?$/.test(test)) throw new Error("test database must end in _test");
  return masked;
}
const ss = (label) => {
  const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" }).split("\n").filter((l) => /:(8000|8100|3000|3100)\s/.test(l));
  console.log(`ss ${label}: ${out.length ? "\n" + out.join("\n") : "nothing on 8000/8100/3000/3100"}`);
};
function copyExt(src, dest, edit) {
  fs.cpSync(src, dest, { recursive: true });
  const mf = path.join(dest, "manifest.json");
  const m = JSON.parse(fs.readFileSync(mf, "utf8"));
  edit?.(m);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
}
const table = (rows) => console.table(rows);

async function main() {
  console.log(`test db: ${maskedTestUrl()}`);
  ss("before");
  fs.mkdirSync(RUN, { recursive: true });
  const ids = ensureKeys();
  console.log("derived IDs:", ids);
  if (ALLOW) process.env.EXTENSION_ORIGINS = `chrome-extension://${ids.ours}`;
  console.log(`run: allow-ours=${ALLOW} EXTENSION_ORIGINS=${process.env.EXTENSION_ORIGINS || "(unset)"} 3pc=${MODE3PC} SPIKE_DEBUG=${process.env.SPIKE_DEBUG}`);
  if (process.env.SPIKE_DEBUG !== "1") throw new Error("set SPIKE_DEBUG=1");

  const fx = await fixtures.start();
  const FX = `http://127.0.0.1:${fx.port}`;
  let ctx;
  const profile = path.join(RUN, "profile");
  try {
    await withEnv(async ({ base, apiBase, createInvite }) => {
      // extension copies generated at run time (committed files untouched)
      const keylessA = path.join(RUN, "keyless-a"), keylessB = path.join(RUN, "keyless-b");
      const dropKey = (m) => { delete m.key; m.name += " keyless"; };
      copyExt(path.join(HERE, "ours"), keylessA, dropKey);
      copyExt(path.join(HERE, "ours"), keylessB, dropKey);
      const hostperm = path.join(RUN, "hostperm"); // reads fixtures through a host permission instead of activeTab
      copyExt(path.join(HERE, "ours"), hostperm, (m) => { delete m.key; m.name += " hostperm"; m.host_permissions.push(`${FX}/*`); });
      const manualSrc = path.join(HERE, "manual");
      const manualCopy = path.join(RUN, "manual-localhost");
      fs.cpSync(manualSrc, manualCopy, { recursive: true });
      for (const f of ["manifest.json", "popup.js"]) {
        const p = path.join(manualCopy, f);
        fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("https://talaan-phi.vercel.app", base));
      }
      const manualId = idFromPath(manualCopy);
      const dirs = [path.join(HERE, "ours"), path.join(HERE, "other"), keylessA, keylessB, hostperm, manualCopy];

      // committed manual extension: static checks
      const mm = JSON.parse(fs.readFileSync(path.join(manualSrc, "manifest.json"), "utf8"));
      const mjs = fs.readFileSync(path.join(manualSrc, "popup.js"), "utf8");
      section("manual extension static checks (committed files)");
      table([
        { check: 'no "key"', ok: !("key" in mm) },
        { check: "host_permissions exactly the prod host", ok: JSON.stringify(mm.host_permissions) === '["https://talaan-phi.vercel.app/*"]' },
        { check: "no permissions field", ok: !("permissions" in mm) && !("optional_permissions" in mm) && !("background" in mm) },
        { check: "no .json( .text( innerHTML console in popup.js", ok: !/\.json\(|\.text\(|innerHTML|console\./.test(mjs) },
        { check: "exactly one fetch", ok: (mjs.match(/fetch\(/g) || []).length === 1 },
      ]);

      // profile + 3PC mode
      fs.mkdirSync(path.join(profile, "Default"), { recursive: true });
      const args = [`--disable-extensions-except=${dirs.join(",")}`, `--load-extension=${dirs.join(",")}`, "--disable-features=DisableLoadExtensionCommandLineSwitch"];
      if (MODE3PC === "block-pref") fs.writeFileSync(path.join(profile, "Default/Preferences"), JSON.stringify({ profile: { cookie_controls_mode: 1 } }));
      if (MODE3PC === "phaseout-flag") args.push("--test-third-party-cookie-phaseout");
      ctx = await chromium.launchPersistentContext(profile, { ...chromiumOptions(), headless: true, args, ignoreDefaultArgs: ["--disable-extensions"] });
      const swWait = Date.now() + 15000;
      while (ctx.serviceWorkers().length < 5 && Date.now() < swWait) await sleep(300);
      const first = ctx.pages()[0] || (await ctx.newPage());
      const cdp = await ctx.newCDPSession(first);
      const ver = await cdp.send("Browser.getVersion");
      section("browser");
      console.log(`product=${ver.product} userAgent=${ver.userAgent}`);
      console.log(`launch: headless:true (executablePath ${path.basename(path.dirname(path.dirname(chromiumOptions().executablePath || "")))}), args=${JSON.stringify(args.map((a) => a.replaceAll(RUN, "<run>").replaceAll(HERE, "<repo>/extension-spike")))}, ignoreDefaultArgs=[--disable-extensions]`);
      const sws = ctx.serviceWorkers().map((w) => new URL(w.url()).host);
      console.log(`service workers seen: ${sws.length}`, sws);
      const swFor = (id) => ctx.serviceWorkers().find((w) => new URL(w.url()).host === id);
      if (!swFor(ids.ours)) throw new Error("ENVIRONMENT FAILURE: extension service worker for ours not present; build ignores --load-extension");

      // ---- IDs
      section("extension IDs");
      const reported = { ours: await swFor(ids.ours).evaluate(() => chrome.runtime.id), other: await swFor(ids.other).evaluate(() => chrome.runtime.id) };
      const kl = { a: idFromPath(keylessA), b: idFromPath(keylessB), hostperm: idFromPath(hostperm) };
      table([
        { ext: "ours (keyed)", derived: ids.ours, reported: reported.ours, match: ids.ours === reported.ours },
        { ext: "other (keyed)", derived: ids.other, reported: reported.other, match: ids.other === reported.other },
        { ext: "keyless copy A", derived_from_path: kl.a, sw_present: !!swFor(kl.a) },
        { ext: "keyless copy B", derived_from_path: kl.b, sw_present: !!swFor(kl.b) },
      ]);
      console.log(`keyless IDs differ from each other and from ours: ${new Set([kl.a, kl.b, ids.ours]).size === 3}`);
      console.log(`manual copy (keyless, path-derived) id=${manualId}`);

      // ---- login
      section("login (signup fetch from a first-party page on the Next origin)");
      const email = `spike-${Date.now()}@example.com`;
      const lp = await ctx.newPage();
      await lp.goto(`${base}/login`);
      const su = await lp.evaluate(async ([email, password, code]) => {
        const r = await fetch("/api/v1/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, account_name: "Spike", invite_code: code }) });
        const l = await fetch("/api/v1/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        return `${r.status}, login ${l.status}`;
      }, [email, PW, createInvite("s0 spike")]);
      await lp.close();
      console.log(`signup status ${su}; cookies in jar: ${(await ctx.cookies()).length}`);
      for (const c of await ctx.cookies()) console.log(`cookie ${c.name} domain=${c.domain} path=${c.path} httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite} expires=${c.expires > 0 ? "set" : "session"} value=<redacted>`);

      // ---- matrix
      const APP = { company: "Spike Co", job_name: "Engineer", status: "saved", mode_of_work: "remote" };
      const ops = [
        ["GET echo", "/api/v1/_spike/echo", "GET", null],
        ["POST echo", "/api/v1/_spike/echo", "POST", {}],
        ["GET me", "/api/v1/me", "GET", null],
        ["POST applications", "/api/v1/applications", "POST", APP],
      ];
      const targets = { "3100 (Next)": base, "8100 (API)": apiBase };
      const call = (runner, t, p, m, b, man) => runner.evaluate(([t, p, m, b, man]) => probe(t, p, m, b, man), [t, p, m, b, man]);
      const rowOf = (ext, cx, tg, op, r) => ({ ext, context: cx, target: tg, op, status: r.status ?? r.error, origin: r.body?.origin, site: r.body?.sec_fetch_site, mode: r.body?.sec_fetch_mode, dest: r.body?.sec_fetch_dest, cookie_present: r.body?.cookie_present, redirected: r.redirected });
      const rows = [];
      for (const ext of ["ours", "other"]) {
        const id = ids[ext];
        const popup = await ctx.newPage();
        await popup.goto(`chrome-extension://${id}/popup.html?harness`);
        for (const [cx, runner] of [["service worker", swFor(id)], ["popup page", popup]])
          for (const [tg, url] of Object.entries(targets))
            for (const [op, p, m, b] of ops) rows.push(rowOf(ext, cx, tg, op, await call(runner, url, p, m, b, false)));
        await popup.close();
      }
      section(`logged-in matrix (run ${ALLOW ? "EXTENSION_ORIGINS=ours" : "EXTENSION_ORIGINS unset"}, 3pc=${MODE3PC})`);
      table(rows);

      // ---- manual extension popup, logged in
      const manualPopup = async () => {
        const pg = await ctx.newPage();
        await pg.goto(`chrome-extension://${manualId}/popup.html`);
        await pg.waitForFunction(() => document.getElementById("result").textContent !== "Checking...", null, { timeout: 15000 });
        const text = await pg.locator("#result").textContent();
        await pg.getByRole("button", { name: "Show Origin" }).click();
        const origin = await pg.locator("#originText").textContent();
        await pg.close();
        return { result: text, origin };
      };
      section("manual extension (localhost copy), logged in");
      console.log(await manualPopup());

      // ---- activeTab
      section("activeTab");
      const sw = swFor(ids.ours);
      const hp = swFor(kl.hostperm);
      const tabIdOfActive = (w) => w.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);
      const grantTries = {};
      for (const [name, url] of [["jobposting", `${FX}/jobposting`], ["og", `${FX}/og`], ["plain", `${FX}/plain`], ["pdf", `${FX}/doc.pdf`], ["chrome://version", "chrome://version"]]) {
        const pg = await ctx.newPage();
        let navErr = "";
        try { await pg.goto(url, { timeout: 10000 }); } catch (e) { navErr = String(e.message).split("\n")[0]; }
        await pg.bringToFront();
        const tabId = await tabIdOfActive(sw);
        const noGrant = await sw.evaluate((id) => readTab(id), tabId);
        // try to produce a real grant: keyboard shortcut, then action.openPopup
        let grant = "none";
        await pg.keyboard.press("Alt+Shift+Y").catch(() => {});
        await sleep(500);
        let after = await sw.evaluate((id) => readTab(id), tabId);
        if (!after.ok) {
          const op = await sw.evaluate(async () => { try { await chrome.action.openPopup(); return "openPopup ok"; } catch (e) { return "openPopup error: " + e.message; } });
          grant = `shortcut: no effect; ${op}`;
          await sleep(500);
          after = await sw.evaluate((id) => readTab(id), tabId);
        } else grant = "shortcut worked";
        const viaHost = tabId ? await hp.evaluate((id) => readTab(id), tabId) : null;
        console.log(JSON.stringify({ page: name, navErr: navErr || undefined, tabId, withoutGrant: noGrant, afterGrantAttempt: after, grantAttempt: grant, viaHostPermissionCopy: viaHost }));
        grantTries[name] = after.ok ? "granted" : "not granted";
        await pg.close();
      }
      console.log("real activeTab grant by click/shortcut in headless:", JSON.stringify(grantTries));

      // ---- SW idle
      section("service worker idle (CDP/Playwright attached: weak evidence)");
      const t0 = Date.now();
      const slow = await Promise.race([call(sw, apiBase, "/api/v1/_spike/slow?s=40", "GET", null, false), sleep(70000).then(() => "timeout")]);
      console.log(`slow?s=40 from SW: ${JSON.stringify(slow.status ?? slow.error ?? slow)} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      // ---- logged out
      section("logged out (cookies cleared), redirect: manual");
      await ctx.clearCookies();
      const lo = [];
      for (const [tg, url] of Object.entries(targets))
        for (const [op, p, m, b] of ops.slice(2)) {
          const r = await call(sw, url, p, m, b, true);
          lo.push({ target: tg, op, status: r.status ?? r.error, body: JSON.stringify(r.body), redirected: r.redirected, type: r.type, location: r.location });
        }
      table(lo);
      section("manual extension (localhost copy), logged out");
      console.log(await manualPopup());
    });
  } finally {
    await ctx?.close().catch(() => {});
    if (MODE3PC === "block-pref") {
      try { console.log("Preferences after run, profile.cookie_controls_mode =", JSON.parse(fs.readFileSync(path.join(profile, "Default/Preferences"), "utf8")).profile?.cookie_controls_mode); } catch (e) { console.log("could not read Preferences:", e.message); }
    }
    fx.server.close();
    fs.rmSync(RUN, { recursive: true, force: true });
    console.log(`temp dir removed: ${!fs.existsSync(RUN)}; fixture server closed`);
    ss("after");
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
