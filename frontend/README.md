# SAMA-NMC web app

Next.js (App Router, static export) + TypeScript + Tailwind. The decision engine in `src/engine/` runs in the
visitor's browser (Web Worker); there is no backend. See the [root README](../README.md) for the whole project.

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | dev server on http://localhost:3000 |
| `npm run build` | static site in `out/` (what Vercel serves) |
| `node scripts/serve-static.mjs out 3000` | serve the build locally with the production security headers |
| `npx vitest run` | engine parity with the Python reference + unit tests |
| `npx playwright test` | end-to-end tests in installed Google Chrome |
| `npx tsc --noEmit` | type check |

Layout: `src/app/` pages · `src/components/` design system · `src/engine/` browser engine (do not change semantics
without changing the Python reference and fixtures) · `src/state/` run store · `src/lib/` view helpers ·
`public/engine/` frozen engine artifacts · `public/sample/` sample data and CSV template · `e2e/` Playwright tests ·
`vercel.json` security headers.
