# Talaan frontend

Next.js (App Router, TypeScript, Tailwind v4). Look and feel: `../docs/DESIGN.md`.

```
npm ci
npm run dev        # http://localhost:3000, design system at /design
npm run lint && npm run typecheck && npm test && npm run build
```

- All colors live in `src/styles/tokens.css`; no hex anywhere else in `src/` (tested).
- Theme is `light-dark()` plus `color-scheme`: "system" by default, override stored in `localStorage`.
- IBM Plex Sans via `next/font`; sentence case; no component library.
- Contrast tests (`tests/contrast.test.ts`) fail if a token pair drops below the DESIGN.md ratio.

## Routes

`/` redirects to `/applications`. `/login` (log in and create account; `?expired=1`, `?deleted=1`, `?next=`), `/applications` (`?status=` filter, 50 rows per page with Load more), `/applications/[id]`, `/applications/new`, `/applications/[id]/edit` (one shared form), `/account` (real user, theme, log out, delete account). From 1280 the list and detail show side by side. Interviews are added, edited and deleted from the detail: `/applications/[id]/interviews/new` and `.../[interviewId]/edit` (times are Philippine time only). `/design` is the component gallery.

## Applications and the API

- `src/lib/api.ts` is the client (applications and interviews: list, read, create, edit, delete); `src/lib/pht.ts` converts interview times to and from Philippine time; `src/lib/mappers.ts` owns the JSON shapes; `src/lib/cache.ts` holds the in-memory list and detail caches (never web storage), cleared by every write and by login, logout and account deletion.
- The API pages at most 100 rows per request and filters by `status`, so each status tab is its own request (`limit=50`) plus a "Load more" button. A cached tab shows while page 1 refetches.
- The form (`src/components/application-form.tsx`, rules in `src/lib/application-form.ts`) mirrors the backend limits. Leaving a dirty form asks "Discard changes?"; the browser Back button and the side/bottom nav links are not intercepted (reload and tab close get the browser's own prompt).
- Local end-to-end check on the real backend (not in CI, no dependency): `NODE_PATH=<dir containing playwright> node scripts/e2e-applications.cjs`; `seed-applications.cjs` seeds sample data and keeps the stack up for manual looking; `screens-applications.cjs` writes the screenshots to `.screenshots/`. All three use `scripts/local-env.cjs`, which starts the API on the `_test` database and `next dev` on free ports, then stops them, truncates the test database and prints that the dev database and any foreign :8000 process were untouched.

## Auth and the API

The browser only calls `/api/...` on the Next origin; `next.config.ts` rewrites it to `BACKEND_URL` (see `.env.example`; default `http://localhost:8000`, set it in Vercel at deploy, it is read at build time). The session cookie is HttpOnly and first-party, so there is no CORS and nothing auth-related is stored in `localStorage`.

- `src/lib/http.ts`: `request()`, `ApiError`, `errorMessage()`, `safeNext()`. A 401 goes to `/login?expired=1&next=...` unless `redirectOn401: false`.
- `src/lib/auth.ts`: `login`, `signup`, `logout`, `getMe`, `deleteAccount`.
- `src/proxy.ts`: private paths need a `session_token` or `__Host-session_token` cookie (presence only), else `/login?next=...`. Never redirects `/login` or `/api`.
- Local API: `COOKIE_SECURE=false` in the API's `.env` (plain http), `ALLOWED_ORIGINS` default `http://localhost:3000`, and raised `LOGIN_*`/`SIGNUP_*` limits (all browsers share one IP behind the rewrite). Invite: `python -m app.admin create-invite` in the repo root.
- `scripts/e2e-auth.cjs` and `scripts/screens-auth.cjs` (not in CI, no dependency): run by hand with Playwright on `NODE_PATH`, the API on the `_test` database; the file headers list the steps.

## Components (`src/components/`)

| Component | Notes |
|---|---|
| `Icon` | Material Symbols Outlined as inline SVG, 24 or 20px, decorative |
| `Button` | `primary`, `secondary`, `ghost`, `destructive`; `href` renders a `next/link` |
| `TextField`, `PasswordField`, `Textarea`, `Select` | `fields.tsx`; label, `required`, `helper`, `error`; `prefix`/`suffix` on TextField; forward `ref` and native props |
| `SegmentedControl` | Native radios in a fieldset (arrow keys from the browser); `value={null}` = nothing chosen, `required`/`error` make it a radiogroup |
| `StatusStamp` | Any status or outcome; `STATUSES`/`OUTCOMES` match the API enums |
| `FilterTabs` | "All" plus each status, `aria-pressed` buttons, scrolls sideways |
| `Banner` | Inline error banner, `role="alert"` |
| `LedgerSheet`, `ApplicationRow`, `InterviewRow`, `DetailRows`, `LedgerSkeleton` | `ledger.tsx`; rows are whole-row links (`href`) or buttons (`onSelect`), `selected` sets `aria-current` |
| `Dialog`, `DeleteConfirm` | `dialog.tsx`; native `<dialog>`: bottom sheet under 768px, centered from 768px; Escape or Cancel only |
| `ToastProvider`, `useToast()` | `success(msg)` auto-dismisses after 4s (paused on hover or focus), `error(msg)` stays; max 3 |
| `AppBar`, `BarAction`, `MainNav` | App shell: ink top bar (hidden from 1280), bottom nav / rail / side nav |
| `EmptyState`, `NotFoundState` | Title, one sentence, optional action button; the not-found view for an unknown application |
| `ApplicationForm` | Shared create/edit form with inline errors, dirty guard and Saving… state |

All of them are on `/design` in every state, in a light and a dark panel.

- Touch targets are at least 44 x 44. Where DESIGN.md draws a 36px element (segments, filter tabs), the visual sits inside a 44px hit area and carries the focus ring.
- Fields show focus as a 2px primary ring over the border; everything else uses the global ring in `globals.css` (`@layer base`, so utilities can override it).
- Adding an icon: download `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg` and paste the path `d` into `icon.tsx`.
- Component tests use React Testing Library and user-event; put `// @vitest-environment jsdom` at the top of the file.

- Formatters (`src/lib/format.ts`) always use Asia/Manila and return `null` for missing or invalid input; callers omit the field. `types.ts` uses the API's field names, not DESIGN.md wording.
- jsdom has no `<dialog>` methods; `tests/setup.ts` stubs `showModal`/`close`/Escape only. Focus trap and inert background are checked in a real browser on `/design`.
