// SPIKE ONLY. Opened as a real popup it checks the session and reads the active tab.
// Opened by the harness as a tab with ?harness it does nothing on its own.
const out = document.getElementById("out");
async function main() {
  const me = await probe("http://localhost:3100", "/api/v1/me");
  if (me.status === 401) document.getElementById("login").hidden = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const r = await readTab(tab.id);
  out.textContent = r.error ? "Can't read this page" : `me ${me.status}; title: ${r.ok.title}`;
}
if (!location.search.includes("harness")) main();
