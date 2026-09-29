# frontend/

## Responsibility

The PWA itself: React 19 + Vite build root for GymTask's browser app. Contains the build config, env contract, PWA assets (`public/`), maintenance scripts (`scripts/`), and `src/` (the application). Deployed as static files (Vercel root `frontend/`, `npm run build` → `dist/`); it talks to `../api` in local dev and to Firebase / Cloud Functions in production.

## Design

**`vite.config.js`** — three plugins beyond `@vitejs/plugin-react`:
- `gytask-umami`: injects an Umami `<script>` in `index.html` only when **both** `VITE_UMAMI_SRC` and `VITE_UMAMI_ID` are set — a plain build stays telemetry-free.
- `gytask-sw-stamp` (`apply: 'build'`): after `closeBundle`, hashes the built `index.html` and replaces `__BUILD__` in `dist/sw.js`, so each deploy's service worker owns its own cache name and drops the old shell on activate.
- `pkgVersion`: `define: { __APP_VERSION__ }` inlined from `package.json` (the version asked for in bug reports; no runtime fetch).

`base: './'` (relative assets — works from any path/subfolder). Dev server: `fs.allow: ['..']` so the Coach core in `../api/coach/core` can be imported, and proxies `/api` → `API_TARGET` (default `http://127.0.0.1:3000`, with `Origin: API_ORIGIN` to satisfy the API's CSRF guard), `/img` and `/gif` → `MEDIA_TARGET` (default `:8888`). `test: { setupFiles: ['./vitest.setup.js'] }` wires vitest into the same config.

**`package.json`** — `"type": "module"`, v1.3.8. Scripts: `dev` = `vite`, `build` = `vite build`, `preview`, `test` = `vitest run`, `test:watch`, `test:fatigue-probe` = `node scripts/fatigue-monotonic-probe.mjs`. Deps: `react`/`react-dom` 19, `react-router-dom` 7, `zustand` 5, `firebase` 12, `jsqr`+`lean-qr` (check-in codes); dev: `vite` 8, `vitest` 4 + `@vitest/coverage-v8`, `happy-dom`, `linkedom`.

**`.env.example`** — the env contract: six `VITE_FIREBASE_*` (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`) enable login + Firestore sync; empty ⇒ builds fine, login shows "configure Firebase", guest mode still works. `VITE_NUTRITION_PROXY_URL` = Cloud Function `nutritionProxy` (external food search); empty ⇒ local ~200-food DB only. Server-side keys (`XAI_API_KEY`, Nutritionix) live in `functions/.env`, never here.

**`public/`** — `manifest.json` (name GymTask, `display: standalone`, portrait, `start_url`/`scope` `./`, dark `#0c0e12`, icons 180 + 512 maskable), `icon-180.png`/`icon-512.png`, and `sw.js` (precache shell, `__BUILD__` placeholder, exercises media cached on first fetch — the app does not redistribute it). Linked from `index.html` with `crossorigin="use-credentials"`.

**`scripts/`** (node, no deps): `check-locales.mjs` — all packs in `src/locales/` must share one key set; `check-source-strings.mjs` — literals passed to `t()` in `src/` that no pack defines (`--strict` exits 1); `bundle-size.mjs` — raw+gzip size of `dist/`, `--compare` for CI deltas; `fatigue-monotonic-probe.mjs` — monotonicity probe over `lib/recovery.js` (npm script); `pt-br-inheritance-fingerprint.mjs` — hash of keys `pt-BR` inherits from `pt`, to detect silent drift.

## Flow

Dev: `npm run dev` → Vite serves `index.html` → `src/main.jsx` → app; API/media calls are proxied to the local `api/` server. Test: `npm test` → vitest picks up `**/*.test.{js,jsx}` under `src/`, DOM via `vitest.setup.js`. Release: `npm run build` → umami injection (if configured) → `dist/` → sw-stamp rewrites `sw.js` → static host serves it; first visit installs the service worker + manifest.

## Integration

- **Out:** `/api/*` (Node `../api/server.js` in dev; Vercel rewrite / same-origin in prod) and `VITE_NUTRITION_PROXY_URL` (Cloud Function) — reached through `src/lib/api.js`; Firestore `users/{uid}/state/app` + Firebase Auth directly from the browser when `VITE_FIREBASE_*` is set.
- **In:** repo root `api/openapi.yaml` documents the fallback HTTP contract the proxy targets; `functions/` provides `coach`/`nutritionProxy`/`pushDailyReminder`; `docs/DEPLOY_VERCEL.md` is the deploy runbook.
- **Sibling:** `resources/` (icon source), `../mcp/` (read-only MCP server over the same data), repo `codemap.md` maps the whole tree.
