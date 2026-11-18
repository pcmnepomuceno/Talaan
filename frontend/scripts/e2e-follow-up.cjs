// Local end-to-end check of the F10 "Needs follow-up" view on the REAL backend. NOT part of package.json or CI.
//
//   NODE_PATH=<dir containing playwright> PW_CHROMIUM=<matching chrome> node scripts/e2e-follow-up.cjs
//
// scripts/local-env.cjs does the setup and the teardown (API on the *_test database, next dev on free
// ports, truncate on exit, proof that the dev database and a foreign :8000 process were untouched).
// Account A has the seeded follow-up rows (seed-applications.cjs followUp), B is empty, C has PAGE_SIZE + 5
// qualifying rows. The browser runs in America/Los_Angeles. Exit code 1 on any FAIL.
const { chromium } = require("playwright");
const { chromiumOptions, withEnv } = require("./local-env.cjs");
const { PASSWORD, seedAccount } = require("./seed-applications.cjs");

let failed = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failed++;
}
const pathOf = (u) => {
  const x = new URL(u);
  return x.pathname + x.search;
};
const phtDay = (n) => new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10);

const PAGE_SIZE = 50;
const INCLUDED = ["Liwayway Analytics", "Tala Robotics", "Sampaguita Cloud", "Banaag Health Tech"];
const EXCLUDED = ["Mabilis Delivery", "Hiraya Systems", "Kalikasan Foods", "Umaga Labs", "Dalisay Payments", "Habagat Media"];

