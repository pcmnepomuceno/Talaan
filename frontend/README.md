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

`/` redirects to `/applications`. `/login` (not wired), `/applications` (`?status=` filter), `/applications/[id]`, `/account`, plus placeholders at `/applications/new` and `/applications/[id]/edit`. All data comes from the in-memory mock in `src/lib/api.ts` (resets on reload). From 1280 the list and detail show side by side. `/design` is the component gallery.

## Components (`src/components/`)

| Component | Notes |
|---|---|
| `Icon` | Material Symbols Outlined as inline SVG, 24 or 20px, decorative |
| `Button` | `primary`, `secondary`, `ghost`, `destructive`; `href` renders a `next/link` |
| `TextField`, `PasswordField`, `Textarea`, `Select` | `fields.tsx`; label, `required`, `helper`, `error`; `prefix`/`suffix` on TextField; forward `ref` and native props |
| `SegmentedControl` | Native radios in a fieldset (arrow keys from the browser) |
| `StatusStamp` | Any status or outcome; `STATUSES`/`OUTCOMES` match the API enums |
| `FilterTabs` | "All" plus each status, `aria-pressed` buttons, scrolls sideways |
| `Banner` | Inline error banner, `role="alert"` |
| `LedgerSheet`, `ApplicationRow`, `InterviewRow`, `DetailRows`, `LedgerSkeleton` | `ledger.tsx`; rows are whole-row links (`href`) or buttons (`onSelect`), `selected` sets `aria-current` |
| `Dialog`, `DeleteConfirm` | `dialog.tsx`; native `<dialog>`: bottom sheet under 768px, centered from 768px; Escape or Cancel only |
| `ToastProvider`, `useToast()` | `success(msg)` auto-dismisses after 4s (paused on hover or focus), `error(msg)` stays; max 3 |
| `AppBar`, `BarAction`, `MainNav` | App shell: ink top bar (hidden from 1280), bottom nav / rail / side nav |
| `EmptyState` | Title, one sentence, optional action button |

All of them are on `/design` in every state, in a light and a dark panel.

- Touch targets are at least 44 x 44. Where DESIGN.md draws a 36px element (segments, filter tabs), the visual sits inside a 44px hit area and carries the focus ring.
- Fields show focus as a 2px primary ring over the border; everything else uses the global ring in `globals.css` (`@layer base`, so utilities can override it).
- Adding an icon: download `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg` and paste the path `d` into `icon.tsx`.
- Component tests use React Testing Library and user-event; put `// @vitest-environment jsdom` at the top of the file.

- Formatters (`src/lib/format.ts`) always use Asia/Manila and return `null` for missing or invalid input; callers omit the field. `types.ts` uses the API's field names, not DESIGN.md wording.
- jsdom has no `<dialog>` methods; `tests/setup.ts` stubs `showModal`/`close`/Escape only. Focus trap and inert background are checked in a real browser on `/design`.
