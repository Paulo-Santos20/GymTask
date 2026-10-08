'use strict'
/* GymTask Cloud Functions — the backend pieces that live on Firebase rather than behind the
 * Vercel-served frontend.
 *
 *   coach              HTTPS — xAI Grok call, mirroring api/coach's prompt/message shape
 *   nutritionProxy     HTTPS — Nutritionix search proxy (the app key never reaches a client)
 *   pushDailyReminder  scheduled — one FCM topic push a day (see functions/README.md)
 *   weeklyReview       scheduled — the opted-in weekly review, held as a pending proposal in
 *                      the same store the app resolves (api/coach/jobs.js contract)
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
const { onRequest } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const REGION = 'us-central1'

/* Duplicated from api/coach/core/system-prompt.js — see the header: same bytes, by design. */
const SYSTEM_PROMPT =
  'You are the GymTask Coach. ' +
  'Answer only the supplied task and return exactly the requested JSON. ' +
  'You have no tools, filesystem access, external services, or persistent memory.'

// Used only when a caller sends { kind, payload } without the canonical `system` rules.
const FALLBACK_RULES =
  'Return exactly one JSON object and nothing else — no prose, no markdown fence. ' +
  'Follow the schema the app expects for this task.'

/* CORS is an origin ALLOWLIST, not '*': a wildcard lets any website drive these
 * endpoints from a browser. The origin is echoed back only when it is on the list —
 * ALLOWED_ORIGINS (comma-separated) overrides the defaults, which cover the Vercel
 * production domain (gymtask-jtu8, see GYMTASK.md / docs/DEPLOY_VERCEL.md) and the
 * vite dev/preview servers. No Origin header (curl, server-to-server) simply gets no
 * ACAO header; that never blocks the request itself — CORS is a browser-enforced rule.
 * Guest mode: no ID-token requirement anywhere, by plan decision (allowlist only). */
const DEFAULT_ALLOWED_ORIGINS = ['https://gymtask-jtu8.vercel.app', 'http://localhost:5173', 'http://localhost:4173']

function allowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  }
  return DEFAULT_ALLOWED_ORIGINS
}

/** CORS headers for THIS request: ACAO only for allowlisted origins, exact match. */
function corsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  const origin = req && req.headers ? req.headers.origin : undefined
  if (typeof origin === 'string' && origin && allowedOrigins().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

function send(req, res, status, body, extraHeaders) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(req),
    ...(extraHeaders || {}),
  })
  res.end(JSON.stringify(body))
}

/** CORS preflight first; false means "not OPTIONS, keep going". */
function preflight(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return true
  }
  return false
}

function postOnly(req, res) {
  if (req.method === 'POST') return false
  send(req, res, 405, { ok: false, error: 'POST only' })
  return true
}

/** req.body is parsed by the Functions runtime; a string body is parsed here, null on junk. */
function bodyOf(req) {
  const b = req.body
  if (b && typeof b === 'object') return b
  if (typeof b === 'string' && b.trim()) {
    try {
      return JSON.parse(b)
    } catch {
      return null
    }
  }
  return {}
}

/* Per-IP rate limit — in-memory fixed window, NO persistence (not Firestore), NO new
 * dependency. Each warm Cloud Functions instance owns its Map, which is enough to blunt
 * a burst from one client (the threat: burning the paid xAI/Nutritionix quota) without an
 * external store. Applied to coach + nutritionProxy ONLY — never to OPTIONS preflights
 * (checked after preflight()) and never to the scheduled pushDailyReminder.
 * RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS are read per request so tests and .env can tune them. */
const rateBuckets = new Map() // ip -> { count, resetAt }

function rateLimitConfig() {
  const max = parseInt(process.env.RATE_LIMIT_MAX, 10)
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10)
  return {
    max: Number.isFinite(max) && max > 0 ? max : 30,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000,
  }
}

function clientIp(req) {
  const xff = req && req.headers ? req.headers['x-forwarded-for'] : undefined
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim()
  if (req && typeof req.ip === 'string' && req.ip) return req.ip
  return 'unknown'
}

/** null = allowed; { retryAfterSec } = this IP exceeded its current window. */
function rateCheck(req) {
  const { max, windowMs } = rateLimitConfig()
  const ip = clientIp(req)
  const now = Date.now()
  let bucket = rateBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs }
    rateBuckets.set(ip, bucket)
  }
  bucket.count += 1
  if (rateBuckets.size > 10000) {
    for (const [k, v] of rateBuckets) if (now >= v.resetAt) rateBuckets.delete(k)
  }
  if (bucket.count > max) {
    return { retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) }
  }
  return null
}

/** 429 + Retry-After when over the limit; false = keep going. */
function rateLimited(req, res) {
  const hit = rateCheck(req)
  if (!hit) return false
  send(
    req,
    res,
    429,
    {
      ok: false,
      error: 'rate limit exceeded — retry in ' + hit.retryAfterSec + 's',
    },
    { 'Retry-After': String(hit.retryAfterSec) },
  )
  return true
}

/* Per-route payload caps — same convention as api/server.js (MAX_BODY → 413): the DECLARED
 * content-length is checked FIRST, before any body handling, so an oversized upload is
 * refused on the header alone; only then is the already-parsed body measured, for chunked
 * requests that arrive with no header (this code buffers nothing itself). Defaults: coach
 * 1 MiB (prompt/payload traffic is KB-scale), photo 4 MiB (a ~2 MB meal JPEG travels as
 * base64), nutritionProxy 16 KiB ({ query } only).
 * Env: COACH_MAX_BODY / PHOTO_MAX_BODY / NUTRITION_MAX_BODY, read per request so tests/.env can tune them. */
const COACH_MAX_BODY = 1024 * 1024
const PHOTO_MAX_BODY = 4 * 1024 * 1024
const NUTRITION_MAX_BODY = 16 * 1024

