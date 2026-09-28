/* Grok (xAI) — OpenAI's Chat Completions wire shape at api.x.ai.
 *
 * xAI speaks the same POST /v1/chat/completions contract OpenAI does (bearer auth, `model`,
 * `messages`), so the request shape is chatCompletionsSpec's and the transport is
 * httpAdapter's; what is Grok-specific is where the credential and the model come from.
 * This provider accepts both, in this order:
 *
 *   key     — the stored instance credential (the admin connect flow, like every other
 *             provider), else the XAI_API_KEY environment variable. An instance that just
 *             exports a key should not need the credential flow to make Grok usable, and a
 *             stored credential is more specific, so it wins.
 *   model   — an explicit pick in the instance config, else XAI_MODEL, else the resolved
 *             default (grok-3-mini via core/providers.js). Env-configurable without
 *             touching the admin UI; an explicit pick still wins over the environment.
 *
 * Neither value ever leaves the server: the key travels only in the Authorization header of
 * the outbound call, never in a URL, never in a response body, and nothing in this file is
 * read by the frontend bundle. A missing key is not a crash — httpAdapter answers the
 * adapter contract with { spawnError, stderr: "no API key configured for grok" }, the
 * pipeline classifies that as a `missing` failure, and the admin card shows the reason.
 */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

/** The model when neither the instance config nor XAI_MODEL says otherwise. */
export const DEFAULT_XAI_MODEL = 'grok-3-mini';

/* `max_tokens`, not `max_completion_tokens`: the field xAI's API documents.
 * temperature 0: a plan diff wants determinism — the same stance compatible.js takes
 * (greedy decoding is also what a constrained decoder handles fastest).
 * If xAI ever rejects the JSON-mode flag, httpAdapter retries once without it, exactly as
 * it does for every other OpenAI-shaped endpoint. */
export const grokSpec = chatCompletionsSpec('grok', { maxTokensField: 'max_tokens', temperature: 0 });

const base = httpAdapter(grokSpec);

// This module also runs in the phone's WebView (coach-local imports core directly), where
// `process` does not exist — guard the read instead of throwing a ReferenceError at call time.
const procEnv = () => (typeof process !== 'undefined' && process.env ? process.env : {});

/** The credential under the name this provider declares, falling back to the process env. */
const grokEnv = env => {
  const merged = { ...(env || {}) };
  const fromProc = procEnv();
  if (!merged.XAI_API_KEY && fromProc.XAI_API_KEY) merged.XAI_API_KEY = fromProc.XAI_API_KEY;
  return merged;
};

/** Instance-config model > XAI_MODEL env > whatever the caller resolved (defaultModel). */
const modelFor = opts =>
  (opts.cfg && opts.cfg.models && opts.cfg.models.grok) ||
  (procEnv().XAI_MODEL || null) ||
  opts.model ||
  null;

/* Same interface as every other adapter (check/models/invoke — see ../adapters/index.js);
 * the three entry points are wrapped only to merge the environment in before httpAdapter's
 * own `env`-keyed reads. `{ ...base }` keeps spawns:false and needsRuntime:false, which is
 * what tells the job runner no privilege drop applies. */
const grok = {
  ...base,
  check: (cfg, env, opts) => base.check(cfg, grokEnv(env), opts),
  models: (cfg, env, opts) => base.models(cfg, grokEnv(env), opts),
  invoke: opts => base.invoke({ ...opts, env: grokEnv(opts.env), model: modelFor(opts) })
};

export default grok;