withEnv(async ({ base, createInvite }) => {
  const stamp = Date.now();
  const A = await seedAccount({ base, invite: createInvite("f10 e2e A"), email: `e2e-f10-a-${stamp}@example.com`, generic: 0, hand: false, followUp: true });
  const B = await seedAccount({ base, invite: createInvite("f10 e2e B"), email: `e2e-f10-b-${stamp}@example.com`, generic: 0, hand: false });
  const C = await seedAccount({ base, invite: createInvite("f10 e2e C"), email: `e2e-f10-c-${stamp}@example.com`, generic: 0, hand: false });
  const browser = await chromium.launch(chromiumOptions());
  const pageErrors = [];
  const open = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, timezoneId: "America/Los_Angeles" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(`${base}/login`);
    await page.getByLabel("Email").fill(who.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL(/\/applications$/, { timeout: 15000 });
    return { ctx, page };
  };
  const list = (page) => page.getByRole("list", { name: "Applications" });
  const rowTexts = (page) => list(page).getByRole("link").evaluateAll((ls) => ls.map((l) => l.innerText));
  const countLine = (page) => page.locator("main p.text-caption").filter({ hasText: /need(s)? a follow-up$/ });
  const countIs = async (page, text) => {
    await countLine(page).filter({ hasText: text }).waitFor({ timeout: 10000 }).catch(() => {});
    return (await countLine(page).allInnerTexts()).join("|");
  };

  try {
    // ---------------- Account A: the four rows, the excluded rows, edits ----------------
    {
      const { ctx, page } = await open(A);
      await list(page).waitFor();
      const allText = (await rowTexts(page)).join("\n");
      check("All view still shows every seeded row, excluded ones included", [...INCLUDED, ...EXCLUDED].every((n) => allText.includes(n)));

      // Watch the live region from before the choice so "announced once" is a real count.
      await page.evaluate(() => {
        const el = document.querySelector('div.sr-only[role="status"]');
        window.__live = [el.textContent];
        window.__liveObs = new MutationObserver(() => {
          if (window.__live[window.__live.length - 1] !== el.textContent) window.__live.push(el.textContent);
        });
        window.__liveObs.observe(el, { subtree: true, childList: true, characterData: true });
      });
      // Keyboard only on the native select: focus, then ArrowDown to the last option (Needs follow-up).
      await page.getByLabel("Status", { exact: true }).focus();
      await page.keyboard.press("End");
      await page.waitForURL(/\/applications\?status=follow_up$/, { timeout: 10000 });
      check("keyboard choice puts ?status=follow_up in the URL", pathOf(page.url()) === "/applications?status=follow_up", pathOf(page.url()));
      check("select shows Needs follow-up", (await page.getByLabel("Status", { exact: true }).inputValue()) === "follow_up");
      const c4 = await countIs(page, "4 applications need a follow-up");
      check('count line "4 applications need a follow-up"', c4 === "4 applications need a follow-up", c4);
      await page.waitForTimeout(500);
      const announced = await page.evaluate(() => window.__live);
      const times = announced.filter((t) => t === "4 applications need a follow-up").length;
      check("live region announced the count sentence exactly once", times === 1, JSON.stringify(announced));

      const texts = await rowTexts(page);
      const order = INCLUDED.map((n) => texts.findIndex((t) => t.includes(n)));
      check("four rows, no others", texts.length === 4, String(texts.length));
      check("exact order Liwayway, Tala, Sampaguita, Banaag", order.join() === "0,1,2,3", order.join());
      const want = ["Applied 21 days ago", "Applied 12 days ago", "Last interview 9 days ago", "Applied 8 days ago"];
      check("row texts", want.every((w, i) => texts[i]?.includes(w)), JSON.stringify(texts.map((t) => t.split("\n").slice(-1)[0])));
      const joined = texts.join("\n");
      check("no excluded row appears", !EXCLUDED.some((n) => joined.includes(n)));
      const pageText = await page.locator("main").innerText();
      check('no "!", overdue or urgent anywhere on the screen', !/!|overdue|urgent/i.test(pageText));

      // Open Tala: the detail keeps ?status=follow_up in its links.
      await list(page).getByRole("link", { name: /Tala Robotics/ }).click();
      await page.waitForURL(/\/applications\/\d+\?status=follow_up$/);
      await page.getByRole("button", { name: "Change status" }).waitFor();
      const hrefs = await page.locator("a[href]").evaluateAll((ls) => ls.map((l) => l.getAttribute("href")));
      const back = hrefs.filter((h) => h === "/applications?status=follow_up");
      const addIv = hrefs.filter((h) => /\/interviews\/new/.test(h));
      check("detail Back link keeps ?status=follow_up", back.length >= 1, JSON.stringify(hrefs));
      check("detail Add-interview link keeps ?status=follow_up", addIv.length >= 1 && addIv.every((h) => h.endsWith("?status=follow_up")), JSON.stringify(addIv));

      // Change status to Screening, back to the list: Tala gone, 3 left.
      await page.getByRole("button", { name: "Change status" }).click();
      await page.getByRole("radio", { name: "Screening" }).check();
      await page.getByRole("button", { name: "Update status" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.getByRole("link", { name: "Back" }).first().click();
      await page.waitForURL(/\/applications\?status=follow_up$/);
      const c3 = await countIs(page, "3 applications need a follow-up");
      check('after Screening: "3 applications need a follow-up"', c3 === "3 applications need a follow-up", c3);
      check("after Screening: Tala is gone", !(await rowTexts(page)).join("\n").includes("Tala Robotics"));

      // Add a future interview to Liwayway through the UI.
      await list(page).getByRole("link", { name: /Liwayway Analytics/ }).click();
      await page.waitForURL(/\/applications\/\d+\?status=follow_up$/);
      await page.getByRole("link", { name: "Add interview" }).first().click();
      await page.waitForURL(/\/interviews\/new\?status=follow_up$/);
      await page.getByLabel(/Date and time/).fill(`${phtDay(2)}T10:00`);
      await page.getByRole("radio", { name: "Online" }).check({ force: true });
      await page.getByRole("button", { name: "Save interview" }).click();
      await page.waitForURL(/\/applications\/\d+\?status=follow_up$/);
      check("saving the interview keeps ?status=follow_up", pathOf(page.url()).endsWith("?status=follow_up"), pathOf(page.url()));
      await page.getByRole("list", { name: "Interviews" }).waitFor();
      await page.getByRole("link", { name: "Back" }).first().click();
      await page.waitForURL(/\/applications\?status=follow_up$/);
      const c2 = await countIs(page, "2 applications need a follow-up");
      check('after a future interview: "2 applications need a follow-up"', c2 === "2 applications need a follow-up", c2);
      const t2 = (await rowTexts(page)).join("\n");
      check("after a future interview: Liwayway gone, Sampaguita and Banaag left", !t2.includes("Liwayway") && t2.includes("Sampaguita Cloud") && t2.includes("Banaag Health Tech"));

      // Delete Banaag.
      await list(page).getByRole("link", { name: /Banaag Health Tech/ }).click();
      await page.waitForURL(/\/applications\/\d+\?status=follow_up$/);
      await page.getByRole("button", { name: "Delete" }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete application" }).click();
      await page.waitForURL(/\/applications\?status=follow_up$/);
      const c1 = await countIs(page, "1 application needs a follow-up");
      check('after deleting Banaag: "1 application needs a follow-up" (singular)', c1 === "1 application needs a follow-up", c1);
      const t1 = await rowTexts(page);
      check("one row left: Sampaguita, Last interview 9 days ago", t1.length === 1 && t1[0].includes("Sampaguita Cloud") && t1[0].includes("Last interview 9 days ago"), JSON.stringify(t1));

      // The normal list still has the excluded rows (and Tala, Liwayway, Banaag's absence).
      await page.getByLabel("Status", { exact: true }).selectOption("all");
      await page.waitForURL(/\/applications$/);
      await list(page).waitFor();
      const allAfter = (await rowTexts(page)).join("\n");
      check("All view still shows the excluded rows", EXCLUDED.every((n) => allAfter.includes(n)) && allAfter.includes("Tala Robotics") && !allAfter.includes("Banaag"));
      await ctx.close();
    }

    // ---------------- Pure keyboard path: Tab to the select, ArrowDown to the last option ----------------
    {
      const { ctx, page } = await open(A);
      await list(page).waitFor();
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.tagName === "SELECT")) break;
      }
      check("Tab reaches the Status select", await page.evaluate(() => document.activeElement?.tagName === "SELECT"));
      // One key at a time, as a person types: each key changes the select and the URL (router.replace), and
      // a key sent before the URL catches up starts from the old value (true of every status choice, not just this one).
      for (let i = 0; i < 11; i++) {
        await page.keyboard.press("ArrowDown"); // All, 9 statuses, Needs follow-up
        await page.waitForTimeout(250);
      }
      await page.waitForURL(/\/applications\?status=follow_up$/, { timeout: 10000 }).catch(() => {});
      check("ArrowDown to the last option selects Needs follow-up", pathOf(page.url()) === "/applications?status=follow_up", pathOf(page.url()));
      await ctx.close();
    }

    // ---------------- Account B: nothing qualifies -> empty state ----------------
    {
      const { ctx, page } = await open(B);
      await page.goto(`${base}/applications?status=follow_up`);
      await page.getByText("Nothing to follow up on right now.").waitFor();
      check("empty state title", true);
      check("empty state: no count line", (await countLine(page).count()) === 0);
      await page.getByRole("link", { name: "Show all" }).click();
      await page.waitForURL(/\/applications$/);
      check("Show all returns to All", pathOf(page.url()) === "/applications");
      await ctx.close();
    }

    // ---------------- Account C: PAGE_SIZE + 5 qualifying rows -> paging ----------------
    {
      const { ctx, page } = await open(C);
      const total = PAGE_SIZE + 5;
      for (let i = 1; i <= total; i++) {
        const r = await page.request.post(`${base}/api/v1/applications`, {
          data: { company: `Paging Co ${String(i).padStart(2, "0")}`, job_name: `Role ${i}`, status: "applied", mode_of_work: "remote", date_applied: phtDay(-30) },
        });
        if (!r.ok()) throw new Error("seed failed " + r.status() + " " + (await r.text()));
      }
      await page.goto(`${base}/applications?status=follow_up`);
      await page.getByRole("button", { name: "Load more" }).waitFor();
      const sentence = `${total} applications need a follow-up`;
      check("page 1: 50 rows", (await list(page).getByRole("link").count()) === PAGE_SIZE);
      check(`count line "${sentence}" before Load more`, (await countLine(page).allInnerTexts()).join("|") === sentence);
      await page.getByRole("button", { name: "Load more" }).click();
      await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Applications"] a').length === n, total);
      check("Load more appends 5 (55 rows)", (await list(page).getByRole("link").count()) === total);
      check("Load more button gone", (await page.getByRole("button", { name: "Load more" }).count()) === 0);
      check(`count line "${sentence}" after Load more`, (await countLine(page).allInnerTexts()).join("|") === sentence);
      const hrefs = await list(page).getByRole("link").evaluateAll((ls) => ls.map((l) => l.getAttribute("href")));
      check("no duplicate rows", new Set(hrefs).size === hrefs.length);
      const announced = await page.locator('div.sr-only[role="status"]').first().innerText();
      check('Load more announced "5 more applications loaded"', announced.includes("5 more applications loaded"), announced);
      await ctx.close();
    }

    // ---------------- Account C at 1280: a status change from the detail pane keeps the list on screen ----------------
    // Two panes: the list stays mounted beside the detail. The follow-up rows are marked stale and refetched,
    // never dropped to a skeleton; the list ends on the server's answer (50 of 54 rows after one leaves).
    {
      const { ctx, page } = await open(C);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${base}/applications?status=follow_up`);
      await page.waitForFunction((n) => document.querySelectorAll('ul[aria-label="Applications"] a').length === n, PAGE_SIZE);
      const target = list(page).getByRole("link").first();
      const targetHref = await target.getAttribute("href");
      await target.click();
      await page.waitForURL(/\/applications\/\d+\?status=follow_up$/);
      await page.getByRole("button", { name: "Change status" }).waitFor();
      await page.getByText("No interviews yet.").waitFor();
      await page.evaluate(() => {
        window.__sk = 0;
        const look = () => {
          for (const el of document.querySelectorAll(".animate-ledger-pulse")) if (el.closest('section[aria-label="Applications"]')) window.__sk++;
        };
        window.__skObs = new MutationObserver(look);
        window.__skObs.observe(document.body, { subtree: true, childList: true, attributes: true });
      });
      await page.getByRole("button", { name: "Change status" }).click();
      await page.getByRole("radio", { name: "Screening" }).check();
      await page.getByRole("button", { name: "Update status" }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      const c54 = await countIs(page, "54 applications need a follow-up");
      await page.waitForTimeout(800);
      const sk = await page.evaluate(() => (window.__skObs.disconnect(), window.__sk));
      check("1280 status change: the follow-up list pane never shows a skeleton", sk === 0, String(sk));
      check('1280 status change: ends on "54 applications need a follow-up"', c54 === "54 applications need a follow-up", c54);
      const hrefs = await list(page).getByRole("link").evaluateAll((ls) => ls.map((l) => l.getAttribute("href")));
      check("1280 status change: the changed row left the list, 50 rows shown", hrefs.length === PAGE_SIZE && !hrefs.includes(targetHref), `${hrefs.length} rows`);
      await ctx.close();
    }

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
