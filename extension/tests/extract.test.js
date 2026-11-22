import { describe, expect, it } from "vitest";
import { extractPosting } from "../src/extract.js";

const TAB = "https://jobs.example.com/jobs/view/222";
const metas = (o = {}) => ({ ogTitle: null, ...o });
const raw = (o = {}) => ({ url: TAB, title: "", metas: metas(), jsonLd: [], ...o });
const ld = (o) => JSON.stringify(o);
const posting = (o = {}) => ({ "@type": "JobPosting", title: "Engineer", hiringOrganization: { name: "Acme" }, ...o });

describe("json-ld shapes", () => {
  it("single object", () => {
    expect(extractPosting(raw({ jsonLd: [ld({ "@context": "https://schema.org", ...posting() })] }))).toEqual({
      company: "Acme", job_name: "Engineer", job_url: TAB, source: "jsonld",
    });
  });
  it("array of objects, graph, array @type", () => {
    expect(extractPosting(raw({ jsonLd: [ld([{ "@type": "WebSite" }, posting()])] })).job_name).toBe("Engineer");
    expect(extractPosting(raw({ jsonLd: [ld({ "@graph": [{ "@type": "Organization", name: "X" }, posting()] })] })).company).toBe("Acme");
    expect(extractPosting(raw({ jsonLd: [ld(posting({ "@type": ["Thing", "JobPosting"] }))] })).job_name).toBe("Engineer");
    expect(extractPosting(raw({ jsonLd: [ld(posting({ "@type": "https://schema.org/JobPosting" }))] })).job_name).toBe("Engineer");
  });
  it("hiringOrganization as string, object, array", () => {
    const c = (h) => extractPosting(raw({ jsonLd: [ld(posting({ hiringOrganization: h }))] })).company;
    expect(c("Beta")).toBe("Beta");
    expect(c({ name: "Gamma" })).toBe("Gamma");
    expect(c([{ name: "" }, { name: "Delta" }])).toBe("Delta");
  });
  it("name used when title missing", () => {
    expect(extractPosting(raw({ jsonLd: [ld({ "@type": "JobPosting", name: "Nm" })] })).job_name).toBe("Nm");
  });
  it("malformed block next to a valid one", () => {
    expect(extractPosting(raw({ jsonLd: ["{nope", ld(posting())] })).job_name).toBe("Engineer");
  });
  it("non-JobPosting types ignored", () => {
    const r = extractPosting(raw({ title: "Plain", jsonLd: [ld([{ "@type": "Organization", name: "O" }, { "@type": "WebSite", name: "W" }, { "@type": "Article", title: "A" }])] }));
    expect(r).toMatchObject({ company: "", job_name: "Plain", source: "title" });
  });
});

describe("stale and multiple postings", () => {
  it("stale url is ignored, falls back to og/title with blank company", () => {
    const r = extractPosting(raw({ metas: metas({ ogTitle: "OG Role" }), jsonLd: [ld(posting({ url: "https://jobs.example.com/jobs/view/111" }))] }));
    expect(r).toMatchObject({ company: "", job_name: "OG Role", source: "opengraph" });
  });
  it("fresh url matches despite query, fragment, trailing slash", () => {
    const r = extractPosting(raw({ url: TAB + "?x=1#f", jsonLd: [ld(posting({ url: TAB + "/?currentJobId=9" }))] }));
    expect(r).toMatchObject({ company: "Acme", source: "jsonld", job_url: TAB + "?x=1" });
  });
  it("unparseable declared url is dropped", () => {
    expect(extractPosting(raw({ title: "T", jsonLd: [ld(posting({ url: "http://[bad" }))] })).source).toBe("title");
  });
  it("several: matching one wins", () => {
    const r = extractPosting(raw({ jsonLd: [ld([posting({ title: "B" }), posting({ title: "A", url: "/jobs/view/222" })])] }));
    expect(r.job_name).toBe("A");
  });
  it("several with none matching: fallback (D3)", () => {
    const r = extractPosting(raw({ title: "Tab", jsonLd: [ld([posting({ title: "A" }), posting({ title: "B" })])] }));
    expect(r).toMatchObject({ company: "", job_name: "Tab", source: "title" });
  });
});

