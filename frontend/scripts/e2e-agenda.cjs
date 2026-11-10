// Local end-to-end check of the F8 interviews agenda and the .ics download on the REAL backend.
// NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> node scripts/e2e-agenda.cjs
//   ICS_OUT=<dir>   optional: also keep the downloaded .ics files there (for an external parser)
//
// scripts/local-env.cjs does the setup and the teardown (free API port if :8000 is busy, *_test
// database, truncate on exit, proof that the dev database and a foreign :8000 process were untouched).
// The browser runs in America/Los_Angeles, so every PHT time and every DTSTART below is also a check
// that nothing reads the device zone. Exit code 1 on any FAIL.
const fs = require("node:fs");
const path = require("node:path");
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

// A PHT calendar day `n` days from now, as YYYY-MM-DD (UTC getters on a +8h shifted clock).
const phtDay = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);

withEnv(async ({ base, createInvite }) => {
  const email = `e2e-f8-${Date.now()}@example.com`;
  const password = "Passw0rd!e2e";
  const browser = await chromium.launch(chromiumOptions());
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: "America/Los_Angeles", acceptDownloads: true });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const urlIs = (re) => page.waitForURL(re, { timeout: 15000 });
    const post = async (url, data) => {
      const r = await page.request.post(`${base}/api/v1${url}`, { data });
      if (!r.ok()) throw new Error(`POST ${url} -> ${r.status()} ${await r.text()}`);
      return r.json();
    };
    const rows = () => page.locator("a[data-interview-id]");
    const status = () => page.locator('[role="status"]').first();

    // 1. sign up
    await page.goto(`${base}/login`);
    await page.getByRole("radio", { name: "Create account" }).check({ force: true });
    await page.getByLabel("Invite code").fill(createInvite("f8 e2e"));
    await page.getByLabel("Account name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await urlIs(/\/applications$/);

    // 2. a user with zero interviews
    await page.goto(`${base}/interviews`);
    await page.getByText("No upcoming interviews.").waitFor();
    const goN = await page.getByRole("link", { name: "Go to applications", exact: true }).count();
    const addN = await page.getByRole("link", { name: /^Add/ }).count();
    check("zero interviews: upcoming empty state with a Secondary link, no primary button", goN === 1 && addN === 0, `go ${goN}, add ${addN}`);
    await page.getByRole("radio", { name: "Past" }).click({ force: true });
    await page.getByText("No past interviews.").waitFor();
    check("zero interviews: past empty state, tab kept in the URL", pathOf(page.url()) === "/interviews?when=past");

    // 3. data through the API: two applications, edge-case interviews, 120 more for paging
    const a = await post("/applications", { company: "Pinagsama Tech", job_name: "Frontend Engineer", status: "interviewing", mode_of_work: "hybrid", date_applied: "2026-11-01" });
    const nastyCompany = 'Dela Peña, Ünï & Sons; "Kape" 🚀 ' + "Pinagsama ".repeat(8);
    const nastyJob = "Senior Inhinyero, Software; \\ 🧑‍💻 " + "Tagapamahala ".repeat(8);
    const b = await post("/applications", { company: nastyCompany.trim(), job_name: nastyJob.trim(), status: "interviewing", mode_of_work: "remote", date_applied: "2026-11-01" });
    const d30 = phtDay(30);
    const d31 = nextDay(d30);
    const d60 = phtDay(60);
    const late = await post(`/applications/${a.id}/interviews`, { scheduled_at: `${d30}T23:30:00+08:00`, mode: "online", interviewer: "Ana Santos" });
    const early = await post(`/applications/${b.id}/interviews`, { scheduled_at: `${d31}T00:30:00+08:00`, mode: "async" }); // no interviewer, async
    const same1 = await post(`/applications/${a.id}/interviews`, { scheduled_at: `${d60}T10:00:00+08:00`, mode: "on_site", remarks: "PRIVATE NOTES, do not export" });
    const same2 = await post(`/applications/${b.id}/interviews`, { scheduled_at: `${d60}T10:00:00+08:00`, mode: "online", interviewer: "Niño Réyes" });
    const past1 = await post(`/applications/${a.id}/interviews`, { scheduled_at: `${phtDay(-5)}T10:00:00+08:00`, mode: "online", outcome: "good" });
    const past2 = await post(`/applications/${b.id}/interviews`, { scheduled_at: `${phtDay(-6)}T10:00:00+08:00`, mode: "on_site", outcome: "bad" });
    const bulk0 = Date.parse(`${phtDay(90)}T00:00:00+08:00`);
    for (let i = 0; i < 120; i++) {
      await post(`/applications/${a.id}/interviews`, { scheduled_at: new Date(bulk0 + i * 3600e3).toISOString(), mode: "online" });
    }
    const UPCOMING = 4 + 120;
    check("data created", [late, early, same1, same2, past1, past2].every((x) => x.id));

    // 4. Upcoming: grouping by PHT day across midnight, order, row fields, notes absent
    await page.goto(`${base}/interviews`);
    await rows().first().waitFor();
    check("first page is 50 rows", (await rows().count()) === 50);
    const heads = await page.getByRole("heading", { level: 2 }).allInnerTexts();
    const fmt = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "short", day: "numeric" }).format(new Date(`${d}T00:00:00Z`));
    check("h2 per PHT day, 23:30 and 00:30 PHT on different days, in order", heads[0] === fmt(d30) && heads[1] === fmt(d31) && heads[2] === fmt(d60), heads.slice(0, 3).join(" | "));
    const first = await rows().nth(0).innerText();
    check("row 1: PHT time, job, company, mode, interviewer, outcome", /11:30 PM PHT/.test(first) && /Frontend Engineer/.test(first) && /Pinagsama Tech/.test(first) && /Online/.test(first) && /Ana Santos/.test(first) && /Pending/.test(first), JSON.stringify(first));
    const second = await rows().nth(1).innerText();
    check("row 2 (async, no interviewer): 12:30 AM PHT, Async, no placeholder", /12:30 AM PHT/.test(second) && /Async/.test(second) && !/person|Interviewer|—|-$/.test(second), JSON.stringify(second));
    check("two interviews at the same minute are both shown, lower id first", (await rows().nth(2).getAttribute("data-interview-id")) === String(same1.id) && (await rows().nth(3).getAttribute("data-interview-id")) === String(same2.id));
    check("notes never shown in the agenda", !(await page.locator("body").innerText()).includes("PRIVATE NOTES"));
    check("nav: three items, Interviews current", await page.getByRole("navigation", { name: "Main" }).getByRole("link").evaluateAll((ls) => ls.map((l) => l.textContent + (l.getAttribute("aria-current") ? "*" : "")).join(",")) === "Applications,Interviews*,Account");

    // 5. Load more: 50 -> 100 -> 124
    await page.getByRole("button", { name: "Load more" }).click();
    await page.waitForFunction(() => document.querySelectorAll("a[data-interview-id]").length === 100);
    check("Load more announces and focuses the first new row", (await status().innerText()) === "50 more interviews loaded" && (await page.evaluate(() => document.activeElement?.matches("a[data-interview-id]") && document.activeElement === document.querySelectorAll("a[data-interview-id]")[50])));
    await page.getByRole("button", { name: "Load more" }).click();
    await page.waitForFunction((n) => document.querySelectorAll("a[data-interview-id]").length === n, UPCOMING);
    check(`all ${UPCOMING} rows, Load more gone`, (await page.getByRole("button", { name: "Load more" }).count()) === 0);
    const ids = await rows().evaluateAll((ls) => ls.map((l) => l.getAttribute("data-interview-id")));
    check("no row twice", new Set(ids).size === ids.length);

    // 6. Past tab: newest first
    await page.getByRole("radio", { name: "Past" }).click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll("a[data-interview-id]").length === 2);
    check("Past: two rows, newest first, no Add to calendar", (await rows().evaluateAll((ls) => ls.map((l) => l.getAttribute("data-interview-id")).join(","))) === `${past1.id},${past2.id}` && (await page.getByRole("button", { name: /^Add to calendar/ }).count()) === 0);
    await page.getByRole("radio", { name: "Upcoming" }).click({ force: true });
    await rows().first().waitFor();

    // 7. download: content, file name, toast, double press
    const out = process.env.ICS_OUT;
    if (out) fs.mkdirSync(out, { recursive: true });
    async function download(name, label) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).first().click()]);
      const file = await dl.path();
      const text = fs.readFileSync(file, "utf8");
      if (out) fs.writeFileSync(path.join(out, `${name}-${dl.suggestedFilename()}`), text);
      return { name: dl.suggestedFilename(), text };
    }
    const nastyBtn = page.getByRole("button", { name: /^Add to calendar, Dela Peña/ });
    // the first nasty row is `early` (d31 00:30)
    const [dl] = await Promise.all([page.waitForEvent("download"), nastyBtn.first().click()]);
    const text = fs.readFileSync(await dl.path(), "utf8");
    if (out) fs.writeFileSync(path.join(out, `nasty-${dl.suggestedFilename()}`), text);
    check("toast after the download", await page.getByText("Calendar file downloaded.").first().isVisible());
    check("file name: talaan-interview-<slug>-<PHT date>.ics, ASCII", /^talaan-interview-[a-z0-9-]{1,40}-\d{4}-\d{2}-\d{2}\.ics$/.test(dl.suggestedFilename()) && dl.suggestedFilename().endsWith(`-${d31}.ics`), dl.suggestedFilename());
    const lines = text.split("\r\n");
    check("CRLF only and every line within 75 octets", !/(?<!\r)\n/.test(text) && lines.every((l) => Buffer.byteLength(l) <= 75));
    const flat = text.replace(/\r\n /g, "");
    const startUtc = new Date(`${d31}T00:30:00+08:00`).toISOString().replace(/[-:]|\.\d{3}/g, "");
    check("DTSTART is the PHT instant in UTC (browser zone is Los Angeles)", flat.includes(`DTSTART:${startUtc}\r\n`), startUtc);
    check("UID stable per interview", flat.includes(`UID:talaan-interview-${early.id}@talaan\r\n`));
    check("SUMMARY escapes , ; \\ and keeps the emoji", flat.includes("SUMMARY:Interview: ") && /Senior Inhinyero\\, Software\\; \\\\ 🧑‍💻/.test(flat) && /Dela Peña\\, Ünï & Sons\\; "Kape" 🚀/.test(flat));
    check("DESCRIPTION: Async, no interviewer line, link to the application", /DESCRIPTION:Mode: Async\\nApplication: http:\/\/localhost:\d+\/applications\/\d+/.test(flat) && !/Interviewer/.test(flat));
    check("no notes in any file", !flat.includes("PRIVATE NOTES"));
    const other = await download("same1", new RegExp(`^Add to calendar, Pinagsama Tech, .*10:00 AM PHT`));
    check("a file for an interview that has notes does not contain them", !other.text.includes("PRIVATE NOTES") && /Mode: On-site/.test(other.text.replace(/\r\n /g, "")));
    // double press: two quick clicks, two downloads
    const dls = [];
    page.on("download", (d) => dls.push(d));
    const btn = page.getByRole("button", { name: /^Add to calendar, Pinagsama Tech/ }).first();
    await btn.dblclick();
    await page.waitForTimeout(800);
    check("pressing twice quickly gives two downloads", dls.length === 2, `${dls.length}`);

    // 8. the guide: open, Tab stays inside, Escape, focus returns, scrolls inside
    const guide = page.getByRole("button", { name: "How to add this to your calendar" });
    await guide.click();
    const dialog = page.getByRole("dialog", { name: "How to add this to your calendar" });
    await dialog.waitFor();
    check("guide opens with focus on its title", await page.evaluate(() => document.activeElement?.tagName === "H2" && document.activeElement.closest("dialog") !== null));
    const text0 = await dialog.innerText();
    check("one-time-copy line first, then Google, Apple, Outlook", text0.indexOf("one-time copy") < text0.indexOf("Google Calendar") && text0.indexOf("Google Calendar") < text0.indexOf("Apple Calendar") && text0.indexOf("Apple Calendar") < text0.indexOf("Outlook"));
    let inside = true;
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      // A native modal dialog makes the page behind inert: Tab cycles in the dialog (or leaves to the
      // browser's own UI, where activeElement is <body>), but never lands on the page behind it.
      inside = inside && (await page.evaluate(() => !document.activeElement?.closest("main, nav, header, a, [data-interview-id]") || !!document.activeElement.closest("dialog")));
    }
    check("Tab never reaches the page behind the modal dialog", inside && (await dialog.evaluate((d) => d.matches(":modal"))));
    const scrolls = await dialog.evaluate((d) => ({ sh: d.scrollHeight, ch: d.clientHeight, within: d.getBoundingClientRect().bottom <= window.innerHeight }));
    check("dialog fits the viewport and scrolls inside when long", scrolls.within && scrolls.sh >= scrolls.ch, JSON.stringify(scrolls));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    check("Escape closes, focus returns to the trigger", await guide.evaluate((el) => el === document.activeElement));
    await guide.click();
    await dialog.waitFor();
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "hidden" });
    check("Close closes and focus returns to the trigger", await guide.evaluate((el) => el === document.activeElement));

    // 9. a row opens the application (390: the detail is its own screen), keeping the agenda in history
    await rows().first().click();
    await urlIs(new RegExp(`/applications/${a.id}$`));
    await page.getByRole("heading", { name: "Frontend Engineer", level: 2 }).first().waitFor();
    check("row link opens that application's detail", true);
    // 10. detail: Add to calendar on upcoming rows only, guide under the sheet
    const list = page.getByRole("list", { name: "Interviews" });
    await list.waitFor();
    check("detail: Add to calendar only on upcoming interviews", (await list.getByRole("button", { name: /^Add to calendar/ }).count()) === (await list.locator("> li").count()) - 1, `${await list.getByRole("button", { name: /^Add to calendar/ }).count()} of ${await list.locator("> li").count()}`);
    check("detail: one guide trigger", (await page.getByRole("button", { name: "How to add this to your calendar" }).count()) === 1);

    // 11. cache: create an interview in the UI, the agenda shows it at once; delete the application, its rows leave
    await page.goto(`${base}/applications/${b.id}/interviews/new`);
    await page.getByLabel(/Date and time/).fill(`${phtDay(10)}T09:15`);
    await page.getByRole("radio", { name: "Online" }).check({ force: true });
    await page.getByRole("button", { name: "Save interview" }).click();
    await urlIs(new RegExp(`/applications/${b.id}$`));
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Interviews" }).click();
    await page.waitForFunction(() => document.querySelector("a[data-interview-id]"));
    check("a new interview is the first Upcoming row after the write (cache cleared)", /9:15 AM PHT/.test(await rows().first().innerText()));
    await page.goto(`${base}/applications/${b.id}`);
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
    await urlIs(/\/applications$/);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Interviews" }).click();
    await page.waitForFunction(() => document.querySelector("a[data-interview-id]"));
    const hrefs = await rows().evaluateAll((ls) => ls.map((l) => l.getAttribute("href")));
    check("after deleting application B none of its rows remain", hrefs.length > 0 && hrefs.every((h) => h === `/applications/${a.id}`));

    // 12. 1280 deep link: a row opens the two-pane applications screen on that application
    const wide = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Pacific/Auckland" });
    await wide.addCookies(await ctx.cookies());
    const w = await wide.newPage();
    await w.goto(`${base}/interviews`);
    await w.locator("a[data-interview-id]").first().waitFor();
    check("1280: side nav has three items, Interviews current", (await w.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]').allInnerTexts()).join() === "Interviews");
    await w.locator("a[data-interview-id]").first().click();
    await w.waitForURL(new RegExp(`/applications/${a.id}$`));
    await w.getByRole("region", { name: "Application detail" }).getByRole("heading", { name: "Frontend Engineer" }).waitFor();
    check("1280: deep link shows the list pane and the detail pane together", (await w.getByRole("region", { name: "Applications" }).isVisible()) && (await w.getByRole("region", { name: "Application detail" }).isVisible()));
    check("1280: Applications is current in the nav", (await w.getByRole("navigation", { name: "Main" }).locator('a[aria-current="page"]').allInnerTexts()).join() === "Applications");
    await wide.close();

    // 13. 768 rail: three items fit
    const tab = await browser.newContext({ viewport: { width: 768, height: 900 } });
    await tab.addCookies(await ctx.cookies());
    const t = await tab.newPage();
    await t.goto(`${base}/interviews`);
    await t.locator("a[data-interview-id]").first().waitFor();
    const fit = await t.getByRole("navigation", { name: "Main" }).getByRole("link").evaluateAll((ls) => ls.every((l) => l.scrollWidth <= l.clientWidth + 1 && l.getBoundingClientRect().width >= 44));
    check("768 rail: three items, no clipped label, 44px targets", fit);
    await tab.close();

    check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
  }
  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  if (failed) process.exitCode = 1;
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
