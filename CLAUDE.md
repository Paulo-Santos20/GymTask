# CLAUDE.md

This file provides guidance to coding agents working with code in this repository.

## What this is

GymTask is a personal gym & body-weight tracker PWA with a Nutrition module and an AI
Coach (Grok/xAI). Frontend is a static build deployed on **Vercel**; auth, data and
serverless functions live on **Firebase**. Interface is **pt-BR only**. License:
AGPL-3.0-or-later. Derived from openGym (https://github.com/DuarteSantos8/openGym),
licence kept.

**Project spec: [`GYMTASK.md`](GYMTASK.md)** — it is authoritative for architecture,
the Firebase contract, Coach/Grok, Nutrition and what is still pending. Read it before
changing auth, state sync, Coach or Nutrition code.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). Static build → Vercel.
           PWA-only: no native shells, install via Add to Home Screen.
api/       backend — server.js (Node, no framework), dep: web-push. Passkey code removed.
           coach/ holds the Coach core: prompts, providers, adapters (incl. grok.js).
functions/ Firebase Cloud Functions (CJS): coach, nutritionProxy, pushDailyReminder.
mcp/       optional MCP server — read-only stdio bridge exposing a user's workouts/1RM/muscle
           balance to LLM clients (Claude Desktop, Cursor…). Env identifiers stay OPENGYM_*
           by decision; only runs when an LLM client spawns it.
media/     exercise img/gif, gitignored, fetched at runtime.
website/   static marketing site (plain HTML/CSS/JS).
docs/      DEPLOY_VERCEL.md (primary deploy doc), API.md, AI_COACH.md, …
web/ + docker-compose.yml  legacy Docker stack (upstream self-host path), not the deploy target.
```

## Commands

```bash
# Frontend dev server (hot reload). No Firebase env → local mode (localStorage + HTTP fallback)
cd frontend && npm install && npm run dev

# Frontend tests (training + nutrition logic: progression, 1RM, session read-back, TDEE, foods)
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/progression.test.js   # single file
npx vitest run -t "some test name"           # single test by name

# MCP server tests
cd mcp && npm test

