# mcp/

## Responsibility
Package root of the optional **read-only MCP bridge**: lets an external LLM client (Claude
Desktop, Cursor, Cline…) query the user's GymTask profile — routines, week plan, logged
workouts, body-weight log, estimated 1RMs, muscle balance — over stdio. It adds no container,
no HTTP listener, no auth: the LLM client spawns `src/index.js` as a local child process and
the filesystem (`./data`) is the trust boundary. Every number it returns is computed by the
same pure functions the React UI uses, so MCP answers match the Stats screen exactly.

## Design
- **`package.json`** — name `gytask-mcp`, `"type": "module"`, AGPL-3.0-or-later, `private`.
  Only two runtime deps: `@modelcontextprotocol/sdk` (server + stdio transport) and `zod`
  (tool input schemas). Dev deps: `vitest` + `@vitest/coverage-v8`. No DB driver, no HTTP
  framework — one runtime dependency beyond the SDK, by design.
- **`bin`**: `gytask-mcp` → `src/index.js` (shebang `#!/usr/bin/env node`), so the server is
  installable as a command; `main` points at the same file.
- **Scripts** — `start` (`node src/index.js`), `test` (`vitest run`), and
  `check:node-loadable` (`scripts/check-node-loadable.mjs`, run under bare node on purpose:
  vitest resolves through Vite, so only a plain-node import catches a lib module growing a
  browser-only dependency that would kill the server at startup).
- **`vitest.config.js`** — `test/**/*.test.js`, node environment, `pool: 'forks'`.
- **`README.md` is the contract** — quick start (`npm install`, point at `./data`, register
  with the client), the 9-tool table, the `get_routine` vs `preview_session` distinction, the
  reuse-of-`frontend/src/lib` explanation, design constraints (read-only, no network, no
  telemetry) and the Phase 1/1.5 done → Phase 2 write-tools → Phase 3 HTTP roadmap.
- **Env identifiers kept as `OPENGYM_*`** (`OPENGYM_DATA`, `OPENGYM_UID`) by decision — the
  server derives from openGym and renaming them would break existing client configs for no
  functional gain.
- **`test/` exists but is excluded from mapping** — it covers the tools (`test/tools.test.js`,
  seeded from `frontend/src/lib/demoSeed.js`, pinned fake clock) plus edge cases: rest-day,
  missing routine, empty history, no synced state, supersets, three 1RM formulas.

## Flow
1. LLM client spawns `node src/index.js` with `OPENGYM_DATA` / optional `OPENGYM_UID` in env.
2. `src/index.js` builds an `McpServer`, calls `init()` (resolves profile + loads state),
   registers every tool from `src/tools.js`, then `connect(StdioServerTransport)`.
3. JSON-RPC over stdin/stdout for the session; stderr carries diagnostics only
   (`serving profile <name>` or a config error).
4. Process stays alive as long as the client keeps the pipe; on disconnect it exits.
5. `npm test` runs the vitest suite in `test/`; `npm run check:node-loadable` verifies the
   import graph loads under plain node.

## Integration
- **Reads only local state files**: `data/db.json` (user list) + `data/state-<uid>.json`
  (the same blob the `api/` server writes at `PUT /api/data`) — no Firestore, no network.
- **Imports training logic from `frontend/src/lib/`** (`history.js`, `onerm.js`,
  `muscles.js`, `progression.js`, `session-start.js`, …) instead of duplicating it; a
  Node-safety split of `i18n.js` was the only frontend change that required this.
- **Registered as a server entry point** in the root `codemap.md`; CI runs `mcp` tests on
  Node 22 alongside frontend/api.
- Dev dependency on the frontend tree means the folder must ship with the repo (not be
  extracted into its own package without vendoring those libs).
