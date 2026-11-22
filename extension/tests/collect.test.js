// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collect } from "../src/collect.js";

const ldScript = (text, type = "application/ld+json") => `<script type="${type}">${text}</script>`;

beforeEach(() => {
  document.title = "";
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("collect", () => {
  it("returns the full shape for a full page", () => {
    document.head.innerHTML =
      '<meta property="og:title" content="OG Title">' +
      '<meta property="og:site_name" content="Acme Jobs">' +
      '<meta property="og:url" content="https://jobs.example.com/og">' +
      '<link rel="canonical" href="https://jobs.example.com/canon">' +
      ldScript('{"@type":"JobPosting"}');
    document.title = "Engineer at Acme";
    const got = collect();
    expect(Object.keys(got)).toEqual(["url", "title", "metas", "jsonLd", "hints"]);
    expect(got).toEqual({
      url: location.href,
      title: "Engineer at Acme",
      metas: { ogTitle: "OG Title" },
      jsonLd: ['{"@type":"JobPosting"}'],
      hints: { companyText: null, modeText: null },
    });
  });

  it("gives null for an absent og:title", () => {
    expect(collect().metas).toEqual({ ogTitle: null });
  });

  it("keeps multiple JSON-LD blocks in order", () => {
    document.head.innerHTML = ldScript('{"a":1}') + ldScript('{"b":2}') + ldScript('{"c":3}');
    expect(collect().jsonLd).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it("caps at 20 blocks", () => {
    document.head.innerHTML = Array.from({ length: 25 }, (_, i) => ldScript(`{"n":${i}}`)).join("");
    const r = collect().jsonLd;
    expect(r).toHaveLength(20);
    expect(r[19]).toBe('{"n":19}');
  });

  it("cuts each block to 200000 characters", () => {
    document.head.innerHTML = ldScript("x".repeat(250000));
    expect(collect().jsonLd[0]).toHaveLength(200000);
  });

  it("skips whitespace-only blocks", () => {
    document.head.innerHTML = ldScript("   \n ") + ldScript("") + ldScript('{"a":1}');
    expect(collect().jsonLd).toEqual(['{"a":1}']);
  });

  it("matches the type attribute case-insensitively", () => {
    document.head.innerHTML = ldScript('{"a":1}', "Application/LD+JSON") + ldScript('{"b":2}', " application/ld+json ");
    expect(collect().jsonLd).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("caps long strings", () => {
    document.head.innerHTML = `<meta property="og:title" content="${"o".repeat(9000)}">`;
    document.title = "t".repeat(9000);
    const r = collect();
    expect(r.title).toHaveLength(5000);
    expect(r.metas.ogTitle).toHaveLength(5000);
  });

  it("is JSON-serializable", () => {
    document.head.innerHTML = '<meta property="og:title" content="x">' + ldScript('{"a":1}');
    document.title = "T";
    const r = collect();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("does not mutate the DOM", () => {
    document.head.innerHTML = '<meta property="og:title" content="x">' + ldScript('{"a":1}');
    const before = document.documentElement.outerHTML;
    collect();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("does not call fetch", () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    try {
      collect();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("self-containment", () => {
  it("runs from its source text alone and returns the same shape", () => {
    document.head.innerHTML = '<meta property="og:title" content="u">' + ldScript('{"a":1}');
    document.title = "T";
    const standalone = new Function("return (" + collect.toString() + ")")();
    expect(standalone).not.toBe(collect);
    expect(standalone()).toEqual(collect());
    const u = new URL("https://www.linkedin.com/jobs/view/1");
    document.body.innerHTML = '<a href="/company/x">Acme</a><span>Remote</span>';
    expect(standalone(u)).toEqual(collect(u));
    expect(collect(u).hints).toEqual({ companyText: "Acme", modeText: "Remote" });
  });

  it("src/collect.js uses no forbidden API", () => {
    const src = readFileSync(join(process.cwd(), "src/collect.js"), "utf8");
    for (const word of ["innerHTML", "DOMParser", "eval", "fetch", "XMLHttpRequest", "sendBeacon", "localStorage", "document.cookie", "import "]) {
      expect(src, word).not.toContain(word);
    }
  });
});

const IN = new URL("https://www.indeed.com/viewjob?jk=1");
const LI = new URL("https://www.linkedin.com/jobs/view/123");
const hints = (u) => collect(u).hints;
const NONE = { companyText: null, modeText: null };

describe("site hints", () => {
  const indeedBody =
    '<a href="/jobs?q=x">Search</a><a href="/cmp/Kalye-Labs/reviews">Reviews</a>' +
    '<a href="/cmp/x"><img src="a.png"></a><a href="/cmp/Kalye-Labs">Kalye Labs Inc</a>';

  it("reads the Indeed company link, skipping non-company and empty links", () => {
    document.body.innerHTML = indeedBody;
    expect(hints(IN)).toEqual({ companyText: "Kalye Labs Inc", modeText: null });
  });

  it("gives null on a non-job Indeed path", () => {
    document.body.innerHTML = indeedBody;
    expect(hints(new URL("https://www.indeed.com/jobs?q=x"))).toEqual(NONE);
  });

  const liBody =
    '<p>Hybrid work available</p><div>Hybrid<span>x</span></div>' +
    '<a href="/company/kalye-labs/">Kalye Labs353 followers</a><a href="/company/kalye-labs/">Show more</a>' +
    '<a href="/company/kalye-labs/life/">Kalye Labs</a><a href="/company/kalye-labs/">Follow</a>' +
    "<span>Hybrid</span>";

  it("reads the LinkedIn company and the leaf mode chip only", () => {
    document.body.innerHTML = liBody;
    expect(hints(LI)).toEqual({ companyText: "Kalye Labs", modeText: "Hybrid" });
  });

  it("gives null on LinkedIn split-view paths", () => {
    document.body.innerHTML = liBody;
    expect(hints(new URL("https://www.linkedin.com/jobs/search-results/?currentJobId=1"))).toEqual(NONE);
  });

  it("matches hosts by label, not substring", () => {
    document.body.innerHTML = indeedBody;
    expect(hints(new URL("https://uk.indeed.com/viewjob?jk=1")).companyText).toBe("Kalye Labs Inc");
    for (const u of ["https://notindeed.com/viewjob", "https://indeed.com.evil.test/viewjob"]) {
      expect(hints(new URL(u))).toEqual(NONE);
    }
    document.body.innerHTML = liBody;
    for (const u of ["https://notlinkedin.com/jobs/view/1", "https://linkedin.com.evil.test/jobs/view/1"]) {
      expect(hints(new URL(u))).toEqual(NONE);
    }
  });

  it("gives no mode for a missing or foreign-language chip", () => {
    document.body.innerHTML = '<a href="/company/a">Acme</a>';
    expect(hints(LI).modeText).toBeNull();
    document.body.innerHTML = "<span>Híbrido</span>";
    expect(hints(LI).modeText).toBeNull();
  });

  it("cuts to 200 code points and returns text verbatim", () => {
    document.body.innerHTML = `<a href="/company/a">${"😀".repeat(250)}</a>`;
    expect([...hints(LI).companyText]).toHaveLength(200);
    document.body.innerHTML = '<a href="/company/a">&lt;b&gt;Acme&lt;/b&gt; \u05e9\u05dc\u05d5\u05dd</a>';
    expect(hints(LI).companyText).toBe("<b>Acme</b> \u05e9\u05dc\u05d5\u05dd");
  });

  it("slices a huge hint text before spreading it", () => {
    document.body.innerHTML = `<a href="/company/a">${"x".repeat(1_000_000)}</a>`;
    const orig = String.prototype[Symbol.iterator];
    let longest = 0;
    String.prototype[Symbol.iterator] = function () {
      longest = Math.max(longest, this.length);
      return orig.call(this);
    };
    try {
      const got = hints(LI).companyText;
      expect(longest).toBeLessThanOrEqual(400);
      expect([...got]).toHaveLength(200);
    } finally {
      String.prototype[Symbol.iterator] = orig;
    }
  });

  it("does not mutate the DOM or call fetch on hint pages", () => {
    document.body.innerHTML = liBody;
    const before = document.documentElement.outerHTML;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    try {
      collect(LI);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
