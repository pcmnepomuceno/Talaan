// Injected into the page via chrome.scripting.executeScript({ func: collect }).
// Must stay self-contained: everything it needs is defined inside its body.
// Read-only; returns plain JSON-serializable data. Cleaning happens in extract.js.
export function collect(loc = location) {
  const STR_MAX = 5000;
  const BLOCK_MAX = 200000;
  const BLOCKS_MAX = 20;
  const cap = (s) => (typeof s === "string" ? s.slice(0, STR_MAX) : null);
  const attr = (selector, name) => {
    const el = document.querySelector(selector);
    return el ? cap(el.getAttribute(name)) : null;
  };
  const jsonLd = [];
  for (const el of document.querySelectorAll("script[type]")) {
    if (jsonLd.length >= BLOCKS_MAX) break;
    if ((el.getAttribute("type") || "").trim().toLowerCase() !== "application/ld+json") continue;
    const text = el.textContent || "";
    if (text.trim()) jsonLd.push(text.slice(0, BLOCK_MAX));
  }
  // Best-effort per-site hints (E2d). Matched on URL host + path only; no class names.
  // When a site changes its markup the hint just returns null (blank field). To refresh:
  // open the job page, find the company link / mode label, update the path regex or words here,
  // add a fixture test in tests/collect.test.js, and update the README tested-sites table.
  const SITE_HINTS = [
    { domain: "indeed.com", path: /^\/viewjob/, company: /^\/cmp\/[^/]+\/?$/ },
    { domain: "linkedin.com", path: /^\/jobs\/view\//, company: /^\/company\/[^/]+/, mode: true, titleMustContainCompany: true },
  ];
  const cut = (s) => [...s.slice(0, 400)].slice(0, 200).join("");
  const hints = { companyText: null, modeTexts: [], titleMustContainCompany: false };
  const onDomain = (x, d) => x === d || x.endsWith("." + d);
  const h = (loc.hostname || "").toLowerCase();
  const hint = SITE_HINTS.find((x) => onDomain(h, x.domain) && x.path.test(loc.pathname));
  if (hint) {
    const root = document.querySelector("main") || document.body;
    hints.titleMustContainCompany = hint.titleMustContainCompany === true;
    for (const a of root.querySelectorAll("a[href]")) {
      if (a.hostname !== h && !onDomain(a.hostname, hint.domain)) continue;
      if (!hint.company.test(a.pathname)) continue;
      const t = (a.textContent || "").trim();
      if (!t || /^(show more|show less|follow)$/i.test(t) || /followers/i.test(t)) continue;
      hints.companyText = cut(t);
      break;
    }
    if (hint.mode) {
      for (const el of root.querySelectorAll("*")) {
        if (hints.modeTexts.length >= 10) break;
        if (el.childElementCount !== 0) continue;
        const t = (el.textContent || "").trim();
        if (/^(remote|hybrid|on-site)$/i.test(t)) hints.modeTexts.push(cut(t));
      }
    }
  }
  return {
    url: cap(loc.href) || "",
    title: cap(document.title) || "",
    metas: {
      ogTitle: attr('meta[property="og:title"]', "content"),
    },
    jsonLd,
    hints,
  };
}
