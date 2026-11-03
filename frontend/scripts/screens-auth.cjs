// Local screenshots of the F4 auth screens (light and dark at 390, 768, 1280). NOT in package.json or CI.
// Same setup as scripts/e2e-auth.cjs (API on the TEST database, Next dev with HIDE_DEV_INDICATOR=1).
// Output: frontend/.screenshots/ (gitignored) and, if it exists, SCREENS_OUT
// (default /mnt/c/dev/projects/portfolio/talaan-screens), as {theme}-{width}-{name}.png.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const REPO = path.resolve(__dirname, "../..");
const PYTHON = process.env.PYTHON ?? path.join(REPO, ".venv/bin/python");
const OUT = [path.resolve(__dirname, "../.screenshots"), process.env.SCREENS_OUT ?? "/mnt/c/dev/projects/portfolio/talaan-screens"];
const SIZES = [
  [390, 844],
  [768, 1024],
  [1280, 800],
];
const PASSWORD = "Passw0rd!shots";

function invite() {
  if (!/_test\b/.test(process.env.DATABASE_URL ?? "")) throw new Error("DATABASE_URL must point at the *_test database");
  const out = execFileSync(PYTHON, ["-m", "app.admin", "create-invite", "--note", "f4 screens", "--expires-in", "1d"], { cwd: REPO, encoding: "utf8" });
  return out.match(/TLN-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/)[0];
}

(async () => {
  for (const dir of OUT) if (dir.startsWith(REPO) || fs.existsSync(path.dirname(dir))) fs.mkdirSync(dir, { recursive: true });
  const dirs = OUT.filter((d) => fs.existsSync(d));
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const email = `shots-${Date.now()}@example.com`;
  const api = (ctx) => ctx.request;
  const signupCtx = await browser.newContext();
  const r = await signupCtx.request.post(`${BASE}/api/v1/signup`, {
    data: { email, password: PASSWORD, account_name: "Ana Cruz", invite_code: invite() },
  });
  if (!r.ok()) throw new Error("signup failed " + r.status());
  await signupCtx.close();

  for (const theme of ["light", "dark"]) {
    for (const [width, height] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const shot = async (name, opts = {}) => {
        await page.waitForTimeout(250);
        for (const dir of dirs) await page.screenshot({ path: path.join(dir, `${theme}-${width}-${name}.png`), ...opts });
        console.log(`${theme}-${width}-${name}`);
      };
      const fillLogin = async (pw = "Wrong-pass1!") => {
        await page.getByLabel("Email").fill(email);
        await page.getByLabel("Password", { exact: true }).fill(pw);
      };
      const loginPage = async (qs = "") => {
        await page.goto(`${BASE}/login${qs}`);
        await page.getByLabel("Email").waitFor();
      };
      const unroute = () => page.unroute("**/api/v1/login");

      // Login family (no session)
      await loginPage();
      await shot("login");
      await fillLogin();
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.locator("main [role=alert]").waitFor();
      await shot("login-error-401");
      for (const [name, handler] of [
        ["429", (route) => route.fulfill({ status: 429, headers: { "retry-after": "601", "content-type": "application/json" }, body: '{"detail":"Too many attempts. Try again later."}' })],
        ["503", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"Service temporarily unavailable."}' })],
        ["network", (route) => route.abort("failed")],
      ]) {
        await page.route("**/api/v1/login", handler);
        await fillLogin();
        await page.getByRole("button", { name: "Log in", exact: true }).click();
        await page.locator("main [role=alert]").waitFor();
        await shot(`login-error-${name}`);
        await unroute();
      }
      await loginPage("?expired=1&next=%2Faccount");
      await shot("login-expired");
      await loginPage("?deleted=1");
      await shot("login-deleted");

      // Sign up
      await loginPage();
      await page.getByRole("radio", { name: "Create account" }).check({ force: true });
      await page.getByLabel("Invite code").waitFor();
      await shot("signup");
      await page.getByLabel("Invite code").fill("TLN-ZZZZ-ZZZZ-ZZZZ");
      await page.getByLabel("Account name").fill("Ana Cruz");
      await page.getByLabel("Email").fill("new@example.com");
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByText("Invalid or expired invite code.").waitFor();
      await shot("signup-error-invite");

      // Account + delete flow (real session)
      await loginPage();
      await fillLogin(PASSWORD);
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await page.waitForURL(/\/applications/);
      await page.goto(`${BASE}/account`);
      await page.getByText(email).waitFor();
      await shot("account");
      await page.getByRole("button", { name: "Delete account" }).first().click();
      await page.getByRole("heading", { name: "Delete your account?" }).waitFor();
      await shot("delete-step1");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("heading", { name: "Type your email to confirm" }).waitFor();
      await shot("delete-step2-disabled");
      await page.getByRole("textbox", { name: "Your email" }).fill(email.toUpperCase());
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await shot("delete-step2-enabled");
      await ctx.close();
    }
  }

  // Remove the throwaway account.
  const ctx = await browser.newContext();
  await ctx.request.post(`${BASE}/api/v1/login`, { data: { email, password: PASSWORD } });
  const del = await ctx.request.post(`${BASE}/api/v1/account/delete`, { data: { password: PASSWORD } });
  console.log("cleanup delete:", del.status());
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
