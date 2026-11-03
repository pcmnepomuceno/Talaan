// Local end-to-end check of the F4 auth flow. NOT part of package.json or CI (no Playwright dependency).
//
// Needs: the API on :8000 against the TEST database with COOKIE_SECURE=false and generous
// LOGIN_*/SIGNUP_* limits, and `npm run dev` (or `npm start`) on :3000. Playwright is resolved from
// NODE_PATH; PW_CHROMIUM may point at a chromium / chrome-headless-shell binary.
//
//   cd <repo> && . ./test-env.sh   # DATABASE_URL=...talaan_test, COOKIE_SECURE=false, high limits
//   .venv/bin/uvicorn app.main:app --port 8000 --no-proxy-headers &
//   cd frontend && npm run dev &
//   NODE_PATH=<dir containing playwright> node scripts/e2e-auth.cjs
//
// It creates its own invite with the real admin CLI (PYTHON, default ../.venv/bin/python; DATABASE_URL
// must be in the environment) and a throwaway account, and deletes that account at the end.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const REPO = path.resolve(__dirname, "../..");
const PYTHON = process.env.PYTHON ?? path.join(REPO, ".venv/bin/python");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

function createInvite() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must point at the *_test database");
  const out = execFileSync(PYTHON, ["-m", "app.admin", "create-invite", "--note", "f4 e2e", "--expires-in", "1d"], {
    cwd: REPO,
    encoding: "utf8",
  });
  const m = out.match(/TLN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  if (!m) throw new Error("no invite code in CLI output");
  return m[0];
}

(async () => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@example.com`;
  const password = "Passw0rd!e2e";
  const invite = createInvite();
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cookie = async () => (await ctx.cookies()).find((c) => /session_token$/.test(c.name));

  // 0. Guard: no cookie, private page -> /login?next=
  await page.goto(`${BASE}/applications`);
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
  await page.goto(`${BASE}/account`);
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
  await page.goto(`${BASE}/login?next=${encodeURIComponent("/account")}`);
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
  const status = await page.request.get(`${BASE}/api/v1/me`, { headers: { cookie: `${oldCookie.name}=${oldCookie.value}` } });
  check("old cookie: GET /api/v1/me is 401", status.status() === 401, String(status.status()));
  await ctx.addCookies([{ name: oldCookie.name, value: oldCookie.value, url: BASE }]);
  await page.goto(`${BASE}/account`); // proxy lets it through (cookie exists); the page's /me 401s
  await page.waitForURL(/\/login\?expired=1/);
  check("stale cookie: /account ends on /login?expired=1&next=", pathOf(page.url()) === "/login?expired=1&next=%2Faccount", pathOf(page.url()));
  await page.waitForTimeout(800);
  check("no redirect loop (still on /login, form visible)", /^\/login/.test(pathOf(page.url())) && (await page.getByLabel("Email").isVisible()));
  check("expired notice shown", await page.getByText("Your session expired. Log in again.").isVisible());

  // 8. No cookie at all: /applications -> /login?next=
  await ctx.clearCookies();
  await page.goto(`${BASE}/applications`);
  check("no cookie again: /applications -> /login?next=", pathOf(page.url()) === "/login?next=%2Fapplications", pathOf(page.url()));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
