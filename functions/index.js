'use strict';
/* GymTask Cloud Functions — the backend pieces that live on Firebase rather than behind the
 * Vercel-served frontend.
 *
 *   coach              HTTPS — xAI Grok call, mirroring api/coach's prompt/message shape
 *   nutritionProxy     HTTPS — Nutritionix search proxy (the app key never reaches a client)
 *   pushDailyReminder  scheduled — one FCM topic push a day (see functions/README.md)
 *
 * CommonJS on purpose: firebase-functions' documented default and the shape every deployed
 * example uses, and this package is its own npm root (its own package.json, no "type" field).
 *
 * Self-contained on purpose: Cloud Functions packages ONLY this directory at deploy time, so
 * `require('../../api/coach/...')` would work locally and fail in the cloud — and api/ is
 * ESM ("type": "module") on top of that, which plain require() cannot load on Node 20.
 * Where this file repeats a fact from api/coach (the 3-line system prompt, the payload block
 * of the prompt assembly) it is flagged inline as duplicated — that duplication is known
 * tech-debt, not an oversight. The canonical prompt library (api/coach/prompts/*.md) is NOT
 * copied here: callers that need the full task rules send them as `system`, built by
 * api/coach/core/prompt.js buildPromptParts() — the same code path the server and phone run.
 *
 * Keys: every credential is read from process.env (see .env.example) and used server-side
 * only — never echoed back, never in a URL, never shipped in any client bundle.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const REGION = 'us-central1';

/* Duplicated from api/coach/core/system-prompt.js — see the header: same bytes, by design. */
const SYSTEM_PROMPT =
  'You are the GymTask Coach. ' +
  'Answer only the supplied task and return exactly the requested JSON. ' +
  'You have no tools, filesystem access, external services, or persistent memory.';

// Used only when a caller sends { kind, payload } without the canonical `system` rules.
const FALLBACK_RULES =
  'Return exactly one JSON object and nothing else — no prose, no markdown fence. ' +
  'Follow the schema the app expects for this task.';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(body));
}

/** CORS preflight first; false means "not OPTIONS, keep going". */
function preflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }
  return false;
}

function postOnly(req, res) {
  if (req.method === 'POST') return false;
  send(res, 405, { ok: false, error: 'POST only' });
  return true;
}

