import { API_BASE, TAB_QUERY } from "./src/config.js";
import { createApi, NetworkError } from "./src/api.js";
import { collect } from "./src/collect.js";
import { extractPosting } from "./src/extract.js";

const SLOW_MS = 3000;
const READ_MS = 4000;
const NAME_MAX = 200;
const URL_MAX = 2000;
const LABELS = { company: "Company", job_name: "Job title", job_url: "Job posting URL", mode_of_work: "Work mode", status: "Status" };
// Top to bottom on screen: the first invalid field gets focus.
const FIELD_ORDER = ["company", "job_name", "job_url", "mode_of_work"];
const BAD_URL = "Enter a full address starting with http:// or https://";

const points = (s) => [...s].length;

// Same rule as the web form (frontend/src/lib/application-form.ts badJobUrl).
function badJobUrl(raw) {
  if (/[\p{Cc}\s]/u.test(raw) || !/^https?:\/\/[^/?#]/i.test(raw) || /^https?:\/\/[^/?#]*@/i.test(raw)) return true;
  try {
    const u = new URL(raw);
    return !((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "") || u.username !== "" || u.password !== "";
  } catch {
    return true;
  }
}
const lookupable = (s) => s !== "" && points(s) <= URL_MAX && !badJobUrl(s);

const tidy = (m) => (/[.!?/]$/.test(m) ? m : `${m}.`).replace(/^./, (c) => c.toUpperCase());

export async function start({ chrome, fetch, document, setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout }) {
  const $ = (id) => document.getElementById(id);
  const api = createApi({ fetch, base: API_BASE });
  const VIEWS = ["loading", "retry", "signedOut", "form", "saved"];
  const show = (name) => VIEWS.forEach((v) => ($(v).hidden = v !== name));
  const setStatus = (text) => ($("status").textContent = text);
  const radios = () => [...document.querySelectorAll('input[name="mode_of_work"]')];
  const slowTimer = (onSlow) => setTimeout(onSlow, SLOW_MS);

  let busy = false;
  let prefilled = false;
  let lastUrl = null;
  let seq = 0;

  // Page reading runs once, in parallel with the first me(). It never throws and
  // gives up (null) after READ_MS if the tab or the script never answers.
  const readPage = async () => {
    try {
      const [tab] = await chrome.tabs.query(TAB_QUERY);
      if (!tab || tab.id == null) return null;
      const out = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collect });
      const raw = out?.[0]?.result;
      if (!raw || typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url)) return null;
      return extractPosting(raw);
    } catch {
      return null;
    }
  };
  const pageRead = (async () => {
    let timer;
    const giveUp = new Promise((resolve) => (timer = setTimeout(() => resolve(null), READ_MS)));
    try {
      return await Promise.race([readPage(), giveUp]);
    } finally {
      clearTimeout(timer);
    }
  })();

  async function prefill() {
    if (prefilled) return;
    prefilled = true;
    const posting = await pageRead;
    if (!posting) {
      $("note").hidden = false;
      return;
    }
    $("company").value = posting.company;
    $("job_name").value = posting.job_name;
    $("job_url").value = posting.job_url;
    const radio = radios().find((r) => r.value === posting.mode_of_work);
    if (radio) {
      radio.checked = true;
      $("mode-note").textContent = posting.mode_source === "title" ? "Detected from the title" : "Detected from the page";
      $("mode-note").hidden = false;
    }
  }

  function setDup(match) {
    const dup = $("dup");
    dup.replaceChildren();
    dup.hidden = !match;
    if (!match) return;
    const a = document.createElement("a");
    a.setAttribute("href", `${API_BASE}/applications/${match.id}`);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.textContent = `${match.job_name}, ${match.company}`;
    dup.append(document.createTextNode("You already saved this posting: "), a, document.createTextNode("."));
  }

  async function checkDup() {
    const url = $("job_url").value.trim();
    if (url === lastUrl) return;
    lastUrl = url;
    const mine = ++seq;
    setDup(null);
    if (!lookupable(url)) return;
    try {
      const r = await api.lookup(url);
      if (r.status !== 200 && mine === seq) lastUrl = null;
      const m = r.status === 200 ? r.data?.match : null;
      if (mine === seq && m && Number.isSafeInteger(m.id) && typeof m.job_name === "string" && typeof m.company === "string") setDup(m);
    } catch {
      // A failed lookup never blocks Save and shows nothing; forget the URL so the next blur retries.
      if (mine === seq) lastUrl = null;
    }
  }

  // Check the session, then show the form, the sign-in prompt or the retry view.
  async function run() {
    show("loading");
    setStatus("");
    $("loadingText").textContent = "Loading...";
    const timer = slowTimer(() => {
      setStatus("Starting up...");
      $("loadingText").textContent = "Starting up...";
    });
    let result;
    try {
      result = await api.me();
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      result = null;
    } finally {
      clearTimeout(timer);
    }
    if (result?.status === 200) {
      setStatus("");
      await prefill();
      show("form");
      focusFirstEmpty();
      checkDup();
    } else if (result?.status === 401) {
      setStatus("");
      await prefill();
      show("signedOut");
      $("openLogin").focus();
    } else {
      const message = result === null ? "Couldn't reach Talaan." : "Something went wrong.";
      $("retryMessage").textContent = message;
      setStatus(message);
      show("retry");
      $("retryButton").focus();
    }
  }

  // First empty required field, else the Company input.
  function focusFirstEmpty() {
    const empty = ["company", "job_name"].find((id) => $(id).value.trim() === "");
    if (empty) $(empty).focus();
    else if (!radios().some((r) => r.checked)) radios()[0].focus();
    else $("company").focus();
  }

  function fieldError(name, message) {
    const err = $(`${name}-error`);
    err.textContent = message;
    err.hidden = false;
    const controls = name === "mode_of_work" ? radios() : [$(name === "status" ? "status-select" : name)];
    controls.forEach((c) => c.setAttribute("aria-invalid", "true"));
  }

  function clearErrors() {
    for (const el of document.querySelectorAll(".error")) {
      el.textContent = "";
      el.hidden = true;
    }
    for (const el of document.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
  }

  function focusField(name) {
    (name === "mode_of_work" ? radios()[0] : $(name === "status" ? "status-select" : name)).focus();
  }

  function validate(v) {
    const e = {};
    for (const [key, label, empty] of [["company", "Company", "Enter a company name."], ["job_name", "Job title", "Enter a job title."]]) {
      if (v[key] === "") e[key] = empty;
      else if (points(v[key]) > NAME_MAX) e[key] = `${label} must be ${NAME_MAX} characters or fewer.`;
    }
    if (v.mode_of_work === "") e.mode_of_work = "Choose a work mode.";
    if (v.job_url !== "") {
      if (points(v.job_url) > URL_MAX) e.job_url = "Job posting URL must be 2,000 characters or fewer.";
      else if (badJobUrl(v.job_url)) e.job_url = BAD_URL;
    }
    return e;
  }

  function showRejected(data) {
    const first = Array.isArray(data?.detail) ? data.detail[0] : null;
    if (!first || typeof first.msg !== "string") {
      setStatus("The server rejected some details. Check the form and try again.");
      return;
    }
    const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null;
    const known = Object.hasOwn(LABELS, field);
    if (!known) return setStatus(tidy(first.msg));
    fieldError(field, `${LABELS[field]}: ${tidy(first.msg)}`);
    focusField(field);
  }

  async function save() {
    if (busy) return;
    clearErrors();
    setStatus("");
    const v = {
      company: $("company").value.trim(),
      job_name: $("job_name").value.trim(),
      job_url: $("job_url").value.trim(),
      mode_of_work: radios().find((r) => r.checked)?.value ?? "",
    };
    const errors = validate(v);
    const firstBad = FIELD_ORDER.find((k) => errors[k]);
    if (firstBad) {
      for (const k of FIELD_ORDER) if (errors[k]) fieldError(k, errors[k]);
      focusField(firstBad);
      return;
    }
    const body = {
      company: v.company,
      job_name: v.job_name,
      status: $("status-select").value,
      mode_of_work: v.mode_of_work,
      date_applied: null,
      salary: null,
      contact_website: null,
      remarks: null,
    };
    if (v.job_url !== "") body.job_url = v.job_url;

    busy = true;
    let timer;
    try {
      $("save").disabled = true;
      timer = slowTimer(() => setStatus("Starting up..."));
      const r = await api.create(body);
      setStatus("");
      if (r.status === 201) {
        const id = r.data?.id;
        $("openLink").setAttribute("href", Number.isSafeInteger(id) ? `${API_BASE}/applications/${id}` : `${API_BASE}/applications`);
        setStatus("Saved");
        show("saved");
        $("openLink").focus();
      } else if (r.status === 401) {
        show("signedOut");
        $("openLogin").focus();
      } else if (r.status === 403) {
        setStatus("This extension is not enabled on the server yet.");
      } else if (r.status === 422) {
        showRejected(r.data);
      } else {
        setStatus("Something went wrong. Try again.");
      }
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      setStatus("Couldn't reach Talaan. Try again.");
    } finally {
      clearTimeout(timer);
      busy = false;
      $("save").disabled = false;
    }
  }

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    return save();
  });
  $("job_url").addEventListener("blur", checkDup);
  for (const r of radios()) r.addEventListener("change", () => ($("mode-note").hidden = true));
  $("retryButton").addEventListener("click", run);
  $("checkAgain").addEventListener("click", run);
  $("openLogin").addEventListener("click", () => chrome.tabs.create({ url: `${API_BASE}/login` }));

  await run();
}

if (typeof chrome !== "undefined" && chrome.scripting) {
  start({ chrome, fetch: globalThis.fetch.bind(globalThis), document });
}
