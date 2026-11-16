// Local end-to-end check of the F4 auth flow on the REAL backend. NOT part of package.json or CI (no Playwright dependency).
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> E2E_API_PORT=8100 node scripts/e2e-auth.cjs
//
// scripts/local-env.cjs does the setup and the teardown (free API port, *_test database, truncate on
// exit, proof that the dev database and a foreign :8000 / :3000 process were untouched). It creates its
// own invite with the real admin CLI and a throwaway account, and deletes that account through the UI.
// Exit code 1 on any FAIL.
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

withEnv(async ({ base, createInvite }) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const password = "Passw0rd!e2e";
  const invite = createInvite("f4 e2e");
  const browser = await chromium.launch(chromiumOptions());
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cookie = async () => (await ctx.cookies()).find((c) => /session_token$/.test(c.name));

    // 0. Guard: no cookie, private page -> /login?next=
    await page.goto(`${base}/applications`);
    check("no cookie: /applications redirects to /login?next=", pathOf(page.url()) === "/login?next=%2Fapplications", pathOf(page.url()));

    // 1. Sign up with the invite, land on /applications
    await page.getByRole("radio", { name: "Create account" }).check({ force: true });
    await page.getByLabel("Invite code").fill(invite.toLowerCase().replace(/-/g, " "));
    await page.getByLabel("Account name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForURL(/\/applications/);
    check("sign up lands on /next (/applications)", pathOf(page.url()) === "/applications", pathOf(page.url()));
    const c1 = await cookie();
    check("cookie is HttpOnly, SameSite=Lax, Path=/, host-only", !!c1 && c1.httpOnly && c1.sameSite === "Lax" && c1.path === "/", JSON.stringify({ ...c1, value: "<redacted>" }));
    check("cookie is not readable from JS", !(await page.evaluate(() => document.cookie)).includes("session_token"));
    const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    check("nothing but the theme in web storage", !/session|token|email|e2e/i.test(stored), stored);

    // 2. Account shows the real user
    await page.goto(`${base}/account`);
    await page.getByText(email).waitFor();
    check("account shows name and email", await page.getByText("E2E Tester").isVisible());

    // 3. Log out, Back must not show a private page
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
    check("log out lands on /login", pathOf(page.url()) === "/login", pathOf(page.url()));
    check("cookie cleared", !(await cookie()));
    await page.goBack();
    await page.waitForLoadState("networkidle");
    check("Back after logout ends on /login", /^\/login/.test(pathOf(page.url())), pathOf(page.url()));

    // 4. Log in again, honouring next
    await page.goto(`${base}/login?next=${encodeURIComponent("/account")}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL(/\/account/);
    check("log in returns to next (/account)", pathOf(page.url()) === "/account", pathOf(page.url()));
    const oldCookie = await cookie();

    // 5. Wrong password on delete keeps the dialog open
    await page.getByRole("button", { name: "Delete account" }).first().click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("textbox", { name: "Your email" }).fill(email.toUpperCase());
    await page.getByLabel("Password", { exact: true }).fill("Wrong-pass1!");
    await page.getByRole("button", { name: "Delete my account permanently" }).click();
    await page.getByText("Incorrect password.").waitFor();
    check("wrong password: 'Incorrect password.' and still on /account", pathOf(page.url()) === "/account");

    // 6. Delete for real
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Delete my account permanently" }).click();
    await page.waitForURL(/\/login\?deleted=1/);
    check("delete lands on /login?deleted=1", pathOf(page.url()) === "/login?deleted=1", pathOf(page.url()));
    check("deleted notice shown", await page.getByText("Your account has been deleted.").isVisible());

    // 7. The old cookie is dead: API says 401, /account goes to expired, no loop
    const status = await page.request.get(`${base}/api/v1/me`, { headers: { cookie: `${oldCookie.name}=${oldCookie.value}` } });
    check("old cookie: GET /api/v1/me is 401", status.status() === 401, String(status.status()));
    await ctx.addCookies([{ name: oldCookie.name, value: oldCookie.value, url: base }]);
    await page.goto(`${base}/account`); // proxy lets it through (cookie exists); the page's /me 401s
    await page.waitForURL(/\/login\?expired=1/);
    check("stale cookie: /account ends on /login?expired=1&next=", pathOf(page.url()) === "/login?expired=1&next=%2Faccount", pathOf(page.url()));
    await page.waitForTimeout(800);
    check("no redirect loop (still on /login, form visible)", /^\/login/.test(pathOf(page.url())) && (await page.getByLabel("Email").isVisible()));
    check("expired notice shown", await page.getByText("Your session expired. Log in again.").isVisible());

    // 8. No cookie at all: /applications -> /login?next=
    await ctx.clearCookies();
    await page.goto(`${base}/applications`);
    check("no cookie again: /applications -> /login?next=", pathOf(page.url()) === "/login?next=%2Fapplications", pathOf(page.url()));
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
