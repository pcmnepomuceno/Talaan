// Local screenshots of the F9 month view (light and dark at 390, 768, 1280). NOT in package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<chrome> E2E_API_PORT=8100 node scripts/screens-calendar.cjs
//
// Same setup and teardown as the e2e scripts (scripts/local-env.cjs). Files land in
// frontend/.screenshots/f9/ as {theme}-{width}-{name}.png (gitignored).
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");

const OUT = path.resolve(__dirname, "../.screenshots/f9");
const SIZES = [
  [390, 844],
  [768, 1024],
  [1280, 800],
];
const PASSWORD = "Passw0rd!shots";
const phtDay = (n = 0) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const addMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const i = y * 12 + mo - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

withEnv(async ({ base, createInvite }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const email = `shots-f9-${Date.now()}@example.com`;
  const boot = await (await chromium.launch(chromiumOptions())).newContext();
  const r = await boot.request.post(`${base}/api/v1/signup`, { data: { email, password: PASSWORD, account_name: "Shots", invite_code: createInvite("f9 screens") } });
  if (!r.ok()) throw new Error("signup failed " + r.status() + " " + (await r.text()));
  await boot.request.post(`${base}/api/v1/login`, { data: { email, password: PASSWORD } });
  const post = async (url, data) => {
    const x = await boot.request.post(`${base}/api/v1${url}`, { data });
    if (!x.ok()) throw new Error(`POST ${url} -> ${x.status()} ${await x.text()}`);
    return x.json();
  };
  // Fictional companies only (DESIGN.md section 9).
  const names = [
    ["Pinagsama Tech", "Senior Frontend Engineer"],
    ["Bayanihan Digital", "Product Designer"],
    ["Mayon Software Labs", "Full Stack Developer"],
    ["Kape Digital", "Backend Engineer"],
    ["Kalayaan Logistics", "UI/UX Researcher"],
    ["Haraya Solutions", "Data Analyst"],
  ];
  const apps = [];
  for (const [company, job_name] of names) apps.push(await post("/applications", { company, job_name, status: "interviewing", mode_of_work: "hybrid", date_applied: "2026-10-01" }));
  const M = phtDay(0).slice(0, 7);
  // [day, hour, application index, outcome]
  const plan = [[3, 10, 0, "good"], [5, 14, 1, "bad"], [9, 23.5, 2, "pending"], [10, 0.5, 3, "pending"], [10, 15, 4, "pending"], [16, 9, 5, "pending"], [16, 11, 0, "pending"], [16, 15, 1, "pending"], [16, 16, 2, "pending"], [24, 13, 3, "pending"], [27, 10, 4, "pending"]];
  for (const [day, hour, i, outcome] of plan) {
    const hh = String(Math.floor(hour)).padStart(2, "0");
    const mm = hour % 1 ? "30" : "00";
    await post(`/applications/${apps[i].id}/interviews`, { scheduled_at: `${M}-${String(day).padStart(2, "0")}T${hh}:${mm}:00+08:00`, mode: ["online", "on_site", "async"][i % 3], outcome, interviewer: i % 2 ? "Ana Santos" : null });
  }
  const M2 = addMonth(M, 2);
  for (let i = 0; i < 201; i++) await post(`/applications/${apps[i % 6].id}/interviews`, { scheduled_at: new Date(Date.parse(`${M2}-15T00:00:00+08:00`) + i * 60e3).toISOString(), mode: "online" });
  await boot.browser().close();

  const browser = await chromium.launch(chromiumOptions());
  let shots = 0;
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce", timezoneId: "America/Los_Angeles" });
      const lr = await ctx.request.post(`${base}/api/v1/login`, { data: { email, password: PASSWORD } });
      if (!lr.ok()) throw new Error("login failed " + lr.status());
      const page = await ctx.newPage();
      const ready = () => page.waitForFunction(() => document.querySelector('[role="grid"]') && !document.querySelector('[role="grid"]').hasAttribute("aria-busy"));
      const shot = async (name, opts = {}) => {
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `${theme}-${width}-${name}.png`), ...opts });
        shots++;
        console.log(`${theme}-${width}-${name}`);
      };
      const full = { fullPage: width < 1280 };

      await page.goto(`${base}/interviews?view=month&month=${M}&day=${M}-16`);
      await ready();
      await shot("month-selected-day", full);

      await page.locator(`button[data-day="${M}-10"]`).focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await shot("month-keyboard-focus", full);

      await page.goto(`${base}/interviews?view=month&month=${M2}&day=${M2}-15`);
      await ready();
      await page.getByText("Showing the first 200 interviews.").waitFor();
      await shot("month-truncated");

      await page.goto(`${base}/interviews?view=month&month=${addMonth(M, -3)}`);
      await ready();
      await shot("month-empty", full);

      await page.goto(`${base}/interviews`);
      await page.getByRole("radio", { name: "Month" }).waitFor();
      await shot("agenda-with-view-switch");
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${shots} screenshots in ${OUT}`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
