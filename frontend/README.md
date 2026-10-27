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

All of them are on `/design` in every state, in a light and a dark panel.

- Touch targets are at least 44 x 44. Where DESIGN.md draws a 36px element (segments, filter tabs), the visual sits inside a 44px hit area and carries the focus ring.
- Fields show focus as a 2px primary ring over the border; everything else uses the global ring in `globals.css` (`@layer base`, so utilities can override it).
- Adding an icon: download `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg` and paste the path `d` into `icon.tsx`.
- Component tests use React Testing Library and user-event; put `// @vitest-environment jsdom` at the top of the file.