function maxBodyFor(route) {
  const envKey = route === 'coach' ? 'COACH_MAX_BODY' : route === 'photo' ? 'PHOTO_MAX_BODY' : 'NUTRITION_MAX_BODY'
  const fallback = route === 'coach' ? COACH_MAX_BODY : route === 'photo' ? PHOTO_MAX_BODY : NUTRITION_MAX_BODY
  const v = parseInt(process.env[envKey], 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function bodyTooLarge(req, cap) {
  const headers = req && req.headers
  const declared = headers ? headers['content-length'] : undefined
  if (declared !== undefined && declared !== '') {
    const n = Number(declared)
    if (Number.isFinite(n) && n > cap) return true
  }
  const b = req ? req.body : undefined
  if (b == null || b === '') return false
  let bytes
  if (typeof b === 'string') bytes = Buffer.byteLength(b, 'utf8')
  else if (Buffer.isBuffer(b)) bytes = b.length
  else {
    try {
      bytes = Buffer.byteLength(JSON.stringify(b), 'utf8')
    } catch {
      return true
    }
  }
  return bytes > cap
}

/** 413 when the request exceeds this route's cap; false = keep going. */
function payloadTooLarge(req, res, route) {
  const cap = maxBodyFor(route)
  if (!bodyTooLarge(req, cap)) return false
  send(req, res, 413, { ok: false, error: 'request body too large (max ' + cap + ' bytes)' })
  return true
}

function extractJson(text) {
  if (typeof text !== 'string') return null
  try {
    return JSON.parse(text)
  } catch {
    /* fall through */
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  return null
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
  const hasPrompt = typeof body.prompt === 'string' && body.prompt.trim().length > 0
  const hasPayload = !!body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
  if (!hasPrompt && !hasPayload) {
    return { error: 'send { system, prompt } (from buildPromptParts) or { kind, payload }' }
  }
  const rules = typeof body.system === 'string' && body.system.trim() ? body.system : hasPayload ? FALLBACK_RULES : null
  const user = hasPrompt ? body.prompt : '## Payload\n\n```json\n' + JSON.stringify(body.payload) + '\n```\n'
  const system = rules ? SYSTEM_PROMPT + '\n\n' + rules : SYSTEM_PROMPT
  if (user.length > 500000) return { error: 'payload too large (500k chars max)' }
  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
}

const XAI_URL = 'https://api.x.ai/v1/chat/completions'
const DEFAULT_XAI_MODEL = 'grok-3-mini'
const COACH_FETCH_TIMEOUT_MS = 60000

async function callGrok({ key, model, messages, temperature, timeoutMs = COACH_FETCH_TIMEOUT_MS, stream, onDelta }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages, temperature, ...(stream ? { stream: true } : {}) }),
      signal: ctl.signal,
    })
    const ct =
      (res.headers && typeof res.headers.get === 'function' && String(res.headers.get('content-type') || '')) || ''
    if (stream && res.ok && /text\/event-stream/.test(ct)) {
      // The tokens as they arrive. The pieces join to the same bytes the buffered path would
      // have parsed — the stream is transport, never a different answer.
      let text = ''
      try {
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i)
            buf = buf.slice(i + 2)
            for (const line of frame.split('\n')) {
              if (line.slice(0, 5) !== 'data:') continue
              const payload = line.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              let d
              try {
                d = JSON.parse(payload)
              } catch {
                continue
              }
              const choice = d && Array.isArray(d.choices) ? d.choices[0] : null
              const piece = choice && choice.delta && choice.delta.content
              if (typeof piece === 'string' && piece) {
                text += piece
                if (onDelta) onDelta(piece)
              }
            }
          }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return { timeout: true }
        return { error: 'the stream broke: ' + String((e && e.message) || e).slice(0, 200), status: 502 }
      }
      if (!text) return { error: 'the model returned no text' }
      return { text }
    }
    // Not SSE (a JSON client, an error, or a provider that ignored the flag): the buffered
    // path exactly as it ran before the stream existed.
    let data = null
    try {
      data = JSON.parse(await res.text())
    } catch {
      data = null
    }
    if (!res.ok) {
      const err = data && data.error
      const msg =
        (err && (typeof err === 'string' ? err : err.message)) ||
        (data && data.message) ||
        'xAI returned HTTP ' + res.status
      return { error: msg, status: res.status }
    }
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null
    const content = choice && choice.message && choice.message.content
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content.map(p => (p && p.text) || '').join('')
          : ''
    if (!text) return { error: 'the model returned no text' }
    return { text }
  } catch (e) {
    if (e && e.name === 'AbortError') return { timeout: true }
    return { unreachable: String((e && e.message) || e).slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

/* -------------------------- meal-photo estimate (RF10) --------------------------
 * A photo -> Groq's free vision tier -> editable macro candidates. The route rides the
 * `coach` function's URL (a path branch, below) so the client's existing
 * VITE_COACH_FUNCTION_URL base reaches it under every documented shape and no env file
 * changes. Wire mirrors api/coach/core/adapters/openai.js chatCompletionsSpec (JSON mode,
 * Bearer header, max_tokens) plus the Groq vision docs (multimodal content parts, the image
 * as a data URL). The image is forwarded to Groq and nowhere else: no console line carries
 * it, nothing is written or kept. Key: GROQ_API_KEY, server-side in functions/.env only
 * (deploy stays manual - decision 4); missing -> 400 naming it, nutritionProxy style. */
const GROQ_VISION_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_VISION_MODEL = 'qwen/qwen3.8-27b'
const PHOTO_TIMEOUT_MS = 25000
// Byte-identical copy of PHOTO_SYSTEM in frontend/src/lib/photo.js: the functions bundle
// ships only its own directory and cannot import the phone's ESM module - the same
// duplication trade-off as SYSTEM_PROMPT, pinned by both suites' contract tests.
const PHOTO_PROMPT =
  'You estimate the macros of a meal photo. Reply ONLY with JSON: ' +
  '{"foods":[{"name":string,"grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"confidence":number}]}. ' +
  'grams is the estimated portion size of that item; kcal, protein, carbs and fat are TOTALS for that portion. ' +
  'confidence is between 0 and 1. List at most 5 foods you can actually see, with Portuguese (pt-BR) names.'
// Byte-identical copy of MENU_SYSTEM in frontend/src/lib/photo.js — the cardápio reader
// behind the same route (body task: 'menu'). Two allowlisted prompts, never an arbitrary
// system text: the server key is not a prompt playground. The optional body.context
// (kept dish names from a menu scan) is appended to the MACRO prompt only.
const MENU_PROMPT =
  'You read a menu photo (a cardápio). Reply ONLY with JSON: ' +
  '{"dishes":[string]}. List each distinct dish or meal option you can read, ' +
  'with Portuguese (pt-BR) names, at most 15. No descriptions, no prices.'

/** One model food -> an editable candidate, or null (wrong shape, out of range, junk). */
function normalisePhotoFood(f) {
  if (!f || typeof f !== 'object') return null
  const name = typeof f.name === 'string' ? f.name.trim().slice(0, 60) : ''
  const grams = Number(f.grams)
  if (!name || !Number.isFinite(grams)) return null
  const macro = v => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.min(10000, Math.round(n)) : NaN
  }
  const out = {
    name,
    grams: Math.min(1500, Math.max(1, Math.round(grams))),
    kcal: macro(f.kcal),
    protein: macro(f.protein),
    carbs: macro(f.carbs),
    fat: macro(f.fat),
  }
  if (
    !Number.isFinite(out.kcal) ||
    !Number.isFinite(out.protein) ||
    !Number.isFinite(out.carbs) ||
    !Number.isFinite(out.fat)
  )
    return null
  const c = Number(f.confidence)
  out.confidence = Number.isFinite(c) ? Math.max(0, Math.min(1, c > 2 ? c / 100 : c)) : 0
  return out
}

function isPhotoRoute(req) {
  const p = req && req.path
  return typeof p === 'string' && p.includes('/api/coach/photo')
}

/** Menu model answer -> trimmed, deduped dish names, ≤ 15 (mirrors photo.js parseMenu). */
function normaliseMenuDishes(parsed) {
  const dishes = parsed && Array.isArray(parsed.dishes) ? parsed.dishes : []
  const out = []
  const seen = new Set()
  for (const d of dishes) {
    if (typeof d !== 'string') continue
    const name = d.trim().slice(0, 60)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.slice(0, 15)
}

async function coachPhoto(req, res) {
  if (preflight(req, res)) return
  if (rateLimited(req, res)) return
  if (payloadTooLarge(req, res, 'photo')) return
  if (postOnly(req, res)) return
  const body = bodyOf(req)
  if (body === null) return send(req, res, 400, { ok: false, error: 'body must be valid JSON' })
  const image = typeof body.image === 'string' ? body.image : ''
  const isMenu = body.task === 'menu'
  // The cardápio reader also takes the menu TYPED in: task:'menu' answers from `text` when
  // no photo is attached (same prompt, same dish-list answer). Text is capped well under
  // the photo body budget so a paste cannot ride the image allowance.
  const menuText = isMenu && !image && typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (!image && !menuText)
    return send(req, res, 400, {
      ok: false,
      error: isMenu
        ? 'image or text is required - send { "image": "data:image/jpeg;base64,..." } or { "task": "menu", "text": "Feijoada, Salada" }'
        : 'image is required - send { "image": "data:image/jpeg;base64,..." }',
    })
  if (image && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))
    return send(req, res, 400, { ok: false, error: 'image must be a base64 data URL (data:image/jpeg;base64,...)' })
  const prompt = isMenu ? MENU_PROMPT : PHOTO_PROMPT
  const context = !isMenu && typeof body.context === 'string' ? body.context.trim().slice(0, 400) : ''
  const userText = menuText
    ? prompt + '\nThe menu lists:\n' + menuText
    : context
      ? prompt + '\nThe meal contains: ' + context
      : prompt
  const key = process.env.GROQ_API_KEY
  if (!key)
    return send(req, res, 400, {
      ok: false,
      error: 'GROQ_API_KEY is not configured on this function - set it server-side in functions/.env and redeploy',
    })

  const model = process.env.GROQ_VISION_MODEL || GROQ_VISION_MODEL
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PHOTO_TIMEOUT_MS)
  let data
  try {
    const upstream = await fetch(GROQ_VISION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt },
          {
            role: 'user',
            // Text-only menu reads ride a plain string content; every image path keeps the
            // multimodal array the vision docs (and the existing tests) pin.
            content: menuText
              ? userText
              : [
                  { type: 'text', text: userText },
                  { type: 'image_url', image_url: { url: image } },
                ],
          },
        ],
      }),
      signal: ctl.signal,
    })
    const raw = await upstream.text()
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
    if (!upstream.ok) {
      if (upstream.status === 429)
        return send(req, res, 429, {
          ok: false,
          error: 'the vision provider is rate limited - try again in a moment, or add the food manually',
        })
      const msg =
        (data && data.error && (typeof data.error === 'string' ? data.error : data.error.message)) ||
        'the vision provider returned HTTP ' + upstream.status
      return send(req, res, 502, { ok: false, error: String(msg).slice(0, 300) })
    }
  } catch (e) {
    if (e && e.name === 'AbortError')
      return send(req, res, 504, { ok: false, error: 'the vision provider did not answer within 25s' })
    return send(req, res, 502, {
      ok: false,
      error: 'could not reach the vision provider: ' + String((e && e.message) || e).slice(0, 200),
    })
  } finally {
    clearTimeout(timer)
  }
  if (!data) return send(req, res, 502, { ok: false, error: 'the vision provider sent an unreadable answer' })

  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  const parsed = extractJson(typeof content === 'string' ? content : '')
  if (isMenu) return send(req, res, 200, { ok: true, results: normaliseMenuDishes(parsed) })
  const foods = parsed && Array.isArray(parsed.foods) ? parsed.foods : []
  const results = foods.map(normalisePhotoFood).filter(Boolean).slice(0, 5)
  return send(req, res, 200, { ok: true, results })
}

