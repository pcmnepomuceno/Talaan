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
