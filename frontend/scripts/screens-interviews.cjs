// Local screenshots of the F6 interview screens (light and dark at 390, 768, 1280). NOT in package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<chrome> node scripts/screens-interviews.cjs
//
// Same setup, teardown and output rules as screens-applications.cjs ({theme}-{width}-{name}.png in
// frontend/.screenshots/ and SCREENS_OUT).
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");
const { PASSWORD, seedAccount } = require("./seed-applications.cjs");

const OUT = [path.resolve(__dirname, "../.screenshots"), process.env.SCREENS_OUT ?? "/mnt/c/dev/projects/portfolio/talaan-screens"];
const SIZES = [
  [390, 844],
  [768, 1024],
  [1280, 800],
];

withEnv(async ({ base, createInvite }) => {
  const dirs = OUT.filter((d) => {
    if (d.startsWith(path.resolve(__dirname, ".."))) fs.mkdirSync(d, { recursive: true });
    else if (fs.existsSync(path.dirname(d))) fs.mkdirSync(d, { recursive: true });
    return fs.existsSync(d);
  });
  // The hand-made applications: Pinagsama Tech has a pending, a good and a bad interview; Haraya has none.
  const acct = await seedAccount({ base, invite: createInvite("f6 screens"), email: `shots-f6-${Date.now()}@example.com`, generic: 0 });
  const browser = await chromium.launch(chromiumOptions());
  let shots = 0;

  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const r = await ctx.request.post(`${base}/api/v1/login`, { data: { email: acct.email, password: PASSWORD } });
      if (!r.ok()) throw new Error("login failed " + r.status());
      const apps = (await (await ctx.request.get(`${base}/api/v1/applications?limit=100`)).json()).items;
      const withIv = apps.find((a) => a.company === "Pinagsama Tech").id;
      const noIv = apps.find((a) => a.company === "Kalayaan Logistics").id;
      const ivId = (await (await ctx.request.get(`${base}/api/v1/applications/${withIv}/interviews`)).json()).items[0].id;
      const page = await ctx.newPage();
      const shot = async (name, opts = {}) => {
        await page.waitForTimeout(300);
        for (const dir of dirs) await page.screenshot({ path: path.join(dir, `${theme}-${width}-${name}.png`), ...opts });
        shots++;
        console.log(`${theme}-${width}-${name}`);
      };
      const full = { fullPage: width < 1280 };
      const formReady = () => page.getByLabel(/Date and time/).waitFor();
      const editReady = async () => {
        await formReady();
        await page.waitForFunction(() => document.querySelector('input[type="datetime-local"]')?.value !== "");
      };

      await page.goto(`${base}/applications/${withIv}`);
      await page.getByRole("list", { name: "Interviews" }).waitFor();
      await page.getByRole("heading", { name: "Interviews" }).scrollIntoViewIfNeeded();
      await shot("detail-interviews-outcomes", full);

      await page.getByRole("button", { name: /^Delete interview, / }).first().click();
      await page.getByRole("heading", { name: "Delete this interview?" }).waitFor();
      await shot("interview-delete-dialog");
      await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

      await page.goto(`${base}/applications/${noIv}`);
      await page.getByText("No interviews yet.").waitFor();
      await shot("detail-no-interviews", full);

      await page.goto(`${base}/applications/${noIv}/interviews/new`);
      await formReady();
      await shot("interview-form-new-empty", full);
      await page.getByRole("button", { name: "Save interview" }).click();
      await page.getByText("Enter the date and time.").waitFor();
      await shot("interview-form-new-errors", full);

      await page.goto(`${base}/applications/${noIv}/interviews/new`);
      await formReady();
      await page.getByLabel(/Date and time/).fill("2026-11-20T23:30");
      await page.getByRole("radio", { name: "Online" }).check({ force: true });
      await page.getByLabel("Interviewer").fill("Ana Santos");
      await page.getByLabel("Outcome").selectOption("good");
      await page.getByLabel("Notes", { exact: true }).fill("Portfolio walkthrough.\nAsk about the team size.");
      await shot("interview-form-new-filled", full);

      await page.goto(`${base}/applications/${withIv}/interviews/${ivId}/edit`);
      await editReady();
      await shot("interview-edit", full);
      await page.getByLabel("Interviewer").fill("Someone else");
      await page.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("heading", { name: "Discard changes?" }).waitFor();
      await shot("interview-discard-dialog");

      const errPage = await ctx.newPage();
      await errPage.route(/\/api\/v1\/applications\/\d+\/interviews/, (route) => route.abort());
      await errPage.goto(`${base}/applications/${withIv}`);
      await errPage.getByText("Couldn't load interviews.").waitFor();
      await errPage.waitForTimeout(300);
      for (const dir of dirs) await errPage.screenshot({ path: path.join(dir, `${theme}-${width}-detail-interviews-error.png`), fullPage: width < 1280 });
      shots++;
      console.log(`${theme}-${width}-detail-interviews-error`);
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${shots} screenshots`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
