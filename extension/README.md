# Talaan Chrome extension

## What it does

Click the toolbar icon on a job posting. A small popup opens with the company, job title and posting link already filled in. Edit them, choose a work mode, and press Save. The application is created through your existing Talaan session.

## What it reads and when

It reads only the active tab, and only after you click the icon, through `activeTab` and `scripting`. It reads the page URL and title, the `og:title` tag, and the text of JSON-LD script tags. On Indeed and LinkedIn job pages it also reads the text of the company link and, on LinkedIn, the exact work-mode labels, only inside `<main>` when the page has one; nothing else. It only reads and never writes to the page. Page reading gives up after 4 seconds, so a stuck tab leaves an empty form.

Nothing is sent anywhere until you press Save, with two exceptions:

- The sign-in check, `GET /api/v1/me`, when the popup opens.
- The duplicate check, `POST /api/v1/applications/lookup`, which sends the posting URL so Talaan can tell you if you already saved it. It runs when the URL field is first filled (on open), and again when the field loses focus after you edit it or after the last lookup failed.

## Permissions and why

- `activeTab`: temporary access to the tab you clicked on.
- `scripting`: to run the page reader once.
- Host permission `https://talaan-phi.vercel.app/*`: to call the Talaan API with your login cookie. It is the Vercel host, never the Render host.

There is nothing else: no background worker and no content scripts.

## Sign-in

The extension has no login form. If you are signed out it shows "Open Talaan to sign in". Sign in on the site, then click the toolbar icon again. The popup closes when the sign-in tab opens, and typed values are not kept.

## Install (unpacked, Chrome on desktop only)

1. Open `chrome://extensions` and turn on Developer mode.
2. Choose Load unpacked and select the `extension/` folder.
3. Confirm the ID is `fjlnbbkeadlpibmnbpfhlgeingifocni`.

