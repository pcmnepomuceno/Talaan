# Talaan Chrome extension

## What it does

Click the toolbar icon on a job posting. A small popup opens with the company, job title and posting link already filled in. Edit them, choose a work mode, and press Save. The application is created through your existing Talaan session.

## What it reads and when

It reads only the active tab, and only after you click the icon, through `activeTab` and `scripting`. It reads the page URL and title, the `og:title`, `og:site_name`, `og:url` and canonical link tags, and the text of JSON-LD script tags. It only reads and never writes to the page. Page reading gives up after 4 seconds, so a stuck tab leaves an empty form.

Nothing is sent anywhere until you press Save, with two exceptions that happen when the popup opens:

- The sign-in check, `GET /api/v1/me`.
- The duplicate check, `POST /api/v1/applications/lookup`, which sends the posting URL so Talaan can tell you if you already saved it.

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
- It sends nothing until you press Save, except the two checks above when the popup opens and you are signed in.
- No analytics.
- No storage: no `chrome.storage`, `localStorage` or cookies of its own.
- No third-party requests and no remote code.

## Known limits

1. The stale JSON-LD check compares the URL path only, not the query. A site that keeps the posting id only in the query is not caught.
2. On LinkedIn's split-view search pages (`/jobs/search/?currentJobId=...`) the posting's JSON-LD is dropped. Open the job's own page for best results.
3. The company is never guessed. It is filled only from a JobPosting's `hiringOrganization`, because the page title and `og:site_name` name the job board.
4. Several JobPostings with none matching the page URL (a list page) are ignored.
5. Any extension with host permission on the Talaan site can read your data with your cookie, and an unpacked copy that reuses our public key gets our ID (docs/AUTH.md, residual risks). Personal API tokens (E3) are the planned fix.
6. A page that cannot be read (`chrome://`, the Web Store, a PDF) gives an empty form.

## Development

```bash
cd extension && npm ci && npm test
```

The local end-to-end script is `node frontend/scripts/e2e-extension.cjs` (environment as for the other e2e scripts). It opens the popup as a tab, so it cannot prove the real toolbar-click `activeTab` grant or the real popup's `Sec-Fetch-Site`. Check those by hand in Chrome.
