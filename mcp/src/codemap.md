# mcp/src/

## Responsibility
The four-file implementation of the **read-only stdio MCP bridge**: build the server, expose
nine read tools, resolve and cache the profile's local state, and pre-format every value into
labels the LLM can quote without re-interpreting codes. No writes, no network, no database —
the entire surface is "answer questions about one `state-<uid>.json` file".

## Design
- **`index.js` (entry, shebang)** — `McpServer` named `gytask` v0.1.0 + `StdioServerTransport`.
  Calls `init()`/`getUser()` once, logs `serving profile <name> (<id>)` to **stderr** (stdout
  is the JSON-RPC channel). On bad config it logs the error but **stays up and still registers
  all tools**, so the client shows the full tool list and the user sees a useful message after
  fixing env. Every tool call is wrapped: handler result → `JSON.stringify` text content;
  thrown error → `isError: true` with `code: message`.
- **`tools.js`** — the nine tools as plain objects `{ name, description, schema, handler }`
  (zod schemas; dates validated as `YYYY-MM-DD` regex so handlers never see `'yesterday'`),
  collected in the exported `TOOLS` array: `list_routines`, `get_routine`, `preview_session`,
  `get_week_plan`, `list_workouts`, `get_workout`, `get_bodyweight`, `estimate_1rm`,
  `muscle_balance`. Handlers return JSON; a `noState()` sentinel answers when no state file
  exists yet. Key invariants encoded in comments: `get_routine` reports what the routine
  *stores*, `preview_session` runs the real session builder (`buildSessionEntries`) and reports
  what the screen *shows* plus where each number came from (`sourceOf`); `get_workout` refuses
  to guess between two sessions on one date; `estimate_1rm` skips warm-up rows and distinguishes
  "never trained" from "only trained above the rep cap"; `muscle_balance` attaches custom
  exercises so `loadOfWorkouts` resolves them (never the `exOr` miss placeholder).
- **`state.js`** — uid resolution order: `OPENGYM_UID` env → the single `state-*.json` → the
  single `db.json` user; ambiguity/absence throws with the candidate ids listed. Filenames
  sanitised (`[^a-zA-Z0-9_-]`), so a hostile uid can't traverse. Cache with `fs.watch`
  (best-effort, invalidates only) + `mtimeMs` fallback, `_watcher.unref()` so the watcher alone
  can't outlive the client. `getState()` merges over `defaultsShape()` exactly like the
  frontend's `pullState`. `getUser()` strips VAPID keys/push subs. `_seedStateForTests` bypasses
  disk. **Env identifiers are `OPENGYM_*` by decision** (openGym lineage).
- **`labels.js`** — formatting glue: applies `{0}/{1}` substitutions (`fmt`) to lib templates
  and re-exports `setLabel`, `exLine`, `muscleName`, `policyName`, `friendlyDuration`, `ratio`,
  `muscleOrder` so handlers emit final human text, not template strings.
- **Data source**: `data/db.json` + `data/state-<uid>.json` only. **Imports helpers from
  `../../frontend/src/lib`** (`workoutVolume`, `setsDone`, `effectiveRoutine`, `onerm.js`,
  `muscles.js`, `progression.js`, `session-start.js`, `format.js`) rather than duplicating —
  numbers match the UI by construction.

## Flow
Client spawn → `index.js` `init()` (state.js: resolve uid, load db + state, attach watcher) →
register `TOOLS` → `connect(stdio)` → per request: zod-validate → handler → `getState()` (mtime
check → re-read if changed) → lib functions compute → labels format → JSON text response →
loop until client disconnects; process exits when the stdio pipe closes.

## Integration
- **`frontend/src/lib/*`** — direct ESM imports across the repo boundary; must stay Node-safe
  (guard `import.meta.env`, no `import.meta.glob`), enforced by `mcp/scripts/check-node-loadable.mjs`.
- **`api/`** — same `./data` files the HTTP server writes atomically; the watcher+mtime pair
  makes api writes visible on the next tool call without restart.
- **`mcp/test/`** (excluded from this map) — covers the tools: seeded from
  `frontend/src/lib/demoSeed.js`, fake timers pin "today", pins JSON shape and edge cases.
- **LLM clients** — read via stdio only; no path back into the app, so Phase 2 write tools need
  the token auth + write lock described in `mcp/README.md`.
