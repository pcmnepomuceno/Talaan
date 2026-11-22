// Pure extraction of company / job title / url from a raw page snapshot.
// No DOM access: input is plain data collected by the content script.

const NAME_MAX = 200;
const URL_MAX = 2000;
const DEPTH_MAX = 10;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  // Single pass, so "&amp;lt;" becomes "&lt;" and is not decoded again.
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hex, dec, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? m;
    const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
    return String.fromCodePoint(cp);
  });
}

/** Strip tags, decode entities, drop control chars, collapse whitespace, cut to max code points. */
function clean(s, max = NAME_MAX) {
  if (typeof s !== "string") return "";
  // Order matters: strip tags BEFORE decoding, so "&lt;b&gt;" ends up as literal "<b>" text.
  const text = decodeEntities(s.replace(/<[^>]*>/g, ""))
    .replace(/[\t\n\r]/g, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return [...text].slice(0, max).join("").toWellFormed();
}

function pathOf(u, base) {
  try {
    const p = new URL(u, base).pathname;
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  } catch {
    return null;
  }
}

function isJobPosting(node) {
  const t = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  return t.some((x) => typeof x === "string" && (x === "JobPosting" || x.endsWith("/JobPosting")));
}

function collect(node, out, depth = 0) {
  if (depth > DEPTH_MAX || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collect(n, out, depth + 1));
  if (isJobPosting(node)) out.push(node);
  Object.values(node).forEach((v) => collect(v, out, depth + 1));
}

function pickPosting(jsonLd, tabUrl) {
  const found = [];
  for (const block of Array.isArray(jsonLd) ? jsonLd : []) {
    if (typeof block !== "string") continue;
    try {
      collect(JSON.parse(block), found);
    } catch {
      // malformed block: ignore
    }
  }
  const tabPath = pathOf(tabUrl, tabUrl);
  const live = found.filter((p) => typeof p.url !== "string" || (pathOf(p.url, tabUrl) !== null && pathOf(p.url, tabUrl) === tabPath));
  if (live.length === 1) return live[0];
  // Several candidates: only one that declares a matching url is trusted (D3).
  return live.find((p) => typeof p.url === "string") ?? null;
}

function orgOne(h) {
  if (typeof h === "string") return clean(h);
  if (h && typeof h === "object" && !Array.isArray(h)) return clean(h.name);
  return "";
}

// One array level only: nested arrays are not followed (no unbounded recursion).
function orgName(h) {
  return Array.isArray(h) ? h.map(orgOne).find(Boolean) ?? "" : orgOne(h);
}

function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

function hostLabels(hostname) {
  return String(hostname ?? "").toLowerCase().split(".").filter((l) => /^[a-z]{4,}$/.test(l));
}

/**
 * Drop a trailing segment that names the site (it contains a host label of 4+ letters), then keep the
 * first " | " segment; " - " parts stay. Unrecognized titles are untouched.
 * ponytail: a real trailing segment containing a host label ("Engineer - LinkedIn Ads") is dropped too (README, Known limits).
 */
export function cleanTitle(title, hostname) {
  // clean() once with no cut (it is not idempotent on entities), cut to NAME_MAX last.
  const t = clean(title, Infinity);
  const cut = (s) => [...s].slice(0, NAME_MAX).join("");
  const labels = hostLabels(hostname);
  const pipes = t.split(" | ");
  const dashes = pipes.at(-1).split(/( (?:-|–|—|·) )/); // separators sit at odd indexes
  const tail = dashes.at(-1).toLowerCase();
  if (!labels.some((l) => tail.includes(l))) return cut(t);
  const rest = dashes.slice(0, -2).join("");
  const kept = rest ? [...pipes.slice(0, -1), rest] : pipes.slice(0, -1);
  return cut(kept[0] || t);
}

function safeUrl(url) {
  if (typeof url !== "string") return "";
  const noFrag = url.split("#")[0];
  if (!/^https?:\/\//i.test(noFrag) || /[\p{Cc}\s]/u.test(noFrag) || [...noFrag].length > URL_MAX) return "";
  return noFrag;
}

const L = "(?<![\\p{L}\\p{N}])";
const R = "(?![\\p{L}\\p{N}])";
const word = (alt) => new RegExp(`${L}(?:${alt})${R}`, "iu");
const MODE_ALT = { remote: "remote", hybrid: "hybrid", on_site: "on-site|onsite|on site" };
const WHOLE = Object.entries(MODE_ALT).map(([mode, alt]) => [mode, new RegExp(`^(?:${alt})$`, "iu")]);
const BRACKETED = Object.entries(MODE_ALT).map(([mode, alt]) => [mode, new RegExp(`[(\\[]\\s*(?:${alt})\\s*[)\\]]`, "iu")]);
const STRONG = word("100% remote|fully remote|work from home|wfh");
const NOT_MODES = /remote[ -](?:sensing|control|desktop)|(?:non|not|no)[- ](?:remote|hybrid|on-site|onsite|on site)/gi;
const SEPARATOR = / (?:\||-|–|—|·|\/) /;
const PAGE_MODES = { remote: "remote", hybrid: "hybrid", "on-site": "on_site" };

/**
 * Work mode from the strongest signal that exists; the first level with a signal wins.
 * ponytail: a heuristic; ambiguous or unknown gives blank, never a guess.
 * @returns {{mode: "on_site"|"hybrid"|"remote"|"", source: "jsonld"|"page"|"title"|""}}
 */
export function detectWorkMode(raw, posting, company = "") {
  const jlt = posting?.jobLocationType;
  const types = Array.isArray(jlt) ? jlt : [jlt];
  if (types.some((x) => typeof x === "string" && x.toUpperCase().includes("TELECOMMUTE"))) {
    return { mode: "remote", source: "jsonld" };
  }
  const pageTexts = Array.isArray(raw?.hints?.modeTexts) ? raw.hints.modeTexts : [];
  const pages = new Set(pageTexts.map((x) => clean(x).toLowerCase()).filter((k) => Object.hasOwn(PAGE_MODES, k)).map((k) => PAGE_MODES[k]));
  if (pages.size === 1) return { mode: [...pages][0], source: "page" };
  const texts = [clean(posting?.title) || clean(posting?.name), clean(raw?.metas?.ogTitle), clean(raw?.title)];
  const labels = hostLabels(hostOf(raw?.url));
  const co = clean(company).toLowerCase();
  const found = new Set();
  for (const t of texts) {
    const segs = t.split(SEPARATOR);
    const multi = segs.length > 1;
    if (multi && labels.some((l) => segs.at(-1).toLowerCase().includes(l))) segs.pop();
    for (const seg of segs) {
      const s = seg.toLowerCase().trim();
      if (co && s === co) continue;
      const text = s.replace(NOT_MODES, " ").trim();
      if (STRONG.test(text)) found.add("remote");
      for (const [mode, re] of WHOLE) if (multi && re.test(text)) found.add(mode);
      for (const [mode, re] of BRACKETED) if (re.test(text)) found.add(mode);
    }
  }
  return found.size === 1 ? { mode: [...found][0], source: "title" } : { mode: "", source: "" };
}

// LinkedIn only: the company link must be backed by the document title (E2d). Both args are lowercased.
// Middle " | " segments only: the first is the job title, the last may name the site.
function titleHasCompany(title, company, hostname) {
  if (title.includes(company)) return true;
  const labels = hostLabels(hostname);
  const segs = title.split(" | ").slice(1);
  if (segs.length && labels.some((l) => segs.at(-1).includes(l))) segs.pop();
  return segs.some((s) => s.length >= 2 && company.includes(s));
}

/**
 * @param {{url?: string, title?: string, metas?: {ogTitle?: string|null}, jsonLd?: string[], hints?: {companyText?: string|null, modeTexts?: string[], titleMustContainCompany?: boolean}}} raw
 * @returns {{company: string, job_name: string, job_url: string, source: "jsonld"|"opengraph"|"title"|"none", mode_of_work: string, mode_source: string}}
 */
export function extractPosting(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const tabUrl = typeof r.url === "string" ? r.url : "";
  let company = "";
  let jobName = "";
  let source = "none";

  const p = pickPosting(r.jsonLd, tabUrl);
  if (p) {
    jobName = clean(p.title) || clean(p.name);
    company = orgName(p.hiringOrganization);
    if (jobName || company) source = "jsonld";
  }
  let hc = clean(r.hints?.companyText);
  if (hc && r.hints?.titleMustContainCompany === true && !titleHasCompany(clean(r.title).toLowerCase(), hc.toLowerCase(), hostOf(tabUrl))) hc = "";
  company ||= hc;
  if (!jobName) {
    const host = hostOf(tabUrl);
    const og = cleanTitle(r.metas?.ogTitle, host);
    const title = cleanTitle(r.title, host);
    if (og) jobName = og;
    else if (title) jobName = title;
    if (source === "none" && jobName) source = og ? "opengraph" : "title";
  }
  const { mode, source: modeSource } = detectWorkMode(r, p, company);
  return { company, job_name: jobName, job_url: safeUrl(tabUrl), source, mode_of_work: mode, mode_source: modeSource };
}
