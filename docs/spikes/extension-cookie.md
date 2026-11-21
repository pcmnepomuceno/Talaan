# S0 spike: Chrome extension with the Talaan login cookie

> **Status: S0 spike, finished 2026-11-21.** The code lives on the branch `spike/extension-cookie` and is never merged; paths below under `extension-spike/` and the marked `# SPIKE` lines in `app/` exist only on that branch. The findings below are the input to E2.

## Production check: done, cookie-first confirmed

Most of this report was measured on **http://localhost:3100 (Next) and :8100 (API)**, with a non-Secure `session_token` cookie, in headless Chromium. The production check was then run by hand: the manual extension from `extension-spike/manual/` (on the spike branch) was loaded in a real browser, **Brave on Windows**, against https://talaan-phi.vercel.app. It returned `200` and "logged in" while logged in, and the logged-out state while logged out. So **cookie-first is confirmed for production**: the `__Host-session_token` cookie goes out through the Vercel proxy.

Still open: **Chrome itself was not tested** (Brave is Chromium-based but not identical). The `activeTab` real-click grant (Q6) and third-party cookie blocking (Q7) remain to verify in E2's first manual step.

## Manual check: 6 steps (your real Chrome)

The extension asks for host permission on `https://talaan-phi.vercel.app/*` only, no other permission, no tabs access. It makes one request to `/api/v1/me` and shows only the status code and "logged in" / "not logged in". It never reads the body, a cookie or your email.

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `extension-spike/manual` (on the spike branch: check it out first, or copy the folder). Pin the icon from the puzzle menu.
4. In the same Chrome profile, open https://talaan-phi.vercel.app and log in to Talaan.
5. Click the extension icon. Expected when logged in: **`200 logged in`**. Then log out of Talaan (or clear its cookie), click the icon again. Expected when logged out: **`401 not logged in`**. Optional: press "Show Origin"; it should show `chrome-extension://<some id>`.
6. On `chrome://extensions`, click **Remove** on "Talaan cookie check (spike)". Optionally turn Developer mode off again.

Reading the result: logged in but `401 not logged in` means the production cookie is NOT sent from the extension, so cookie-first fails and E3 tokens (or a content script on the Talaan site) come first. `network error` means the host permission or the URL is wrong. `0 not logged in` means the request was redirected (the popup uses `redirect: "manual"`), which is a deployment problem, not a cookie result. Any other status (for example 5xx) is also a deployment problem.

## Setup used

- Chromium: `chromium-1243`, reports Chrome/153.0.8010.12 (User-Agent `HeadlessChrome/153.0.0.0`).
- `chromium.launchPersistentContext(<temp dir>, {headless: true, executablePath: $PW_CHROMIUM, ignoreDefaultArgs: ["--disable-extensions"], args: ["--disable-extensions-except=<dirs>", "--load-extension=<dirs>", "--disable-features=DisableLoadExtensionCommandLineSwitch"]})`. It worked first time; the CDP `Extensions.loadUnpacked` fallback was not needed. Yes, this build supports loading extensions in headless mode with those flags.
- Stack from `frontend/scripts/local-env.cjs` (API :8100 on `talaan_test`, `next dev` :3100, `COOKIE_SECURE=false`). Test DB printed first: `postgresql+psycopg2://talaan:***@localhost:5432/talaan_test`.
- Reproduce (on the spike branch, from the repo root, venv active, `docker compose up -d db`):
  `NODE_PATH=/home/pcmnepomuceno/.npm/_npx/e41f203b7505f1fb/node_modules PW_CHROMIUM=/home/pcmnepomuceno/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome E2E_API_PORT=8100 E2E_WEB_PORT=3100 SPIKE_DEBUG=1 node extension-spike/run.cjs [--allow-ours] [--3pc=block-pref|phaseout-flag]`
  Run A: no flags. B: `--allow-ours` (sets `EXTENSION_ORIGINS` to our ID). C: B plus `--3pc=block-pref`. D: B plus `--3pc=phaseout-flag`.
- `ss -ltnp` on 8000, 8100, 3000, 3100: empty before and after. `pytest`: 626 passed with the spike dormant (count reported by the worker; its output was not saved, rerun `pytest` to confirm). `ruff check app`: clean.

