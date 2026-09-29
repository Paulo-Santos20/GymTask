# api/coach/adapters/

## Responsibility

Provider adapters that run a **child process**, plus the one registry every caller uses. Live
code — not legacy: `index.js` is the only place `jobs.js` and `routes.js` resolve a provider
from, and it deliberately sits *above* `../core/adapters/` so there is a single registry for
both spawn-backed and HTTPS providers.

- `index.js` — `ADAPTERS` map + `adapterFor(provider)`; defines the in-repo `fixture` adapter
  inline (spawns `../fixture-cli.mjs` — the fake provider CI drives and owners can walk the
  whole intake → proposal → apply → revert loop with before connecting an account).
- `claude.js` — Claude Agent SDK adapter (lazy `import()`: on the default image the module
  loads, `check()` reports the runtime absent, and the Coach stays out of `GET /api/config`).
- `codex.js` — OpenAI Codex CLI as `codex exec -` (prompt on stdin), login cache in
  `CODEX_HOME` under `CREDENTIAL_HOME`.
- `spawn.js` — the sandboxed process runner both adapters (and the fixture) go through.

## Design

- **One interface, stated not inferred** (`index.js:1-13`):

  ```
  check(cfg, env)                                   → { ok, version?, error? }
  invoke({ prompt, jobDir, env, model, timeoutMs }) → { code, text, stderr, timedOut, spawnError }
  spawns                                            true  ⇔  a child process is started
  ```

  `spawns` is the branch the job runner uses for the privilege drop (`true` here, `false` for
  every `../core/adapters/` HTTP adapter, which must not be refused for having no process to
  drop). `ADAPTERS = { fixture, claude, codex, anthropic, openai, gemini, groq, grok,
  compatible }` —
  the last six are re-exported from `../core/adapters/`, so callers never import two paths.
- **`spawn.js` sandbox**: no shell ever (argv array; user text travels inside the payload file
  as JSON), env built from an allowlist via `cfgStore.jobEnv()` so the child cannot read
  `ADMIN_UIDS`, VAPID material or `./data`, and the child runs as the unprivileged `coach` user
  (uid/gid resolved from `/etc/passwd`) whose uid cannot read the data directory.
  `canDropPrivileges()` **fails closed on Linux**: no drop → no job ("no `coach` user exists in
  this image"), permissive on dev hosts (macOS) so the test suite and `node server.js` still
  work; `forcePrivilegeVerdict()` is the test seam. `run()` never rejects on a non-zero exit —
  the caller classifies `{code, stdout, stderr, timedOut}` — and honours an explicit
  `asCoach:false` (the fixture runs in a temp dir owned by root in tests).
- **Docker coupling**: the `coach` image target installs `@anthropic-ai/claude-agent-sdk`,
  `@openai/codex` + bubblewrap (Codex's sandbox) and creates the `coach` user; the default
  target ships none of it, which is why `check()` reporting absence is a first-class state.

## Flow

`jobs.execute()` → `adapterFor(cfg.provider)` → if `spawns !== false`: `fs.mkdtempSync` a
`coach-*` job dir, `shareJobDir()` it to the `coach` uid, build `env = jobEnv(jobDir,
credentialFor(uid))`, register an `AbortController` (used by `forget`) →
`adapter.invoke({prompt, jobDir, env, model, timeoutMs})` → `run(cmd, argv, {stdin: prompt,
env, cwd: jobDir, timeoutMs})` → `{code, stdout, stderr, timedOut}` → `text = stdout` → back in
`core/pipeline.js` the result is classified: `code 0` → parse/validate; `timedOut` → `timeout`;
`spawnError` (e.g. CLI absent, missing key) → `missing`; non-zero + `/auth|401|403|api key/` →
`auth`, otherwise `provider`. `check()` answers `GET /api/admin/coach` (dead in this build) and
`jobs.testRun()` — "is the runtime there", never "run a job".

## Integration

- **Consumers**: `../jobs.js` (execution), `../routes.js` (`adapterFor` for status/models),
  `test/adapters.test.js`, `test/jobs.test.js`.
- **Sibling**: `../core/adapters/` supplies the HTTPS adapters that `index.js` re-exports —
  the split is *transport* (process vs fetch), not provider family.
- **Security boundary**: `spawn.js` is the control that keeps a provider runtime out of the
  data directory; `core/validate.js` is the one that keeps its output out of the plan.
