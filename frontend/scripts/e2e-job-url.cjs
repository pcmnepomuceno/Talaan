// Local end-to-end check of the E1 job posting URL on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> node scripts/e2e-job-url.cjs
//
// scripts/local-env.cjs starts the API and `next dev` on free ports against the *_test database and
// cleans up afterwards (see e2e-applications.cjs). Screenshots go to the gitignored frontend/.screenshots/.
// Exit code 1 if any check fails.
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");

const SHOTS = path.resolve(__dirname, "../.screenshots");
let failed = 0;
let passed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  ok ? passed++ : failed++;
}
const lookupReq = (r) => r.method() === "POST" && /\/api\/v1\/applications\/lookup$/.test(new URL(r.url()).pathname);

withEnv(async ({ base, createInvite }) => {
  const stamp = Date.now();
  const password = "Passw0rd!e2e";
  const browser = await chromium.launch(chromiumOptions());
  const pageErrors = [];

  async function signUp(ctx, email) {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`${base}/login`);
    await page.getByRole("radio", { name: "Create account" }).check({ force: true });
    await page.getByLabel("Invite code").fill(createInvite("e1 e2e"));
    await page.getByLabel("Account name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForURL(/\/applications$/, { timeout: 15000 });
    return page;
  }
  async function fillApp(page, title, company, url) {
    await page.getByLabel("Job title").fill(title);
    await page.getByLabel("Company", { exact: true }).fill(company);
    await page.getByRole("radio", { name: "Remote" }).check({ force: true });
    await page.getByLabel("Job posting URL").fill(url);
  }
  async function save(page) {
    await page.getByRole("button", { name: "Save application" }).click();
    await page.waitForURL(/\/applications\/\d+/, { timeout: 15000 });
  }
  const shoot = async (page, name) => {
    for (const theme of ["light", "dark"]) {
      for (const width of [390, 1280]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `e1-${theme}-${width}-${name}.png`), fullPage: true });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 900 });
  };

  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
  const page = await signUp(ctxA, `e2e-e1a-${stamp}@example.com`);
  const lookups = [];
  page.on("request", (r) => lookupReq(r) && lookups.push(r));

  // 1. add an application with utm_source and a fragment
  const URL1 = "https://jobs.example.ph/careers/view?jobId=42&utm_source=linkedin#apply";
  const SAME = "https://jobs.example.ph/careers/view?jobId=42";
  const OTHER = "https://jobs.example.ph/careers/view?jobId=43";
  await page.goto(`${base}/applications/new`);
  await fillApp(page, "Platform Engineer", "Acme Co", URL1);
  await save(page);
  const id1 = new URL(page.url()).pathname.split("/").pop();
  check("create with a posting URL lands on the detail", /^\d+$/.test(id1), page.url());

  // 2. the detail link
  const link = page.getByRole("link", { name: "Open posting, Acme Co", exact: true });
  await link.waitFor();
  check("detail: link has the accessible name 'Open posting, Acme Co'", (await link.count()) === 1);
  check("detail: link target=_blank", (await link.getAttribute("target")) === "_blank");
  check("detail: link rel='noopener noreferrer'", (await link.getAttribute("rel")) === "noopener noreferrer");
  check("detail: link href is the URL exactly as typed", (await link.getAttribute("href")) === URL1, await link.getAttribute("href"));
  check("detail: the row is labelled 'Job posting'", await page.getByText("Job posting", { exact: true }).first().isVisible());
  await shoot(page, "detail-link");

  // 3. Add again with the same URL minus the utm part and the fragment: the note, in the muted colour
  await page.goto(`${base}/applications/new`);
  lookups.length = 0;
  await fillApp(page, "Platform Engineer", "Acme Co", SAME);
  await page.getByLabel("Job posting URL").blur();
  const note = page.locator("p", { hasText: "You already saved this posting:" });
  await note.waitFor({ timeout: 10000 });
  check("duplicate note text", (await note.innerText()).replace(/\s+/g, " ").trim() === "You already saved this posting: Platform Engineer, Acme Co.", await note.innerText());
  const noteLink = note.getByRole("link");
  check("duplicate note links to that application", (await noteLink.getAttribute("href")) === `/applications/${id1}`, await noteLink.getAttribute("href"));
  const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
  const mutedRef = await colorOf(page.getByText("Paste the link to the job posting.", { exact: true }));
  const noteColor = await colorOf(note);
  check("duplicate note uses the muted Caption colour (same as the helper text)", noteColor === mutedRef, `${noteColor} vs ${mutedRef}`);
  check("duplicate note is not in an alert region and the field shows no error", (await note.locator('xpath=ancestor-or-self::*[@role="alert"]').count()) === 0 && (await page.getByLabel("Job posting URL").getAttribute("aria-invalid")) !== "true");
  check("the lookup went to the API with the typed URL", lookups.some((q) => q.postDataJSON().url === SAME), lookups.map((q) => q.url()).join(" "));
  check("the lookup is a POST with no query string and no posting URL in the request URL", lookups.length >= 1 && lookups.every((q) => new URL(q.url()).search === "" && !q.url().includes("jobs.example.ph")), lookups.map((q) => q.url()).join(" "));
  check("create: the lookup body has exclude_id null", lookups.every((q) => q.postDataJSON().exclude_id === null), lookups.map((q) => q.postData()).join(" "));
  await note.scrollIntoViewIfNeeded();
  await shoot(page, "form-duplicate-note");

  // 4. saving anyway still succeeds
  await save(page);
  const id2 = new URL(page.url()).pathname.split("/").pop();
  check("saving with a duplicate URL still succeeds", /^\d+$/.test(id2) && id2 !== id1, page.url());

  // 5. a different job id gives no note
  await page.goto(`${base}/applications/new`);
  lookups.length = 0;
  await page.getByLabel("Job posting URL").fill(OTHER);
  await page.getByLabel("Job posting URL").blur();
  await page.waitForTimeout(1200);
  check("a different job id: the lookup ran", lookups.length >= 1, String(lookups.length));
  check("a different job id: no note", (await page.getByText("You already saved this posting:").count()) === 0);

  // 6. editing without touching the URL makes zero lookup requests
  await page.goto(`${base}/applications/${id2}/edit`);
  await page.waitForFunction(() => document.querySelector("input")?.value !== "");
  await page.getByLabel("Job posting URL").waitFor();
  lookups.length = 0;
  await page.getByLabel("Company", { exact: true }).fill("Acme Co Ltd");
  await page.getByLabel("Company", { exact: true }).blur();
  await page.getByLabel("Job posting URL").focus();
  await page.getByLabel("Job posting URL").blur();
  await page.waitForTimeout(1200);
  check("edit without touching the URL: zero lookup requests", lookups.length === 0, String(lookups.length));
  check("edit without touching the URL: no note", (await page.getByText("You already saved this posting:").count()) === 0);

  // 6b. editing with a new URL sends this application's id as exclude_id
  await page.getByLabel("Job posting URL").fill(OTHER);
  await page.getByLabel("Job posting URL").blur();
  await page.waitForTimeout(1200);
  check("edit with a new URL: the lookup body has exclude_id = this id", lookups.length >= 1 && lookups.every((q) => q.postDataJSON().exclude_id === Number(id2)), lookups.map((q) => q.postData()).join(" "));

  // 7. clearing the URL: PATCH body job_url null, the link is gone
  const patches = [];
  page.on("request", (r) => r.method() === "PATCH" && patches.push(r.postData()));
  await page.getByLabel("Job posting URL").fill("");
  await page.getByRole("button", { name: "Save application" }).click();
  await page.waitForURL(new RegExp(`/applications/${id2}$`), { timeout: 15000 });
  await page.getByRole("heading", { name: "Platform Engineer" }).first().waitFor();
  const body = patches.length ? JSON.parse(patches[patches.length - 1]) : {};
  check("clear: the PATCH body has job_url null", patches.length === 1 && body.job_url === null, JSON.stringify(body));
  check("clear: the Open posting link is gone", (await page.getByRole("link", { name: /^Open posting/ }).count()) === 0);
  check("clear: the API now returns job_url null", (await (await page.request.get(`${base}/api/v1/applications/${id2}`)).json()).job_url === null);

  // 8. a second user with the same URL gets no match
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await signUp(ctxB, `e2e-e1b-${stamp}@example.com`);
  const lookupsB = [];
  pageB.on("request", (r) => lookupReq(r) && lookupsB.push(r));
  await pageB.goto(`${base}/applications/new`);
  await pageB.getByLabel("Job posting URL").fill(SAME);
  await pageB.getByLabel("Job posting URL").blur();
  await pageB.waitForTimeout(1500);
  check("second user: the lookup ran", lookupsB.length >= 1, String(lookupsB.length));
  check("second user: the same URL shows no note", (await pageB.getByText("You already saved this posting:").count()) === 0);
  const r = await pageB.request.post(`${base}/api/v1/applications/lookup`, { data: { url: SAME, exclude_id: null } });
  check("second user: the API answers match null", r.status() === 200 && (await r.json()).match === null);

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close().catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
