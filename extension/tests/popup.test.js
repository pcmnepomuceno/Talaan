// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../src/api.js";
import { API_BASE, TAB_QUERY } from "../src/config.js";
import { start } from "../popup.js";

const html = readFileSync(path.resolve(process.cwd(), "popup.html"), "utf8");
const PAGE = "https://jobs.example.ph/jobs/1";
const RAW = {
  url: PAGE,
  title: "Backend Engineer | Kape Digital",
  metas: { ogTitle: null },
  jsonLd: [JSON.stringify({ "@type": "JobPosting", title: "Backend Engineer", hiringOrganization: { name: "Kape Digital" }, url: PAGE })],
};
const SAVE_BODY = {
  company: "Kape Digital",
  job_name: "Backend Engineer",
  status: "saved",
  mode_of_work: "remote",
  date_applied: null,
  salary: null,
  contact_website: null,
  remarks: null,
  job_url: PAGE,
};

const res = (status, data) => ({ status, type: "basic", json: async () => data });
const abortAware = (init) =>
  new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));

const $ = (s) => document.querySelector(s);
const shown = (id) => !$("#" + id).hidden;
const settle = async () => {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
};
const typeInto = (sel, v) => {
  $(sel).value = v;
  $(sel).dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = () => $("#form").requestSubmit();
const posts = (f) => f.mock.calls.filter(([url, init]) => init.method === "POST" && url.endsWith("/api/v1/applications"));
const lookups = (f) => f.mock.calls.filter(([url]) => url.endsWith("/applications/lookup"));

async function mount({ routes = {}, raw = RAW, tabs = [{ id: 7 }], script, wait = true, timer } = {}) {
  document.documentElement.innerHTML = html;
  const table = {
    "GET /api/v1/me": res(200, { id: 1 }),
    "POST /api/v1/applications/lookup": res(200, { match: null }),
    "POST /api/v1/applications": res(201, { id: 42 }),
    ...routes,
  };
  const f = vi.fn(async (url, init) => {
    const r = table[`${init.method} ${new URL(url).pathname}`];
    if (!r) throw new Error(`unexpected ${init.method} ${url}`);
    return typeof r === "function" ? r(init) : r;
  });
  const chrome = {
    tabs: { query: vi.fn(async () => tabs), create: vi.fn(async () => ({})) },
    scripting: { executeScript: vi.fn(script ?? (async () => [{ result: raw }])) },
  };
  const ready = start({ chrome, fetch: f, document, ...(timer && { setTimeout: timer }) });
  if (wait) {
    await ready;
    await settle();
  }
  return { f, chrome, ready };
}

const fillAndPickRemote = () => {
  $("#mode_remote").click();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("module import", () => {
  it("has no side effects without chrome.scripting", async () => {
    vi.resetModules();
    document.documentElement.innerHTML = html;
    const before = document.documentElement.outerHTML;
    const spy = vi.fn();
    const real = globalThis.fetch;
    globalThis.fetch = spy;
    try {
      await import("../popup.js");
      await settle();
    } finally {
      globalThis.fetch = real;
    }
    expect(spy).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
  });
});

describe("startup and sign-in", () => {
  it("signed in: shows the form prefilled, nothing chosen for work mode, status saved", async () => {
    const { chrome } = await mount();
    expect(chrome.tabs.query).toHaveBeenCalledWith(TAB_QUERY);
    expect(chrome.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 7 });
    expect(shown("form")).toBe(true);
    expect(shown("loading")).toBe(false);
    expect($("#company").value).toBe("Kape Digital");
    expect($("#job_name").value).toBe("Backend Engineer");
    expect($("#job_url").value).toBe(PAGE);
    expect(document.querySelectorAll('input[name="mode_of_work"]:checked')).toHaveLength(0);
    expect([...document.querySelectorAll('input[name="mode_of_work"]')].map((r) => r.value)).toEqual(["on_site", "hybrid", "remote"]);
    expect($("#status-select").value).toBe("saved");
    expect([...$("#status-select").options].map((o) => o.value)).toEqual([
      "saved", "applied", "screening", "interviewing", "offered", "accepted", "rejected", "withdrawn", "ghosted",
    ]);
    expect($("#note").hidden).toBe(true);
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("401: shows signed-out view, keeps the form in the DOM hidden, no lookup", async () => {
    const { f } = await mount({ routes: { "GET /api/v1/me": res(401, { detail: "x" }) } });
    expect(shown("signedOut")).toBe(true);
    expect(shown("form")).toBe(false);
    expect($("#form")).not.toBeNull();
    expect($("#signedOut").textContent).toContain("Sign in to Talaan to save this job.");
    expect(lookups(f)).toHaveLength(0);
  });

  it("opens the login page with chrome.tabs.create, not window.open", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { chrome } = await mount({ routes: { "GET /api/v1/me": res(401, {}) } });
    $("#openLogin").click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${API_BASE}/login` });
    expect(open).not.toHaveBeenCalled();
  });

  it("Check again: still signed out stays; signed in returns to the form with typed values kept", async () => {
    let status = 401;
    const { f } = await mount({ routes: { "GET /api/v1/me": () => res(status, {}) } });
    typeInto("#company", "Typed Co");
    $("#checkAgain").click();
    await settle();
    expect(shown("signedOut")).toBe(true);
    status = 200;
    $("#checkAgain").click();
    await settle();
    expect(shown("form")).toBe(true);
    expect($("#company").value).toBe("Typed Co");
    expect(lookups(f)).toHaveLength(1);
  });

  it("shows Starting up... at exactly 3000 ms, not 2999, and clears it when me() settles", async () => {
    const d = deferred();
    const { ready } = await mount({ routes: { "GET /api/v1/me": () => d.promise }, wait: false });
    await vi.advanceTimersByTimeAsync(2999);
    expect($("#status").textContent).toBe("");
    expect(shown("loading")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect($("#status").textContent).toBe("Starting up...");
    expect($("#loading").textContent).toContain("Starting up...");
    d.resolve(res(200, {}));
    await ready;
    await settle();
    expect($("#status").textContent).toBe("");
    expect(shown("form")).toBe(true);
  });
});

describe("slow-start timers", () => {
  it("a first me() that answers at 10 ms leaves no Starting up... and no timer behind", async () => {
    const { ready } = await mount({ routes: { "GET /api/v1/me": () => later(10, res(200, {})) }, wait: false });
    await vi.advanceTimersByTimeAsync(10);
    await ready;
    await settle();
    expect(shown("form")).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect($("#status").textContent).toBe("");
    expect($("#loadingText").textContent).not.toBe("Starting up...");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a save that answers at 10 ms leaves no Starting up... and no timer behind", async () => {
    await mount({ routes: { "POST /api/v1/applications": () => later(10, res(201, { id: 42 })) } });
    fillAndPickRemote();
    submit();
    await vi.advanceTimersByTimeAsync(10);
    await settle();
    expect(shown("saved")).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect($("#status").textContent).not.toBe("Starting up...");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Try again arms the timer too: Starting up... at exactly 3000 ms, not 2999", async () => {
    let fail = true;
    const d = deferred();
    await mount({
      routes: {
        "GET /api/v1/me": () => {
          if (fail) throw new TypeError("Failed to fetch");
          return d.promise;
        },
      },
    });
    fail = false;
    $("#retry button").click();
    await vi.advanceTimersByTimeAsync(2999);
    expect($("#status").textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect($("#status").textContent).toBe("Starting up...");
    d.resolve(res(200, {}));
    await settle();
    expect($("#status").textContent).toBe("");
  });
});

describe("focus and announcements", () => {
  const failMe = () => {
    throw new TypeError("Failed to fetch");
  };

  it("retry: focus on Try again, message announced in the status line", async () => {
    await mount({ routes: { "GET /api/v1/me": failMe } });
    expect(document.activeElement).toBe($("#retryButton"));
    expect($("#status").textContent).toBe("Couldn't reach Talaan.");
    expect($("#retryMessage").textContent).toBe("Couldn't reach Talaan.");
  });

  it("retry after a 5xx announces the generic message", async () => {
    await mount({ routes: { "GET /api/v1/me": res(503, null) } });
    expect($("#status").textContent).toBe("Something went wrong.");
  });

  it("signed out from me(): focus on Open Talaan to sign in", async () => {
    await mount({ routes: { "GET /api/v1/me": res(401, {}) } });
    expect(document.activeElement).toBe($("#openLogin"));
  });

  it("signed out from a 401 on Save: focus on Open Talaan to sign in", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(401, {}) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect(shown("signedOut")).toBe(true);
    expect(document.activeElement).toBe($("#openLogin"));
  });

  it("saved: focus on the link and Saved announced in the status line", async () => {
    await mount();
    fillAndPickRemote();
    submit();
    await settle();
    expect(document.activeElement).toBe($("#openLink"));
    expect($("#status").textContent).toBe("Saved");
  });

  it("back to the form after Check again: focus on the first empty required field", async () => {
    let status = 401;
    await mount({ tabs: [], routes: { "GET /api/v1/me": () => res(status, {}) } });
    status = 200;
    $("#checkAgain").click();
    await settle();
    expect(shown("form")).toBe(true);
    expect(document.activeElement).toBe($("#company"));

    status = 401;
    $("#checkAgain").click();
    await settle();
    typeInto("#company", "Typed Co");
    status = 200;
    $("#checkAgain").click();
    await settle();
    expect(document.activeElement).toBe($("#job_name"));
  });

  it("back to the form with both names filled and no work mode: focus on the first radio", async () => {
    await mount();
    expect(document.activeElement).toBe($("#mode_on_site"));
  });
});

describe("first me() failures", () => {
  it("network error shows retry with the message; Try again re-runs and continues", async () => {
    let fail = true;
    const { f } = await mount({
      routes: {
        "GET /api/v1/me": () => {
          if (fail) throw new TypeError("Failed to fetch");
          return res(200, {});
        },
      },
    });
    expect(shown("retry")).toBe(true);
    expect($("#retry").textContent).toContain("Couldn't reach Talaan.");
    expect($("#retry button").textContent).toBe("Try again");
    fail = false;
    $("#retry button").click();
    expect(shown("loading")).toBe(true);
    await settle();
    expect(shown("form")).toBe(true);
    expect(f.mock.calls.filter(([u]) => u.endsWith("/api/v1/me"))).toHaveLength(2);
  });

  it("timeout (45000 ms, abort-aware fetch) shows retry", async () => {
    const { ready } = await mount({ routes: { "GET /api/v1/me": abortAware }, wait: false });
    await vi.advanceTimersByTimeAsync(44999);
    expect(shown("loading")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    await settle();
    expect(shown("retry")).toBe(true);
    expect($("#retry").textContent).toContain("Couldn't reach Talaan.");
  });

  it("5xx shows retry with Something went wrong.", async () => {
    await mount({ routes: { "GET /api/v1/me": res(503, null) } });
    expect(shown("retry")).toBe(true);
    expect($("#retry").textContent).toContain("Something went wrong.");
  });

  it("an unexpected status is treated as the generic failure", async () => {
    await mount({ routes: { "GET /api/v1/me": res(404, null) } });
    expect(shown("retry")).toBe(true);
    expect($("#retry").textContent).toContain("Something went wrong.");
  });

  it("Try again after a 5xx, then 401, continues to signed out", async () => {
    let status = 500;
    await mount({ routes: { "GET /api/v1/me": () => res(status, null) } });
    status = 401;
    $("#retry button").click();
    await settle();
    expect(shown("signedOut")).toBe(true);
  });
});

describe("reading the page", () => {
  it.each([
    ["no tab", { tabs: [] }],
    ["executeScript throws", { script: async () => { throw new Error("Cannot access"); } }],
    ["missing result", { script: async () => [] }],
    ["malformed result", { script: async () => [{ result: "nope" }] }],
    ["non-http page", { raw: { ...RAW, url: "chrome://extensions" } }],
  ])("%s: empty form and the note", async (_name, opts) => {
    await mount(opts);
    expect(shown("form")).toBe(true);
    expect($("#note").hidden).toBe(false);
    expect($("#note").textContent).toBe("Can't read this page. Fill in the fields by hand.");
    expect($("#company").value).toBe("");
    expect($("#job_name").value).toBe("");
    expect($("#job_url").value).toBe("");
  });
});

describe("a page read that hangs", () => {
  it("falls back to the empty form and the note after 4000 ms, not 3999", async () => {
    const { ready } = await mount({ script: () => new Promise(() => {}), wait: false });
    await vi.advanceTimersByTimeAsync(3999);
    expect(shown("loading")).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    await settle();
    expect(shown("form")).toBe(true);
    expect($("#note").hidden).toBe(false);
    expect($("#note").textContent).toBe("Can't read this page. Fill in the fields by hand.");
    expect($("#company").value).toBe("");
    expect($("#job_name").value).toBe("");
    expect($("#job_url").value).toBe("");
  });

  it("a read that settles at 100 ms leaves no pending timer", async () => {
    const { ready } = await mount({ script: () => later(100, [{ result: RAW }]), wait: false });
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await ready;
    await settle();
    expect($("#company").value).toBe("Kape Digital");
    await vi.advanceTimersByTimeAsync(1); // lets the duplicate lookup finish and clear its own timer
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect($("#note").hidden).toBe(true);
  });
});

describe("duplicate check", () => {
  const MATCH = (extra = {}) => res(200, { match: { id: 5, job_name: "Backend Engineer", company: "Kape Digital", ...extra } });

  it("looks up once on open with {url, exclude_id: null} and shows a neutral note with a link", async () => {
    const { f } = await mount({ routes: { "POST /api/v1/applications/lookup": MATCH() } });
    expect(lookups(f)).toHaveLength(1);
    expect(JSON.parse(lookups(f)[0][1].body)).toEqual({ url: PAGE, exclude_id: null });
    const dup = $("#dup");
    expect(dup.hidden).toBe(false);
    expect(dup.textContent).toBe("You already saved this posting: Backend Engineer, Kape Digital.");
    const a = dup.querySelector("a");
    expect(a.getAttribute("href")).toBe(`${API_BASE}/applications/5`);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.textContent).toBe("Backend Engineer, Kape Digital");
  });

  it("renders HTML-looking text literally and creates no elements from it", async () => {
    await mount({ routes: { "POST /api/v1/applications/lookup": MATCH({ job_name: "<img src=x onerror=alert(1)>", company: "A&B <b>x</b>" }) } });
    expect($("#dup").textContent).toBe("You already saved this posting: <img src=x onerror=alert(1)>, A&B <b>x</b>.");
    expect(document.querySelectorAll("img, b")).toHaveLength(0);
  });

  it("ignores a match with an unsafe id", async () => {
    await mount({ routes: { "POST /api/v1/applications/lookup": MATCH({ id: "5/../x" }) } });
    expect($("#dup").hidden).toBe(true);
  });

  it("looks up again on blur only when the trimmed URL changed", async () => {
    const { f } = await mount();
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect(lookups(f)).toHaveLength(1);
    typeInto("#job_url", `  ${PAGE}  `);
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect(lookups(f)).toHaveLength(1);
    typeInto("#job_url", "https://jobs.example.ph/jobs/2");
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect(lookups(f)).toHaveLength(2);
    expect(JSON.parse(lookups(f)[1][1].body).url).toBe("https://jobs.example.ph/jobs/2");
  });

  it.each([
    ["a network error", () => { throw new TypeError("x"); }],
    ["a 500", () => res(500, null)],
  ])("retries the same URL on blur after %s on open", async (_n, first) => {
    let n = 0;
    const { f } = await mount({ routes: { "POST /api/v1/applications/lookup": () => (n++ === 0 ? first() : MATCH()) } });
    expect(lookups(f)).toHaveLength(1);
    expect($("#dup").hidden).toBe(true);
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect(lookups(f)).toHaveLength(2);
    expect($("#dup").hidden).toBe(false);
  });

  it("does not look up an invalid URL and clears an old note", async () => {
    const { f } = await mount({ routes: { "POST /api/v1/applications/lookup": MATCH() } });
    expect($("#dup").hidden).toBe(false);
    typeInto("#job_url", "ftp://x.example/a");
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect(lookups(f)).toHaveLength(1);
    expect($("#dup").hidden).toBe(true);
  });

  it("does not look up when the URL is empty", async () => {
    const { f } = await mount({ raw: { ...RAW, url: "chrome://x" } });
    expect(lookups(f)).toHaveLength(0);
  });

  it("ignores a stale response", async () => {
    const a = deferred();
    let n = 0;
    const { f } = await mount({
      routes: {
        "POST /api/v1/applications/lookup": () => (n++ === 0 ? a.promise : MATCH({ id: 9, job_name: "Second", company: "B" })),
      },
    });
    typeInto("#job_url", "https://jobs.example.ph/jobs/2");
    $("#job_url").dispatchEvent(new Event("blur"));
    await settle();
    expect($("#dup").textContent).toContain("Second, B");
    a.resolve(MATCH({ id: 1, job_name: "First", company: "A" }));
    await settle();
    expect($("#dup").textContent).toContain("Second, B");
    expect($("#dup").textContent).not.toContain("First");
    expect(lookups(f)).toHaveLength(2);
  });

  it.each([
    ["500", () => res(500, null)],
    ["401", () => res(401, {})],
    ["network error", () => { throw new TypeError("x"); }],
  ])("a lookup failure (%s) shows nothing and Save still works", async (_n, route) => {
    const { f } = await mount({ routes: { "POST /api/v1/applications/lookup": route } });
    expect($("#dup").hidden).toBe(true);
    fillAndPickRemote();
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
    expect(shown("saved")).toBe(true);
  });

  it("with a duplicate shown, saving anyway is allowed", async () => {
    const { f } = await mount({ routes: { "POST /api/v1/applications/lookup": MATCH() } });
    expect($("#dup").hidden).toBe(false);
    fillAndPickRemote();
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
    expect(shown("saved")).toBe(true);
  });
});

describe("save", () => {
  it("sends exactly the web form body and the credentialed request to the API host only", async () => {
    const { f } = await mount();
    fillAndPickRemote();
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
    const [url, init] = posts(f)[0];
    expect(JSON.parse(init.body)).toEqual(SAVE_BODY);
    expect(init.credentials).toBe("include");
    for (const [u] of f.mock.calls) expect(new URL(u).origin).toBe(API_BASE);
  });

  it("trims values, sends the chosen status, and omits job_url when empty", async () => {
    const { f } = await mount();
    typeInto("#company", "  Kape Digital  ");
    typeInto("#job_name", "  SRE ");
    typeInto("#job_url", "   ");
    $("#status-select").value = "applied";
    $("#mode_hybrid").click();
    submit();
    await settle();
    const body = JSON.parse(posts(f)[0][1].body);
    expect(body).toEqual({
      company: "Kape Digital",
      job_name: "SRE",
      status: "applied",
      mode_of_work: "hybrid",
      date_applied: null,
      salary: null,
      contact_website: null,
      remarks: null,
    });
    expect("job_url" in body).toBe(false);
  });

  it("two submits in the same tick send exactly one POST; the button is disabled while busy", async () => {
    const d = deferred();
    const { f } = await mount({ routes: { "POST /api/v1/applications": () => d.promise } });
    fillAndPickRemote();
    submit();
    submit();
    $("#save").click();
    expect($("#save").disabled).toBe(true);
    await settle();
    expect(posts(f)).toHaveLength(1);
    d.resolve(res(201, { id: 42 }));
    await settle();
    expect(posts(f)).toHaveLength(1);
  });

  it("201 shows Saved with a link to the application", async () => {
    await mount();
    fillAndPickRemote();
    submit();
    await settle();
    expect(shown("saved")).toBe(true);
    expect(shown("form")).toBe(false);
    expect($("#saved").textContent).toContain("Saved");
    const a = $("#saved a");
    expect(a.textContent).toBe("Open in Talaan");
    expect(a.getAttribute("href")).toBe(`${API_BASE}/applications/42`);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("201 with an id that is not a safe integer links to the list", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(201, { id: "../x" }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#saved a").getAttribute("href")).toBe(`${API_BASE}/applications`);
  });

  it("shows Starting up... if the save is pending 3000 ms, not 2999", async () => {
    await mount({ routes: { "POST /api/v1/applications": () => new Promise(() => {}) } });
    fillAndPickRemote();
    submit();
    await vi.advanceTimersByTimeAsync(2999);
    expect($("#status").textContent).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect($("#status").textContent).toBe("Starting up...");
  });

  it("a throwing timer never leaves Save stuck: busy resets and a later submit works", async () => {
    let boom = false;
    const timer = (fn, ms) => {
      if (boom) throw new NetworkError("timer");
      return globalThis.setTimeout(fn, ms);
    };
    const { f } = await mount({ timer });
    fillAndPickRemote();
    boom = true;
    submit();
    await settle();
    expect($("#save").disabled).toBe(false);
    expect(posts(f)).toHaveLength(0);
    boom = false;
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
    expect(shown("saved")).toBe(true);
  });

  it("401 goes to signed-out, keeps values, and Save works after Check again", async () => {
    let create = res(401, { detail: "Not authenticated" });
    const { f } = await mount({ routes: { "POST /api/v1/applications": () => create } });
    typeInto("#company", "Kept Co");
    fillAndPickRemote();
    submit();
    await settle();
    expect(shown("signedOut")).toBe(true);
    $("#checkAgain").click();
    await settle();
    expect(shown("form")).toBe(true);
    expect($("#company").value).toBe("Kept Co");
    expect($("#mode_remote").checked).toBe(true);
    expect($("#save").disabled).toBe(false);
    create = res(201, { id: 8 });
    submit();
    await settle();
    expect(posts(f)).toHaveLength(2);
    expect(shown("saved")).toBe(true);
  });

  it("403 shows the not-enabled message and re-enables Save", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(403, { detail: "Cross-site request blocked." }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#status").textContent).toBe("This extension is not enabled on the server yet.");
    expect($("#save").disabled).toBe(false);
    expect(shown("form")).toBe(true);
  });

  it("422 shows the first error with a label, marks and focuses the field", async () => {
    const detail = [
      { loc: ["body", "job_name"], msg: "String should have at most 200 characters" },
      { loc: ["body", "company"], msg: "second" },
    ];
    await mount({ routes: { "POST /api/v1/applications": res(422, { detail }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#form").textContent).toContain("Job title: String should have at most 200 characters.");
    expect($("#form").textContent).not.toContain("second");
    expect($("#job_name").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe($("#job_name"));
    expect($("#save").disabled).toBe(false);
  });

  it("422 on an unknown field shows just the capitalized message with a period", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(422, { detail: [{ loc: ["body", "contact_email"], msg: "extra fields not permitted" }] }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#status").textContent).toBe("Extra fields not permitted.");
  });

  it("422 with a detail that is not an array shows the generic rejection", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(422, { detail: "bad" }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#status").textContent).toBe("The server rejected some details. Check the form and try again.");
  });

  it("network error shows Couldn't reach Talaan. Try again. and re-enables Save", async () => {
    await mount({
      routes: {
        "POST /api/v1/applications": () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#status").textContent).toBe("Couldn't reach Talaan. Try again.");
    expect($("#save").disabled).toBe(false);
  });

  it("a timeout on save shows the network message", async () => {
    await mount({ routes: { "POST /api/v1/applications": abortAware } });
    fillAndPickRemote();
    submit();
    await vi.advanceTimersByTimeAsync(45000);
    await settle();
    expect($("#status").textContent).toBe("Couldn't reach Talaan. Try again.");
  });

  it("5xx shows Something went wrong. Try again. and never shows the server body", async () => {
    await mount({ routes: { "POST /api/v1/applications": res(500, { detail: "<h1>secret trace</h1>" }) } });
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#status").textContent).toBe("Something went wrong. Try again.");
    expect(document.body.textContent).not.toContain("secret trace");
    expect($("#save").disabled).toBe(false);
  });
});

describe("client validation", () => {
  const send = async (opts) => {
    const m = await mount(opts);
    submit();
    await settle();
    return m;
  };

  it("empty form: three messages, first invalid field focused, nothing sent", async () => {
    const { f } = await send({ tabs: [] });
    expect($("#company-error").textContent).toBe("Enter a company name.");
    expect($("#job_name-error").textContent).toBe("Enter a job title.");
    expect($("#mode_of_work-error").textContent).toBe("Choose a work mode.");
    expect($("#company").getAttribute("aria-invalid")).toBe("true");
    expect($("#company").getAttribute("aria-describedby")).toContain("company-error");
    expect(document.activeElement).toBe($("#company"));
    expect(posts(f)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("a missing work mode alone focuses the first radio", async () => {
    const { f } = await send();
    expect($("#mode_of_work-error").textContent).toBe("Choose a work mode.");
    expect(document.activeElement).toBe($("#mode_on_site"));
    expect(posts(f)).toHaveLength(0);
  });

  it("a missing work mode leaves the focused radio described by the error text", async () => {
    await send();
    const focused = document.activeElement;
    expect(focused.name).toBe("mode_of_work");
    for (const r of document.querySelectorAll('input[name="mode_of_work"]')) {
      expect(r.getAttribute("aria-describedby")).toBe("mode_of_work-error");
    }
    const ids = focused.getAttribute("aria-describedby").split(" ");
    expect(ids.map((id) => document.getElementById(id).textContent).join(" ")).toBe("Choose a work mode.");
  });

  it("over-long title, company and URL", async () => {
    await mount();
    typeInto("#job_name", "x".repeat(201));
    typeInto("#company", "y".repeat(201));
    typeInto("#job_url", "https://x.example/" + "z".repeat(2000));
    fillAndPickRemote();
    submit();
    await settle();
    expect($("#job_name-error").textContent).toBe("Job title must be 200 characters or fewer.");
    expect($("#company-error").textContent).toBe("Company must be 200 characters or fewer.");
    expect($("#job_url-error").textContent).toBe("Job posting URL must be 2,000 characters or fewer.");
  });

  it("counts code points, so 200 emoji are fine", async () => {
    const { f } = await mount();
    typeInto("#job_name", "\u{1F600}".repeat(200));
    fillAndPickRemote();
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
  });

  it.each(["ftp://x.example/a", "example.com", "https://user:pw@x.example/", "https://x.example/a b", "https://@x.example/"])(
    "rejects the job URL %s",
    async (bad) => {
      const { f } = await mount();
      typeInto("#job_url", bad);
      fillAndPickRemote();
      submit();
      await settle();
      expect($("#job_url-error").textContent).toBe("Enter a full address starting with http:// or https://");
      expect(document.activeElement).toBe($("#job_url"));
      expect(posts(f)).toHaveLength(0);
    },
  );

  it("an empty job URL is allowed", async () => {
    const { f } = await mount();
    typeInto("#job_url", "");
    fillAndPickRemote();
    submit();
    await settle();
    expect(posts(f)).toHaveLength(1);
  });
});

describe("source rules", () => {
  const read = (p) => readFileSync(path.resolve(process.cwd(), p), "utf8");
  const files = ["popup.js", "src/api.js", "src/config.js"];

  it.each(files)("%s uses none of the forbidden APIs", (file) => {
    const src = read(file);
    for (const re of [
      /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /DOMParser/, /document\.write/, /\beval\s*\(/, /new Function/,
      /chrome\.storage/, /localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/, /localhost/, /onrender/i,
      /window\.open/, /Authorization/i, /Bearer/i, /type\s*=\s*["']password/,
    ]) {
      expect(src, `${file} ${re}`).not.toMatch(re);
    }
  });

  it("only api.js calls fetch, and always with credentials include", () => {
    expect(read("popup.js")).not.toMatch(/\bfetch\s*\(/);
    expect(read("src/api.js")).toContain('credentials: "include"');
    expect(read("src/api.js")).toContain("base + path");
  });

  it("the API base is the Vercel host and lives in config.js only", () => {
    expect(read("src/config.js")).toContain('export const API_BASE = "https://talaan-phi.vercel.app";');
    expect(read("src/config.js")).toContain("export const TAB_QUERY = { active: true, currentWindow: true };");
    expect(read("popup.js")).not.toMatch(/https?:\/\/[a-z]/i);
  });
});

describe("detected work mode", () => {
  const withLd = (extra) => ({ ...RAW, jsonLd: [JSON.stringify({ "@type": "JobPosting", title: "Backend Engineer", hiringOrganization: { name: "Kape Digital" }, url: PAGE, ...extra })] });
  const checked = () => document.querySelector('input[name="mode_of_work"]:checked')?.value;

  it("JSON-LD TELECOMMUTE preselects remote and says it came from the page", async () => {
    await mount({ raw: withLd({ jobLocationType: "TELECOMMUTE" }) });
    expect(checked()).toBe("remote");
    expect($("#mode-note").hidden).toBe(false);
    expect($("#mode-note").textContent).toBe("Detected from the page");
  });

  it("a title match says it came from the title", async () => {
    await mount({ raw: { ...RAW, title: "Backend Engineer | Remote" } });
    expect(checked()).toBe("remote");
    expect($("#mode-note").textContent).toBe("Detected from the title");
  });

  it("a site default preselects remote and says it was assumed", async () => {
    const raw = { ...RAW, url: "https://www.onlinejobs.ph/jobseekers/job/1", title: "Support Agent - OnlineJobs.ph", jsonLd: [], hints: { companyText: null, modeTexts: [], titleMustContainCompany: false, defaultMode: "remote" } };
    const { f } = await mount({ raw });
    expect(checked()).toBe("remote");
    expect($("#mode-note").hidden).toBe(false);
    expect($("#mode-note").textContent).toBe("Assumed from the site");
    $("#mode_hybrid").click();
    expect($("#mode-note").hidden).toBe(true);
    expect($("#mode-note").textContent).toBe("");
    typeInto("#company", "Kalye Labs");
    submit();
    await settle();
    expect(JSON.parse(posts(f)[0][1].body).mode_of_work).toBe("hybrid");
  });

  it("choosing another radio hides the note and Save sends the new value", async () => {
    const { f } = await mount({ raw: withLd({ jobLocationType: "TELECOMMUTE" }) });
    $("#mode_hybrid").click();
    expect($("#mode-note").hidden).toBe(true);
    expect($("#mode-note").textContent).toBe("");
    submit();
    await settle();
    expect(JSON.parse(posts(f)[0][1].body).mode_of_work).toBe("hybrid");
  });

  it("nothing detected leaves nothing checked and the note hidden", async () => {
    await mount();
    expect(checked()).toBeUndefined();
    expect($("#mode-note").hidden).toBe(true);
  });

  it("the fieldset points at the note", () => {
    document.documentElement.innerHTML = html;
    expect($("fieldset").getAttribute("aria-describedby")).toBe("mode_of_work-error mode-note");
  });
});
