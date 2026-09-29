# api/

## Responsibility

Framework-free Node backend for GymTask: session-authenticated per-user state sync, Web Push,
live-workout presence, the daily reminder tick, and the mount point for the AI Coach
(`coach/`). It is the local-dev / no-Firebase fallback the frontend falls back to, and the
reference implementation its HTTP contract is written down in — `openapi.yaml` (3.1, one path
per registered route) is the source of truth for what this folder serves.

- `server.js` (861 lines, ESM) — everything above: storage, auth, push, routes, dispatch.
- `push-messages.js` — payload builders only (`dayReminderPush`, `restTimerPush`, `testPush`).
- `openapi.yaml` — hand-written spec of the HTTP fallback API; `Dockerfile` — two build
  targets; `test/*.test.js` — `npm test` = `node --test test/*.test.js`; `scripts/` — asset
  checks. Sign-in itself is **not** served here (see Design).

## Design

- **Dispatch**: one `routes` object keyed by `'METHOD /path'`
  (`routes[req.method + ' ' + url.pathname]`, server.js:833). 16 local keys —
  `GET /api/health|config|me|data|data/rev|push/public-key|push/status`,
  `POST /api/logout|logout/all|data|push/subscribe|push/unsubscribe|push/test|
  push/rest-timer|push/rest-timer/cancel|activity` — plus `...coachRoutes(...)`, whose
  `/api/admin/*` keys are filtered out at spread time (server.js:793): the admin panel is gone
  and `requireAdmin` is no longer passed. Unknown key → 404; `HttpError` → its status; anything
  else → logged 500. No framework, no router, no middleware stack.
- **Storage** (`DATA_DIR`, default `/data`): `db.json` (users, creds, subs),
  `state-<uid>.json` (the whole app document, uid sanitised to `[A-Za-z0-9_-]`), `secret`
  (32 random bytes, created on boot), `vapid.json`, `audit.log`, `coach.json` +
  `coach/<uid>.json`. Every write goes through `atomicWrite` — write `file.tmp`, `renameSync`
  — so a crash never leaves a half-written document; `saveDb`/state writes carry mode `0600`
  per file rather than a blanket `chmod` on the bind-mounted directory (server.js:30-47).
- **Auth**: HMAC-SHA256 session token `uid:expiryMs:sessionVersion` over the per-instance
  `secret`; accepted as cookie `gymsid` (`__Host-gymsid` when `ORIGIN` is https) or as
  `Authorization: Bearer`. `readSession` (server.js:385) checks signature (`timingSafeEqual`),
  expiry, `user.disabled`, and the `sv` counter bumped by `POST /api/logout/all`. A duplicated
  cookie under one name is refused outright (shadowing). **No route mints a cookie in this
  build** — sign-in is client-side (Firebase email/password, per `openapi.yaml` §Auth), and the
  old login/register/passkey/admin routes are gone; the cookie-minting `sign()` was removed with
them (nothing issues a session cookie in this build — only `clearCookie` on logout).
- **CSRF**: non-GET requests must report `Sec-Fetch-Site: same-origin|none`, else
  `Origin === ORIGIN`, else no Origin at all (not a browser); Bearer-authenticated requests are
  exempt (server.js:423).
- **State sync**: server owns `_rev` (incremented per accepted PUT); `baseRev` mismatch →
  `409 {error, rev, state}` so the client merges; `GET /api/data/rev` is the cheap 30 s poll.
  `PUT` sanitises `workouts`/`routines` to object entries and strips `active` (device-local).
- **Push**: `web-push` + VAPID keys generated into `vapid.json`; outbound endpoints are
  SSRF-checked at DNS-lookup time (`PUSH_AGENT` rejects private/loopback/link-local, IPv4 and
  IPv6), bounded by `PUSH_TIMEOUT_MS`, `PUSH_CONCURRENCY`, `MAX_SUBS_PER_USER = 20`.
- **Env**: `PORT`, `DATA_DIR`, `ORIGIN`, `ALLOW_GUEST`,
  `VAPID_SUBJECT`, `REMINDER_TICK_MS`, `AUDIT_LOG/MAX/DAYS/IP`, `COACH_*` (coach/).
- **Image**: `Dockerfile` — `default` target = no AI runtime (`npm ci --omit=optional`, npm
  removed); `coach` target adds the Claude Agent SDK, Codex CLI + bubblewrap, and the
  unprivileged `coach` user the privilege drop needs. Deps: `undici`, `web-push`, optional
  `@anthropic-ai/claude-agent-sdk`.

## Flow

1. Request → reflect `Origin` (no `Allow-Credentials`) → `OPTIONS` → 204; parse `URL` (bad →
   400) → `routes[key]` (missing → 404) → `csrfOk` (fail → 403, logged not audited) → handler
   inside try/catch → `json()` with `Cache-Control: no-store`.
2. `GET /api/data` → `readSession` (401) → `readState(uid)` → `{state, rev}`.
   `PUT /api/data` → body guards (400) → conditional `baseRev` check (409 + current doc) →
   `_rev = curRev + 1` → `atomicWrite` → `{ok, ts, rev}`.
3. Reminder tick (every `REMINDER_TICK_MS`): for each user with a subscription → mtime-cached
   state read → `reminder.on` + `userNow(tz)` (IANA zone, not server clock) → within the
   15-minute window, once per local date, nothing logged today, a routine planned →
   `saveDb()` (marks `lastReminder`) → `dayReminderPush` → `sendPush`.
4. Boot tail: `coachJobs.recoverOnBoot()` (jobs dead with the process → reported, not hung),
   `setProposalHook` → Web Push when a proposal is `ready`, `startCadence()`, `startWarmup()`.

## Integration

- **Consumers**: `frontend/src/lib/api.js` (`/api/config`, `/api/me`, `/api/data*`, push) when
  `VITE_FIREBASE_*` is absent — the same routes `openapi.yaml` documents; the `mcp/` server
  reads the same `./data` files directly.
- **Coaches**: `coach/routes.js` is spread into the table with server helpers injected
  (`{json, readBody, readSession}`) to avoid an import cycle; `coach/config.js`'s
  `publicConfig()` supplies the `coach` key of `GET /api/config`, absent unless the feature is
  enabled *and* a provider is connected.
- **Siblings**: `functions/` is the deployed, stateless subset (single LLM call, nutrition
  proxy, scheduled FCM) — this folder is the full local server with jobs, storage and auth.