exports.coach = onRequest({ region: REGION, timeoutSeconds: 300 }, async (req, res) => {
  if (isPhotoRoute(req)) return coachPhoto(req, res)
  if (preflight(req, res)) return
  if (rateLimited(req, res)) return
  if (payloadTooLarge(req, res, 'coach')) return
  if (postOnly(req, res)) return
  const body = bodyOf(req)
  if (body === null) return send(req, res, 400, { ok: false, error: 'body must be valid JSON' })

  // Clear message, never a crash and never the key itself: configured server-side via
  // functions/.env (see .env.example), invisible to every client bundle.
  const key = process.env.XAI_API_KEY
  if (!key) {
    return send(req, res, 400, {
      ok: false,
      error:
        'XAI_API_KEY is not configured on this function — copy functions/.env.example to functions/.env, set it, and redeploy',
    })
  }

  const built = buildMessages(body)
  if (built.error) return send(req, res, 400, { ok: false, error: built.error })

  const model =
    (typeof body.model === 'string' && body.model.trim().slice(0, 80)) || process.env.XAI_MODEL || DEFAULT_XAI_MODEL
  const temperature = Number.isFinite(+body.temperature) ? Math.min(2, Math.max(0, +body.temperature)) : 0

  // Every guard above this line answers JSON whether or not the client asked for a stream —
  // headers are open only once nothing can still refuse the request. The handshake itself is
  // written before the upstream call leaves, so a client sees 200 while the model is thinking.
  const accept = req && req.headers ? req.headers.accept : undefined
  if (typeof accept === 'string' && /text\/event-stream/.test(accept)) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      ...corsHeaders(req),
    })
    const frame = (type, data) => {
      try {
        res.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n')
      } catch {
        /* client gone; res.end below still runs */
      }
    }
    const out = await callGrok({
      key,
      model,
      messages: built.messages,
      temperature,
      stream: true,
      onDelta: t => frame('delta', { text: t }),
    })
    if (out.timeout) frame('error', { ok: false, error: 'the model did not answer within 60s', status: 504 })
    else if (out.unreachable)
      frame('error', { ok: false, error: 'could not reach api.x.ai: ' + out.unreachable, status: 502 })
    else if (out.error) frame('error', { ok: false, error: out.error, status: out.status || 502 })
    else frame('end', { ok: true, model, text: out.text, answer: extractJson(out.text) })
    return res.end()
  }

  const out = await callGrok({ key, model, messages: built.messages, temperature })
  if (out.timeout) return send(req, res, 504, { ok: false, error: 'the model did not answer within 60s' })
  if (out.unreachable) return send(req, res, 502, { ok: false, error: 'could not reach api.x.ai: ' + out.unreachable })
  if (out.error) return send(req, res, 502, { ok: false, error: out.error, status: out.status || null })

  return send(req, res, 200, { ok: true, model, text: out.text, answer: extractJson(out.text) })
})

/* --------------------------- nutritionProxy --------------------------- */

/* Nutritionix natural search for pt-BR (`locales/br`), server-to-server: the app id/key ride
 * in x-app-id / x-app-key headers from process.env and are never exposed to the frontend.
 * `/v2/natural/locales/br/search` is the scored, per-food endpoint; if the app later wants a
 * typeahead, `/v2/search/instant` is the cheaper one — same auth, different response shape —
 * and swapping is a one-line URL + mapping change here. */
const NUTRITIONIX_URL = 'https://trackapi.nutritionix.com/v2/natural/locales/br/search'
const NUTRITIONIX_TIMEOUT_MS = 15000

const round1 = n => (Number.isFinite(+n) ? Math.round(+n * 10) / 10 : null)

function normaliseFood(f) {
  if (!f || !f.food_name) return null
  const qty = f.serving_qty
  const unit = f.serving_unit
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
    image: (f.photo && (f.photo.thumb || f.photo.small || f.photo.large)) || null,
  }
}

