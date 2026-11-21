// Local screenshots of the A1 /admin invite page (light and dark at 390 and 1280). NOT in package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<chrome> E2E_API_PORT=8100 E2E_WEB_PORT=3100 node scripts/screens-admin.cjs
//
// Same setup and teardown as the e2e scripts (scripts/local-env.cjs). Files land in
// frontend/.screenshots/a1/ as {theme}-{width}-{name}.png (gitignored). Every shot is taken after a
// reload, so no code is on screen; the one exception masks the code element. /admin shows no emails.
process.env.E2E_ADMIN_EMAILS = "admin-shots@example.ph";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");

const OUT = path.resolve(__dirname, "../.screenshots/a1");
const SIZES = [
  [390, 844],
  [1280, 800],
];
const PASSWORD = "Passw0rd!shots";

withEnv(async ({ base, apiBase, createInvite }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const boot = await (await chromium.launch(chromiumOptions())).newContext();
  const r = await boot.request.post(`${base}/api/v1/signup`, { data: { email: process.env.E2E_ADMIN_EMAILS, password: PASSWORD, account_name: "Shots Admin", invite_code: createInvite("a1 screens") } });
  if (!r.ok()) throw new Error("signup failed " + r.status());
  await boot.request.post(`${base}/api/v1/login`, { data: { email: process.env.E2E_ADMIN_EMAILS, password: PASSWORD } });
  const create = async (note, days) => {
    const x = await boot.request.post(`${base}/api/v1/admin/invites`, { data: { note, expires_in_days: days, password: PASSWORD } });
    if (!x.ok()) throw new Error("create failed " + x.status());
    return (await x.json()).code;
  };
  // One used by a fictional friend (API signup, no Origin header), one unused with a note, one unused without.
  const used = await create("Ana from the bootcamp", 14);
  const s = await fetch(`${apiBase}/api/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ana-cruz-shots@example.ph", password: PASSWORD, account_name: "Ana Cruz", invite_code: used }),
  });
  if (!s.ok) throw new Error("friend signup failed " + s.status);
  await create("Kuya Miguel, frontend meetup", 30);
  await create("", 7);
  await boot.browser().close();

  const browser = await chromium.launch(chromiumOptions());
  let shots = 0;
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const lr = await ctx.request.post(`${base}/api/v1/login`, { data: { email: process.env.E2E_ADMIN_EMAILS, password: PASSWORD } });
      if (!lr.ok()) throw new Error("login failed " + lr.status());
      const page = await ctx.newPage();
      const shot = async (name, opts = {}) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `${theme}-${width}-${name}.png`), ...opts });
        shots++;
        console.log(`${theme}-${width}-${name}`);
      };
      await page.goto(`${base}/admin`);
      await page.getByText("Kuya Miguel, frontend meetup").waitFor();
      await page.reload();
      await page.getByText("Kuya Miguel, frontend meetup").waitFor();
      await shot("admin", { fullPage: width < 1280 });
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
      console.log(`  ${theme}-${width}: body background ${bg} (${(theme === "dark") === lum < 128 ? "matches" : "DOES NOT MATCH"} ${theme})`);

      if (theme === "light" && width === 390) {
        await page.getByLabel("Note").fill("Fresh code");
        await page.getByLabel("Your password", { exact: true }).fill(PASSWORD);
        await page.getByRole("button", { name: "Create code" }).click();
        const code = page.locator('section[aria-labelledby="new-code"] p.select-all');
        await code.waitFor();
        await shot("admin-new-code-masked", { fullPage: true, mask: [code] });
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${shots} screenshots in ${OUT}`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
