// Local end-to-end check of the A1 admin invite page on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> E2E_API_PORT=8100 E2E_WEB_PORT=3100 node scripts/e2e-admin.cjs
//
// scripts/local-env.cjs does the setup and the teardown (*_test database only). The admin is the
// address in E2E_ADMIN_EMAILS (set below). Invite codes are read from the DOM and never printed.
// Exit code 1 on any FAIL.
process.env.E2E_ADMIN_EMAILS = "admin-e2e@example.ph";
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { chromiumOptions, withEnv, FRONTEND } = require("./local-env.cjs");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

withEnv(async ({ base, apiBase, createInvite }) => {
  const stamp = Date.now();
  const adminEmail = process.env.E2E_ADMIN_EMAILS;
  const friendEmail = `friend-e2e-${stamp}@example.ph`;
  const password = "Passw0rd!e2e";
  const codes = []; // never printed
  const browser = await chromium.launch(chromiumOptions());
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const codeEl = page.locator('section[aria-labelledby="new-code"] p.select-all');
    const rows = page.locator('section[aria-labelledby="invites"] li');
    const createCode = async (note, pw = password) => {
      await page.getByLabel("Note").fill(note);
      await page.getByLabel("Expires in").selectOption("7");
      await page.getByLabel("Your password", { exact: true }).fill(pw);
      await page.getByRole("button", { name: "Create code" }).click();
    };
    const readCode = async () => {
      await codeEl.waitFor();
      const code = ((await codeEl.textContent()) ?? "").trim();
      codes.push(code);
      return code;
    };

    // 1. Admin signs up through the UI and sees the Admin link on Account
    await page.goto(`${base}/login`);
    await page.getByRole("radio", { name: "Create account" }).check({ force: true });
    await page.getByLabel("Invite code").fill(createInvite("a1 e2e admin").toLowerCase().replace(/-/g, " "));
    await page.getByLabel("Account name").fill("E2E Admin");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.waitForURL(/\/applications/);
    await page.goto(`${base}/account`);
    const adminLink = page.getByRole("link", { name: "Admin", exact: true });
    await adminLink.waitFor();
    check("admin: Account shows the Admin link", await adminLink.isVisible());
    await adminLink.click();
    await page.waitForURL(/\/admin$/);
    check("Admin link lands on /admin", pathOf(page.url()) === "/admin", pathOf(page.url()));
    await page.getByRole("heading", { name: "Create invite" }).waitFor();

    // 2. Create a code, read it from the DOM, copy
    await createCode("Friend one");
    const code1 = await readCode();
    check("code created and read from the DOM (<redacted>)", /^TLN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code1));
    check("'This code cannot be shown again.' is visible", await page.getByText("This code cannot be shown again.").isVisible());
    await page.getByRole("button", { name: "Copy code" }).click();
    const ok = page.getByText("Code copied.");
    const failedCopy = page.getByText("Couldn't copy the code. Select it and copy it yourself.");
    await ok.or(failedCopy).first().waitFor();
    const copyPath = (await ok.count()) ? "success toast" : "failure toast";
    check(`Copy shows a toast (${copyPath})`, (await ok.count()) + (await failedCopy.count()) >= 1);
    check("code still visible after Copy", (await codeEl.isVisible()) && ((await codeEl.textContent()) ?? "").trim() === code1);

    // 3. A friend signs up with the code (node fetch, no Origin header)
    const res = await fetch(`${apiBase}/api/v1/signup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: friendEmail, password, account_name: "E2E Friend", invite_code: code1 }),
    });
    check("friend signup with the created code", res.ok, String(res.status));
    await page.reload();
    await page.getByRole("heading", { name: "Invites" }).waitFor();
    const friendRow = rows.filter({ hasText: "Friend one" });
    await friendRow.waitFor();
    check("after reload the code block is gone", (await codeEl.count()) === 0 && (await page.getByText("This code cannot be shown again.").count()) === 0);
    check("row shows the Used stamp", await friendRow.getByText("Used", { exact: true }).isVisible());
    check("row shows 'Used on ... by E2E Friend'", /Used on .+ by E2E Friend/.test((await friendRow.textContent()) ?? ""));

    // 7. Wrong password: field error, no new row
    const before = await rows.count();
    await createCode("Wrong pw", "Wrong-pass1!");
    await page.getByText("Incorrect password.").waitFor();
    check("wrong password: 'Incorrect password.' on the field", await page.getByText("Incorrect password.").isVisible());
    check("wrong password: no new row and no code", (await rows.count()) === before && (await codeEl.count()) === 0);

    // 4. Second code, revoke through the dialog
    await createCode("Friend two");
    await readCode();
    const twoRow = rows.filter({ hasText: "Friend two" });
    await twoRow.waitFor();
    await twoRow.getByRole("button", { name: "Revoke invite, Friend two" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Revoke this invite?").waitFor();
    check("revoke dialog title shown", await dialog.getByText("Revoke this invite?").isVisible());
    await dialog.getByRole("button", { name: "Revoke invite", exact: true }).click();
    await page.getByText("Invite revoked.").waitFor();
    check("'Invite revoked.' toast showed", true);
    await rows.filter({ hasText: "Friend two" }).waitFor({ state: "detached" });
    check("revoked row is gone from the list", (await rows.filter({ hasText: "Friend two" }).count()) === 0);

    // 5. No created code in the server logs
    const logs = ["api.log", "web.log"].map((f) => fs.readFileSync(path.join(FRONTEND, ".screenshots/logs", f), "utf8"));
    const leaked = codes.filter((c) => logs.some((l) => l.includes(c)));
    check(`none of ${codes.length} created codes appears in api.log or web.log`, leaked.length === 0 && codes.length === 2);

    // 6. The friend (not an admin) in a fresh context
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await p2.goto(`${base}/login`);
    await p2.getByLabel("Email").fill(friendEmail);
    await p2.getByLabel("Password", { exact: true }).fill(password);
    await p2.getByRole("button", { name: "Log in", exact: true }).click();
    await p2.waitForURL(/\/applications/);
    await p2.goto(`${base}/account`);
    await p2.getByText("E2E Friend").waitFor();
    check("non-admin: Account has no Admin link", (await p2.getByRole("link", { name: "Admin", exact: true }).count()) === 0);
    await p2.goto(`${base}/admin`);
    await p2.getByText("Page not found.").waitFor();
    check("non-admin: /admin shows 'Page not found.'", await p2.getByText("Page not found.").isVisible());
    check(
      "non-admin: no 'Create invite' heading and no form",
      (await p2.getByRole("heading", { name: "Create invite" }).count()) === 0 && (await p2.locator("form").count()) === 0,
    );
    await ctx2.close();
  } finally {
    await browser.close();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