exports.nutritionProxy = onRequest({ region: REGION, timeoutSeconds: 30 }, async (req, res) => {
  if (preflight(req, res)) return
  if (rateLimited(req, res)) return
  if (payloadTooLarge(req, res, 'nutrition')) return
  if (postOnly(req, res)) return
  const body = bodyOf(req)
  if (body === null) return send(req, res, 400, { ok: false, error: 'body must be valid JSON' })

  const query = String(body.query != null ? body.query : body.q != null ? body.q : '')
    .trim()
    .slice(0, 200)
  if (!query) return send(req, res, 400, { ok: false, error: 'query is required — send { "query": "banana prata" }' })

  const appId = process.env.NUTRITIONIX_APP_ID
  const appKey = process.env.NUTRITIONIX_APP_KEY
  if (!appId || !appKey) {
    return send(req, res, 400, {
      ok: false,
      error:
        'NUTRITIONIX_APP_ID and NUTRITIONIX_APP_KEY must be set on this function — copy functions/.env.example to functions/.env, set them, and redeploy',
    })
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), NUTRITIONIX_TIMEOUT_MS)
  let data
  try {
    const upstream = await fetch(NUTRITIONIX_URL + '?query=' + encodeURIComponent(query), {
      method: 'GET',
      headers: { 'x-app-id': appId, 'x-app-key': appKey, accept: 'application/json' },
      signal: ctl.signal,
    })
    const raw = await upstream.text()
    try {
      data = JSON.parse(raw)
    } catch {
      data = null
    }
    if (!upstream.ok) {
      const msg =
        (data && (data.message || (data.error && data.error.message))) || 'Nutritionix returned HTTP ' + upstream.status
      return send(req, res, 502, { ok: false, error: String(msg).slice(0, 300) })
    }
  } catch (e) {
    if (e && e.name === 'AbortError')
      return send(req, res, 504, { ok: false, error: 'Nutritionix did not answer within 15s' })
    return send(req, res, 502, {
      ok: false,
      error: 'could not reach Nutritionix: ' + String((e && e.message) || e).slice(0, 200),
    })
  } finally {
    clearTimeout(timer)
  }

  const rawFoods = Array.isArray(data && data.foods) ? data.foods : []
  const results = rawFoods.map(normaliseFood).filter(Boolean)
  // `results` is the normalised contract; `foods` echoes the source objects because the
  // current frontend reader (frontend/src/lib/foodApis.js searchNutritionix) consumes
  // data.foods with raw Nutritionix field names (food_name, nf_*, serving_weight_grams)
  // for its own per-100 g conversion. Drop `foods` once that reader moves to `results`.
  return send(req, res, 200, {
    ok: true,
    query,
    locale: 'br',
    source: 'nutritionix',
    count: results.length,
    results,
    foods: rawFoods,
  })
})

/* -------------------------- pushDailyReminder -------------------------- */

/* One FCM topic push per day, 09:00 in the audience's timezone. Recipients are the
 * clients themselves: each device subscribes to the `gytask-daily` topic after
 * getToken() on the client side (the exact contract is written down in
 * functions/README.md), so this function stores NO device tokens and reads NO
 * Firestore — one topic, one message, done.
 *
 * firebase-admin is initialized the Cloud-Functions-safe way: initializeApp() with
 * no arguments picks up the runtime's default credentials — no service-account
 * file to manage on GCF. Init is lazy (first run builds it once per instance) and
 * every failure path is caught + console.error'd, never thrown: a scheduled function
 * that throws just crash-loops on a schedule nobody can fix at 09:00.
 *
 * Deploying this function IS the opt-in (it only fires if you deploy it);
 * DAILY_REMINDER_ENABLED in functions/.env is the runtime kill switch — unset means
 * on (see .env.example).
 */
/* firebase-admin v14 removed the legacy namespace services (`admin.apps`,
 * `admin.messaging()`) from the main export — reading them here made
 * messagingOrNull() throw-and-skip on EVERY enabled run after the v14 upgrade
 * (caught + logged as "could not initialize", so the reminder silently never
 * sent). The modular entry points below are the supported equivalent; caught by
 * test/handlers.test.js's enabled-path control. */
const { getApps, initializeApp } = require('firebase-admin/app')
const { getMessaging } = require('firebase-admin/messaging')

const REMINDER_TOPIC = 'gytask-daily'
const REMINDER_TITLE = 'GymTask'
const REMINDER_BODY = 'Hora do treino de hoje — abra o app para registrar suas séries.'

/** Unset (or empty) means on; 0/false/off/no turns the run off without a redeploy. */
function reminderEnabled() {
  const raw = process.env.DAILY_REMINDER_ENABLED
  const v = String(raw == null ? '' : raw)
    .trim()
    .toLowerCase()
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no'
}

/** App + Messaging built once per instance; stays null when init failed (already logged). */
let messagingClient = null

function messagingOrNull() {
  if (messagingClient) return messagingClient
  try {
    if (!getApps().length) initializeApp()
    messagingClient = getMessaging()
  } catch (e) {
    console.error(
      'pushDailyReminder: firebase-admin could not initialize — skipping this run: ' +
        String((e && e.message) || e).slice(0, 300),
    )
  }
  return messagingClient
}

exports.pushDailyReminder = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'America/Sao_Paulo', region: REGION },
  async () => {
    if (!reminderEnabled()) {
      console.log('pushDailyReminder: DAILY_REMINDER_ENABLED is off — nothing sent')
      return
    }

    const messaging = messagingOrNull()
    if (!messaging) return // init failed above and already logged

    // The whole payload: topic + pt-BR notification, sent exactly once. `webpush.fcmOptions.link`
    // is what a click on the browser notification opens (the installed PWA).
    try {
      const messageId = await messaging.send({
        topic: REMINDER_TOPIC,
        notification: { title: REMINDER_TITLE, body: REMINDER_BODY },
        webpush: { fcmOptions: { link: '/' } },
      })
      console.log('pushDailyReminder: sent to topic ' + REMINDER_TOPIC + ' (' + messageId + ')')
    } catch (e) {
      // Log and swallow: the next schedule tick is the retry, no crash-loop tonight.
      console.error(
        'pushDailyReminder: send failed — nothing delivered this run: ' + String((e && e.message) || e).slice(0, 300),
      )
    }
  },
)

/* --------------------------- weekly review (RF8) --------------------------- */

/* The scheduled weekly review: one tick a day at 18:00 SP, each opted-in profile reviewed on
 * the weekday it chose, the answer held as a pending proposal in the SAME per-profile store
 * the app already serves (GET /api/coach/status) and clears (POST /api/coach/pending/resolve
 * - api/coach/jobs.js resolvePending). Composes with the api's own in-process scheduler
 * (api/coach/cadence.js): both skip while a proposal waits or a review is fresh, and this run
 * appends the history lines jobs.finish would, so cadence reads my reviews as its own.
 *
 * Self-contained like the rest of this file: every store/payload/validate fact below is
 * duplicated from api/coach and cites its source (file header). Known ceilings, taken on
 * purpose:
 *   - the sheet's chosen TIME is honoured only for the default 18:00; other times still land
 *     on the chosen DAY (the in-process cadence ticks every 60s and honours the minute);
 *   - no planHash: fingerprinting needs canonicalPlan's modeOf/isBw over the exercise
 *     catalogue (api/coach/core/payload.js:128-167), which cannot ship here - markStale's
 *     per-change before check still guards every scalar change (coach.js:231);
 *   - no cohort block: api/coach/cohort.js derives the medians from every profile's state
 *     (share opt-in, jobs.js:468-469); this function sends none, so a non-sharer gets exactly
 *     what the api would show them (the trade is symmetric by construction) and a sharer just
 *     loses the comparison context;
 *   - one attempt, no repair round: an answer that fails validation is recorded as
 *     failed/unusable - paid for, and counted as reviewed by cadence.js:76-78 - and the next
 *     attempt is next week's tick. ponytail: add a repair pass only if the job log shows
 *     validation failures costing real reviews. */