The server must allow it with `EXTENSION_ORIGINS=chrome-extension://fjlnbbkeadlpibmnbpfhlgeingifocni` (docs/AUTH.md). Chrome 123 or newer is needed (the popup's colors use `light-dark()`).

The `key` in `manifest.json` is the public key. It is committed because it fixes the ID. The matching private key was generated outside the repository and is never committed. `npm run package` and the Chrome Web Store upload do not use it; only Chrome's "Pack extension" (a `.crx` file) would. Never add a `*.pem` file.

## Privacy

- Disclosure shown at the top of the popup, in every state: "Reads this page's link, title and job details when you open Talaan, and sends the link to your Talaan account to check for duplicates. Nothing is saved until you press Save." Privacy policy: https://talaan-phi.vercel.app/privacy
- It reads only the active tab, after a click.
- It sends nothing until you press Save, except the sign-in check and the duplicate check above.
- No analytics.
- No storage: no `chrome.storage`, `localStorage` or cookies of its own.
- No third-party requests and no remote code.
- On OnlineJobs.ph job pages the work mode is assumed from the site, not read from the page.

## Tested sites (2026-11-22)

Checked by hand in Chrome on real postings.

| Site | Title | Company | Work mode |
| --- | --- | --- | --- |
| Indeed `/viewjob` | Yes | Yes | None |
| LinkedIn `/jobs/view` (signed in) | Yes | Yes | From the top card |
| LinkedIn split-view search | Yes | None | None |
| JobStreet | Yes | Yes | None in the page data we saw |
| BossJob | Yes | Yes | Yes |
| OnlineJobs.ph | Yes | None | Assumed Remote from the site |

## Site hints

Indeed (`/viewjob`), LinkedIn (`/jobs/view/`) and OnlineJobs.ph (`/jobseekers/job/`) pages have no structured data, so `src/collect.js` keeps a small `SITE_HINTS` table matched on the URL host and path only (never class names). The scan is limited to `<main>` when the page has one, otherwise the whole body. The collector returns `{ companyText, modeTexts, titleMustContainCompany, defaultMode }`. The OnlineJobs.ph row has no company or mode rule, only `defaultMode: "remote"`.

Company: the first link to `/cmp/...` (Indeed) or `/company/...` (LinkedIn) with real text, on the same site as the page (links to another site are skipped, and so are SVG links). On LinkedIn the company must also appear in the document title as whole words: the title contains the company, or a middle title segment (not the first, and not a last segment that names the site) is inside the company. Otherwise the company stays blank. Indeed is exempt from this check. A company from JSON-LD is never checked.

Work mode is chosen from the first signal that exists, and anything unclear gives blank:

1. JSON-LD `jobLocationType` TELECOMMUTE.
2. The LinkedIn page level: up to 10 leaf elements reading exactly Remote, Hybrid or On-site are collected. It counts only when exactly one distinct mode appears (case-insensitive).
3. The title scan, over the JSON-LD title, the `og:title` and the document title. It reads job-title segments only: the text is split on spaced separators (` | `, ` - `, ` / `, en dash, em dash and `·`), a last segment that names the site is dropped, and a segment equal to the company is dropped. A mode word counts only when it is a whole segment between separators, sits inside `()` or `[]`, or is a strong phrase: 100% remote, fully remote, work from home, WFH. Negations (non, not or no before a mode, also before fully or 100% remote, WFH or work from home) and "remote sensing/control/desktop" are ignored. Two different modes across the titles give blank.
4. Site default (OnlineJobs.ph job pages only): Remote, shown as "Assumed from the site". Used only when no level above saw any mode.

The popup says where the value came from and one click changes it.

To refresh a hint when a site changes: open the job page, find the company link or mode label, update the path regex or words in `SITE_HINTS`, add a fixture test in `tests/collect.test.js`, and update the table above.

## Known limits

1. The stale JSON-LD check compares the URL path only, not the query. A site that keeps the posting id only in the query is not caught.
2. On LinkedIn's split-view search pages (`/jobs/search/?currentJobId=...`) the posting's JSON-LD is dropped. The title is still filled, but the saved link is the search-results URL, not the job's. Open the job's own page for best results.
3. The company is never guessed from the title. It comes from a JobPosting's `hiringOrganization` or, on Indeed and LinkedIn job pages, the company link (site hints). The page title names the job board, and the `og:site_name` tag is not read.
4. Several JobPostings with none matching the page URL (a list page) are ignored.
5. Any extension with host permission on the Talaan site can read your data with your cookie, and an unpacked copy that reuses our public key gets our ID (docs/AUTH.md, residual risks). Personal API tokens (E3) are the planned fix.
6. A page that cannot be read (`chrome://`, the Web Store, a PDF) gives an empty form.
7. A page whose JSON-LD url path differs from the tab path (slug URLs, ATS embeds) has its JSON-LD ignored, so the company stays blank. We prefer blank over a possibly stale company.
8. OnlineJobs.ph and LinkedIn split-view or search pages give no company. OnlineJobs.ph mode is assumed Remote from the site; a non-remote posting there needs one click. Indeed gives no work mode. Work-mode detection is a heuristic; a wrong guess is one click to fix.
9. Search pages (Indeed's "Job Search", for example) give nothing useful. Open the job's own page.
10. The title cleanup is a heuristic and applies only to the `og:title` and document-title fallback, never to JSON-LD. It drops a last segment that contains part of the site's host name (for example linkedin, indeed or jobs), so a real title such as "Platform Engineer - LinkedIn Ads" on linkedin.com is shortened to "Platform Engineer". Edit the field if that happens.
11. A bare title such as "Remote Engineer" is not detected as remote. The mode word must be a whole segment, in brackets, or a strong phrase.
12. A LinkedIn company that is missing from the document title is left blank, even when the company link is right.
13. A segment that only starts with a mode word ("Remote Customer Support | Acme") is not read.
14. A company whose name starts or ends with punctuation glued to a letter in the title may be left blank by the whole-word check.

## Packaging and distribution

```bash
cd extension && npm run package                  # writes extension/dist/
node extension/scripts/package.js [--out DIR]    # same, from the repo root (any directory with the full path)
```

It needs the system `zip` command. Both zips hold only `manifest.json`, `popup.html`, `popup.css`, `popup.js`, `src/` and `icons/` (hidden files and `~` backups are left out), and `extension/manifest.json` is never modified.

- `talaan-extension-store-<version>.zip` is for the Chrome Web Store upload. Its manifest has no `key`, because the Store assigns its own ID and may reject the field.
- `talaan-extension-friends-<version>.zip` is for friends: unzip it, then use Load unpacked on the folder. It keeps `key`, so the ID stays `fjlnbbkeadlpibmnbpfhlgeingifocni`.
- After the first Store upload, add the Store-assigned ID (`chrome-extension://<id>`) to `EXTENSION_ORIGINS` in Render, alongside the pinned one.
- Bump `"version"` before every Store upload. It must be 1 to 4 dot-separated integers, each 0 to 65535, with no leading zeros and not all zero; put a label such as "beta" in `version_name`.

The build checks the manifest first: `manifest_version` is 3, the version follows Chrome's rules (above), `name` is at most 75 characters and `description` at most 132, there is a 128 icon, every icon and popup file exists, is not a hidden file or `~` backup, and is among the shipped files, `permissions` and `host_permissions` are exactly the ones listed above, and `key` is present. If a check fails, the script prints one line saying which (for example `description must be at most 132 characters`), exits 1 and writes no zip. Zips from an earlier run are left as they were. If copying into `dist/` fails partway (a full disk, for example), it can hold one new zip and one old one; rerun the script.

## Development

```bash
cd extension && npm ci && npm test
```

The local end-to-end script is `node frontend/scripts/e2e-extension.cjs` (environment as for the other e2e scripts). It opens the popup as a tab, so it cannot prove the real toolbar-click `activeTab` grant or the real popup's `Sec-Fetch-Site`. Check those by hand in Chrome.
