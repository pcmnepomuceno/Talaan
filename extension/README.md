# Talaan Chrome extension

## What it does

Click the toolbar icon on a job posting. A small popup opens with the company, job title and posting link already filled in. Edit them, choose a work mode, and press Save. The application is created through your existing Talaan session.

## What it reads and when

It reads only the active tab, and only after you click the icon, through `activeTab` and `scripting`. It reads the page URL and title, the `og:title` tag, and the text of JSON-LD script tags. On Indeed and LinkedIn job pages it also reads the text of the company link and, on LinkedIn, the work-mode label; nothing else. It only reads and never writes to the page. Page reading gives up after 4 seconds, so a stuck tab leaves an empty form.

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

The `key` in `manifest.json` is the public key. It is committed because it fixes the ID. The matching private key was generated outside the repository, is never committed, and is needed only to pack a release. Never add a `*.pem` file.

## Privacy

- It reads only the active tab, after a click.
- It sends nothing until you press Save, except the sign-in check and the duplicate check above.
- No analytics.
- No storage: no `chrome.storage`, `localStorage` or cookies of its own.
- No third-party requests and no remote code.

## Tested sites (2026-11-22)

Checked by hand in Chrome on real postings, before the site hints below.

| Site | What the page exposes | Company | Work mode |
| --- | --- | --- | --- |
| JobStreet | JSON-LD with the title and `hiringOrganization` | JSON-LD | Remote when the JSON-LD says TELECOMMUTE (not measured) |
| BossJob | JSON-LD with the title and `hiringOrganization` | JSON-LD | Remote when the JSON-LD says TELECOMMUTE (not measured) |
| Indeed `/viewjob` | No JSON-LD; `og:title` is the page title with the location and the site name | From the company link | None |
| LinkedIn `/jobs/view` (signed in) | No JSON-LD; the document title, a company link and a work-mode label | From the company link | From the label |
| OnlineJobs.ph | No JSON-LD; only the document title, with pay details and the site name | Blank | From the title ("Remote") |

## Site hints

Indeed (`/viewjob`) and LinkedIn (`/jobs/view/`) pages have no structured data, so `src/collect.js` keeps a small `SITE_HINTS` table matched on the URL host and path only (never class names): the first link to `/cmp/...` (Indeed) or `/company/...` (LinkedIn) with real text gives the company, and on LinkedIn a leaf element reading exactly Remote, Hybrid or On-site gives the work mode. Anything else stays blank.

Work mode is chosen from the first signal that exists: JSON-LD `jobLocationType` TELECOMMUTE, then the LinkedIn label, then a whole-word match in the title (remote, work from home, WFH, hybrid, on-site). Two different modes in the titles, or none, give blank. The popup says where the value came from and one click changes it.

To refresh a hint when a site changes: open the job page, find the company link or mode label, update the path regex or words in `SITE_HINTS`, add a fixture test in `tests/collect.test.js`, and update the table above.

## Known limits

1. The stale JSON-LD check compares the URL path only, not the query. A site that keeps the posting id only in the query is not caught.
2. On LinkedIn's split-view search pages (`/jobs/search/?currentJobId=...`) the posting's JSON-LD is dropped. The title is still filled, but the saved link is the search-results URL, not the job's. Open the job's own page for best results.
3. The company is never guessed from the title. It comes from a JobPosting's `hiringOrganization` or, on Indeed and LinkedIn job pages, the company link (site hints). The page title names the job board, and the `og:site_name` tag is not read.
4. Several JobPostings with none matching the page URL (a list page) are ignored.
5. Any extension with host permission on the Talaan site can read your data with your cookie, and an unpacked copy that reuses our public key gets our ID (docs/AUTH.md, residual risks). Personal API tokens (E3) are the planned fix.
6. A page that cannot be read (`chrome://`, the Web Store, a PDF) gives an empty form.
7. A page whose JSON-LD url path differs from the tab path (slug URLs, ATS embeds) has its JSON-LD ignored, so the company stays blank. We prefer blank over a possibly stale company.
8. OnlineJobs.ph and LinkedIn split-view or search pages give no company. Indeed gives no work mode. Work-mode detection is a heuristic; a wrong guess is one click to fix.
9. Search pages (Indeed's "Job Search", for example) give nothing useful. Open the job's own page.
10. The title cleanup is a heuristic and applies only to the `og:title` and document-title fallback, never to JSON-LD. It drops a last segment that contains part of the site's host name (for example linkedin, indeed or jobs), so a real title such as "Platform Engineer - LinkedIn Ads" on linkedin.com is shortened to "Platform Engineer". Edit the field if that happens.

## Development

```bash
cd extension && npm ci && npm test
```

The local end-to-end script is `node frontend/scripts/e2e-extension.cjs` (environment as for the other e2e scripts). It opens the popup as a tab, so it cannot prove the real toolbar-click `activeTab` grant or the real popup's `Sec-Fetch-Site`. Check those by hand in Chrome.