const REVIEW_NAMES = require('./coach-names.js')

const REVIEW_HISTORY_MAX = 20 // api/coach/jobs.js:44 HISTORY_MAX
const REVIEW_PENDING_DAYS = 14 // api/coach/jobs.js:43 PENDING_DAYS (FR-33)
const REVIEW_MAX_CHANGES = 25 // api/coach/core/validate.js MAX_CHANGES
const REVIEW_WINDOW_WEEKS = 12 // api/coach/core/payload.js MAX_WEEKS
const REVIEW_SESSIONS = 12 // the last dozen sessions, all compact (see wWorkoutLine)
const REVIEW_DAYS = 7 // one review per profile per rolling week
const REVIEW_MAX_PER_RUN = 10 // ponytail: household-scale instance; raise when a run must serve more
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// api/coach/core/validate.js CHANGE_TYPES minus add-exercise / swap-exercise / superset /
// add-routine: those need the exercise catalogue, which does not ship with functions/.
const REVIEW_TYPES = [
  'remove-exercise',
  'sets',
  'reps',
  'repsMin',
  'repsMax',
  'sec',
  'cardio',
  'reorder',
  'routine-prog',
  'exercise-prog',
  'inc',
  'remove-routine',
  'rename-routine',
  'week',
]
const REVIEW_NEEDS_EX = [
  'remove-exercise',
  'sets',
  'reps',
  'repsMin',
  'repsMax',
  'sec',
  'cardio',
  'exercise-prog',
  'inc',
]
const REVIEW_POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'] // validate.js POLICIES
const REVIEW_MAX_INC = 50
const REVIEW_MAX_SPEED = 60

/* Tiny validators, byte-identical to validate.js:57-60. */
const isStr = v => typeof v === 'string' && v.trim().length > 0
const isNum = v => typeof v === 'number' && Number.isFinite(v)
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const clampStr = (v, n) => String(v == null ? '' : v).slice(0, n)

/* ---------- the store: DATA_DIR/coach/<uid>.json, the api's own layout ----------
 * Duplicated from api/coach/jobs.js:36-65 and :99-107 (see the file header). Read per run,
 * not at load: DATA_DIR is the api's variable (same default /data) and the deploy decides
 * where the shared store lives - functions/README.md documents that this must be the SAME
 * directory the api serves, or the proposal lands where nobody resolves it. */
const safeUid = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '') // jobs.js:48
const wStateFile = (dir, uid) => path.join(dir, 'state-' + safeUid(uid) + '.json')
const wCoachFile = (dir, uid) => path.join(dir, 'coach', safeUid(uid) + '.json')
const wRead = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
function wListUids(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f))
      .map(f => f.slice(6, -5))
  } catch {
    return []
  }
}
/** jobs.js:50-57 readUser - absent file is the EMPTY record, never an error. */
const wReadCoach = (dir, uid) => ({
  daily: null,
  current: null,
  pending: null,
  history: [],
  ...(wRead(wCoachFile(dir, uid)) || {}),
})
/** jobs.js:59-65 writeUser - dir 0700, tmp + rename, file 0600. */
function wWriteCoach(dir, uid, rec) {
  const coachDir = path.join(dir, 'coach')
  fs.mkdirSync(coachDir, { recursive: true, mode: 0o700 })
  const file = wCoachFile(dir, uid)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/* ---------- due gates: cadence.js:21-47, day-level tick ---------- */

/** When this profile was last read by a review: the client-stamped lastReview, or the
 *  history lines jobs.finish writes (ready / nochange / failed-unusable) - cadence.js:69-81. */
function wReviewedAt(S, rec) {
  const lines = (rec.history || [])
    .filter(
      h =>
        h.kind === 'review' &&
        (h.outcome === 'ready' || h.outcome === 'nochange' || (h.outcome === 'failed' && h.errorClass === 'unusable')),
    )
    .map(h => h.at || 0)
  return Math.max(0, S?.coach?.lastReview?.at || 0, ...lines)
}

/** Weekday index in the profile's own timezone, as cadence.js derives it (WEEKDAYS order). */
function wWeekdayIndex(tz, at) {
  try {
    return WEEKDAYS.indexOf(
      new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Sao_Paulo', weekday: 'long' }).format(new Date(at)),
    )
  } catch {
    return new Date(at).getUTCDay()
  }
}

function wWeeklyDue(S, rec, now) {
  const coach = S && S.coach
  if (!coach?.consent?.agreedAt) return { due: false, why: 'no consent' } // jobs.js:300
  const cadence = coach.cadence
  // 'off', absent, or everyWorkouts-only: the in-process cadence owns that mode.
  if (!cadence || typeof cadence !== 'object' || !cadence.weekly || typeof cadence.weekly !== 'object')
    return { due: false, why: 'weekly cadence is off' }
  if (rec.pending) return { due: false, why: 'a proposal is already waiting' } // cadence.js:64-65
  if (rec.current) return { due: false, why: 'a review job is already running' } // cadence.js:65 st.job
  const reviewedAt = wReviewedAt(S, rec)
  if (now - reviewedAt < REVIEW_DAYS * 86400000) return { due: false, why: 'already reviewed this week' }
  const wantDay = Number.isInteger(cadence.weekly.day) ? cadence.weekly.day : 0
  const today = wWeekdayIndex(S.reminder?.tz, now)
  if (today !== wantDay) return { due: false, why: 'not the chosen weekday (' + WEEKDAYS[wantDay] + ')' }
  // Nothing new to read - cadence.js:26-34, same end-vs-reviewedAt rule (the date stands in
  // for a workout with no end; the phone's local day can run ahead of the server's UTC day).
  const since = (S.workouts || []).filter(
    w => !reviewedAt || (w?.end ? w.end > reviewedAt : w?.d > new Date(reviewedAt).toISOString().slice(0, 10)),
  )
  if (!since.length) return { due: false, why: 'no new workouts since the last review' }
  return { due: true }
}

/* ---------- the payload: payload.js:574-590 review branch, compact ---------- */

/* Duplicated in spirit from api/coach/prompts/review.md + common.md (the canonical rules the
 * in-process pipeline assembles through buildPromptParts): the prompt library cannot ship
 * with functions/ (file header), so this states the same decision rules plus the exact
 * contract wValidate enforces. The api keeps the full text. */
const REVIEW_RULES = [
  'Task: review their training against the plan in the payload and either propose plan changes or say there is nothing to change.',
  'Read `window` (the sessions they actually did, most recent last), `bodyweight`, `coachProfile`, `previouslyDeclined` if present, and `plan` (what is prescribed: routines with named exercises, and the weekday `week` map).',
  'One session is not a trend: with fewer than three sessions in `window`, act only on clear evidence in the data or something the user wrote - otherwise answer nochange.',
  'Change nothing when nothing warrants it. Prefer few, high-conviction changes - about six at most. Never invent a change to look useful.',
  'You may only adjust what already exists: prescription numbers (sets/reps/time/increment/progression), remove an exercise or a routine, rename a routine, move a plan to another weekday, or reorder a routine.',
  'You may NOT add or swap an exercise, add a routine, or link a superset: this review channel has no exercise catalogue, so those types are rejected.',
  'Return exactly one JSON object and nothing else - no prose, no markdown fence.',
  'Nothing to change: {"coach_contract":1,"nochange":true,"reading":"<a short honest paragraph on how the block went>"}',
  'Otherwise: {"coach_contract":1,"summary":"<2-4 sentences: what you saw and what you are proposing>","evidence":{"from":"YYYY-MM-DD","to":"YYYY-MM-DD","sessions":<count>},"changes":[{"id":"c1","type":"<type>","target":{"routineId":"<id>","exId":"<id>","weekday":<0-6>},"after":<value>,"why":"<the evidence behind it, max 600 chars>"}]}',
  'Allowed types: remove-exercise, sets, reps, repsMin, repsMax, sec, cardio, reorder, routine-prog, exercise-prog, inc, remove-routine, rename-routine, week.',
  'after by type: sets 1-10 whole; reps 1-100 whole (an even total when the exercise is per-side); repsMin and repsMax 1-100 with min <= max; sec 5-3600; inc > 0 and <= 50; routine-prog and exercise-prog one of off, linear, greyskull, double, time; cardio an object with min (1-180) and/or speed (> 0, <= 60); rename-routine the new name (max 40 chars); remove-exercise and remove-routine omit after; week sets target.weekday (0-6) and after to a routine id, "rest", or null; reorder sets after to exactly that routine\'s exercise ids, each once, in the new order.',
  'target must name a routineId from `plan`; any type touching an exercise must name its exId inside that routine.',
  'Every change needs a unique id ("c1", "c2", ...) and a why. Do not send before - the app reads current values from the live plan.',
  'No two changes may reschedule the same weekday. A routine cannot be removed and changed in the same answer. A reorder cannot sit in a routine that also has an exercise removed.',
].join('\n\n')

const wEffort = S => {
  const e = S && S.effort
  return e === 'none' || e === 'rir' || e === 'rpe' ? e : S && S.showRir ? 'rir' : 'none' // payload.js:188-191
}

/** The model never sees the raw uid: a stable per-profile pseudonym (payload.js meta.profile
 *  role; api uses an HMAC with the instance secret this function does not have). */
const wHandle = uid => crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 16)

