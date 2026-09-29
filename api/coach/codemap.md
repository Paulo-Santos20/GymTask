# api/coach/

## Responsibility

The AI Coach server side: HTTP surface, instance configuration, the in-process job queue that
runs one provider call per job, and everything that schedules or gates it (caps, consent,
warmup, cohort medians). Stateless logic lives in `core/` (importable by the phone too), the
provider processes in `adapters/`; this directory is the server-only orchestration around both.

- `routes.js` — route table factory (`GET/POST /api/coach/*`); `jobs.js` — queue, caps,
  per-profile records, proposal storage; `config.js` — `coach.json` store + `PROVIDERS` table;
- `cadence.js` (scheduled reviews) · `warmup.js` (local-model prefix cache) · `cohort.js`
  ("compare with others" medians) · `handle.js` (uid → HMAC pseudonym) · `node-fetch.js`
  (fetch with a job-length timeout) · `fixture-cli.mjs` (fake provider for CI/demo) ·
- `prompts/*.md` — the editable prompt sources (`common`, `create`, `review`, `debrief`,
  `refine`, `repair`), compiled into `core/prompts.js` by `scripts/build-coach-assets.mjs`.

## Design

- **Provider table** (`config.js:50`): `PROVIDERS = { fixture, claude, codex, ...HTTP_PROVIDERS }`
  — the three runtime-backed rows (label, `runtime`, `apiKeyEnv`/`oauthEnv`) plus the plain-HTTPS
  rows spread in from `core/providers.js`, so the server table and the phone's picker can never
  offer different endpoints. Row `grok` → `defaultBase: https://api.x.ai`,
  `defaultModel: grok-3-mini`, key in `XAI_API_KEY` (server-side only; a stored credential beats
  the env var, an explicit model pick beats `XAI_MODEL`). Adding a provider = one adapter file +
  one row; nothing else branches on provider identity.
- **Config**: `DATA_DIR/coach.json`, defaults `{enabled:false, provider:'fixture',
  authMode:'instance', caps:{perProfileDaily:10, instanceDaily:0}, community:false}`. Credentials
  are AES-256-GCM blobs keyed by HKDF(`secret`), stored per provider so switching never drops a
  key; `authMode:'instance'` binds a *personal* credential (setup token/OAuth) to the first
  profile that spends it and refuses the rest. `COACH_DISABLED` is the env kill switch;
  `CREDENTIAL_HOME=/coach-auth` sits outside `data/` so `tar czf … data/` backups never capture
  a live refresh token. `jobEnv()` builds the child environment from an allowlist.
- **Routes as a factory** (`routes.js:29`): `coachRoutes({json, readBody, readSession})` takes
  the server's helpers instead of importing them (no cycle, fake-able in tests). Every user
  route starts at `guard()` = session → `isEnabled()` → `isConnected()`. `CoachError` codes map
  to HTTP via `HTTP_FOR`: off 503, busy 409, cap 429, consent 403, shared 409, unprivileged 503;
  raw provider detail never reaches the user — it lands in the instance job log only.
- **Jobs** (`jobs.js`): a plain array queue, `MAX_CONCURRENT = 2`, single-flight per uid
  (`inflight`), `TIMEOUT_MS = max(60s, COACH_JOB_TIMEOUT_MS or 5 min)`. Caps are counted at
  *enqueue* (spending bounds the queue, not the completion). The proposal lives server-side in
  `DATA_DIR/coach/<uid>.json` (`current`, `pending`, `history`×20, `daily`, `share`) — never in
  the synced state blob, which the next device to sync would erase. `pending` expires after 14
  days; `clearUser()` drops the file, aborts the in-flight call (`forgetSeq` makes its result
  land nowhere) and keeps only today's spend counter.
- **Boot** (server.js:799-812): `recoverOnBoot()` fails jobs that died with the process,
  `setProposalHook()` turns a `ready` proposal into a Web Push, `startCadence()`/`startWarmup()`
  run the schedules. `/api/admin/*` handlers still exist in `routes.js` but are filtered out by
  `server.js` — the admin panel is gone.

## Flow

`POST /api/coach/plan|review|debrief` → `guard` → `jobs.enqueue(uid, {kind, intake|note|refine|
workoutId})`, which checks: feature on + connected, no job already queued/running for this
profile, `state.coach.consent.agreedAt` (server-side, not the UI), credential present/ownable,
privilege drop possible for spawning providers, per-profile and instance daily caps → `202 {job}`.

Then, on the queue: `execute()` re-reads state (consent revoked meanwhile → `failed/consent`) →
`payloadLib.build(state, {handle: handleFor(uid), kind, cohort, previous})` →
`runPipeline({adapter: adapterFor(cfg.provider), cfg, kind, payload, model, timeoutMs,
invokeOpts:{jobDir, env, fetch, signal}})` → `{ok, result}` → `finish()` writes
`pending = {id, kind, planHash, iteration, …result}` (or `outcome:'nochange'` + `reading`, or
`failed/errorClass`) → hook fires a push. The client polls `GET /api/coach/status`
(`{job, pending, cap, last}`) and answers with `POST /api/coach/pending/resolve`
(`accepted|rejected|dismissed`); `POST /api/coach/forget` wipes everything for the profile.

## Integration

- Mounted by `../server.js` (route spread + `GET /api/config` ← `config.publicConfig()`, which
  stays absent unless enabled *and* connected, so an unconfigured instance is byte-identical to
  the pre-Coach app).
- Depends on `core/` (payload → prompt → pipeline → validate) and `adapters/` (registry +
  spawn/HTTPS adapters); `node-fetch.js` supplies the fetch the HTTP adapters are handed.
- Consumed by the frontend through `lib/coach-api.js` → `/api/coach/*`; `cadence.js` and
  `jobs.js` write the instance log the admin card used to render; `cohort.js` reads every
  opted-in profile's state file; pushes reuse the server's `sendPush`.
