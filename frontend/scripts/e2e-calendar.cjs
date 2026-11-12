// Local end-to-end check of the F9 month view on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> E2E_API_PORT=8100 node scripts/e2e-calendar.cjs
//
// scripts/local-env.cjs does the setup and the teardown (free API port, *_test database, truncate on
// exit, proof that the dev database and a foreign :8000 / :3000 process were untouched). The browser
// runs in America/Los_Angeles, so every PHT day below is also a check that nothing reads the device
// zone. Exit code 1 on any FAIL.
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

// PHT calendar days, as YYYY-MM-DD (UTC getters on a +8h shifted clock).
const phtDay = (n = 0) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
const addMonth = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const i = y * 12 + mo - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const heading = (m) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${m}-01T00:00:00Z`));
const longDay = (d) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", year: "numeric", month: "short", day: "numeric" }).format(new Date(`${d}T00:00:00Z`));

withEnv(async ({ base, createInvite }) => {
  const email = `e2e-f9-${Date.now()}@example.com`;
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
    const grid = page.getByRole("grid");
    const ready = () => page.waitForFunction(() => document.querySelector('[role="grid"]') && !document.querySelector('[role="grid"]').hasAttribute("aria-busy"), null, { timeout: 15000 });
    const cell = (d) => page.locator(`button[data-day="${d}"]`);
    const active = () => page.evaluate(() => document.activeElement?.getAttribute("data-day") ?? document.activeElement?.tagName);
    // The month heading is the grid's label; the import guide has headings of its own inside <main>.
    const monthText = () => document.getElementById(document.querySelector('[role="grid"]')?.getAttribute("aria-labelledby") ?? "")?.textContent;
    const h2 = (pg = page) => pg.evaluate(monthText);
    const monthIs = (t, pg = page) => pg.waitForFunction(({ fn, t }) => new Function(`return (${fn})()`)() === t, { fn: monthText.toString(), t });
    const h3 = () => page.locator("main h3").filter({ hasText: /^\w+day, \w+ \d+, \d{4}$/ }).first().innerText();
    const rows = () => page.locator("a[data-interview-id]");
    const tintedDays = () => page.locator("button[data-day].bg-primary-tint").evaluateAll((bs) => bs.map((b) => b.dataset.day));

    // 1. sign up
    await page.goto(`${base}/login`);
    await page.getByRole("radio", { name: "Create account" }).check({ force: true });
    await page.getByLabel("Invite code").fill(createInvite("f9 e2e"));
    await page.getByLabel("Account name").fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await urlIs(/\/applications$/);

    // 2. a user with zero interviews: the grid is the whole state
    const M = phtDay(0).slice(0, 7);
    await page.goto(`${base}/interviews`);
    await page.getByRole("radio", { name: "Month" }).click({ force: true });
    await urlIs(new RegExp(`/interviews\\?view=month&month=${M}$`));
    await ready();
    check("zero interviews: grid of the current PHT month, nothing tinted, no alert", (await h2()) === heading(M) && (await tintedDays()).length === 0 && (await page.locator('main [role="alert"]').count()) === 0, await h2());
    check("zero interviews: selected day is today, empty-day text", (await h3()) === longDay(phtDay(0)) && (await page.getByText("No interviews on this day.").count()) === 1);
    check("today has the outline and aria-current", (await cell(phtDay(0)).getAttribute("aria-current")) === "date" && /border-primary/.test(await cell(phtDay(0)).getAttribute("class")));

    // 3. data: edge cases around midnight PHT, three on one day, one upcoming, 201 in a later month
    const a = await post("/applications", { company: "Pinagsama Tech", job_name: "Frontend Engineer", status: "interviewing", mode_of_work: "hybrid", date_applied: "2026-11-01" });
    const b = await post("/applications", { company: "Bayanihan Digital", job_name: "Product Designer", status: "interviewing", mode_of_work: "remote", date_applied: "2026-11-01" });
    const late = await post(`/applications/${a.id}/interviews`, { scheduled_at: `${M}-09T23:30:00+08:00`, mode: "online", interviewer: "Ana Santos" });
    const early = await post(`/applications/${b.id}/interviews`, { scheduled_at: `${M}-10T00:30:00+08:00`, mode: "async" });
    const midnight = await post(`/applications/${b.id}/interviews`, { scheduled_at: `${M}-12T00:00:00+08:00`, mode: "online" });
    for (const [h, c] of [[9, a], [11, b], [15, a]]) await post(`/applications/${c.id}/interviews`, { scheduled_at: `${M}-20T${String(h).padStart(2, "0")}:00:00+08:00`, mode: "on_site" });
    const UP = phtDay(3);
    const upcoming = await post(`/applications/${a.id}/interviews`, { scheduled_at: `${UP}T10:00:00+08:00`, mode: "online" });
    const M2 = addMonth(M, 2);
    for (let i = 0; i < 201; i++) {
      await post(`/applications/${i % 2 ? a.id : b.id}/interviews`, { scheduled_at: new Date(Date.parse(`${M2}-15T00:00:00+08:00`) + i * 60e3).toISOString(), mode: "online" });
    }
    check("data created", [late, early, midnight, upcoming].every((x) => x.id));

    // 4. the view shows the data (a fresh load; the cache of step 2 is gone with the page)
    await page.goto(`${base}/interviews?view=month&month=${M}`);
    await ready();
    const tinted = await tintedDays();
    // (Today is selected by default and selection wins over the tint, so only days that are not today are checked here.)
    check("days with interviews are tinted: 9 (23:30 PHT), 10 (00:30 PHT), 20", [`${M}-09`, `${M}-10`, `${M}-20`].filter((d) => d !== phtDay(0)).every((d) => tinted.includes(d)), tinted.join(","));
    check("23:30 PHT and 00:30 PHT next day are on different days, one interview each", /1 interview$/.test(await cell(`${M}-09`).getAttribute("aria-label")) && /1 interview$/.test(await cell(`${M}-10`).getAttribute("aria-label")));
    check("exactly 00:00 PHT is on its own day", /1 interview$/.test(await cell(`${M}-12`).getAttribute("aria-label")));
    check("day with three: name carries the count", /3 interviews$/.test(await cell(`${M}-20`).getAttribute("aria-label")));
    check("number is bold on a day with interviews, not on a plain day", (await cell(`${M}-20`).locator(".font-semibold").count()) === 1 && (await cell(`${M}-03`).locator(".font-semibold").count()) === 0);
    check("one tab stop in the grid", (await page.locator('button[data-day][tabindex="0"]').count()) === 1);
    const nowReq = page.waitForRequest((r) => r.url().includes("/interviews/calendar"));
    await page.reload();
    const req = new URL((await nowReq).url());
    const days = (Date.parse(req.searchParams.get("to")) - Date.parse(req.searchParams.get("from"))) / 864e5 + 1;
    check("the request covers the whole visible grid (28, 35 or 42 days, Sunday first)", [28, 35, 42].includes(days) && new Date(`${req.searchParams.get("from")}T00:00:00Z`).getUTCDay() === 0, `${req.searchParams.get("from")}..${req.searchParams.get("to")}`);
    await ready();

    // 5. select a day, read its rows in PHT, open an application from a row, come back
    await cell(`${M}-09`).click();
    await urlIs(new RegExp(`day=${M}-09$`));
    await page.waitForFunction(() => document.querySelectorAll("a[data-interview-id]").length === 1);
    const row = await rows().first().innerText();
    check("day list: 11:30 PM PHT, job, company, mode, interviewer, outcome", /11:30 PM PHT/.test(row) && /Frontend Engineer/.test(row) && /Pinagsama Tech/.test(row) && /Online/.test(row) && /Ana Santos/.test(row) && /Pending/.test(row), JSON.stringify(row));
    check("day heading names the full date", (await h3()) === longDay(`${M}-09`));
    await rows().first().click();
    await urlIs(new RegExp(`/applications/${a.id}$`));
    check("a day row opens its application", pathOf(page.url()) === `/applications/${a.id}`);
    await page.goBack();
    await urlIs(/view=month/);
    await ready();
    check("Back from the application returns to the same month and day", pathOf(page.url()).includes(`month=${M}`) && pathOf(page.url()).includes(`day=${M}-09`) && (await h3()) === longDay(`${M}-09`));

    // 6. an upcoming row: .ics download
    await page.goto(`${base}/interviews?view=month&month=${UP.slice(0, 7)}&day=${UP}`);
    await ready();
    await page.waitForFunction(() => document.querySelectorAll("a[data-interview-id]").length >= 1);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Add to calendar/ }).first().click()]);
    const text = await (async () => {
      const s = await dl.createReadStream();
      let out = "";
      for await (const c of s) out += c;
      return out;
    })();
    check("upcoming row: .ics file with the start in UTC (10:00 PHT = 02:00Z)", dl.suggestedFilename().endsWith(".ics") && text.includes(`DTSTART:${UP.replaceAll("-", "")}T020000Z`), dl.suggestedFilename());

    // 7. months: Previous / Next / Today, announced, one history entry for the whole visit
    await page.goto(`${base}/applications`);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Interviews" }).click();
    await urlIs(/\/interviews$/);
    await page.getByRole("radio", { name: "Month" }).click({ force: true });
    await ready();
    await page.getByRole("button", { name: "Next month" }).click();
    await monthIs(heading(addMonth(M, 1)));
    check("Next month: heading and URL", (await h2()) === heading(addMonth(M, 1)) && pathOf(page.url()) === `/interviews?view=month&month=${addMonth(M, 1)}`);
    await page.waitForFunction((t) => document.querySelector('main [role="status"]')?.textContent === t, heading(addMonth(M, 1)));
    check("the new month is announced in the polite status region", true);
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "Previous month" }).click();
    await monthIs(heading(addMonth(M, 2)));
    check("Previous month after three Next", (await h2()) === heading(addMonth(M, 2)));
    await page.getByRole("button", { name: "Today" }).click();
    await monthIs(heading(M));
    check("Today returns to the current month", (await h2()) === heading(M) && (await h3()) === longDay(phtDay(0)));
    await ready();
    await page.goBack();
    check("Back after several month moves goes to the page before /interviews, not the previous month", pathOf(page.url()) === "/applications", pathOf(page.url()));
    await page.goForward();
    await page.waitForFunction(() => document.querySelector('[role="grid"]') || location.pathname === "/interviews");

    // 8. the 201-interview month: truncated banner, 200 shown
    await page.goto(`${base}/interviews?view=month&month=${M2}&day=${M2}-15`);
    await ready();
    await page.waitForFunction(() => document.querySelectorAll("a[data-interview-id]").length > 0);
    check("201 interviews: banner says the first 200 are shown", (await page.getByText("Showing the first 200 interviews. Some are not shown.").count()) === 1);
    check("201 interviews: the day shows 200 rows and its name says 200", (await rows().count()) === 200 && /200 interviews$/.test(await cell(`${M2}-15`).getAttribute("aria-label")));

    // 9. keyboard only
    await page.goto(`${base}/interviews?view=month&month=${M}&day=${M}-10`);
    await ready();
    await page.getByRole("button", { name: "Today" }).focus();
    await page.keyboard.press("Tab");
    check("Tab from Today lands on the selected day", (await active()) === `${M}-10`, await active());
    await page.keyboard.press("ArrowRight");
    check("ArrowRight moves one day", (await active()) === `${M}-11`);
    await page.keyboard.press("ArrowDown");
    check("ArrowDown moves one week", (await active()) === `${M}-18`);
    await page.keyboard.press("Home");
    check("Home goes to Sunday of the week", new Date(`${await active()}T00:00:00Z`).getUTCDay() === 0, await active());
    await page.keyboard.press("End");
    check("End goes to Saturday of the week", new Date(`${await active()}T00:00:00Z`).getUTCDay() === 6, await active());
    check("moving focus does not select (no ?day change yet)", pathOf(page.url()).includes(`day=${M}-10`));
    await page.keyboard.press("Enter");
    await urlIs(new RegExp(`day=${await active()}$`));
    check("Enter selects the focused day", (await h3()) === longDay(await active()));
    await page.keyboard.press("PageDown");
    await monthIs(heading(addMonth(M, 1)));
    await ready();
    check("PageDown changes the month and focus stays on a day (not body)", /^\d{4}-\d{2}-\d{2}$/.test(await active()) && (await active()).startsWith(addMonth(M, 1)), await active());
    await page.keyboard.press("PageUp");
    await page.keyboard.press("PageUp");
    await monthIs(heading(addMonth(M, -1)));
    check("PageUp twice goes two months back, focus kept", /^\d{4}-\d{2}-\d{2}$/.test(await active()), await active());
    await page.keyboard.press("Space");
    await urlIs(/day=/);
    check("Space selects the focused day", pathOf(page.url()).endsWith(`day=${await active()}`));
    // an arrow past the visible grid changes the month
    await page.goto(`${base}/interviews?view=month&month=${M}&day=${M}-03`);
    await ready();
    await cell(`${M}-01`).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await monthIs(heading(addMonth(M, -1)));
    check("ArrowLeft past the first cell goes to the previous month with focus on a day", (await active()).startsWith(addMonth(M, -1)), await active());

    // 10. narrow screen: no markers other than tint; no horizontal scroll; 44px cells
    await page.goto(`${base}/interviews?view=month&month=${M}`);
    await ready();
    const narrow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth <= window.innerWidth,
      lines: [...document.querySelectorAll("[data-lines]")].every((l) => getComputedStyle(l).display === "none"),
      min: Math.min(...[...document.querySelectorAll("button[data-day]")].map((b) => b.getBoundingClientRect().height)),
      mainW: document.querySelector("main").getBoundingClientRect().width,
    }));
    check("390: no horizontal scroll, text lines hidden, cells at least 44px tall", narrow.scroll && narrow.lines && narrow.min >= 44, JSON.stringify(narrow));

    // 11. desktop: wider container, two text lines and "+N more"
    const wide = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Pacific/Auckland" });
    await wide.addCookies(await ctx.cookies());
    const w = await wide.newPage();
    await w.goto(`${base}/interviews?view=month&month=${M}`);
    await w.waitForFunction(() => document.querySelector('[role="grid"]') && !document.querySelector('[role="grid"]').hasAttribute("aria-busy"));
    const d = await w.evaluate((m) => {
      const c = document.querySelector(`button[data-day="${m}-20"]`);
      const vis = (el) => !!el && getComputedStyle(el).display !== "none";
      return {
        mainW: Math.round(document.querySelector("main").getBoundingClientRect().width),
        lines: [...c.querySelectorAll("[data-line]")].map((l) => l.textContent),
        more: c.querySelector("[data-more]")?.textContent,
        shown: vis(c.querySelector("[data-lines]")),
        trunc: [...c.querySelectorAll("[data-line]")].every((l) => getComputedStyle(l).textOverflow === "ellipsis" || getComputedStyle(l).overflow === "hidden"),
        tinted: [...document.querySelectorAll("button[data-day].bg-primary-tint")].map((b) => b.dataset.day).includes(`${m}-09`),
      };
    }, M);
    check("1280: month view container is 960px wide", d.mainW === 960, String(d.mainW));
    check("1280: up to two time lines and '+1 more' for three interviews", d.shown && d.lines.length === 2 && d.lines[0].startsWith("9:00 AM · ") && d.lines[1].startsWith("11:00 AM · ") && d.more === "+1 more" && d.trunc, JSON.stringify(d));
    check("1280 in a far zone (Auckland): the same days are tinted", d.tinted);
    await w.goto(`${base}/interviews`);
    await w.locator("main h1").waitFor();
    check("1280: the agenda keeps its 640px column", Math.round((await w.locator("main").boundingBox()).width) === 640);
    await wide.close();

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