/** payload.js:56-61 - a warmup set is not training data. */
const wIsWarmup = s => {
  const ph = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : ''
  if (ph) return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up'
  return s?.warmup === true
}

/** payload.js:196-203 reviewWindow, sliced to REVIEW_SESSIONS sessions, all compact. */
function wReviewWindow(S, since) {
  const all = (S.workouts || []).filter(w => w && w.d)
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - REVIEW_WINDOW_WEEKS * 7)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const from = since && since > cutoff ? since : cutoff
  return all.filter(w => w.d >= from).slice(-REVIEW_SESSIONS)
}

/** One session as the model reads it: every done set, warmups dropped, ids resolved to names
 *  through the shipped name map (library ids are 4-digit strings - coach-names.js). */
function wWorkoutLine(w, custom) {
  return {
    d: w.d || null,
    name: w.name || null,
    ...(w.end && w.start ? { minutes: Math.round((w.end - w.start) / 60000) } : {}),
    entries: (w.entries || []).map(en => ({
      id: en.id || null,
      name: custom.get(en.id) || REVIEW_NAMES[en.id] || null,
      sets: (en.sets || [])
        .filter(s => s && s.done && !wIsWarmup(s))
        .map(s => ({
          ...(s.w != null ? { w: s.w } : {}),
          ...(s.r != null ? { r: s.r } : {}),
          ...(s.rir != null ? { rir: s.rir } : {}),
          ...(s.rpe != null ? { rpe: s.rpe } : {}),
          ...(s.sec != null ? { sec: s.sec } : {}),
          ...(s.min != null ? { min: s.min } : {}),
          ...(s.speed != null ? { speed: s.speed } : {}),
        })),
    })),
  }
}

/** payload.js:500-632 build() for kind 'review': meta, profile, plan, window, bodyweight,
 *  previouslyDeclined - without aggregates/library/cohort, which need the catalogue. */
function wPayload(S, uid, now) {
  const coach = S.coach || {}
  const profile = coach.profile || null
  const since = coach.lastReview?.at ? new Date(coach.lastReview.at).toISOString().slice(0, 10) : null
  const workouts = wReviewWindow(S, since)
  const custom = new Map((S.customEx || []).map(c => [c.id, c.name]))
  const declined = (coach.log || []) // payload.js:540-543 (FR-26)
    .flatMap(e => (e.decisions || []).filter(d => d.status === 'rejected').map(d => ({ type: d.type, why: d.why })))
    .slice(-15)
  const from = workouts[0]?.d || null
  return {
    coach_contract: 1,
    task: 'review',
    meta: {
      profile: wHandle(uid),
      lang: S.lang || 'en',
      unit: S.unit || 'kg',
      effortScale: wEffort(S),
      today: new Date(now).toISOString().slice(0, 10),
    },
    coachProfile: profile
      ? {
          goal: profile.goal || null,
          experience: profile.experience || null,
          daysPerWeek: profile.daysPerWeek || null,
          preferredDays: profile.preferredDays || [],
          sessionMin: profile.sessionMin || null,
          equipment: profile.equipment || [],
          limitations: profile.limitations || '',
          likes: profile.likes || '',
          dislikes: profile.dislikes || '',
          notes: profile.notes || '',
        }
      : null,
    plan: {
      routines: (S.routines || []).map(r => ({
        id: r.id,
        name: r.name || '',
        ...(r.prog ? { prog: r.prog } : {}),
        ex: (r.ex || []).map(e => ({
          id: e.id,
          name: custom.get(e.id) || REVIEW_NAMES[e.id] || null,
          ...(e.sets != null ? { sets: e.sets } : {}),
          ...(e.reps != null ? { reps: e.reps } : {}),
          ...(e.sec != null ? { sec: e.sec } : {}),
          ...(e.min != null ? { min: e.min } : {}),
          ...(e.speed != null ? { speed: e.speed } : {}),
          ...(e.weight ? { weight: e.weight } : {}),
          ...(e.prog ? { prog: e.prog } : {}),
          ...(e.inc != null ? { inc: e.inc } : {}),
          ...(e.repsMin != null ? { repsMin: e.repsMin } : {}),
          ...(e.repsMax != null ? { repsMax: e.repsMax } : {}),
          ...(e.side ? { side: true } : {}),
        })),
      })),
      // payload.js cleanPlan week rule: empty days out, combined days kept, merge order kept.
      week: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])]),
      ),
    },
    window: {
      from,
      to: workouts[workouts.length - 1]?.d || null,
      workouts: workouts.map(w => wWorkoutLine(w, custom)),
    },
    bodyweight: {
      goal: S.targetW ?? null,
      series: (S.bodyweight || []).filter(b => b && b.d && (!from || b.d >= from)).map(b => ({ d: b.d, w: b.w })),
    },
    ...(declined.length ? { previouslyDeclined: declined } : {}),
  }
}

