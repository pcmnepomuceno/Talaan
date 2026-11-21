// SPIKE ONLY. Shared by sw.js (importScripts) and popup.html. The harness calls these via evaluate().
globalThis.probe = async function probe(base, path, method = "GET", body = null, manual = false) {
  const init = { method, credentials: "include", headers: {} };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (manual) init.redirect = "manual";
  try {
    const r = await fetch(base + path, init);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, redirected: r.redirected, type: r.type, location: r.headers.get("location"), body: json ?? text.slice(0, 200) };
  } catch (e) {
    return { error: String(e) };
  }
};

globalThis.readTab = async function readTab(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        jsonld: document.querySelector('script[type="application/ld+json"]')?.textContent ?? null,
        og: [...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute("property"), m.content]),
      }),
    });
    return { ok: res.result };
  } catch (e) {
    return { error: String(e.message || e) };
  }
};