## Q1. Does the cookie go out from a service worker and from a popup page?

**Measured: yes, in all four combinations.** With `host_permissions` for the site and `credentials: "include"`, the SameSite=Lax `session_token` cookie was sent from the service worker and from the popup page (opened as `chrome-extension://<id>/popup.html` in a tab), to both `localhost:3100` and `localhost:8100`. The echo route reported `cookie_present: true` (cookie names only, never values); `GET /me` returned 200; `redirected` was false everywhere. Identical for our extension and for a second extension with the same host permission.

Docs (developer.chrome.com, "Cross-origin network requests"): "A script executing in an extension service worker or foreground tab can talk to remote servers outside of its origin" (needs host permissions). The page says **nothing** about cookies or SameSite for extension requests, and nothing about popups. So why the cookie is sent (Chrome treats a request with host permission as same-site) is **could not verify from documentation**; the evidence is the measurement.

What does NOT transfer to production: local cookie is not Secure and not `__Host-`; localhost cookies ignore ports so :8100 shares the :3100 cookie (in production the cookie lives on the Vercel host only, so the extension must call `https://<vercel host>/api/v1/...`, never the Render host); popup was a page in a tab, not the real action popup; headless, not a real profile. The manual check above covers these.

## Q2. Origin and Sec-Fetch-Site the API receives

Measured with the `SPIKE_DEBUG` echo route (names and headers only):

| Request from the extension | Origin | Sec-Fetch-Site | Sec-Fetch-Mode | Sec-Fetch-Dest |
|---|---|---|---|---|
| GET | none sent (`null` in echo) | `none` | `cors` | `empty` |
| POST | `chrome-extension://<id>` | `none` | `cors` | `empty` |

The POST row's Origin and Sec-Fetch values come from run B and only from `ours`: in run A every extension POST was blocked (403) before it reached the echo route, and in run B `other` was blocked too. Same for service worker and popup page, and the same through Next (:3100) and direct (:8100), so the Next proxy passes both headers through unchanged (locally). **`Sec-Fetch-Site` is `none`, not `cross-site` and not `same-origin`.** GET carries no Origin; POST carries the extension origin.

## Q3. What origin_check does, and the smallest safe change

Current code (`app/security.py`):

```python
if request.method in UNSAFE_METHODS:
    origin = request.headers.get("origin")
    site = request.headers.get("sec-fetch-site", "").strip().lower()
    if site == "cross-site" or (
        site != "same-origin"
        and origin is not None
        and origin.strip().lower() not in config.ALLOWED_ORIGINS
    ):
        return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
```

Measured today (run A): an extension POST (`site=none`, Origin `chrome-extension://...`) fails the second branch, so **every extension write is 403**, even with the cookie. GETs are never checked.

Proposed change (as built on the spike branch, marked `# SPIKE: proposed for E2`):

```python
# app/config.py
def parse_extension_origins(raw):  # each entry must fullmatch chrome-extension://[a-p]{32}, else startup error
    ...
EXTENSION_ORIGINS = parse_extension_origins(os.getenv("EXTENSION_ORIGINS"))   # default: empty

# app/security.py, first lines inside `if request.method in UNSAFE_METHODS:` after reading origin/site
if origin is not None and origin.strip().lower() in config.EXTENSION_ORIGINS:
    return await call_next(request)
```

Empty setting = today's behavior by inspection (an empty frozenset never matches); run A ran the spike code with the setting empty and every extension POST got 403, but the unmodified code was not run separately. Everything else, including `ALLOWED_ORIGINS`, is untouched. No wildcard is possible (the pattern requires 32 letters a-p).

Proof (run B, `EXTENSION_ORIGINS=chrome-extension://pflclnkbfekhdollheiompdknkddmeeg`):

| Extension | POST echo | POST /applications | GET /me |
|---|---|---|---|
| ours (`pflclnk...`) | 200 | **201** | 200 |
| other (`ijnmaeg...`, same host permission) | **403** | **403** | 200 |