/** req.body is parsed by the Functions runtime; a string body is parsed here, null on junk. */
function bodyOf(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string' && b.trim()) {
    try { return JSON.parse(b); } catch { return null; }
  }
  return {};
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { /* fall through */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

/* ------------------------------ coach ------------------------------ */

/* Builds { messages } the way api/coach/core/adapters/openai.js does: rules in the system
 * message (SYSTEM_PROMPT first, byte-identical across jobs), payload in the user message.
 *
 * Preferred input — the canonical split, produced by buildPromptParts(kind, payload) in
 * api/coach/core/prompt.js and passed through verbatim:
 *     { system: '<rules>', prompt: '<user block>' }
 * Fallback input — payload assembled here exactly like buildPromptParts' user block, with
 * FALLBACK_RULES standing in for the full task rules:
 *     { kind: 'create'|'review'|'debrief'|'refine', payload: {...} }
 */
function buildMessages(body) {
  const hasPrompt = typeof body.prompt === 'string' && body.prompt.trim().length > 0;
  const hasPayload = !!body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload);
  if (!hasPrompt && !hasPayload) {
    return { error: 'send { system, prompt } (from buildPromptParts) or { kind, payload }' };
  }
  const rules =
    typeof body.system === 'string' && body.system.trim() ? body.system :
    hasPayload ? FALLBACK_RULES : null;
  const user = hasPrompt
    ? body.prompt
    : '## Payload\n\n```json\n' + JSON.stringify(body.payload) + '\n```\n';
  const system = rules ? SYSTEM_PROMPT + '\n\n' + rules : SYSTEM_PROMPT;
  if (user.length > 500000) return { error: 'payload too large (500k chars max)' };
  return { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
}

const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_XAI_MODEL = 'grok-3-mini';
const COACH_FETCH_TIMEOUT_MS = 60000;

async function callGrok({ key, model, messages, temperature, timeoutMs = COACH_FETCH_TIMEOUT_MS }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, temperature }),
      signal: ctl.signal
    });
    let data = null;
    try { data = JSON.parse(await res.text()); } catch { data = null; }
    if (!res.ok) {
      const err = data && data.error;
      const msg = (err && (typeof err === 'string' ? err : err.message)) || (data && data.message) || 'xAI returned HTTP ' + res.status;
      return { error: msg, status: res.status };
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const content = choice && choice.message && choice.message.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => (p && p.text) || '').join('') : '';
    if (!text) return { error: 'the model returned no text' };
    return { text };
  } catch (e) {
    if (e && e.name === 'AbortError') return { timeout: true };
    return { unreachable: String((e && e.message) || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

exports.coach = onRequest({ region: REGION, timeoutSeconds: 300 }, async (req, res) => {
  if (preflight(req, res)) return;
  if (postOnly(req, res)) return;
  const body = bodyOf(req);
  if (body === null) return send(res, 400, { ok: false, error: 'body must be valid JSON' });

  // Clear message, never a crash and never the key itself: configured server-side via
  // functions/.env (see .env.example), invisible to every client bundle.
  const key = process.env.XAI_API_KEY;
  if (!key) {
    return send(res, 400, {
      ok: false,
      error: 'XAI_API_KEY is not configured on this function — copy functions/.env.example to functions/.env, set it, and redeploy'
    });
  }

  const built = buildMessages(body);
  if (built.error) return send(res, 400, { ok: false, error: built.error });

  const model =
    (typeof body.model === 'string' && body.model.trim().slice(0, 80)) ||
    process.env.XAI_MODEL ||
    DEFAULT_XAI_MODEL;
  const temperature = Number.isFinite(+body.temperature) ? Math.min(2, Math.max(0, +body.temperature)) : 0;

  const out = await callGrok({ key, model, messages: built.messages, temperature });
  if (out.timeout) return send(res, 504, { ok: false, error: 'the model did not answer within 60s' });
  if (out.unreachable) return send(res, 502, { ok: false, error: 'could not reach api.x.ai: ' + out.unreachable });
  if (out.error) return send(res, 502, { ok: false, error: out.error, status: out.status || null });

  return send(res, 200, { ok: true, model, text: out.text, answer: extractJson(out.text) });
});

/* --------------------------- nutritionProxy --------------------------- */

/* Nutritionix natural search for pt-BR (`locales/br`), server-to-server: the app id/key ride
 * in x-app-id / x-app-key headers from process.env and are never exposed to the frontend.
 * `/v2/natural/locales/br/search` is the scored, per-food endpoint; if the app later wants a
 * typeahead, `/v2/search/instant` is the cheaper one — same auth, different response shape —
 * and swapping is a one-line URL + mapping change here. */
const NUTRITIONIX_URL = 'https://trackapi.nutritionix.com/v2/natural/locales/br/search';
const NUTRITIONIX_TIMEOUT_MS = 15000;

const round1 = n => (Number.isFinite(+n) ? Math.round(+n * 10) / 10 : null);

function normaliseFood(f) {
  if (!f || !f.food_name) return null;
  const qty = f.serving_qty;
  const unit = f.serving_unit;
  return {
    id: f.uuid || f.slug || null,
    name: f.food_name,
    brand: f.brand_name || null,
    serving: [qty, unit].filter(x => x != null && x !== '').join(' ') || null,
    calories: round1(f.nf_calories),
    protein: round1(f.nf_protein),
    carbs: round1(f.nf_total_carbohydrate),
    fat: round1(f.nf_total_fat),
    fiber: round1(f.nf_dietary_fiber),
    sugar: round1(f.nf_sugars),
    weight: round1(f.serving_weight_grams),
    image: (f.photo && (f.photo.thumb || f.photo.small || f.photo.large)) || null
  };
}

exports.nutritionProxy = onRequest({ region: REGION, timeoutSeconds: 30 }, async (req, res) => {
  if (preflight(req, res)) return;
  if (postOnly(req, res)) return;
  const body = bodyOf(req);
  if (body === null) return send(res, 400, { ok: false, error: 'body must be valid JSON' });

  const query = String(body.query != null ? body.query : body.q != null ? body.q : '').trim().slice(0, 200);
  if (!query) return send(res, 400, { ok: false, error: 'query is required — send { "query": "banana prata" }' });

  const appId = process.env.NUTRITIONIX_APP_ID;
  const appKey = process.env.NUTRITIONIX_APP_KEY;
  if (!appId || !appKey) {
    return send(res, 400, {
      ok: false,
      error: 'NUTRITIONIX_APP_ID and NUTRITIONIX_APP_KEY must be set on this function — copy functions/.env.example to functions/.env, set them, and redeploy'
    });
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NUTRITIONIX_TIMEOUT_MS);
  let data;
  try {
    const upstream = await fetch(NUTRITIONIX_URL + '?query=' + encodeURIComponent(query), {
      method: 'GET',
      headers: { 'x-app-id': appId, 'x-app-key': appKey, accept: 'application/json' },
      signal: ctl.signal
    });
    const raw = await upstream.text();
    try { data = JSON.parse(raw); } catch { data = null; }
    if (!upstream.ok) {
      const msg = (data && (data.message || (data.error && data.error.message))) || ('Nutritionix returned HTTP ' + upstream.status);
      return send(res, 502, { ok: false, error: String(msg).slice(0, 300) });
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return send(res, 504, { ok: false, error: 'Nutritionix did not answer within 15s' });
    return send(res, 502, { ok: false, error: 'could not reach Nutritionix: ' + String((e && e.message) || e).slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }

  const rawFoods = Array.isArray(data && data.foods) ? data.foods : [];
  const results = rawFoods.map(normaliseFood).filter(Boolean);
  // `results` is the normalised contract; `foods` echoes the source objects because the
  // current frontend reader (frontend/src/lib/foodApis.js searchNutritionix) consumes
  // data.foods with raw Nutritionix field names (food_name, nf_*, serving_weight_grams)
  // for its own per-100 g conversion. Drop `foods` once that reader moves to `results`.
  return send(res, 200, {
    ok: true, query, locale: 'br', source: 'nutritionix',
    count: results.length, results, foods: rawFoods
  });
});

/* -------------------------- pushDailyReminder -------------------------- */

/* One FCM topic push per day, 09:00 in the audience's timezone. Recipients are the
 * clients themselves: each device subscribes to the `gytask-daily` topic after
 * getToken() on the client side (the exact contract is written down in
 * functions/README.md), so this function stores NO device tokens and reads NO
 * Firestore — one topic, one message, done.
 *
 * firebase-admin is initialized the Cloud-Functions-safe way: admin.initializeApp()
 * with no arguments picks up the runtime's default credentials — no service-account
 * file to manage on GCF. Init is lazy (first run builds it once per instance) and
 * every failure path is caught + console.error'd, never thrown: a scheduled function
 * that throws just crash-loops on a schedule nobody can fix at 09:00.
 *
 * Deploying this function IS the opt-in (it only fires if you deploy it);
 * DAILY_REMINDER_ENABLED in functions/.env is the runtime kill switch — unset means
 * on (see .env.example).
 */
const admin = require('firebase-admin');

const REMINDER_TOPIC = 'gytask-daily';
const REMINDER_TITLE = 'GymTask';
const REMINDER_BODY = 'Hora do treino de hoje — abra o app para registrar suas séries.';

/** Unset (or empty) means on; 0/false/off/no turns the run off without a redeploy. */
function reminderEnabled() {
  const raw = process.env.DAILY_REMINDER_ENABLED;
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

/** App + Messaging built once per instance; stays null when init failed (already logged). */
let messagingClient = null;

function messagingOrNull() {
  if (messagingClient) return messagingClient;
  try {
    if (!admin.apps.length) admin.initializeApp();
    messagingClient = admin.messaging();
  } catch (e) {
    console.error('pushDailyReminder: firebase-admin could not initialize — skipping this run: ' + String((e && e.message) || e).slice(0, 300));
  }
  return messagingClient;
}

exports.pushDailyReminder = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/Sao_Paulo', region: REGION },
  async () => {
    if (!reminderEnabled()) {
      console.log('pushDailyReminder: DAILY_REMINDER_ENABLED is off — nothing sent');
      return;
    }

    const messaging = messagingOrNull();
    if (!messaging) return; // init failed above and already logged

// The whole payload: topic + pt-BR notification, sent exactly once. `webpush.fcmOptions.link`
      // is what a click on the browser notification opens (the installed PWA).
    try {
      const messageId = await messaging.send({
        topic: REMINDER_TOPIC,
        notification: { title: REMINDER_TITLE, body: REMINDER_BODY },
        webpush: { fcmOptions: { link: '/' } }
      });
      console.log('pushDailyReminder: sent to topic ' + REMINDER_TOPIC + ' (' + messageId + ')');
    } catch (e) {
      // Log and swallow: the next schedule tick is the retry, no crash-loop tonight.
      console.error('pushDailyReminder: send failed — nothing delivered this run: ' + String((e && e.message) || e).slice(0, 300));
    }
  }
);
