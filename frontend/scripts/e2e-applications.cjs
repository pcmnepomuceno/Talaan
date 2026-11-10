// Local end-to-end check of the F5 applications flow on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> node scripts/e2e-applications.cjs
//
// scripts/local-env.cjs does the setup and the teardown: it starts the API (a free port, :8000 is left
// alone if busy) on the *_test database with COOKIE_SECURE=false, starts `next dev`, and on exit stops
// both, truncates the test database and prints that the dev database and any foreign :8000 process
// were not touched. Exit code 1 if any check fails.
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");

let failed = 0;
let passed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  ok ? passed++ : failed++;
}
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search;
};

withEnv(async ({ base, createInvite }) => {
  const stamp = Date.now();
  const email = `e2e-f5-${stamp}@example.com`;
  const password = "Passw0rd!e2e";
  const browser = await chromium.launch(chromiumOptions());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // beforeunload dialogs are handled on purpose: always dismissed (= stay on the page), and recorded.
  const dialogs = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.type());
    await d.dismiss();
  });
  const urlIs = (re) => page.waitForURL(re, { timeout: 15000 });
  const toastText = () => page.locator('[role="status"]').allInnerTexts();

  // 1. sign up with a CLI invite
  await page.goto(`${base}/login`);
  await page.getByRole("radio", { name: "Create account" }).check({ force: true });
  await page.getByLabel("Invite code").fill(createInvite("f5 e2e"));
  await page.getByLabel("Account name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await urlIs(/\/applications$/);
  check("sign up lands on /applications", pathOf(page.url()) === "/applications");

  // 2. new user: empty state with the Add action
  await page.getByText("No applications yet.").waitFor();
  check("new user sees the empty state", true);
  const add = page.getByRole("link", { name: "Add application" }).first();
  check("empty state has an Add action to /applications/new", (await add.getAttribute("href")) === "/applications/new");

  // 3. create form: empty submit shows errors, focuses the first invalid field
  await add.click();
  await urlIs(/\/applications\/new$/);
  check("work mode starts with nothing selected", (await page.getByRole("radio").evaluateAll((rs) => rs.every((r) => !r.checked))) === true);
  check("status defaults to Saved", (await page.getByLabel("Status", { exact: true }).inputValue()) === "saved");
  await page.getByRole("button", { name: "Save application" }).click();
  check("empty submit: Job title error", await page.getByText("Enter a job title.").isVisible());
  check("empty submit: Company error", await page.getByText("Enter a company name.").isVisible());
  check("empty submit: 'Choose a work mode.' shown", await page.getByText("Choose a work mode.").isVisible());
  check("empty submit: focus on Job title", await page.getByLabel("Job title").evaluate((el) => el === document.activeElement));

  // 4. fill every field; work mode last-missing -> focus goes to the group
  await page.getByLabel("Job title").fill("Frontend Engineer 🚀");
  await page.getByLabel("Company", { exact: true }).fill("  Pinagsama Tech  ");
  await page.getByRole("button", { name: "Save application" }).click();
  check("only work mode missing: focus is inside the work mode group", await page.evaluate(() => !!document.activeElement?.closest("fieldset[role=radiogroup]")));
  check("focusing the group did not select a mode", (await page.getByRole("radio").evaluateAll((rs) => rs.every((r) => !r.checked))) === true);
  await page.getByRole("radio", { name: "Hybrid" }).check({ force: true });
  await page.getByLabel("Status", { exact: true }).selectOption("applied");
  await page.getByLabel("Date applied").fill("2026-10-31");
  const salary = page.getByLabel("Monthly gross salary (PHP)");
  await salary.fill("85,000");
  check("salary 85,000 is stored as digits only", (await salary.inputValue()) === "85,000" || (await salary.inputValue()) === "85000", await salary.inputValue());
  await page.getByLabel("Company website").fill("https://pinagsama.example.ph");
  await page.getByLabel("Notes", { exact: true }).fill("Referred by a former teammate.\nLine two with 日本語 and emoji 🎯.");

  // 5. dirty guard: Cancel -> dialog -> Keep editing keeps every value
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: "Discard changes?" }).waitFor();
  check("Cancel on a dirty form asks 'Discard changes?'", true);
  await page.getByRole("button", { name: "Keep editing" }).click();
  check("Keep editing keeps the typed values", (await page.getByLabel("Job title").inputValue()) === "Frontend Engineer 🚀" && (await page.getByLabel("Notes", { exact: true }).inputValue()).includes("日本語"));

  // 5b. beforeunload: a dirty form tries to block leaving; the dialog is dismissed on purpose
  dialogs.length = 0;
  await page.close({ runBeforeUnload: true }).catch(() => {});
  await page.waitForTimeout(500);
  check("dirty form: beforeunload dialog fired (and was dismissed, page stays open)", dialogs.includes("beforeunload") && !page.isClosed(), JSON.stringify(dialogs));

  // 6. save
  await page.getByRole("button", { name: "Save application" }).click();
  await urlIs(/\/applications\/\d+$/);
  const id = pathOf(page.url()).split("/").pop();
  check("create: lands on /applications/<id>", /^\d+$/.test(id), pathOf(page.url()));
  check("toast 'Application saved.'", (await toastText()).some((t) => t.includes("Application saved.")));
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  const body = await page.locator("main").innerText();
  check("detail shows trimmed company", body.includes("Pinagsama Tech") && !body.includes("  Pinagsama"));
  check("detail shows date exactly as stored (Oct 31, 2026)", body.includes("Oct 31, 2026"));
  check("detail shows salary", body.includes("₱85,000"));
  check("detail shows notes with non-Latin text", body.includes("日本語"));
  dialogs.length = 0;
  await page.reload();
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  check("reload on a clean page: no beforeunload dialog", dialogs.length === 0, JSON.stringify(dialogs));

  // 7. Back does not return to the form
  await page.goBack();
  await page.waitForLoadState();
  check("browser Back after create does not return to /applications/new", !pathOf(page.url()).endsWith("/new"), pathOf(page.url()));
  await page.goto(`${base}/applications`);

  // 8. list + client-visible server filter
  await page.getByRole("link", { name: /Frontend Engineer/ }).first().waitFor();
  check("list shows the new application", true);
  const statusSelect = page.getByRole("combobox", { name: "Status" });
  check("filter select starts on All", (await statusSelect.inputValue()) === "all");
  await statusSelect.selectOption("offered");
  await urlIs(/status=offered/);
  await page.getByText("No applications with this status.").waitFor();
  check("filter: other status shows 'No applications with this status.'", true);
  await statusSelect.selectOption("applied");
  await urlIs(/status=applied/);
  await page.getByRole("link", { name: /Frontend Engineer/ }).first().waitFor();
  check("filter: Applied shows it, ?status= kept in the URL", pathOf(page.url()) === "/applications?status=applied");
  check("filter select changes the list (Applied row shown, select reads Applied)", (await statusSelect.inputValue()) === "applied");

  // 9. edit the status, see it after reload
  await page.getByRole("link", { name: /Frontend Engineer/ }).first().click();
  await urlIs(new RegExp(`/applications/${id}\\?status=applied$`));
  await page.getByRole("link", { name: "Edit" }).first().click();
  await urlIs(new RegExp(`/applications/${id}/edit\\?status=applied$`));
  await page.getByLabel("Job title").waitFor();
  await page.waitForFunction(() => document.querySelector("input")?.value !== "");
  check("edit pre-fills from the real record", (await page.getByLabel("Company", { exact: true }).inputValue()) === "Pinagsama Tech" && (await page.getByLabel("Date applied").inputValue()) === "2026-10-31" && (await page.getByLabel("Monthly gross salary (PHP)").inputValue()) === "85000");
  check("edit pre-selects the stored work mode", await page.getByRole("radio", { name: "Hybrid" }).isChecked());
  await page.reload();
  await page.getByLabel("Company", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("input")?.value !== "");
  check("reload on /edit works and pre-fills again", (await page.getByLabel("Company", { exact: true }).inputValue()) === "Pinagsama Tech");
  await page.getByLabel("Status", { exact: true }).selectOption("offered");
  await page.getByRole("button", { name: "Save application" }).click();
  await urlIs(new RegExp(`/applications/${id}\\?status=applied$`));
  await page.locator('section[aria-label="Application detail"]').getByText("Offered", { exact: true }).first().waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  check("status change survives a reload", await page.locator('section[aria-label="Application detail"]').getByText("Offered", { exact: true }).first().isVisible());

  // 10. dirty guard on edit; unknown id; other-user style 404
  await page.goto(`${base}/applications/${id}/edit`);
  await page.getByLabel("Company", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("input")?.value !== "");
  await page.getByRole("button", { name: "Cancel" }).click(); // clean: leaves without a dialog
  await urlIs(new RegExp(`/applications/${id}$`));
  check("Cancel on a clean edit form leaves without asking", true);
  await page.goto(`${base}/applications/${id}/edit`);
  await page.waitForFunction(() => document.querySelector("input")?.value !== "");
  await page.getByLabel("Company", { exact: true }).fill("Changed Co");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("heading", { name: "Discard changes?" }).waitFor();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await urlIs(new RegExp(`/applications/${id}$`));
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  const afterDiscard = await page.locator("main").innerText();
  check("Discard returns to the detail, unchanged", afterDiscard.includes("Pinagsama Tech") && !afterDiscard.includes("Changed Co"));
  await page.goto(`${base}/applications/999999`);
  check("unknown id on detail: not found", await page.getByText("Application not found.").waitFor().then(() => true, () => false));
  await page.goto(`${base}/applications/999999/edit`);
  check("unknown id on edit: not found", await page.getByText("Application not found.").waitFor().then(() => true, () => false));

  // 10b. Change status on the detail (1280: list + detail panes). Saved -> Applied: the server fills
  // date_applied, the detail shows the server's row at once (no skeleton in the detail pane), and the
  // background refetch still happens.
  const sr = await page.request.post(`${base}/api/v1/applications`, { data: { company: "Status Co", job_name: "Status Role", status: "saved", mode_of_work: "remote" } });
  const sid = (await sr.json()).id;
  const manilaToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/applications/${sid}`);
  await page.getByRole("heading", { name: "Status Role" }).first().waitFor();
  await page.getByRole("list", { name: "Interviews" }).or(page.getByText("No interviews yet.")).first().waitFor();
  check("Saved application starts with no date", (await (await page.request.get(`${base}/api/v1/applications/${sid}`)).json()).date_applied === null);
  const changeBtn = page.getByRole("button", { name: "Change status" });
  await changeBtn.focus();
  await page.keyboard.press("Enter"); // keyboard only: open with Enter
  const statusDialog = page.getByRole("dialog", { name: "Change status" });
  await statusDialog.waitFor();
  check("status dialog: current status checked and focused", await page.evaluate(() => document.activeElement?.matches('input[type="radio"]:checked') && document.activeElement.closest("label")?.textContent === "Saved"));
  await page.keyboard.press("ArrowDown"); // Saved -> Applied
  check("arrow key chose Applied without sending anything", (await page.getByRole("radio", { name: "Applied" }).isChecked()) && (await (await page.request.get(`${base}/api/v1/applications/${sid}`)).json()).status === "saved");
  await page.evaluate(() => {
    window.__sk = { detail: 0 };
    const look = () => {
      for (const el of document.querySelectorAll(".animate-ledger-pulse")) if (el.closest('section[aria-label="Application detail"]')) window.__sk.detail++;
    };
    window.__skObs = new MutationObserver(look);
    window.__skObs.observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const stGets = [];
  const onSt = (r) => r.method() === "GET" && new RegExp(`/api/v1/applications/${sid}$`).test(r.url()) && stGets.push(r.url());
  page.on("request", onSt);
  await page.keyboard.press("Enter"); // confirm with Enter
  await page.waitForFunction(() => document.querySelector('section[aria-label="Application detail"]')?.textContent.includes("Applied"));
  await page.waitForTimeout(1500);
  const stSk = await page.evaluate(() => (window.__skObs.disconnect(), window.__sk));
  page.off("request", onSt);
  check("status change: no skeleton in the detail pane from confirm until after the refetch", stSk.detail === 0, JSON.stringify(stSk));
  check("status change: no refetch (the PATCH response is the fresh row)", stGets.length === 0, `${stGets.length} GET`);
  check("toast 'Status updated.'", (await toastText()).some((t) => t.includes("Status updated.")));
  const sAfter = await (await page.request.get(`${base}/api/v1/applications/${sid}`)).json();
  check("status change persisted and the server filled date_applied (today, Manila)", sAfter.status === "applied" && sAfter.date_applied === manilaToday, JSON.stringify([sAfter.status, sAfter.date_applied, manilaToday]));
  check("detail shows the filled date", await page.locator('section[aria-label="Application detail"]').getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/).first().isVisible());
  check("focus is back on Change status", await page.evaluate(() => document.activeElement?.textContent === "Change status"));
  check("list row shows the new status", (await page.getByRole("list", { name: "Applications" }).getByRole("link", { name: /Status Role/ }).innerText()).includes("Applied"));
  await page.request.delete(`${base}/api/v1/applications/${sid}`);

  // 10c. PR #23 review: a status change at 1280 never blanks the list pane. 120 extra rows, Load more
  // twice, the list pane scrolled down, a row near the bottom opened, then Change status.
  const seeded = [];
  for (let i = 1; i <= 120; i++) {
    const r = await page.request.post(`${base}/api/v1/applications`, { data: { company: `Pane Co ${i}`, job_name: `Pane Role ${i}`, status: "applied", mode_of_work: "remote" } });
    if (!r.ok()) throw new Error("seed failed " + r.status());
    seeded.push((await r.json()).id);
  }
  const pane = page.locator('section[aria-label="Applications"]');
  const paneLinks = pane.getByRole("list", { name: "Applications" }).getByRole("link");
  await page.goto(`${base}/applications`);
  await page.getByRole("button", { name: "Load more" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 100);
  await page.getByRole("button", { name: "Load more" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 121);
  const target = paneLinks.nth(110);
  const targetHref = await target.getAttribute("href");
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await urlIs(new RegExp(`${targetHref}$`));
  await page.getByRole("button", { name: "Change status" }).waitFor();
  await page.getByText("No interviews yet.").waitFor();
  const scrollBefore = await pane.evaluate((el) => el.scrollTop);
  check("1280: list pane scrolled down before the change", scrollBefore > 1000, String(scrollBefore));
  const watchSkeletons = () =>
    page.evaluate(() => {
      window.__pane = { list: 0, detail: 0 };
      const look = () => {
        for (const el of document.querySelectorAll(".animate-ledger-pulse")) {
          if (el.closest('section[aria-label="Applications"]')) window.__pane.list++;
          if (el.closest('section[aria-label="Application detail"]')) window.__pane.detail++;
        }
      };
      window.__paneObs = new MutationObserver(look);
      window.__paneObs.observe(document.body, { subtree: true, childList: true, attributes: true });
    });
  const stopSkeletons = () => page.evaluate(() => (window.__paneObs.disconnect(), window.__pane));
  const gets = [];
  const onGet = (r) => r.method() === "GET" && /\/api\/v1\/applications(\?|\/\d+)/.test(r.url()) && gets.push(pathOf(r.url()));
  await watchSkeletons();
  page.on("request", onGet);
  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("radio", { name: "Offered" }).check();
  await page.getByRole("button", { name: "Update status" }).click();
  // .catch: on a list that dropped its loaded pages the row never comes back; the checks below say so.
  await page.waitForFunction((h) => document.querySelector(`ul[aria-label="Applications"] a[href="${h}"]`)?.textContent.includes("Offered"), targetHref, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const paneSk = await stopSkeletons();
  page.off("request", onGet);
  check("1280 status change (All): no skeleton in the list or detail pane", paneSk.list === 0 && paneSk.detail === 0, JSON.stringify(paneSk));
  check("1280 status change (All): every loaded page remains (121 rows)", (await paneLinks.count()) === 121);
  const scrollAfter = await pane.evaluate((el) => el.scrollTop);
  check("1280 status change (All): list scroll position kept", Math.abs(scrollAfter - scrollBefore) <= 1, `${scrollBefore} -> ${scrollAfter}`);
  check("1280 status change (All): the row shows the new status", ((await pane.locator(`a[href="${targetHref}"]`).innerText({ timeout: 2000 }).catch(() => "")) || "").includes("Offered"));
  check("1280 status change (All): no list or detail GET", gets.length === 0, JSON.stringify(gets));
  check("1280 status change: Change status enabled right away", await page.getByRole("button", { name: "Change status" }).isEnabled());

  // Dialog focus: a slow PATCH that fails. Focus stays in the dialog while busy, then the checked radio.
  const targetId = targetHref.split("/").pop();
  await page.route(`**/api/v1/applications/${targetId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"Server error"}' });
  });
  await page.getByRole("button", { name: "Change status" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Change status" }).waitFor();
  await page.keyboard.press("ArrowDown"); // Offered -> Accepted
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const busyFocus = await page.evaluate(() => ({ inDialog: !!document.activeElement?.closest("dialog[open]"), tag: document.activeElement?.tagName, busy: document.querySelector("dialog[open]")?.getAttribute("aria-busy") }));
  check("dialog busy: focus stays inside the dialog", busyFocus.busy === "true" && busyFocus.inDialog, JSON.stringify(busyFocus));
  await page.getByText("Talaan isn't responding right now. Try again in a moment.").or(page.getByText("Couldn't change the status. Try again.")).first().waitFor();
  await page.waitForTimeout(200);
  const failFocus = await page.evaluate(() => ({ radio: document.activeElement?.matches('dialog[open] input[type="radio"]:checked') ?? false, label: document.activeElement?.closest("label")?.textContent ?? document.activeElement?.tagName }));
  check("dialog failed save: the checked radio has focus", failFocus.radio, JSON.stringify(failFocus));
  await page.unroute(`**/api/v1/applications/${targetId}`);
  await page.keyboard.press("Escape");

  // Filtered view: the row leaves, Load more asks for the server's next unsent row, no gap.
  await page.goto(`${base}/applications?status=applied`);
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 50);
  const first = paneLinks.first();
  const firstHref = await first.getAttribute("href");
  await first.click();
  await urlIs(new RegExp(`${firstHref.replace("?", "\\?")}$`));
  await page.getByRole("button", { name: "Change status" }).waitFor();
  await page.getByText("No interviews yet.").waitFor();
  const offsets = [];
  const onList = (r) => r.method() === "GET" && /\/api\/v1\/applications\?/.test(r.url()) && offsets.push(new URL(r.url()).searchParams.get("offset"));
  await watchSkeletons();
  page.on("request", onList);
  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("radio", { name: "Rejected" }).check();
  await page.getByRole("button", { name: "Update status" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 49, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  check("1280 status change (filtered): 49 rows held after the row left", (await paneLinks.count()) === 49, String(await paneLinks.count()));
  const fSk = await stopSkeletons();
  check("1280 status change (filtered): the row leaves, no skeleton in either pane", fSk.list === 0 && fSk.detail === 0, JSON.stringify(fSk));
  check("1280 status change (filtered): no list refetch", offsets.length === 0, JSON.stringify(offsets));
  await page.getByRole("button", { name: "Load more" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 99);
  await page.getByRole("button", { name: "Load more" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 118);
  page.off("request", onList);
  check("filtered Load more offsets follow the held rows (49, then 99)", JSON.stringify(offsets) === '["49","99"]', JSON.stringify(offsets));
  const apiIds = [];
  for (const off of [0, 100]) apiIds.push(...(await (await page.request.get(`${base}/api/v1/applications?status=applied&limit=100&offset=${off}`)).json()).items.map((a) => a.id));
  const shownIds = (await paneLinks.evaluateAll((as) => as.map((a) => a.getAttribute("href")))).map((h) => Number(h.split("?")[0].split("/").pop()));
  check("filtered list equals the server's set: no row skipped or repeated", JSON.stringify(shownIds) === JSON.stringify(apiIds), `${shownIds.length} vs ${apiIds.length}`);
  for (const sid2 of seeded) await page.request.delete(`${base}/api/v1/applications/${sid2}`);

  // 11. delete -> empty again
  await page.goto(`${base}/applications/${id}?status=offered`);
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  await page.setViewportSize({ width: 1280, height: 900 }); // two panes: the detail stays mounted
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).waitFor();
  // Watch the whole DOM from before the confirm click: "Application not found" must never appear.
  await page.evaluate(() => {
    window.__notFoundSeen = false;
    const look = () => {
      if (document.body.textContent.includes("Application not found")) window.__notFoundSeen = true;
    };
    window.__notFoundObserver = new MutationObserver(look);
    window.__notFoundObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
    look();
  });
  const detailGets = [];
  const onReq = (r) => r.method() === "GET" && new RegExp(`/api/v1/applications/${id}(/|$|\\?)`).test(r.url()) && detailGets.push(r.url());
  page.on("request", onReq);
  await page.getByRole("button", { name: "Delete application" }).click();
  await urlIs(/\/applications\?status=offered$/);
  check("toast 'Application deleted.'", (await toastText()).some((t) => t.includes("Application deleted.")));
  await page.getByText("No applications with this status.").waitFor();
  await page.waitForTimeout(1000); // a late refetch would land by now
  const notFoundSeen = await page.evaluate(() => {
    window.__notFoundObserver.disconnect();
    return window.__notFoundSeen;
  });
  page.off("request", onReq);
  check("1280px delete: 'Application not found' never appeared in the DOM", !notFoundSeen);
  check("1280px delete: the deleted id was not fetched again", detailGets.length === 0, JSON.stringify(detailGets));
  check("delete returns to the list keeping ?status=", pathOf(page.url()) === "/applications?status=offered");
  await page.getByRole("combobox", { name: "Status" }).selectOption("all");
  await page.getByText("No applications yet.").waitFor();
  check("after delete the empty state is back", true);
  const gone = await page.request.get(`${base}/api/v1/applications/${id}`);
  check("API says 404 for the deleted id", gone.status() === 404);

  // 12. paging against the real API: 60 rows -> 50 + Load more
  for (let i = 1; i <= 60; i++) {
    const r = await page.request.post(`${base}/api/v1/applications`, { data: { company: `Paging Co ${i}`, job_name: `Role ${i}`, status: "applied", mode_of_work: "remote" } });
    if (!r.ok()) throw new Error("seed failed " + r.status());
  }
  await page.reload();
  const rows = () => page.getByRole("list", { name: "Applications" }).getByRole("link").count();
  await page.getByRole("button", { name: "Load more" }).waitFor();
  check("first page shows 50 rows and Load more", (await rows()) === 50);
  await page.getByRole("button", { name: "Load more" }).click();
  await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Applications"] a').length === 60);
  check("Load more adds the last 10 and the button disappears", (await page.getByRole("button", { name: "Load more" }).count()) === 0);
  check("announced in the live region", (await toastText()).some((t) => t.includes("10 more applications loaded")));
  check("focus moved to the first new row", await page.evaluate(() => document.activeElement?.tagName === "A" && document.activeElement.closest("ul")?.getAttribute("aria-label") === "Applications"));

  // 13. waking-up line (PR #23 review item 5): first load only, never adds page height at 1280.
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 900]]) {
    const p2 = await ctx.newPage();
    await p2.setViewportSize({ width: w, height: h });
    await p2.route("**/api/v1/applications?*", async (route) => {
      await new Promise((r) => setTimeout(r, 4500));
      await route.fallback();
    });
    await p2.goto(`${base}/applications`);
    await p2.waitForTimeout(1000);
    const before = await p2.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }));
    await p2.waitForTimeout(2600);
    const during = await p2.evaluate(() => ({
      sh: document.documentElement.scrollHeight,
      ih: innerHeight,
      shown: [...document.querySelectorAll("p[aria-live=polite]")].some((el) => el.textContent.includes("Starting up") && el.offsetParent !== null),
    }));
    check(`${w}px: waking-up line shows on a slow first load`, during.shown);
    if (w >= 1280) check(`${w}px: the line adds no page height (no page scroll at h-dvh)`, during.sh === before.sh && during.sh <= during.ih, JSON.stringify({ before, during }));
    else console.log(`INFO  ${w}px page height before/with the line: ${before.sh} / ${during.sh} (viewport ${during.ih}); below 1280 the line is in normal flow`);
    await p2.getByRole("list", { name: "Applications" }).waitFor({ timeout: 15000 });
    await p2.close();
  }

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close().catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
