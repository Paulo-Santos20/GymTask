# Repository Atlas: GymTask

## Project Responsibility
Personal gym, body-weight and nutrition tracker PWA with an AI Coach (Grok/xAI). pt-BR-only
interface, AGPL-3.0-or-later, derived from openGym (licence kept). Static frontend on Vercel;
auth, data and serverless functions on Firebase. Spec of record: `GYMTASK.md` (architecture,
Firebase contract, Coach, Nutrition, pending work). Contributor rules: `CLAUDE.md` +
`CONTRIBUTING.md`.

## System Entry Points
- `frontend/src/main.jsx` (or `index.jsx`) — React 19 + Vite bootstrap; `App.jsx` defines the
  HashRouter route table.
- `api/server.js` — framework-less Node `node:http` server; routes in a `routes` object keyed
  by `'METHOD /path'`. Local dev + HTTP fallback only (passkey/admin routes removed).
- `functions/index.js` — Firebase Cloud Functions (CJS): `coach`, `nutritionProxy`,
  `pushDailyReminder`.
- `mcp/src/` — optional read-only stdio MCP bridge for LLM clients.
- `firebase.json` / `firestore.rules` / `vercel.json` / `.github/workflows/test.yml` — deploy
  and CI wiring (CI runs frontend/api/mcp tests on Node 22).

## Root Files
| File | Role |
|---|---|
| `GYMTASK.md` | Authoritative project spec (read before auth/state/coach/nutrition changes) |
| `CLAUDE.md` | Architecture guide + conventions for coding agents |
| `CONTRIBUTING.md` | Dependency-light hard constraint; pure helpers + unit tests in `src/lib` |
| `PROJECT_CONTEXT.md` | Notes on the drop-set / rest-pause feature (set-row `type` axis) |
| `ROADMAP.md`, `CHANGELOG.md` | Planned work, release history |
| `.env.example` | Root env sample (server-side keys) |

## Data & Control Flow (system-wide)
1. Browser → Vercel static bundle (React) → Firebase Auth (e-mail/password) in the client.
2. State: Zustand store (`store/useStore.js`, `store/nutritionStore.js`) → `lib/api.js`
   interceptor → Firestore doc `users/{uid}/state/app` (with `_rev` / 409-on-stale) when
   Firebase is configured and a user is signed in; otherwise localStorage (`gym_state_v1`,
   `gym_nutrition_v1`) + HTTP `GET/PUT /api/data` against `api/server.js`.
3. Coach: view → Cloud Function `functions/coach` (or local `api/coach` / phone BYOK
   `lib/coach-local.js`) → provider row (`grok` → `https://api.x.ai`, `groq` →
   `https://api.groq.com/openai`) → adapter → upstream; `XAI_API_KEY` stays server-side.
4. Nutrition search: `lib/foodApis.js` → USDA/Open Food Facts directly, Nutritionix via
   `nutritionProxy` (`VITE_NUTRITION_PROXY_URL`).
5. Training logic is pure: everything that decides what you lift next or reads a session back
   lives in `frontend/src/lib/` with a co-located `*.test.js` (vitest).

## Directory Map (Aggregated)
| Directory | Responsibility Summary | Detailed Map |
|---|---|---|
| `frontend/` | React 19 + Vite app shell: config, PWA manifest, scripts. Static build → Vercel. | [Map](frontend/codemap.md) |
| `frontend/scripts/` | Build/data helper scripts invoked from package.json/CI. | [Map](frontend/scripts/codemap.md) |
| `frontend/src/` | App entry + `App.jsx` HashRouter route table, global styles. | [Map](frontend/src/codemap.md) |
| `frontend/src/views/` | One file per screen (Home, Workout, Nutrition, Stats, Settings, Login…). | [Map](frontend/src/views/codemap.md) |
| `frontend/src/components/` | Shared UI (sheets/ExConfig, steppers, charts, muscle map, demos). | [Map](frontend/src/components/codemap.md) |
| `frontend/src/store/` | Zustand stores: `useStore` (app blob), `nutritionStore` (meal log), `useUI`. | [Map](frontend/src/store/codemap.md) |
| `frontend/src/lib/` | Pure framework-free logic + co-located vitest tests: progression, 1RM, workout-model, TDEE, foods, api interceptor, coach-local. | [Map](frontend/src/lib/codemap.md) |
| `frontend/src/locales/` | i18n: `pt.js` base + `pt-BR.js` overrides (pt-BR-only product). | [Map](frontend/src/locales/codemap.md) |
| `frontend/src/instr/` | Per-language exercise instruction text. | [Map](frontend/src/instr/codemap.md) |
| `frontend/src/exercise-names/` | Exercise-name datasets feeding the 1,324-exercise library. | [Map](frontend/src/exercise-names/codemap.md) |
| `api/` | Framework-less Node HTTP server: session auth, atomic JSON state, Web Push; openapi.yaml. Legacy/dev fallback path. | [Map](api/codemap.md) |
| `api/coach/` | Coach package root: prompts, core, adapters. | [Map](api/coach/codemap.md) |
| `api/coach/core/` | Provider table + orchestrator (rows incl. `grok` → api.x.ai, `groq` → api.groq.com/openai). | [Map](api/coach/core/codemap.md) |
| `api/coach/core/adapters/` | Provider adapters incl. `groq.js`, `grok.js`. | [Map](api/coach/core/adapters/codemap.md) |
| `api/coach/adapters/` | Coach adapters (see map for live-vs-legacy status). | [Map](api/coach/adapters/codemap.md) |
| `functions/` | Firebase Cloud Functions (CJS): `coach`, `nutritionProxy`, `pushDailyReminder`. | [Map](functions/codemap.md) |
| `mcp/` | MCP server manifest/tests; read-only, local, stdio. | [Map](mcp/codemap.md) |
| `mcp/src/` | MCP tools exposing workouts/1RM/muscle balance; reuses `frontend/src/lib` helpers, `OPENGYM_*` env names. | [Map](mcp/src/codemap.md) |
| `website/` | Static marketing site (plain HTML/CSS/JS), not part of the app build. | [Map](website/codemap.md) |

Unmapped on purpose (tests, docs, data): `docs/`, `scripts/`, `web/` + `docker-compose.yml`
(legacy upstream self-host path), `.github/`, `assets/`, `media/` (gitignored, fetched at
runtime).
