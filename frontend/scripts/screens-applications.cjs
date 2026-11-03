// Local screenshots of the F5 screens (light and dark at 390, 768, 1280). NOT in package.json or CI.
//
//   NODE_PATH=<dir containing playwright> node scripts/screens-applications.cjs
//
// Same setup and teardown as e2e-applications.cjs (scripts/local-env.cjs). Seeds one account with 56
// applications (scripts/seed-applications.cjs) and one empty account. Output: frontend/.screenshots/
// (gitignored) and, if its parent exists, SCREENS_OUT (default /mnt/c/dev/projects/portfolio/talaan-screens),
// as {theme}-{width}-{name}.png.
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
  const full = await seedAccount({ base, invite: createInvite("f5 screens"), email: `shots-${Date.now()}@example.com` });
  const empty = await seedAccount({ base, invite: createInvite("f5 screens empty"), email: `empty-${Date.now()}@example.com`, generic: 0, hand: false });
  const browser = await chromium.launch(chromiumOptions());
  let shots = 0;

  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const open = async (who) => {
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
        const r = await ctx.request.post(`${base}/api/v1/login`, { data: { email: who.email, password: PASSWORD } });
        if (!r.ok()) throw new Error("login failed " + r.status());
        const page = await ctx.newPage();
        const shot = async (name, opts = {}) => {
          await page.waitForTimeout(300);
          for (const dir of dirs) await page.screenshot({ path: path.join(dir, `${theme}-${width}-${name}.png`), ...opts });
          shots++;
          console.log(`${theme}-${width}-${name}`);
        };
        return { ctx, page, shot };
      };
      const rowsReady = (page) => page.getByRole("list", { name: "Applications" }).waitFor();
      const formReady = async (page) => {
        await page.getByLabel("Job title").waitFor();
        await page.waitForFunction(() => !document.body.innerText.includes("Loading application"));
      };

      // ---- account with data ----
      {
        const { ctx, page, shot } = await open(full);
        await page.goto(`${base}/applications`);
        await rowsReady(page);
        await shot("list-populated");
        await page.getByRole("button", { name: "Load more" }).scrollIntoViewIfNeeded();
        await shot("list-load-more");

        // newest row = the interviews example
        const href = await page.getByRole("list", { name: "Applications" }).getByRole("link").first().getAttribute("href");
        const id = href.split("/").pop();

        await page.goto(`${base}/applications/${id}`);
        await page.getByRole("list", { name: "Interviews" }).waitFor();
        await shot("detail");
        await page.getByRole("button", { name: "Delete" }).first().click();
        await page.getByRole("heading", { name: "Delete this application?" }).waitFor();
        await shot("delete-dialog");
        await page.getByRole("button", { name: "Cancel" }).click();

        await page.goto(`${base}/applications/${id}/edit`);
        await formReady(page);
        await page.waitForFunction(() => document.querySelector("input")?.value !== "");
        await shot("edit", { fullPage: width < 1280 });
        await page.getByLabel("Company", { exact: true }).fill("Pinagsama Tech Philippines");
        await page.getByRole("button", { name: "Cancel" }).click();
        await page.getByRole("heading", { name: "Discard changes?" }).waitFor();
        await shot("discard-dialog");
        await ctx.close();
      }

      // ---- interviews error: the application stays visible ----
      {
        const { ctx, page, shot } = await open(full);
        await page.goto(`${base}/applications`);
        await rowsReady(page);
        const href = await page.getByRole("list", { name: "Applications" }).getByRole("link").first().getAttribute("href");
        await page.route("**/interviews*", (route) => route.abort());
        await page.goto(`${base}${href}`);
        await page.getByText("Couldn't load interviews.").waitFor();
        await shot("detail-interviews-error");
        await ctx.close();
      }

      // ---- list load error ----
      {
        const { ctx, page, shot } = await open(full);
        await page.route(/\/api\/v1\/applications\?/, (route) => route.abort());
        await page.goto(`${base}/applications`);
        await page.getByText("Couldn't load applications.").waitFor();
        await shot("list-load-error");
        await ctx.close();
      }

      // ---- empty account: empty, no-match, new form states ----
      {
        const { ctx, page, shot } = await open(empty);
        await page.goto(`${base}/applications`);
        await page.getByText("No applications yet.").waitFor();
        await shot("list-empty");
        await page.goto(`${base}/applications?status=offered`);
        await page.getByText("No applications with this status.").waitFor();
        await shot("list-no-match");

        await page.goto(`${base}/applications/new`);
        await page.getByLabel("Job title").waitFor();
        await shot("form-new-empty", { fullPage: width < 1280 });
        await page.getByRole("button", { name: "Save application" }).click();
        await page.getByText("Enter a job title.").waitFor();
        await shot("form-new-errors", { fullPage: width < 1280 });

        await page.goto(`${base}/applications/new`);
        await page.getByLabel("Job title").fill("Frontend Engineer");
        await page.getByLabel("Company", { exact: true }).fill("Pinagsama Tech");
        await page.getByLabel("Status", { exact: true }).selectOption("applied");
        await page.getByLabel("Date applied").fill("2026-10-14");
        await page.getByRole("radio", { name: "Hybrid" }).check({ force: true });
        await page.getByLabel("Monthly gross salary (PHP)").fill("85000");
        await page.getByLabel("Company website").fill("https://pinagsama.example.ph");
        await page.getByLabel("Notes", { exact: true }).fill("Referred by a former teammate.\nAsk about the team size.");
        await shot("form-new-filled", { fullPage: width < 1280 });
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(`\n${shots} screenshots written to: ${dirs.join(", ")}`);
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
