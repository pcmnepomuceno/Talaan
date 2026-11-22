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
    expect(Object.keys(got)).toEqual(["url", "title", "metas", "jsonLd"]);
    expect(got).toEqual({
      url: location.href,
      title: "Engineer at Acme",
      metas: { ogTitle: "OG Title" },
      jsonLd: ['{"@type":"JobPosting"}'],
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
  });

  it("src/collect.js uses no forbidden API", () => {
    const src = readFileSync(join(process.cwd(), "src/collect.js"), "utf8");
    for (const word of ["innerHTML", "DOMParser", "eval", "fetch", "XMLHttpRequest", "sendBeacon", "localStorage", "document.cookie", "import "]) {
      expect(src, word).not.toContain(word);
    }
  });
});