# Production build (what Vercel runs with root frontend/)
cd frontend && npm run build
```

There is no linter/formatter configured (no ESLint/Prettier config in the repo) and no
TypeScript — match the existing style by hand.

CI is `.github/workflows/test.yml` on GitHub (repo: Paulo-Santos20/GymTask): runs the
frontend/api/mcp tests on Node 22. The GitLab/Gitea CI files and the mirror + docker-publish
workflows were deleted.

## Architecture

### Auth — Firebase e-mail/senha (passkeys removed)

- `frontend/src/lib/firebase.js` — the only place that initialises Firebase. Exports
  `firebaseConfigured`, `app`, `auth`, `db` (`null`/`false` when no `VITE_FIREBASE_*` env).
  Every other module imports from here, never calls `initializeApp` directly. Firestore uses
  `persistentLocalCache`.
- `frontend/src/views/Login.jsx` — e-mail/senha via Firebase; `auth/*` errors mapped to pt-BR;
  "Esqueci minha senha" via `sendPasswordResetEmail`. Without Firebase configured it shows a
  clear "configure Firebase" notice and the app stays in guest/local mode.
- No `RP_ID`/`RP_NAME` env vars, no `@simplewebauthn` dependency, no WebAuthn routes in
  `api/server.js`, no admin/invite system. Docs must never tell the reader to sign in with a
  passkey.

### State path — localStorage + HTTP fallback, or Firestore

- `store/useStore.js` — single Zustand store for the app state. `store/nutritionStore.js` —
  meal log per date, persisted as `gym_nutrition_v1`. `store/useUI.js` — ephemeral UI state.
- `lib/api.js` intercepts the state calls (`GET/PUT /api/data`, `/api/data/rev`): with Firebase
  configured **and** a signed-in user it reads/writes the Firestore doc
  `users/{uid}/state/app` directly (blob keys as document fields + server-owned `_rev`;
  409-on-stale-`baseRev` semantics mirrored from the server); otherwise it falls back to the
  original HTTP/localStorage path, so the app fully works with zero Firebase config.

### Nutrition module (new in this fork)

- `lib/tdee.js` — BMR (Mifflin-St Jeor), TDEE, calorie target, macros (+ `tdee.test.js`).
- `lib/foods.js` — ~200-entry BR food database, accent-insensitive search (+ `foods.test.js`).
- `lib/foodApis.js` — USDA (DEMO_KEY) / Open Food Facts / Nutritionix (via
  `VITE_NUTRITION_PROXY_URL`, skipped without env).
- `views/Nutrition.jsx` (+ `src/nutrition.css` — imported as `../nutrition.css`) — date navigation, calorie/macro summary, undo,
  add-food (local + external search), portion picker, TDEE form; route `/nutrition` wired in
  `App.jsx`.
- i18n: only `locales/pt.js` (base) + `locales/pt-BR.js` (overrides) remain.

### Coach + Grok, Cloud Functions

- Providers in `api/coach/core/providers.js` (row `grok` → `https://api.x.ai`,
  default model `grok-3-mini`); adapter in `api/coach/core/adapters/grok.js`. Key lives
  server-side only (`XAI_API_KEY` env), never in the bundle.
- `functions/index.js` exports **`coach`** (`POST …/coach`, body `{system, prompt}` or
  `{kind, payload}`, answers `{ok, model, text, answer}`), **`nutritionProxy`**
  (`POST …/nutritionProxy`, body `{query}` → Nutritionix, read via `VITE_NUTRITION_PROXY_URL`),
  **`pushDailyReminder`** (scheduled FCM to topic `gytask-daily`). See `functions/README.md`
  for the client contract. Note: `api/openapi.yaml` documents the HTTP fallback API only —
  the coach surface is not in that spec.
- Phone BYOK path: `frontend/src/lib/coach-local.js` (`ADAPTERS` includes grok).

### Frontend lib conventions

- `lib/` holds pure, framework-free helpers, each paired with a same-directory `*.test.js`:
  `progression.js` (linear, Greyskull LP, double progression, time-based), `onerm.js`,
  `finish-workout.js`, `recovery.js`/`recovery-view.js`, `workout-model.js`,
  `supersetFlow.js`, `exercises.js`/`exercises-data.js` (1,324 built-ins + user-defined),
  plus the Nutrition helpers above. CONTRIBUTING.md is explicit: **anything that decides
  what you lift next, or reads a logged session back, is a pure helper here with a unit
  test beside it.**
- `views/` — one file per screen, routed by `react-router-dom` (HashRouter) from `App.jsx`.
- `components/` — shared UI. `src/instr/` holds per-language exercise instruction text.

### API (`api/server.js`)

Single file, no framework, plain `node:http`. Routes dispatched through a `routes` object
keyed by `'METHOD /path'`. State is flat JSON under `DATA_DIR` (`db.json`,
`state-<uid>.json`), written with write-temp-then-rename (`atomicWrite`). Auth is a signed
session cookie plus Web Push (`web-push`, VAPID keys in `data/vapid.json`). The passkey
endpoints and the `/api/admin/*` handlers are gone.

### Deploy

Primary path is **Vercel (static frontend) + Firebase (auth/db/functions)** — see
[`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) and `GYMTASK.md` §3 for the env contract
(`VITE_FIREBASE_*`, `VITE_NUTRITION_PROXY_URL`, `XAI_API_KEY`, `NUTRITIONIX_*`). The
`docker-compose.yml` / `web/` stack is legacy from upstream, not the deploy target.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint, not a preference.** Frontend: React + Router + Zustand
  and nothing else. New dependencies are a hard sell either side.
- Don't commit `media/` or `data/` (gitignored).
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code, not just manual clicking-through.
