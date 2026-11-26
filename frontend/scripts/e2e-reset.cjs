// Local end-to-end check of the A2 password reset link on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> E2E_API_PORT=8100 E2E_WEB_PORT=3100 node scripts/e2e-reset.cjs
//
// scripts/local-env.cjs does the setup and the teardown (*_test database only). The reset link is
// never printed: everything this script writes goes through redact(), Playwright errors included
// (they echo URLs, fragment and all). Screenshots mask the link. Exit code 1 on any FAIL.
process.env.E2E_ADMIN_EMAILS = "admin-reset-e2e@example.ph";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv, waitFor, FRONTEND } = require("./local-env.cjs");

const OUT = path.join(FRONTEND, ".screenshots/a2");
const DEAD = "This reset link is invalid or has expired. Ask for a new one.";
const MOBILE = { width: 390, height: 844 };

// token_urlsafe(32) is 43 characters of this alphabet: hide any run that long or longer.
// Anything after "reset#" too, in case a message cuts the token short.
const redact = (s) => String(s).replace(/reset#[^\s"'<]*/g, "reset#<redacted>").replace(/[A-Za-z0-9_-]{43,}/g, "<redacted>");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(redact(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`));
  if (!ok) failed++;
}

withEnv(async ({ base, apiBase, createInvite }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const adminEmail = process.env.E2E_ADMIN_EMAILS;
  const friendEmail = `friend-reset-${Date.now()}@example.ph`;
  const password = "Passw0rd!e2e";
  const newPassword = "N3w!Passw0rd-e2e";
  const api = (p, body) =>
    fetch(`${apiBase}/api/v1${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  for (const [email, name] of [[adminEmail, "E2E Admin"], [friendEmail, "E2E Friend"]]) {
    const invite_code = createInvite("a2 e2e");
    // createInvite blocks the event loop, so fetch may still hold a keep-alive socket the API has closed.
    // Poll /ping first (10 s timeout, clear error): a request that fails on a stale socket is caught and
    // retried, unlike the signup POST. The cause of the earlier failure is unconfirmed.
    await waitFor(`${apiBase}/ping`, "API", 10000);
    const r = await api("/signup", { email, password, account_name: name, invite_code });
    if (!r.ok) throw new Error(`signup failed ${r.status}`);
  }

  const browser = await chromium.launch(chromiumOptions());
  try {
    const logIn = async (page, email, pw) => {
      await page.goto(`${base}/login`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(pw);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.waitForURL(/\/applications/);
    };
    const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    // 1. Friend is signed in on their own device
    const friendCtx = await browser.newContext();
    const friendPage = await friendCtx.newPage();
    await logIn(friendPage, friendEmail, password);
    const me = async () => (await friendCtx.request.get(`${base}/api/v1/me`)).status();
    check("friend has a live session", (await me()) === 200);

    // 2. Admin creates the link on a 390 px screen
    const adminCtx = await browser.newContext({ viewport: MOBILE });
    const admin = await adminCtx.newPage();
    await logIn(admin, adminEmail, password);
    await admin.goto(`${base}/admin`);
    const section = admin.locator('section[aria-labelledby="reset"]');
    await section.getByLabel("Email").fill(friendEmail);
    await section.getByLabel("Your password", { exact: true }).fill(password);
    await section.getByRole("button", { name: "Create reset link" }).click();
    const linkEl = section.locator("p.select-all");
    await linkEl.waitFor();
    const link = ((await linkEl.textContent()) ?? "").trim();
    const token = link.slice(link.indexOf("#") + 1);
    check("link is the web origin, /reset, then a 43-character fragment", link.startsWith(`${base}/reset#`) && /^[A-Za-z0-9_-]{43}$/.test(token));
    check("'Reset link, shown once' and the expiry show", (await section.getByText("Reset link, shown once").isVisible()) && (await section.getByText(/^Expires .+ PHT$/).isVisible()));
    await section.getByRole("button", { name: "Copy link" }).click();
    await admin.getByText("Link copied.").or(admin.getByText("Couldn't copy the link. Select it and copy it yourself.")).first().waitFor();
    check("Copy link shows a toast", true);
    check("390px: /admin has no horizontal overflow", await fits(admin));
    const sizes = await section.locator("input, button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    check("390px: every reset control is at least 44px tall", sizes.every((h) => h >= 44), sizes.join(","));
    await admin.screenshot({ path: path.join(OUT, "390-admin.png"), fullPage: true, mask: [linkEl] });
    check("creating a link signs nobody out", (await me()) === 200);

    // 3. The friend opens the link in another context and sets a new password
    const openLink = async (ctx) => {
      const page = await ctx.newPage();
      const res = await page.goto(link);
      return { page, res };
    };
    const resetCtx = await browser.newContext({ viewport: MOBILE });
    const seen = [];
    resetCtx.on("request", (r) => seen.push({ url: r.url(), referer: r.headers().referer ?? "", method: r.method(), body: r.postData() ?? "" }));
    const { page: resetPage, res } = await openLink(resetCtx);
    const headers = res.headers();
    check("/reset: Cache-Control no-store", /no-store/.test(headers["cache-control"] ?? ""), headers["cache-control"]);
    check("/reset: Referrer-Policy no-referrer", headers["referrer-policy"] === "no-referrer", headers["referrer-policy"]);
    await resetPage.getByLabel("New password").waitFor();
    check("the fragment is stripped from the address bar", !resetPage.url().includes("#") && !resetPage.url().includes(token));
    check("390px: /reset has no horizontal overflow", await fits(resetPage));
    await resetPage.screenshot({ path: path.join(OUT, "390-reset.png"), fullPage: true });
    const fill = async (page, pw, confirm = pw) => {
      await page.getByLabel("New password").fill(pw);
      await page.getByLabel("Confirm password").fill(confirm);
      await page.getByRole("button", { name: "Set new password" }).click();
    };
    await fill(resetPage, "weak");
    await resetPage.getByText("Password must contain at least one uppercase letter.").waitFor();
    check("a weak password shows the server's rule inline", true);
    check("still no fragment after a failed attempt", !resetPage.url().includes("#"));
    await fill(resetPage, newPassword);
    await resetPage.waitForURL(/\/login\?reset=1$/);
    await resetPage.getByText("Password changed. Log in with your new password.").waitFor();
    check("lands on /login?reset=1 with the notice", true);
    check("no request URL or Referer carried the token", seen.every((r) => !r.url.includes(token) && !r.referer.includes(token)));
    check("the token went in the POST body", seen.some((r) => r.method === "POST" && r.url.endsWith("/api/v1/auth/reset-password") && r.body.includes(token)));

    // 4. Old session and old password are dead, the new password works
    check("friend's old session gets 401", (await me()) === 401);
    check("old password is refused", (await api("/login", { email: friendEmail, password })).status === 401);
    check("new password logs in", (await api("/login", { email: friendEmail, password: newPassword })).status === 200);

    // 5. The same link again
    const againCtx = await browser.newContext({ viewport: MOBILE });
    const { page: again } = await openLink(againCtx);
    await again.getByLabel("New password").waitFor();
    await fill(again, "An0ther!Passw0rd");
    await again.getByText(DEAD).waitFor();
    check("reusing the link shows the generic error", (await again.getByLabel("New password").count()) === 0);
    await again.screenshot({ path: path.join(OUT, "390-reset-dead.png"), fullPage: true });

    // 6. Server logs
    const logs = ["api.log", "web.log"].map((f) => fs.readFileSync(path.join(FRONTEND, ".screenshots/logs", f), "utf8"));
    check("the token is in neither api.log nor web.log", logs.every((l) => !l.includes(token)));
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  if (failed) process.exitCode = 1;
}).catch((e) => {
  // The string only, redacted: printing the error object would echo URLs with the fragment.
  console.error(redact(e?.stack ?? e));
  if (e?.cause) console.error(redact(`cause: ${e.cause.code ?? ""} ${e.cause.message ?? ""}`));
  process.exitCode = 1;
});