Run C and D gave the identical matrix. Why Origin and not Sec-Fetch-Site: the extension's `Sec-Fetch-Site` is `none` for every extension, so only the Origin identifies which one. Origin can be forged by a non-browser client, but such a client has no ambient cookie to ride, same reasoning as the existing "no Origin = allowed" rule.

Residual risk that this change does not fix: **GETs are unchecked**, so any extension the user installs that has host permission on the Talaan host can read all their data with their cookie (run B: `other` got 200 on `GET /me`). The allow-list only blocks its writes. Tokens (E3) with a quick-add-only endpoint remove this exposure.

## Q4. Stable extension ID

- Pin: add the base64 DER public key (SPKI) as `"key"` in `manifest.json`. Docs (manifest "key"): the key "maintains the unique ID of an extension ... when it is loaded during development"; the docs do not describe the derivation.
- Derive (verified by measurement): SHA-256 of the DER public key, first 16 bytes (32 hex chars), each hex digit mapped 0-f to a-p. `extension-spike/keys.cjs` (spike branch) does this with `node:crypto`; private keys live only in the scratchpad, never in the repo. **Decision point for E2:** the `key` in the manifest is the *public* key, committed in plain text, and Chrome derives the ID from that public value. Any extension loaded unpacked in developer mode that copies our `key` gets our ID and our Origin and passes `EXTENSION_ORIGINS`. So "only our extension may write" really means "only extensions carrying our public key", which in practice means a user (or malware that can enable developer mode) who installed it on purpose; a Web Store extension cannot claim our ID. This was reasoned, not measured. Decide in E2 whether that is acceptable (E3 tokens avoid it).
- Match: `ours` derived `pflclnkbfekhdollheiompdknkddmeeg`, `chrome.runtime.id` reported the same; `other` derived and reported `ijnmaegnnpbcgkiafkkjcibjbonjbmeh`.
- Without a key the ID comes from the install path: the same extension loaded from two paths got two different IDs. Each run copies the extension to a new temp path, so the IDs change every run; run A had `hhlachffccejjjkkakojfhjafkkmmfoc` and `klhccfflnfbgediamafomaomaongkdal`, and the script printed `keyless IDs differ from each other and from ours: true`. These IDs were derived from the path and confirmed by a service worker running under each ID, not by `chrome.runtime.id`. So without a key `EXTENSION_ORIGINS` cannot be set reliably. **E2 must ship a `key`.** (The `manual/` extension deliberately has no key, so its ID is irrelevant.)

## Q5. Logged-out behavior

Measured (cookies cleared, `fetch(..., {redirect: "manual"})`, service worker, :3100 and :8100 alike):

- `GET /api/v1/me`: **401**, body `{"detail":"Not authenticated"}`, `redirected: false`, response type `basic`, no `Location` header. Clean, no redirect.
- `POST /api/v1/applications` (run A, allow-list empty): 403 `{"detail":"Cross-site request blocked."}`. With our ID allowed and no cookie (runs B to D, service worker, :3100 and :8100), `POST /api/v1/applications` returned **401** `{"detail":"Not authenticated"}`, `redirected: false`, no `Location`: it passes the origin check and fails at `get_current_user`.

Popup behavior: on 401 from `/me`, show "Log in to Talaan" with a link to the site's `/login` (opened in a new tab via `chrome.tabs.create`/`<a target=_blank>`, no `tabs` permission needed for a link). On Save, treat 401 the same way and keep the typed fields. The manual extension's logged-out result is `401 not logged in`.

## Q6. activeTab and scripting

Manifest used: `"permissions": ["activeTab", "scripting"]`, `host_permissions` only for the Talaan hosts; the fixture origin was not listed.

