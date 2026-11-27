// Local end-to-end check of A3 invite requests on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> E2E_API_PORT=8100 E2E_WEB_PORT=3100 node scripts/e2e-invite-request.cjs
//
// scripts/local-env.cjs does the setup and the teardown (*_test database only). The status link and
// the invite codes are never printed: everything this script writes goes through redact(), Playwright
// errors included (they echo URLs, fragment and all). Screenshots mask both. Exit code 1 on any FAIL.
process.env.E2E_ADMIN_EMAILS = "admin-request-e2e@example.ph";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv, waitFor, FRONTEND } = require("./local-env.cjs");

const OUT = path.join(FRONTEND, ".screenshots/a3");
const MOBILE = { width: 390, height: 844 };
const SHOWN = "The code was already shown.";
const ASK_AGAIN = "If you didn't save it, ask the person who runs Talaan for a new code.";

// token_urlsafe(32) is 43 characters of this alphabet: hide any run that long, anything after
// "request#" (a message may cut the token short), and anything shaped like an invite code.
const redact = (s) =>
  String(s)
    .replace(/request#[^\s"'<]*/g, "request#<redacted>")
    .replace(/TLN-[0-9A-Z-]+/g, "<code>")
    .replace(/[A-Za-z0-9_-]{43,}/g, "<redacted>");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(redact(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`));
  if (!ok) failed++;
}

withEnv(async ({ base, apiBase, createInvite }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const adminEmail = process.env.E2E_ADMIN_EMAILS;
  const friendEmail = `friend-request-${Date.now()}@example.ph`;
  const password = "Passw0rd!e2e";
  const invite_code = createInvite("a3 e2e");
  // createInvite blocks the event loop; see e2e-reset.cjs for why we ping before the first POST.
  await waitFor(`${apiBase}/ping`, "API", 10000);
  const signedUp = await fetch(`${apiBase}/api/v1/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password, account_name: "E2E Admin", invite_code }),
  });
  if (!signedUp.ok) throw new Error(`signup failed ${signedUp.status}`);

  const browser = await chromium.launch(chromiumOptions());
  const seen = [];
  const secrets = [];
  try {
    const newContext = async (options) => {
      const ctx = await browser.newContext(options);
      ctx.on("request", (r) => seen.push({ url: r.url(), referer: r.headers().referer ?? "" }));
      return ctx;
    };
    const secretText = (page) => page.locator("p.select-all");
    const shot = (page, name) =>
      page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, mask: [secretText(page)] });
    const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    // Every visible control (the off-screen honeypot is not one).
    const bigEnough = async (scope) => {
      const sizes = await scope
        .locator('input:not([name="website"]), textarea, button, a')
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width).map((r) => [Math.round(r.width), Math.round(r.height)]));
      return { ok: sizes.length > 0 && sizes.every(([w, h]) => w >= 44 && h >= 44), sizes: JSON.stringify(sizes) };
    };
    const checkLayout = async (page, label, scope = page.locator("main")) => {
      check(`390px: ${label} has no horizontal overflow`, await fits(page));
      const size = await bigEnough(scope);
      check(`390px: ${label} controls are at least 44 x 44`, size.ok, size.ok ? "" : size.sizes);
    };
    const logIn = async (page, email) => {
      await page.goto(`${base}/login`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.waitForURL(/\/applications/);
    };
    const submitRequest = async (page, contact, note) => {
      await page.getByLabel("Contact").fill(contact);
      await page.getByLabel("Why you want access").fill(note);
      await page.getByRole("button", { name: "Send request" }).click();
      await page.getByRole("heading", { name: "Save this link" }).waitFor();
      const link = ((await secretText(page).textContent()) ?? "").trim();
      const token = link.slice(link.indexOf("#") + 1);
      secrets.push(token);
      check("the saved link is the web origin, /request, then a 43-character fragment", link.startsWith(`${base}/request#`) && /^[A-Za-z0-9_-]{43}$/.test(token));
      return link;
    };
    const openLink = async (ctx, link) => {
      const page = await ctx.newPage();
      const res = await page.goto(link);
      return { page, res };
    };

    // 1. Signup mode links to the request form
    const person = await newContext({ viewport: { width: 1280, height: 900 } });
    const page = await person.newPage();
    await page.goto(`${base}/login`);
    await page.getByText("Create account", { exact: true }).click();
    await shot(page, "before-1280-signup");
    await page.getByRole("link", { name: "Don't have a code? Request one" }).click();
    await page.waitForURL(/\/request$/);
    await page.getByLabel("Contact").waitFor();
    check("signup mode links to /request", true);

    // 2. Inline errors, then submit and keep the link
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByText("Enter how to reach you.").waitFor();
    check("empty fields show our own inline errors", await page.getByText("Tell us why you want access.").isVisible());
    await shot(page, "before-1280-request-form");
    const link = await submitRequest(page, friendEmail, "From the meetup, applying to a few places.");
    await shot(page, "after-1280-save-link");

    const first = await openLink(await newContext(), link);
    const headers = first.res.headers();
    check("/request: Cache-Control no-store", /no-store/.test(headers["cache-control"] ?? ""), headers["cache-control"]);
    check("/request: Referrer-Policy no-referrer", headers["referrer-policy"] === "no-referrer", headers["referrer-policy"]);
    await first.page.getByText("Still waiting.").waitFor();
    check("the saved link shows Still waiting.", true);
    check("the fragment is stripped from the address bar", !first.page.url().includes("#"));
    await shot(first.page, "before-1280-status-pending");

    // 3. The admin approves with their password and sees the backup code
    const adminCtx = await newContext({ viewport: { width: 1280, height: 900 } });
    const admin = await adminCtx.newPage();
    await logIn(admin, adminEmail);
    await admin.goto(`${base}/admin`);
    const section = admin.locator('section[aria-labelledby="requests"]');
    await section.getByText(friendEmail, { exact: true }).waitFor();
    await shot(admin, "before-1280-admin");
    await section.getByRole("button", { name: `Approve request from ${friendEmail}` }).click();
    await section.getByLabel("Your password", { exact: true }).fill(password);
    await section.getByRole("button", { name: "Approve request", exact: true }).click();
    const backup = section.locator("p.select-all");
    await backup.waitFor();
    const backupCode = ((await backup.textContent()) ?? "").trim();
    secrets.push(backupCode);
    check("approve shows the backup code", /^TLN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(backupCode));
    await admin.locator('section[aria-labelledby="invites"]').getByText(/^Request #\d+$/).waitFor();
    check("the invite list refreshed with Request #id", true);
    await shot(admin, "after-1280-admin-approved");

    // 4. The link reveals the code once, and the code signs up
    const second = await openLink(await newContext({ viewport: { width: 1280, height: 900 } }), link);
    await second.page.getByText("Shown once. Copy it now, then create your account.").waitFor();
    const code = ((await secretText(second.page).textContent()) ?? "").trim();
    check("the revealed code is the one the admin saw", code === backupCode);
    await shot(second.page, "after-1280-status-code");
    await second.page.setViewportSize(MOBILE);
    await checkLayout(second.page, "revealed code");
    await shot(second.page, "390-status-code");
    await second.page.getByRole("link", { name: "Create your account" }).click();
    await second.page.waitForURL(/\/login$/);
    await second.page.getByText("Create account", { exact: true }).click();
    await second.page.getByLabel("Invite code").fill(code);
    await second.page.getByLabel("Account name").fill("E2E Friend");
    await second.page.getByLabel("Email").fill(friendEmail);
    await second.page.getByLabel("Password", { exact: true }).fill(password);
    await second.page.getByRole("button", { name: "Create account", exact: true }).click();
    await second.page.waitForURL(/\/applications/);
    check("signing up with the revealed code succeeds", true);

    const third = await openLink(await newContext(), link);
    await third.page.getByText(SHOWN).waitFor();
    check("reopening the link says the code was already shown", (await third.page.locator("p.select-all").count()) === 0);
    check("and says what to do if it was not saved", await third.page.getByText(ASK_AGAIN).isVisible());
    await shot(third.page, "after-1280-status-shown");
    await third.page.setViewportSize(MOBILE);
    await checkLayout(third.page, "already-shown status");
    await shot(third.page, "390-status-shown");

    // 5. The same at 390 px, ending in a rejection and a delete
    const phone = await newContext({ viewport: MOBILE });
    const small = await phone.newPage();
    await small.goto(`${base}/login`);
    await small.getByText("Create account", { exact: true }).click();
    const requestLink = small.getByRole("link", { name: "Don't have a code? Request one" });
    const box = await requestLink.boundingBox();
    check("390px: the request link is at least 44 x 44", !!box && box.width >= 44 && box.height >= 44);
    await shot(small, "390-signup");
    await requestLink.click();
    await small.getByLabel("Contact").waitFor();
    await checkLayout(small, "request form");
    await shot(small, "390-request-form");
    const longContact = `${"\u{1F600}".repeat(30)}${"x".repeat(150)}`;
    const mobileLink = await submitRequest(small, longContact, `${"long".repeat(100)}\n\u{1F600}`);
    await checkLayout(small, "save-link screen");
    await shot(small, "390-save-link");
    const pending = await openLink(phone, mobileLink);
    await pending.page.getByText("Still waiting.").waitFor();
    await checkLayout(pending.page, "pending status");
    await shot(pending.page, "390-status-pending");

    await admin.setViewportSize(MOBILE);
    await admin.reload();
    await section.getByText(longContact, { exact: true }).waitFor();
    await section.getByRole("button", { name: `Approve request from ${longContact}` }).click();
    await section.getByLabel("Your password", { exact: true }).waitFor();
    await checkLayout(admin, "admin requests with the approve form", section);
    await shot(admin, "390-admin-approve-form");
    await section.getByRole("button", { name: "Cancel" }).click();
    await section.getByRole("button", { name: `Reject request from ${longContact}` }).click();
    await admin.getByText("Request rejected.").waitFor();
    await pending.page.getByRole("button", { name: "Check again" }).click();
    await pending.page.getByText("Not approved right now.").waitFor();
    check("after a reject, Check again says not approved", true);
    await shot(pending.page, "390-status-rejected");
    await section.getByRole("button", { name: `Delete request from ${longContact}` }).click();
    const dialog = admin.getByRole("dialog");
    check("delete warns that the invite is not revoked", await dialog.getByText("Deleting an approved request does not revoke its invite. Revoke it under Invites.").isVisible());
    await shot(admin, "390-admin-delete-dialog");
    await dialog.getByRole("button", { name: "Delete request", exact: true }).click();
    await admin.getByText("Request deleted.").waitFor();
    const gone = await openLink(await newContext({ viewport: MOBILE }), mobileLink);
    await gone.page.getByText("Invalid or expired request link.").waitFor();
    check("a deleted request's link gives the generic error", true);
    await shot(gone.page, "390-status-invalid");

    // 6. Nothing leaked
    check("no request URL or Referer carried a token or code", seen.every((r) => secrets.every((s) => !r.url.includes(s) && !r.referer.includes(s))));
    const logs = ["api.log", "web.log"].map((f) => fs.readFileSync(path.join(FRONTEND, ".screenshots/logs", f), "utf8"));
    check("no token or code is in api.log or web.log", logs.every((l) => secrets.every((s) => !l.includes(s))));
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
