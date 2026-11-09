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
  await page.getByText("Offered", { exact: true }).first().waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Frontend Engineer 🚀" }).first().waitFor();
  check("status change survives a reload", await page.getByText("Offered", { exact: true }).first().isVisible());

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
  await page.getByRole("button", { name: "All", exact: true }).click();
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

  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  await browser.close().catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