- **Control without a grant (measured):** `executeScript` on all four fixture pages fails: "Cannot access contents of the page. Extension manifest must request permission to access the respective host."
- **A real activeTab grant could NOT be produced in headless Chrome:** the `_execute_action` shortcut (Alt+Shift+Y) had no effect and `chrome.action.openPopup()` returned without granting. **So "activeTab alone can read title, JSON-LD and og tags" is NOT verified by measurement.** Docs (developer.chrome.com, activeTab) say the extension gets temporary access to the active tab when the user invokes it by clicking the action, a keyboard shortcut, a context menu item or an omnibox suggestion; with the `scripting` permission it can run `executeScript`; "Access to the tab lasts while the user is on that page, and is revoked when the user navigates away or closes the tab."
- **Readable half, measured with a different mechanism** (a throwaway copy with the fixture origin as a *host permission*, which is not activeTab): `/jobposting` returned the title "Backend Engineer at Spike Co" and the full JobPosting JSON-LD; `/og` returned the title and og:title "Backend Engineer", og:site_name "Spike Co", og:url; `/plain` returned only the title; the PDF fixture returned an empty title with no JSON-LD or og (whether Chrome's PDF viewer or something else loaded was not distinguished). So the extraction code works once access exists.
- **Restricted pages:** `chrome://version` fails with "Cannot access a chrome:// URL" (measured). Docs: "Access is not granted to restricted pages, such as chrome:// pages." The Chrome Web Store page was not tested and the activeTab docs do not mention it (**could not verify**). Popup should show "Can't read this page. Fill in the fields by hand." for any `executeScript` error, and for a PDF or empty result show the empty form (title blank).
- **Permissions needed (expected, not measured with a real grant):** `activeTab` and `scripting`; no host permission beyond the Talaan site (needed for the API fetch). To verify by hand: load `extension-spike/ours` from the spike branch (it has the Talaan localhost hosts only) in a throwaway profile, open a fixture page served by `extension-spike/fixtures.cjs` (spike branch), click the icon, and check that the popup shows the title.

## Q7. Third-party cookie blocking

Runs C (`profile.cookie_controls_mode = 1` written to `Default/Preferences`, still `1` after the run) and D (`--test-third-party-cookie-phaseout`) produced a matrix **byte-identical** to run B: cookie still sent, same statuses. Default settings (run A/B) also send it.

**Caveat:** I did not prove the preference or flag actually blocked a genuine third-party cookie (no cross-site iframe control), so C and D mean "no change observed", not "blocking was verified active". Not tested: a real profile with "Block third-party cookies" set through the UI, Incognito, and enterprise policies. The manual check, repeated in a profile with third-party cookies blocked, would answer it for production.

## Edge cases

- **Service worker idle shutdown:** a 40 s fetch from the service worker completed (200 after 40.0 s), but Playwright/CDP was attached to the worker and likely kept it alive. Weak evidence; **could not verify** real termination. Mitigation for E2: do the save from the popup page (alive while open), not the service worker.
- **Popup on chrome://, Web Store, PDF:** see Q6.
- **ID changes without a key:** see Q4.
- **Cookie not Secure vs Secure:** confirmed by the manual check in Brave (see the production check above).

## Recommendation

Cookie-first **works locally**: the cookie is sent from both contexts, the origin check blocks all extension writes today, and one setting (`EXTENSION_ORIGINS`) lets only our pinned ID write while another extension with the same host permission is still rejected. The manual check confirmed it for production in Brave (https, `__Host-` cookie, Vercel proxy); Chrome itself is still to be verified in E2's first manual step. Even so, reading remains open to any extension with host permission on our site, which is the argument for E3 right after E2.

## Proposed outline for E2

1. Server: `EXTENSION_ORIGINS` (validated, default empty, set in Render and `.env.example`), the 2-line `origin_check` allowance, tests (allowed ID writes, other ID 403, empty setting unchanged, malformed entry fails startup), docs/AUTH.md and a dated DECISIONS.md entry. Consider listing it in `production_problems()` only if wanted.
2. `extension/` with pinned `key`, host permission for the Talaan site only, `activeTab` + `scripting`, popup page does the fetches to `https://<vercel host>/api/v1`.
3. Extraction: JSON-LD `JobPosting`, then Open Graph, then `document.title`, with unit tests on synthetic HTML fixtures.
4. Popup states: loading, logged out (Log in to Talaan), restricted page, editable form, saved, error (keep typed values).
5. Depends on E1 (`job_url`) for "already saved".

## Not verified (summary)

Chrome itself (production was checked in Brave only); real activeTab grant; real action popup vs popup page; whether the 3PC preference and flag were actually enforcing; service worker idle termination; Chrome Web Store page behavior. Also: the developer.chrome.com quotes were fetched by a web tool and not independently checked against the pages.
