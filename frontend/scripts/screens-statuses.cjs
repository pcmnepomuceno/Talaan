// Local screenshots of every status stamp and interview outcome stamp (P1, DESIGN.md 3.2), light and
// dark at 390 and 1280. NOT in package.json or CI. Review only: no palette change comes from this.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<chrome> node scripts/screens-statuses.cjs
//
// Same setup, teardown and output rules as screens-applications.cjs ({theme}-{width}-status-{name}.png in
// frontend/.screenshots/ and SCREENS_OUT). Seeds through the API on the TEST database only.
const fs = require("node:fs");
const path = require("node:path");
const { chromium, request } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");
const { PASSWORD, seedAccount } = require("./seed-applications.cjs");

const OUT = [path.resolve(__dirname, "../.screenshots"), process.env.SCREENS_OUT ?? "/mnt/c/dev/projects/portfolio/talaan-screens"];
const SIZES = [
  [390, 844],
  [1280, 1100],
];
const STATUSES = ["saved", "applied", "screening", "interviewing", "offered", "accepted", "rejected", "withdrawn", "ghosted"];
// The hand-made seed already has six statuses (and Pinagsama Tech with a pending, a good and a bad interview).
const EXTRA = [
  { company: "Kape Digital", job_name: "QA Analyst", status: "withdrawn", mode_of_work: "remote", salary: 45000, date_applied: "2026-10-05" },
  { company: "Kalayaan Logistics", job_name: "Fleet Data Analyst", status: "ghosted", mode_of_work: "on_site", salary: 55000, date_applied: "2026-09-20" },
  { company: "Mayon Software Labs", job_name: "Backend Developer", status: "accepted", mode_of_work: "hybrid", salary: 105000, date_applied: "2026-09-10" },
];

withEnv(async ({ base, createInvite }) => {
  const dirs = OUT.filter((d) => {
    if (d.startsWith(path.resolve(__dirname, ".."))) fs.mkdirSync(d, { recursive: true });
    else if (fs.existsSync(path.dirname(d))) fs.mkdirSync(d, { recursive: true });
    return fs.existsSync(d);
  });
  const acct = await seedAccount({ base, invite: createInvite("p1 status screens"), email: `shots-p1-${Date.now()}@example.com`, generic: 0 });
  const api = await request.newContext({ baseURL: base });
  await api.post("/api/v1/login", { data: { email: acct.email, password: PASSWORD } });
  for (const body of EXTRA) if (!(await api.post("/api/v1/applications", { data: body })).ok()) throw new Error("seed failed");
  await api.dispose();

  const browser = await chromium.launch(chromiumOptions());
  let shots = 0;
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const r = await ctx.request.post(`${base}/api/v1/login`, { data: { email: acct.email, password: PASSWORD } });
      if (!r.ok()) throw new Error("login failed " + r.status());
      const apps = (await (await ctx.request.get(`${base}/api/v1/applications?limit=100`)).json()).items;
      const byStatus = Object.fromEntries(apps.map((a) => [a.status, a.id]));
      const missing = STATUSES.filter((s) => !byStatus[s]);
      if (missing.length) throw new Error("missing statuses: " + missing);
      const page = await ctx.newPage();
      const shot = async (name, target = page, opts = {}) => {
        await page.waitForTimeout(300);
        for (const dir of dirs) await target.screenshot({ path: path.join(dir, `${theme}-${width}-status-${name}.png`), ...opts });
        shots++;
        console.log(`${theme}-${width}-status-${name}`);
      };

      await page.goto(`${base}/applications`);
      await page.getByRole("list", { name: "Applications" }).waitFor();
      await shot("list-all-nine", page, { fullPage: width < 1280 });

      for (const s of STATUSES) {
        await page.goto(`${base}/applications/${byStatus[s]}`);
        const header = page.locator('section[aria-label="Application detail"] .flex-col.gap-6 > div:first-child');
        await header.waitFor();
        await shot(`header-${s}`, header);
      }

      await page.goto(`${base}/applications/${byStatus.interviewing}`);
      await page.getByRole("list", { name: "Interviews" }).waitFor();
      await shot("detail-outcomes-pending-good-bad", page, { fullPage: width < 1280 });

      await page.getByRole("button", { name: "Change status" }).click();
      await page.getByRole("heading", { name: "Change status" }).waitFor();
      await shot("dialog-nine-statuses");
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${shots} screenshots`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
