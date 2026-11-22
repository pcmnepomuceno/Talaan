// Injected into the page via chrome.scripting.executeScript({ func: collect }).
// Must stay self-contained: everything it needs is defined inside its body.
// Read-only; returns plain JSON-serializable data. Cleaning happens in extract.js.
export function collect() {
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
  return {
    url: cap(location.href) || "",
    title: cap(document.title) || "",
    metas: {
      ogTitle: attr('meta[property="og:title"]', "content"),
    },
    jsonLd,
  };
}
