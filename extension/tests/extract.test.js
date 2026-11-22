import { describe, expect, it } from "vitest";
import { cleanTitle, extractPosting } from "../src/extract.js";

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

describe("title cleanup", () => {
  const at = (url, o) => extractPosting(raw({ url, ...o }));
  const LI = "https://www.linkedin.com/jobs/view/1";
  const IN = "https://ph.indeed.com/viewjob?jk=1";

  it("drops the site and the company-like segment from a pipe title", () => {
    expect(at(LI, { title: "Acme Interns | Acme | LinkedIn" })).toMatchObject({ job_name: "Acme Interns", company: "" });
  });
  it("keeps ' - ' parts but drops the site", () => {
    expect(at(IN, { title: "Systems Trainee - Quezon City - Indeed.com" }).job_name).toBe("Systems Trainee - Quezon City");
    expect(at("https://www.onlinejobs.ph/jobseekers/job/1", { title: "Support Engineer | $10/hr | 100% Remote 123 - OnlineJobs.ph" }).job_name).toBe("Support Engineer");
  });
  it("known weak case: a search page", () => {
    expect(at(IN, { title: "Job Search | Indeed" }).job_name).toBe("Job Search");
  });
  it("known heuristic cost (README, Known limits): a trailing segment containing a host label is dropped", () => {
    expect(at(LI, { title: "Platform Engineer - LinkedIn Ads" }).job_name).toBe("Platform Engineer");
  });
  it("unrecognized titles stay as they are", () => {
    expect(at(IN, { title: "Data Analyst - Night Shift" }).job_name).toBe("Data Analyst - Night Shift");
    expect(at(LI, { title: "LinkedIn" }).job_name).toBe("LinkedIn");
    expect(at("http://localhost/x", { title: "Engineer | Acme" }).job_name).toBe("Engineer | Acme");
  });
  it("hosts without a 4-letter label change nothing", () => {
    for (const h of ["10.0.0.1", "a.b.co", "[::1]"]) {
      expect(at(`http://${h}/`, { title: "Dev | LinkedIn" }).job_name).toBe("Dev | LinkedIn");
    }
  });
  it("is case-insensitive", () => {
    expect(cleanTitle("Dev | LINKEDIN", "WWW.LinkedIn.com")).toBe("Dev");
    expect(cleanTitle("Dev - indeed.COM", "ph.Indeed.com")).toBe("Dev");
    expect(at("https://PH.INDEED.COM/x", { title: "Dev - indeed.COM" }).job_name).toBe("Dev");
  });
  it("handles the other dash separators", () => {
    expect(cleanTitle("Role – Indeed", "ph.indeed.com")).toBe("Role");
    expect(cleanTitle("Role — Indeed", "ph.indeed.com")).toBe("Role");
    expect(cleanTitle("Role · Indeed", "ph.indeed.com")).toBe("Role");
  });
  it("handles emoji and RTL", () => {
    expect(at(LI, { title: "مهندس 👩‍💻 | LinkedIn" }).job_name).toBe("مهندس 👩‍💻");
    expect(at(LI, { title: "Dev 👩‍💻" }).job_name).toBe("Dev 👩‍💻");
  });
  it("a site name in the middle is not stripped", () => {
    expect(at(IN, { title: "Engineer - Indeed - Manila" }).job_name).toBe("Engineer - Indeed - Manila");
    expect(at(IN, { title: "Indeed | Engineer | Manila" }).job_name).toBe("Indeed | Engineer | Manila");
  });
  it("empty title", () => {
    expect(cleanTitle("", "www.linkedin.com")).toBe("");
    expect(cleanTitle(undefined, "www.linkedin.com")).toBe("");
  });
  it("JSON-LD title is never cleaned", () => {
    const r = at(LI, { jsonLd: [ld(posting({ title: "Engineer | LinkedIn" }))] });
    expect(r).toMatchObject({ job_name: "Engineer | LinkedIn", source: "jsonld" });
  });
  it("og:title is cleaned, source stays opengraph", () => {
    expect(at(LI, { metas: metas({ ogTitle: "Acme Interns | Acme | LinkedIn" }) })).toMatchObject({ job_name: "Acme Interns", source: "opengraph" });
  });
  it("strips the suffix first, then cuts to 200 code points", () => {
    expect(at(LI, { title: "a".repeat(195) + " | LinkedIn" }).job_name).toBe("a".repeat(195));
    expect(at(LI, { title: "a".repeat(300) + " | LinkedIn" }).job_name).toBe("a".repeat(200));
  });
});
