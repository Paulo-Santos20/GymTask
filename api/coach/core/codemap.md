# api/coach/core/

## Responsibility

The runtime-agnostic Coach core: everything from "here is the user's state" to "here is a
validated proposal, or a classified failure". Pure by contract — **no file, no clock, no
`process.env`** — so the server (`../jobs.js`) and the phone (which imports `core/` directly
when it brings its own API key) run literally the same prompt, transport classification, parser,
validator and single repair round. Two copies of that loop would be two places for "what the
model may say" to disagree, and the validator *is* the security boundary.

- `providers.js` · `pipeline.js` · `prompt.js` (+ generated `prompts.js`) · `payload.js` ·
  `parse.js` · `schemas.js` · `validate.js` · `plan-hash.js` · `system-prompt.js` ·
  `library.js` (+ generated `library-data.js`) · `categories.js` · `adapters/` (see its own map).

## Design

- **Provider table** (`providers.js`, `HTTP_PROVIDERS` frozen): rows `anthropic`, `openai`,
  `gemini`, `grok`, `compatible`, each `{label, runtime:'HTTPS', http:true, apiKeyEnv,
  defaultBase, defaultModel, keyPlaceholder}`. Row `grok` → `defaultBase: https://api.x.ai`,
  `defaultModel: grok-3-mini`, `apiKeyEnv: XAI_API_KEY`; `compatible` has no base and no default
  model (it is whatever the owner's endpoint serves). `config.PROVIDERS` spreads these rows in
  next to the runtime-backed ones, and the phone reads them for its picker — one source, two
  runtimes. `baseUrlFor(id, cfg)` resolves override → default; `validateBaseUrl()` permits only
  http(s), no userinfo, no query/fragment (the host ends up in a log).
- **Pipeline** (`pipeline.js`): `attemptOnce()` = prompt → `adapter.invoke()` → classify →
  `extractJSON` → `contractOK` → `validate{Plan,Review,Debrief}`. Failures carry
  `errorClass ∈ {timeout, missing, auth, provider, unusable}` and, when the model *can* be
  told what was wrong, `repairable: true`. `runPipeline()` = one attempt + at most one repair
  round. For `spawns === false` adapters the prompt is split into `system` + `user` with a
  JSON `schema` (`schemas.js`) for constrained decoding; CLIs get one flat prompt (no roles).
- **Prompt assembly** (`prompt.js`): `buildPrompt(kind, payload, repair)` / `buildPromptParts()`
  concatenate `prompts/common.md` + the task file (`create|review|debrief|refine`) and, on the
  repair round, `prompts/repair.md` with the validator's own error list. The `.md` files are
  editable sources; `prompts.js` and `library-data.js` are generated from them by
  `scripts/build-coach-assets.mjs` so bare node and Vite can both import the text.
- **Payload** (`payload.js`): builds exactly what leaves the server — allowlisted categories
  (`DATA_CATEGORIES`, shown to the user by `categories.js` before anything is sent), the
  exercise slice from `library-data.js` (1,324 entries, user's own flagged `custom`), the plan,
  history, cohort medians, and the `handle` pseudonym (`../handle.js`: HMAC of the uid under the
  instance secret, 16 chars, non-reversible) instead of the uid. Consent is a promise this
  module keeps by construction.
- **Validation** (`validate.js`): checks ids against the library, working weights, days per
  week, set/rep ranges, `planHash` freshness, and produces `nochange` + `reading` when the model
  correctly decided nothing should change. Nothing upstream of it is trusted — the prompt only
  asks for a shape.
- **Also here**: `plan-hash.js` (fingerprint of `canonicalPlan`, so a proposal can't be applied
  to a plan it was not computed against), `system-prompt.js` (the one identity prompt every
  provider gets), `parse.js` (`extractJSON`: first balanced/fenced object out of prose).

## Flow

`jobs.execute` → `payloadLib.build(state, {handle, kind, intake|note|refine, previous, cohort})`
→ `runPipeline({adapter, cfg, kind, payload, model, timeoutMs, invokeOpts})` →

1. `buildPromptParts(kind, payload, null)` → `adapter.invoke()` (`core/adapters/http.js` for
   HTTPS, `../adapters/*` for CLIs) → `{code, text, stderr, timedOut, spawnError}`;
2. classify (`timeout`/`missing`/`auth`/`provider`) → `extractJSON(text)` → `coach_contract`
   check → `validate*(value, payload)` → `{ok:true, result}` | `{ok:true, nochange, reading}` |
   `{ok:false, repairable, errors, errorClass:'unusable'}`;
3. if `repairable`: same again with `prompts/repair.md` and the errors appended; a second
   failure is a failed job, never a retry loop.

Result feeds `jobs.finish()` → `pending {planHash, iteration, …}` or a logged `errorClass`.

## Integration

- **Importers**: `../jobs.js` (`runPipeline`, `payload`, `prompt`, `parse`, `plan-hash`),
  `../routes.js` (`DATA_CATEGORIES`, `validateBaseUrl`), `../warmup.js` (byte-identical system
  message so a local prefix cache stays warm), and the phone's local coach (imports `core/`
  + `core/adapters/` with an injected `fetch`).
- **Generators**: `scripts/build-coach-assets.mjs` → `prompts.js`, `library-data.js` from
  `frontend/src/lib/exercises-data.js`; `scripts/check-core-loadable.mjs` asserts the folder
  still loads standalone; tests: `test/prompts.test.js`, `prompt-split`, `parse`, `payload`,
  `validate`, `coach-limits`.
- **Contract**: answers are `coach_contract`-versioned JSON; `parse.contractOK` refuses a build
  it does not speak before `validate` ever sees the contents.
