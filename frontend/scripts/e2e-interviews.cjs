// Local end-to-end check of the F6 interviews flow on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> node scripts/e2e-interviews.cjs
//
// scripts/local-env.cjs does the setup and the teardown (free API port if :8000 is busy, *_test
// database, truncate on exit, proof that the dev database and a foreign :8000 process were untouched).
// Times are Philippine time whatever the browser zone is: the displayed and prefilled values are
// re-checked in contexts with timezoneId America/Los_Angeles and Pacific/Auckland. Exit code 1 on any FAIL.
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
  const email = `e2e-f6-${Date.now()}@example.com`;
  const password = "Passw0rd!e2e";
  const browser = await chromium.launch(chromiumOptions());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // "not found" text must never flash around an interview write: record it on every document, SPA or not.
  await ctx.addInitScript(() => {
    window.__nf = [];
    const look = () => {
      const t = document.body?.innerText ?? ""; // visible text only: inline scripts also hold strings like "not found"
      if (/not found/i.test(t)) window.__nf.push(t.match(/[^.]*not found[^.]*/i)[0].trim().slice(0, 60));
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.type());
    await d.dismiss();
  });
  const urlIs = (re) => page.waitForURL(re, { timeout: 15000 });
  const toasts = () => page.locator('[role="status"]').allInnerTexts();
  const nf = () => page.evaluate(() => window.__nf);
  // An interview write changes no list field, so the list pane must never show skeleton rows after one
  // (1280: both panes mounted). watch() before the write, stop() after the detail is back and settled.
  const watchListSkeleton = () =>
    page.evaluate(() => {
      window.__lsk = 0;
      const look = () => (window.__lsk += document.querySelectorAll('section[aria-label="Applications"] .animate-ledger-pulse').length);
      window.__lskObs = new MutationObserver(look);
      window.__lskObs.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
  const stopListSkeleton = () => page.evaluate(() => (window.__lskObs.disconnect(), window.__lsk));
  const ivTexts = () => page.getByRole("list", { name: "Interviews" }).locator("> li").allInnerTexts();
  const time = (label = /Date and time/) => page.getByLabel(label);

  // 1. sign up, create an application (through the API on the Next origin)
  await page.goto(`${base}/login`);
  await page.getByRole("radio", { name: "Create account" }).check({ force: true });
  await page.getByLabel("Invite code").fill(createInvite("f6 e2e"));
  await page.getByLabel("Account name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await urlIs(/\/applications$/);
  const created = await page.request.post(`${base}/api/v1/applications`, {
    data: { company: "Pinagsama Tech", job_name: "Frontend Engineer", status: "applied", mode_of_work: "hybrid", date_applied: "2026-11-01" },
  });
  const app = await created.json();
  const id = app.id;
  const appUrl = `${base}/applications/${id}`;
  check("application created through the API", created.ok(), `id ${id}`);

  // 2. empty state -> Add interview -> form rules
  await page.goto(appUrl);
  await page.getByText("No interviews yet.").waitFor();
  const add = page.getByRole("link", { name: "Add interview" });
  check("empty state has exactly one Add interview action", (await add.count()) === 1);
  await add.click();
  await urlIs(new RegExp(`/applications/${id}/interviews/new$`));
  await time().waitFor();
  check("mode starts with nothing selected", await page.getByRole("radio").evaluateAll((rs) => rs.every((r) => !r.checked)));
  check("outcome defaults to Pending", (await page.getByLabel("Outcome").inputValue()) === "pending");
  check("time field is labelled Philippine time", await page.getByText("Date and time (Philippine time)").isVisible());
  await page.getByRole("button", { name: "Save interview" }).click();
  check("empty submit: time error", await page.getByText("Enter the date and time.").isVisible());
  check("empty submit: 'Choose an interview mode.'", await page.getByText("Choose an interview mode.").isVisible());
  check("empty submit: focus on the time field", await time().evaluate((el) => el === document.activeElement));
  await time().fill("2026-11-20T23:30");
  await page.getByRole("button", { name: "Save interview" }).click();
  check("only mode missing: focus inside the mode group", await page.evaluate(() => !!document.activeElement?.closest("fieldset[role=radiogroup]")));
  check("focusing the group did not select a mode", await page.getByRole("radio").evaluateAll((rs) => rs.every((r) => !r.checked)));

  // 3. save at 23:30 PHT
  await page.getByRole("radio", { name: "Online" }).check({ force: true });
  await page.getByLabel("Interviewer").fill("  Ana Santos 🎯  ");
  await page.getByLabel("Notes", { exact: true }).fill("Portfolio walkthrough.\n日本語");
  await page.evaluate(() => (window.__nf.length = 0));
  await watchListSkeleton();
  await page.getByRole("button", { name: "Save interview" }).click();
  await urlIs(new RegExp(`/applications/${id}$`));
  await page.getByRole("list", { name: "Interviews" }).waitFor();
  await page.getByRole("list", { name: "Applications" }).waitFor();
  await page.waitForTimeout(1000); // the background refetches have landed
  check("no list-pane skeleton after creating an interview", (await stopListSkeleton()) === 0);
  check("toast 'Interview saved.'", (await toasts()).some((t) => t.includes("Interview saved.")));
  check('"not found" never flashed around the first save', (await nf()).length === 0, JSON.stringify(await nf()));
  check("detail shows the same wall-clock time (11:30 PM PHT)", (await ivTexts())[0].includes("Nov 20, 2026, 11:30 PM PHT"), (await ivTexts())[0].split("\n")[0]);
  check("interviewer trimmed, emoji and non-Latin notes kept", (await ivTexts())[0].includes("Ana Santos 🎯") && (await ivTexts())[0].includes("日本語"));
  check("Back after save does not return to the form", await (async () => { await page.goBack(); await page.waitForLoadState(); return !pathOf(page.url()).includes("/interviews/new"); })());
  await page.goto(appUrl);
  await page.getByRole("list", { name: "Interviews" }).waitFor();
  const apiList = await (await page.request.get(`${base}/api/v1/applications/${id}/interviews`)).json();
  check("API stores the instant (23:30 PHT = 15:30Z)", apiList.items[0].scheduled_at.startsWith("2026-11-20T15:30:00"), apiList.items[0].scheduled_at);
  const appAfter = await (await page.request.get(`${base}/api/v1/applications/${id}`)).json();
  check("saving an interview did not change the application status", appAfter.status === "applied" && appAfter.updated_at === app.updated_at);
  const firstId = apiList.items[0].id;

  // 4. edit: outcome Good
  const dateLabel = "Nov 20, 2026, 11:30 PM PHT";
  await page.getByRole("link", { name: `Edit interview, ${dateLabel}` }).click();
  await urlIs(new RegExp(`/applications/${id}/interviews/${firstId}/edit$`));
  await page.waitForFunction(() => document.querySelector('input[type="datetime-local"]')?.value !== "");
  check("edit prefills the PHT time from the UTC value", (await time().inputValue()) === "2026-11-20T23:30", await time().inputValue());
  check("edit prefills mode and interviewer", (await page.getByRole("radio", { name: "Online" }).isChecked()) && (await page.getByLabel("Interviewer").inputValue()) === "Ana Santos 🎯");
  await page.getByLabel("Outcome").selectOption("good");
  await page.evaluate(() => (window.__nf.length = 0));
  const patches = [];
  const onReq = (r) => r.method() === "PATCH" && patches.push(r.postData());
  page.on("request", onReq);
  await watchListSkeleton();
  await page.getByRole("button", { name: "Save interview" }).click();
  await urlIs(new RegExp(`/applications/${id}$`));
  await page.getByRole("list", { name: "Interviews" }).waitFor();
  await page.getByRole("list", { name: "Applications" }).waitFor();
  await page.waitForTimeout(1000);
  check("no list-pane skeleton after editing an interview", (await stopListSkeleton()) === 0);
  page.off("request", onReq);
  check("edit sent only the changed field", patches.length === 1 && patches[0] === '{"outcome":"good"}', JSON.stringify(patches));
  check('"not found" never flashed around the edit save', (await nf()).length === 0, JSON.stringify(await nf()));
  check("Good stamp shows", (await ivTexts())[0].includes("Good"));
  await page.reload();
  await page.getByRole("list", { name: "Interviews" }).waitFor();
  check("Good survives a reload", (await ivTexts())[0].includes("Good") && (await ivTexts())[0].includes("11:30 PM PHT"));

  // edit with no change: no request, no toast
  await page.getByRole("link", { name: `Edit interview, ${dateLabel}` }).click();
  await page.waitForFunction(() => document.querySelector('input[type="datetime-local"]')?.value !== "");
  patches.length = 0;
  page.on("request", onReq);
  await page.getByRole("button", { name: "Save interview" }).click();
  await urlIs(new RegExp(`/applications/${id}$`));
  page.off("request", onReq);
  check("edit with no change sends nothing and shows no toast", patches.length === 0 && !(await toasts()).some((t) => t.includes("Interview saved.")));

  // 5. two more: same time (tie by id) and 00:30 PHT
  async function addInterview(when, mode, interviewer) {
    await page.getByRole("link", { name: "Add interview" }).click();
    await urlIs(new RegExp(`/interviews/new$`));
    await time().fill(when);
    await page.getByRole("radio", { name: mode }).check({ force: true });
    if (interviewer) await page.getByLabel("Interviewer").fill(interviewer);
    await page.getByRole("button", { name: "Save interview" }).click();
    await urlIs(new RegExp(`/applications/${id}$`));
    await page.getByRole("list", { name: "Interviews" }).waitFor();
  }
  await addInterview("2026-11-20T23:30", "Async", "Second at same time");
  await addInterview("2026-11-19T00:30", "On-site", "Earlier, just after midnight");
  let rows = await ivTexts();
  check("three rows, earliest first", rows.length === 3 && rows[0].includes("Nov 19, 2026, 12:30 AM PHT"), rows.map((r) => r.split("\n")[0]).join(" | "));
  check("same time keeps a stable order (older id first)", rows[1].includes("Ana Santos") && rows[2].includes("Second at same time"));

  // 6. same wall-clock time in foreign browser timezones
  const state = await ctx.storageState();
  for (const tz of ["America/Los_Angeles", "Pacific/Auckland"]) {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: tz, storageState: state });
    const p2 = await c2.newPage();
    await p2.goto(appUrl);
    await p2.getByRole("list", { name: "Interviews" }).waitFor();
    check(`[${tz}] the browser really runs in that zone`, (await p2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)) === tz);
    const t2 = await p2.getByRole("list", { name: "Interviews" }).locator("> li").allInnerTexts();
    check(`[${tz}] detail shows 12:30 AM and 11:30 PM PHT unchanged`, t2[0].includes("Nov 19, 2026, 12:30 AM PHT") && t2[1].includes("Nov 20, 2026, 11:30 PM PHT"), t2.map((r) => r.split("\n")[0]).join(" | "));
    await p2.getByRole("link", { name: "Edit interview, Nov 19, 2026, 12:30 AM PHT" }).click();
    await p2.waitForFunction(() => document.querySelector('input[type="datetime-local"]')?.value !== "");
    check(`[${tz}] edit prefills 2026-11-19T00:30`, (await p2.getByLabel(/Date and time/).inputValue()) === "2026-11-19T00:30", await p2.getByLabel(/Date and time/).inputValue());
    // saving from a foreign zone with a changed note must keep the time (only the note is sent)
    const sent = [];
    p2.on("request", (r) => r.method() === "PATCH" && sent.push(r.postData()));
    await p2.getByLabel("Notes", { exact: true }).fill(`edited from ${tz}`);
    await p2.getByRole("button", { name: "Save interview" }).click();
    await p2.waitForURL(new RegExp(`/applications/${id}$`));
    check(`[${tz}] save sends only the note`, sent.length === 1 && sent[0] === JSON.stringify({ remarks: `edited from ${tz}` }), JSON.stringify(sent));
    await p2.getByRole("list", { name: "Interviews" }).waitFor();
    check(`[${tz}] time unchanged after the save`, (await p2.getByRole("list", { name: "Interviews" }).locator("> li").allInnerTexts())[0].includes("Nov 19, 2026, 12:30 AM PHT"));
    await c2.close();
  }

  // 7. dirty guard
  await page.getByRole("link", { name: "Add interview" }).click();
  await urlIs(/interviews\/new$/);
  await page.getByLabel("Interviewer").fill("typed");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: "Discard changes?" }).waitFor();
  await page.getByRole("button", { name: "Keep editing" }).click();
  check("Keep editing keeps the typed value", (await page.getByLabel("Interviewer").inputValue()) === "typed");
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true }).catch(() => {});
  await page.waitForTimeout(500);
  check("dirty form: beforeunload fired (dismissed, page stays)", dialogs.includes("beforeunload") && !page.isClosed(), JSON.stringify(dialogs));
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await urlIs(new RegExp(`/applications/${id}$`));
  check("Discard returns to the application", true);
  await page.getByRole("list", { name: "Interviews" }).waitFor();

  // 8. delete one, with the not-found observer running
  await page.evaluate(() => (window.__nf.length = 0));
  const ivGets = [];
  const onGet = (r) => r.method() === "GET" && /\/interviews\?/.test(r.url()) && ivGets.push(r.url());
  page.on("request", onGet);
  // Skeleton observer: any skeleton row in the detail pane (or anywhere, logged) from the delete click on.
  await page.evaluate(() => {
    window.__sk = { detail: 0, list: 0, any: 0 };
    const look = () => {
      for (const el of document.querySelectorAll(".animate-ledger-pulse")) {
        window.__sk.any++;
        if (el.closest('section[aria-label="Application detail"]')) window.__sk.detail++;
        if (el.closest('section[aria-label="Applications"]')) window.__sk.list++;
      }
    };
    window.__skObs = new MutationObserver(look);
    window.__skObs.observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.getByRole("button", { name: "Delete interview, Nov 19, 2026, 12:30 AM PHT" }).click();
  await page.getByRole("heading", { name: "Delete this interview?" }).waitFor();
  check("delete dialog names the mode and date", (await page.getByRole("dialog").innerText()).includes("The on-site interview on Nov 19, 2026, 12:30 AM PHT will be removed."));
  await page.getByRole("dialog").getByRole("button", { name: "Delete interview" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Nov 19, 2026, 12:30 AM PHT"));
  await page.waitForTimeout(1000);
  const sk = await page.evaluate(() => (window.__skObs.disconnect(), window.__sk));
  check("no skeleton in the detail pane from the delete click until after the refetch", sk.detail === 0, JSON.stringify(sk));
  check("no skeleton in the list pane after deleting an interview (1280)", sk.list === 0, JSON.stringify(sk));
  check("focus moved to the Interviews heading", await page.evaluate(() => document.activeElement?.id === "d-interviews"), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
  page.off("request", onGet);
  check("toast 'Interview deleted.'", (await toasts()).some((t) => t.includes("Interview deleted.")));
  check("two rows left", (await ivTexts()).length === 2);
  check("the page refetched the interviews in the background", ivGets.length >= 1, `${ivGets.length} GET`);
  check('"not found" never flashed around the interview writes', (await nf()).length === 0, JSON.stringify(await nf()));

  // 9. delete the application: interviews are gone
  const remaining = (await (await page.request.get(`${base}/api/v1/applications/${id}/interviews`)).json()).items.map((i) => i.id);
  await page.getByRole("button", { name: "Delete", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
  await urlIs(/\/applications$/);
  const gone = await Promise.all([
    page.request.get(`${base}/api/v1/applications/${id}/interviews`),
    ...remaining.map((i) => page.request.get(`${base}/api/v1/interviews/${i}`)),
  ]);
  check("deleting the application removed its interviews (all 404)", remaining.length === 2 && gone.every((r) => r.status() === 404));
  await page.goto(`${appUrl}/interviews/new`);
  check("new interview for a deleted application: not found before any form", await (async () => {
    const shown = await page.getByRole("heading", { name: "Application not found." }).waitFor().then(() => true, () => false);
    return shown && (await time().count()) === 0;
  })());

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
