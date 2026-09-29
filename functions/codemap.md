# functions/

## Responsibility

Firebase Cloud Functions backend for GymTask — the pieces that must run server-side because
they hold secrets (`XAI_API_KEY`, `NUTRITIONIX_APP_ID/KEY`) or run on a schedule. Single file
`index.js` (CommonJS, its own npm root, firebase-functions v6 + firebase-admin v12, Node 22),
three exports:

- `coach` — HTTPS POST proxy to xAI Grok (`https://api.x.ai/v1/chat/completions`), mirroring
  `api/coach`'s prompt/message shape so the same prompt built by
  `api/coach/core/prompt.js buildPromptParts()` works on either backend.
- `nutritionProxy` — HTTPS POST proxy to Nutritionix pt-BR natural search
  (`/v2/natural/locales/br/search`); the app key never reaches a browser bundle.
- `pushDailyReminder` — scheduled FCM publish to topic `gytask-daily`; no tokens, no Firestore.

`functions/README.md` documents deploy, the env contract, and the client subscription recipe.

## Design

- **Self-contained on purpose**: Cloud Functions packages only `functions/` at deploy time, so
  nothing here may `require('../../api/...')` — and `api/` is ESM anyway (unreadable by
  `require()` on Node 20+). Duplicated facts (the 3-line `SYSTEM_PROMPT`, payload-block
  assembly) are flagged inline as known tech-debt; the canonical prompt library
  (`api/coach/prompts/*.md`) is NOT copied — callers send full task rules as `system`.
- **Shared HTTP helpers** in `index.js:40-86`: `preflight` (CORS `*`, OPTIONS→204),
  `postOnly` (405 otherwise), `bodyOf` (parses string bodies, `null` on junk → 400), `send`
  (JSON + CORS headers), `extractJson` (parse whole reply, else first `{…}` slice → `answer`).
- **`coach` input contract** (`buildMessages`, index.js:100): preferred
  `{ system, prompt }` (canonical split from `buildPromptParts`); fallback
  `{ kind: create|review|debrief|refine, payload }` assembled locally with `FALLBACK_RULES`
  standing in for full task rules. User block capped at 500k chars. Model resolution:
  body `model` → `XAI_MODEL` env → `grok-3-mini`; temperature clamped 0–2, default 0.
  `callGrok` uses `AbortController` at 60s; maps failures to 504 (timeout), 502
  (upstream/unreachable), 400 (missing key). Handler `timeoutSeconds: 300`, region
  `us-central1`.
- **`nutritionProxy`**: reads `query`/`q` (≤200 chars), auth via `x-app-id`/`x-app-key`
  headers from env, 15s timeout, upstream errors → 502/504. Responds with **two** shapes:
  `results` (normalised: `id/name/serving/calories/protein/…`, `normaliseFood` + `round1`)
  and `foods` (raw Nutritionix pass-through kept only because `foodApis.js` still reads the
  raw `nf_*` fields — drop `foods` when that reader moves to `results`).
- **`pushDailyReminder`**: `onSchedule('every day 09:00', America/Sao_Paulo)`. Lazy
  `admin.initializeApp()` (runtime default credentials — no service-account file), cached
  messaging client, `reminderEnabled()` kill switch (`DAILY_REMINDER_ENABLED` unset = on).
  Every failure path logs and swallows: a scheduled function that throws crash-loops on a
  schedule nobody can fix at 09:00.
- **Env contract** (`functions/.env.example`; `.env` deployed / `.env.local` emulator,
  gitignored): `XAI_API_KEY` (required for `coach`), `XAI_MODEL` (default `grok-3-mini`),
  `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (required for `nutritionProxy`),
  `DAILY_REMINDER_ENABLED` (optional). Missing keys produce a 400 naming the variable and
  the fix, never a crash. All read server-side only, never echoed or logged.

## Flow

- `coach`: OPTIONS preflight → POST check → `bodyOf` → env key check → `buildMessages`
  → `callGrok` (Bearer token, `{model, messages, temperature}`) → 200
  `{ ok, model, text, answer }` where `text` is raw model output and `answer` the
  best-effort parsed JSON (null when the model wrapped/fenced it unrecoverably).
- `nutritionProxy`: same guards → query/env checks → GET Nutritionix with auth headers →
  `data.foods.map(normaliseFood).filter(Boolean)` → 200
  `{ ok, query, locale: 'br', source: 'nutritionix', count, results, foods }`.
- `pushDailyReminder`: kill-switch check → messaging init (null → already logged, return) →
  single `messaging.send({ topic: 'gytask-daily', notification, webpush.fcmOptions.link: '/' })`
  → log messageId / log-and-swallow failure.

## Integration

- **`frontend/src/lib/foodApis.js`** → `nutritionProxy`: `searchNutritionix()` POSTs
  `{ query }` to `import.meta.env.VITE_NUTRITION_PROXY_URL`
  (`https://us-central1-<proj>.cloudfunctions.net/nutritionProxy`); unset → source silently
  skipped. It reads `data.foods` raw fields for its own per-100 g conversion — the reason
  index.js echoes `foods`. Runs parallel to USDA/OFF in `searchExternal`, failing soft.
- **Coach UI**: `lib/coach-api.js` calls `/api/coach/*` through `lib/api.js`'s `api()` —
  i.e. the **legacy `api/server.js` fallback** (or demo/BYOK-local modes), not the function
  URL. The `coach` function is the deployed Firebase equivalent with the identical
  `{system, prompt}` contract (GYMTASK.md §Coach), reachable directly at
  `https://us-central1-<proj>.cloudfunctions.net/coach`.
- **`firebase.json`** wires it: `functions: [{ source: "functions", runtime: "nodejs22" }]`
  + `firestore.rules`; no `hosting` block (frontend ships on Vercel). Deploy:
  `firebase deploy --only functions` — deploying *is* the opt-in for each function.
- **Contrast with `api/server.js`**: that legacy server is ESM, framework-less HTTP with the
  full coach job/proposal workflow (jobs, cadence, warmup, persistence) plus `/api/data`
  state endpoints for local dev; `functions/` is the stateless, deployable subset —
  single-shot LLM call, one food search, one scheduled push — no jobs, no storage, no auth.