/* ---------- the gate: validateReview (validate.js:257-620), catalogue-free types ---------- */

/** What the plan says right now - validate.js:717-742 currentOf, coach.js:177 currentValue.
 *  Read off the plan, never taken from the answer: markStale compares it to the live plan. */
function wCurrentOf(type, routine, planned, S, target) {
  switch (type) {
    case 'sets':
      return planned?.sets ?? null
    case 'reps':
      return planned?.reps ?? null
    case 'repsMin':
      return planned?.repsMin ?? null
    case 'repsMax':
      return planned?.repsMax ?? null
    case 'sec':
      return planned?.sec ?? null
    case 'inc':
      return planned?.inc ?? null
    case 'exercise-prog':
      return planned?.prog ?? null
    case 'routine-prog':
      return routine?.prog ?? null
    case 'rename-routine':
      return routine?.name ?? null
    case 'week':
      return S.week?.[target?.weekday] ?? null
    default:
      return null
  }
}

/** Per-type checks on `after` - validate.js:350-530 for the supported types. Returns an
 *  error string or null, normalising `after` the way the api does where it must. */
function wCheckAfter(out, routine, planned, routines) {
  const where = `change "${out.id}"`
  switch (out.type) {
    case 'remove-exercise':
    case 'remove-routine':
      out.after = null
      return null
    case 'sets':
      return isInt(out.after, 1, 10) ? null : `${where}.after must be a whole number of sets (1-10)`
    case 'reps': {
      if (!isInt(out.after, 1, 100)) return `${where}.after must be a whole number of reps (1-100)`
      if (planned?.side && out.after % 2) return `${where}.after must be an even total for a per-side exercise`
      return null
    }
    case 'repsMin': {
      if (!isInt(out.after, 1, 100)) return `${where}.after must be a whole number (1-100)`
      if (planned?.repsMax != null && out.after > planned.repsMax)
        return `${where}.after must stay at or below the exercise's repsMax`
      return null
    }
    case 'repsMax': {
      if (!isInt(out.after, 1, 100)) return `${where}.after must be a whole number (1-100)`
      if (planned?.repsMin != null && out.after < planned.repsMin)
        return `${where}.after must stay at or above the exercise's repsMin`
      return null
    }
    case 'sec':
      return isInt(out.after, 5, 3600) ? null : `${where}.after must be seconds (5-3600)`
    case 'cardio': {
      const a = out.after || {}
      if (!isInt(a.min, 1, 180) && !isNum(a.speed)) return `${where}.after must carry min and/or speed`
      out.after = {
        ...(isInt(a.min, 1, 180) ? { min: a.min } : {}),
        ...(isNum(a.speed) && a.speed > 0 && a.speed <= REVIEW_MAX_SPEED ? { speed: a.speed } : {}),
      }
      return null
    }
    case 'inc':
      return isNum(out.after) && out.after > 0 && out.after <= REVIEW_MAX_INC
        ? null
        : `${where}.after must be a positive increment no larger than ${REVIEW_MAX_INC}`
    case 'routine-prog':
    case 'exercise-prog':
      return REVIEW_POLICIES.includes(out.after) ? null : `${where}.after must be one of ${REVIEW_POLICIES.join(', ')}`
    case 'reorder': {
      const order = Array.isArray(out.after) ? out.after : null
      if (!order) return `${where}.after must be an array of exercise ids in the new order`
      const have = (routine.ex || []).map(e => e.id)
      // Same ids, each exactly once (validate.js:488-510): a list that duplicates one id and
      // omits another would delete an exercise on apply with nothing on screen to show it.
      if (order.length !== have.length || new Set(order).size !== order.length || order.some(id => !have.includes(id)))
        return `${where}.after must list exactly the ${have.length} exercise ids already in "${routine.name}", each once, reordered`
      out.after = order
      return null
    }
    case 'rename-routine':
      if (!isStr(out.after)) return `${where}.after must be the new routine name`
      out.after = clampStr(out.after, 40)
      return null
    case 'week': {
      if (!isInt(out.target.weekday, 0, 6)) return `${where}.target.weekday must be 0-6`
      if (out.after != null && out.after !== 'rest' && !routines.has(out.after))
        return `${where}.after must be a routine id from the plan, "rest", or null`
      out.after = out.after ?? null
      return null
    }
  }
  return null
}

/** Structural twin of validateReview for REVIEW_TYPES (see the section header). Same target
 *  rules, same after ranges, same coherence pass minus the catalogue-bound kinds. */
