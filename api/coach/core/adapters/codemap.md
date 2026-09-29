# api/coach/core/adapters/

## Responsibility

The **HTTPS** provider adapters — providers that are nothing but an API endpoint, so they spawn
no process, need no AI runtime in the image, and run unchanged on the server (node's `fetch`)
and in the phone's WebView (an injected `fetch` through the native layer, so CORS never
applies). Live code: this is one half of the adapter split, the other being
`../../adapters/` (child processes + the registry that re-exports these).

- `http.js` — `httpAdapter(spec)`: the whole transport (timeouts, retries, model listing,
  error mapping). One file, every HTTPS provider.
- `openai.js` — `chatCompletionsSpec()` factory (Chat Completions, not Responses API, because
  it is the one shape `compatible` endpoints actually serve) — also the base for `grok.js` and
  `compatible.js`.
- `grok.js` · `anthropic.js` · `gemini.js` · `compatible.js` — thin specs: endpoint paths,
  auth header, request body, response readers.

## Design

- **Two-layer shape**: a *spec* describes the provider (`path(model)`, `headers(key)`,
  `body({model, prompt, system, schema, maxTokens})`, `readText(data)`, `readModels(data)`,
  `errorMessage(data)`, `modelsPath`, optional `withoutJsonMode`); `httpAdapter(spec)` owns
  transport and returns `{id, spawns:false, needsRuntime:false, baseUrl, check, models,
  invoke}`. Adding a provider is a spec file + a row in `../providers.js` (which
  `config.PROVIDERS` spreads) + a re-export in `../../adapters/index.js`.
- **Return contract** chosen to match the pipeline's classification of spawn-backed adapters:
  `2xx + text` → `{code:0, text}`; non-2xx → `{code:1, stderr:"<status> <msg>"}` (the leading
  401/403 is what `pipeline.js`'s auth regex keys on); truncated output → `code 1` (a half JSON
  object would burn the single repair round); fetch threw/aborted → `code 1` with the host /
  `timedOut`; missing key on a provider that requires one → `spawnError` ("missing", like an
  absent CLI).
- **Bounds**: `MAX_OUTPUT_TOKENS = 16000`, default 5-minute timeout (both overridable by the
  caller), `RETRY_STATUSES = {429, 500, 502, 503, 504, 529}` retried twice at 2 s / 5 s —
  transient statuses the providers themselves advertise — never a 4xx that means the request is
  wrong; one retry with the JSON-mode flag dropped when a compatible endpoint rejects it.
  `fetch` and `signal` are injected, so `forget` aborts a call and tests use fakes.
- **`grok.js`**: `chatCompletionsSpec('grok', {maxTokensField:'max_tokens', temperature:0})` —
  the field xAI documents, greedy decoding because a plan diff wants determinism. Credential and
  model resolution merges: key = stored instance credential, else `XAI_API_KEY` (from the job
  env or, guarded for the WebView, `process.env`); model = instance config → `XAI_MODEL` →
  `defaultModel grok-3-mini`. The key travels only in the outbound `Authorization` header —
  never in a URL, never in a response, never read by the frontend bundle.
- **`gemini.js`** puts the key in a header (a `?key=` query string lands in proxy logs and
  browser history); **`anthropic.js`** sends `system-prompt.js`'s `SYSTEM_PROMPT` as the
  system block; **`compatible.js`** is the configurable one (base URL from config, key optional
  — a LAN Ollama has none).

## Flow

`pipeline.attemptOnce` → `adapter.invoke({cfg, prompt, system, schema, model, timeoutMs,
env, fetch, signal})` → `baseUrlFor(id, cfg)` (override else `defaultBase`) → key lookup under
`meta.apiKeyEnv` → resolve model (`model || meta.defaultModel`, else a `code 1` telling the
caller to pick one) → POST `base + spec.path(model)` inside `call()` (AbortController +
timeout) → status check → retry/backoff or `spec.readText(data)` →
`{code:0, text}` / classified failure → the pipeline parses, validates, and on a fixable
rejection does exactly one repair round against the same adapter.

`check(cfg, env)` = "can this endpoint be reached": no key → `{ok:true, needsKey:true}` (the
tile says what is missing); with a key → `models()` (a `GET spec.modelsPath`), which doubles as
the auth check and gives the UI a list instead of a stale text field.

## Integration

- **Registry**: re-exported by `../../adapters/index.js` (`ADAPTERS.grok` etc.), so `jobs.js`
  and `routes.js` resolve them through one function regardless of transport.
- **Metadata**: rows come from `../providers.js` (`HTTP_PROVIDERS`); runtime config/credential
  from `../config.js` (`PROVIDERS`, `jobEnv`, `credentialFor`).
- **Callers**: `../pipeline.js` (the only invoke path), warmup (`../../warmup.js` sends a
  byte-identical system message to keep a local model's prefix cache hot), the phone's local
  coach (injects its own `fetch`); tests: `test/adapters-http.test.js`, `test/adapters.test.js`.