describe("fallbacks", () => {
  it("og only, title only, nothing", () => {
    expect(extractPosting(raw({ metas: metas({ ogTitle: "O" }) })).source).toBe("opengraph");
    expect(extractPosting(raw({ title: "T" }))).toMatchObject({ job_name: "T", source: "title", company: "" });
    expect(extractPosting({})).toEqual({ company: "", job_name: "", job_url: "", source: "none" });
  });
  it("company only from json-ld keeps source jsonld and falls back for the name", () => {
    const r = extractPosting(raw({ title: "T", jsonLd: [ld({ "@type": "JobPosting", hiringOrganization: "Acme" })] }));
    expect(r).toMatchObject({ company: "Acme", job_name: "T", source: "jsonld" });
  });
  it("company never comes from the title", () => {
    const r = extractPosting(raw({ title: "Engineer at Acme | Indeed" }));
    expect(r.company).toBe("");
  });
});

describe("cleaning", () => {
  const t = (title) => extractPosting(raw({ title })).job_name;
  it("tags and entities", () => {
    expect(t("Backend &amp; Platform Engineer <b>(Remote)</b>")).toBe("Backend & Platform Engineer (Remote)");
    expect(t("&lt;script&gt;")).toBe("<script>");
    expect(t("&amp;lt;")).toBe("&lt;");
    expect(t("a&#65;&#x42;&nbsp;c&#0;d&#1114112;e")).toBe("aAB cde");
  });
  it("control chars removed, whitespace collapsed", () => {
    expect(t("a\u0000b\u0007c\u001fd")).toBe("abcd");
    expect(t("  a \t\n b\r\n  c  ")).toBe("a b c");
    expect(t("a\tb\nc")).toBe("a b c");
    expect(t("a\tb\rc")).toBe("a b c");
  });
  it("lone surrogates are replaced, result is well-formed", () => {
    const r = extractPosting(raw({ jsonLd: [ld(posting({ title: "A\ud800B" }))] }));
    expect(r.job_name.isWellFormed()).toBe(true);
  });
  it("emoji and RTL kept", () => {
    expect(t("مهندس برمجيات 👩‍💻")).toBe("مهندس برمجيات 👩‍💻");
  });
  it("cuts to 200 code points with no lone surrogate", () => {
    const r = extractPosting(raw({ jsonLd: [ld(posting({ title: "😀".repeat(300), hiringOrganization: "😀".repeat(300) }))] }));
    expect([...r.job_name]).toHaveLength(200);
    expect([...r.company]).toHaveLength(200);
    expect(r.job_name).toBe("😀".repeat(200));
  });
});

describe("job_url", () => {
  const u = (url) => extractPosting(raw({ url })).job_url;
  it("strips fragment only", () => {
    expect(u("https://a.com/p?utm_source=x#frag")).toBe("https://a.com/p?utm_source=x");
  });
  it("rejects non-http, whitespace, control chars, over-length", () => {
    expect(u("chrome://extensions")).toBe("");
    expect(u("file:///tmp/a")).toBe("");
    expect(u("https://a.com/a b")).toBe("");
    expect(u("https://a.com/a\u0001b")).toBe("");
    expect(u("https://a.com/" + "😀".repeat(2000))).toBe("");
    expect(u("https://a.com/" + "a".repeat(1980))).not.toBe("");
    expect(u("https://a.com/" + "😀".repeat(1000))).not.toBe("");
  });
});

describe("defensive", () => {
  it("wrong-typed fields do not throw", () => {
    for (const r of [undefined, null, 5, "x", { url: 5, title: {}, metas: "no", jsonLd: "no" }, { metas: { ogTitle: 3 }, jsonLd: [1, null, "{}", "[]"] }]) {
      expect(() => extractPosting(r)).not.toThrow();
    }
    expect(extractPosting(null).source).toBe("none");
  });
  it("deeply nested hiringOrganization array does not throw", () => {
    const deep = "[".repeat(5000) + '"Acme"' + "]".repeat(5000);
    const block = `{"@type":"JobPosting","title":"T","hiringOrganization":${deep}}`;
    let r;
    expect(() => { r = extractPosting(raw({ jsonLd: [block] })); }).not.toThrow();
    expect(typeof r.company).toBe("string");
  });
});