function wValidate(data, S) {
  if (!data || typeof data !== 'object') return { ok: false, errors: ['the answer was not an object'] }
  if (data.nochange) return { ok: true, nochange: true, reading: clampStr(data.reading || data.summary || '', 1200) }
  const list = Array.isArray(data.changes) ? data.changes : null
  if (!list) return { ok: false, errors: ['changes must be an array (or set "nochange": true with a "reading")'] }

  const errors = []
  const routines = new Map((S.routines || []).map(r => [r.id, r]))
  const changes = []
  const seenIds = new Set()
  list.slice(0, REVIEW_MAX_CHANGES).forEach((c, i) => {
    const where = `changes[${i}]`
    if (!c || typeof c !== 'object') {
      errors.push(`${where} is not an object`)
      return
    }
    if (!REVIEW_TYPES.includes(c.type)) {
      errors.push(`${where}.type "${c.type}" is not supported by this review - use one of: ${REVIEW_TYPES.join(', ')}`)
      return
    }
    if (!isStr(c.why)) {
      errors.push(`${where}.why is required - every change must cite the evidence behind it`)
      return
    }
    const target = c.target || {}
    const routine = target.routineId ? routines.get(target.routineId) : null
    // Everything but week must name a routine that exists (validate.js:292-297).
    if (c.type !== 'week' && !routine) {
      errors.push(`${where}.target.routineId "${target.routineId}" is not one of the routines in the plan`)
      return
    }
    let planned = null
    if (REVIEW_NEEDS_EX.includes(c.type)) {
      if (!target.exId) {
        errors.push(`${where}.target.exId is required for type "${c.type}"`)
        return
      }
      planned = (routine.ex || []).find(e => e.id === target.exId) || null
      if (!planned) {
        errors.push(`${where}.target.exId "${target.exId}" is not in routine "${routine.name}"`)
        return
      }
    }
    // Two changes under one id share a checkbox on the review screen (validate.js:324-328).
    let cid = isStr(c.id) ? clampStr(c.id, 40) : 'c' + i
    if (seenIds.has(cid)) cid = `${cid}-${i}`
    seenIds.add(cid)

    const out = {
      id: cid,
      type: c.type,
      target: {
        ...(isStr(target.routineId) ? { routineId: clampStr(target.routineId, 40) } : {}),
        ...(isStr(target.exId) ? { exId: clampStr(target.exId, 40) } : {}),
        ...(isInt(target.weekday, 0, 6) ? { weekday: target.weekday } : {}),
      },
      why: clampStr(c.why, 600),
      ...(routine ? { routineName: clampStr(routine.name || '', 40) } : {}),
      before: wCurrentOf(c.type, routine, planned, S, target),
      after: c.after ?? null,
    }
    const bad = wCheckAfter(out, routine, planned, routines)
    if (bad) {
      errors.push(bad)
      return
    }
    changes.push(out)
  })
  if (errors.length) return { ok: false, errors }

  // Coherence (validate.js:624-664): each change validated alone, the SET has to make sense
  // on one screen - the user approves a screen, not a change.
  const SCALAR = [
    'sets',
    'reps',
    'repsMin',
    'repsMax',
    'sec',
    'inc',
    'routine-prog',
    'exercise-prog',
    'rename-routine',
    'week',
  ]
  const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  // A scalar whose after equals the plan is dropped, not refused; all gone = honest nochange.
  const kept = changes.filter(ch => !(SCALAR.includes(ch.type) && sameValue(ch.before, ch.after)))
  const byRoutine = new Map()
  const weekdays = new Set()
  const removed = new Set()
  kept.forEach(ch => {
    const rid = ch.target.routineId
    if (rid) {
      if (!byRoutine.has(rid)) byRoutine.set(rid, [])
      byRoutine.get(rid).push(ch.type)
    }
    if (ch.type === 'remove-routine') removed.add(rid)
    if (ch.type === 'week') {
      const d = ch.target.weekday
      if (weekdays.has(d)) errors.push(`two changes both reschedule weekday ${d} - only one can win`)
      weekdays.add(d)
    }
  })
  byRoutine.forEach((types, rid) => {
    if (types.includes('reorder') && types.includes('remove-exercise'))
      errors.push(
        `routine "${routines.get(rid)?.name || rid}" is both reordered and restructured in one review - propose the reorder next time, against the list it will actually have`,
      )
    if (removed.has(rid) && types.some(t => t !== 'remove-routine'))
      errors.push(`routine "${routines.get(rid)?.name || rid}" is removed and also changed in the same review`)
  })
  if (errors.length) return { ok: false, errors }
  if (!kept.length) return { ok: true, nochange: true, reading: clampStr(data.summary || data.reading || '', 1200) }
  return {
    ok: true,
    proposal: {
      summary: clampStr(data.summary || '', 1200),
      evidence: {
        from: isStr(data.evidence?.from) ? clampStr(data.evidence.from, 40) : null,
        to: isStr(data.evidence?.to) ? clampStr(data.evidence.to, 40) : null,
        sessions: isInt(data.evidence?.sessions, 0, 10000) ? data.evidence.sessions : null,
      },
      changes: kept,
      notes: (Array.isArray(data.notes) ? data.notes : [])
        .filter(isStr)
        .slice(0, 6)
        .map(n => clampStr(n, 600)),
    },
  }
}

/* ---------- the schedule ---------- */

exports.weeklyReview = onSchedule(
  {
    // Daily tick, per-profile WEEKDAY honoured below (the sheet's day choice, default Sunday).
    // Time is best-effort: 18:00 SP matches the default choice exactly; another chosen minute
    // still runs on the right DAY at 18:00 (section header). The in-process cadence.js honours
    // the minute when that server runs.
    schedule: 'every day 18:00',
    timeZone: 'America/Sao_Paulo',
    region: REGION,
    timeoutSeconds: 300, // up to REVIEW_MAX_PER_RUN sequential 60s calls
  },
  async () => {
    const key = process.env.XAI_API_KEY
    if (!key) {
      console.log('weeklyReview: XAI_API_KEY is not configured - skipping the run')
      return
    }
    const dataDir = process.env.DATA_DIR || '/data' // jobs.js:36, read per run
    const now = Date.now()
    let asked = 0
    for (const uid of wListUids(dataDir).sort()) {
      if (asked >= REVIEW_MAX_PER_RUN) break
      try {
        const S = wRead(wStateFile(dataDir, uid))
        if (!S) continue
        const rec = wReadCoach(dataDir, uid)
        const due = wWeeklyDue(S, rec, now)
        if (!due.due) {
          console.log('weeklyReview: skip ' + uid + ' - ' + due.why)
          continue
        }
        const built = buildMessages({ system: REVIEW_RULES, payload: wPayload(S, uid, now) })
        if (built.error) {
          console.error('weeklyReview: payload for ' + uid + ' rejected - ' + built.error)
          continue
        }
        asked++
        const out = await callGrok({
          key,
          model: process.env.XAI_MODEL || DEFAULT_XAI_MODEL,
          messages: built.messages,
          temperature: 0, // a plan review is a reading of the data, not a creativity test
        })
        const attemptId = crypto.randomBytes(8).toString('hex') // jobs.js pending id form
        // One history line, in the shape jobs.finish writes (jobs.js:396-411): ready with the
        // proposal, nochange with its reading, failed/unusable when the answer could not be
        // read - all three are what cadence.js:69-81 counts as reviewed.
        const record = (extra, pending) => {
          const r = wReadCoach(dataDir, uid)
          const line = {
            id: attemptId,
            kind: 'review',
            trigger: 'scheduled',
            errorClass: null,
            ...extra,
            at: Date.now(),
          }
          const history = [...(r.history || []), line].slice(-REVIEW_HISTORY_MAX)
          wWriteCoach(dataDir, uid, { ...r, ...(pending !== undefined ? { pending } : {}), history })
        }
        // Never reached a usable answer (timeout / transport / HTTP error): retried next week
        // by the weekday gate, not recorded as reviewed - cadence.js:66-68 records only what
        // was actually paid for and read.
        if (out.timeout || out.unreachable || out.status != null) {
          console.error(
            'weeklyReview: ' +
              uid +
              ' model call failed - ' +
              String(out.timeout ? 'timeout' : out.unreachable || out.error).slice(0, 200),
          )
          continue
        }
        const ans = out.text ? extractJson(out.text) : null
        if (!ans) {
          console.error('weeklyReview: ' + uid + ' answer unusable - recording failed/unusable')
          record({ outcome: 'failed', errorClass: 'unusable' })
          continue
        }
        const checked = wValidate(ans, S)
        if (checked.ok && checked.nochange) {
          console.log('weeklyReview: ' + uid + ' - nothing to change')
          record({ outcome: 'nochange', reading: checked.reading })
          continue
        }
        if (!checked.ok) {
          console.error(
            'weeklyReview: ' + uid + ' answer failed validation - ' + checked.errors.join('; ').slice(0, 300),
          )
          record({ outcome: 'failed', errorClass: 'unusable' })
          continue
        }
        // jobs.js:507-520 pending shape, minus planHash (section header).
        const pending = {
          id: attemptId,
          kind: 'review',
          createdAt: Date.now(),
          expiresAt: Date.now() + REVIEW_PENDING_DAYS * 86400000,
          iteration: 1,
          ...checked.proposal,
        }
        record({ outcome: 'ready' }, pending)
        console.log('weeklyReview: proposal for ' + uid + ' (' + checked.proposal.changes.length + ' changes)')
      } catch (e) {
        // One bad profile must not cost the other nine their review.
        console.error('weeklyReview: ' + uid + ' failed - ' + String((e && e.message) || e).slice(0, 300))
      }
    }
  },
)
