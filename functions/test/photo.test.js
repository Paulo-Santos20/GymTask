'use strict'
/* RF10 (roadmap-features todo 10): the meal-photo -> macro estimate endpoint.
 *
 * The photo route lives INSIDE `exports.coach` (path branch before the Grok pipeline) so the
 * client's existing VITE_COACH_FUNCTION_URL base reaches it under every documented shape and
 * no env file changes (plan Must-NOT: "no env changes"). Contract per functions/README-style
 * behavior pins below:
 *   photo happy        -> one upstream call to api.groq.com JSON mode, foods normalised, 200
 *   no GROQ_API_KEY    -> 400 NAMING it, zero upstream calls (nutritionProxy pattern)
 *   upstream 429       -> 429 JSON so the client falls back to manual entry
 *   upstream 500/junk  -> 502 JSON
 *   bad/missing image  -> 400 before any key is read
 *   oversized body     -> 413 with the photo cap (PHOTO_MAX_BODY, env-tunable like the others)
 *   GET                -> 405 (postOnly), nothing leaves
 *   the image          -> never appears in console.log/console.error (spy below)
 *   non-photo path     -> the coach pipeline is untouched (branch only fires on /photo)
 * Harness mirrors handlers.test.js: global fetch stubbed to RECORD, unique x-forwarded-for
 * per request keeps the rate limiter out, built-ins only (node:test + node:assert). */
const { test, after } = require('node:test')
const assert = require('node:assert/strict')

/* ------------------------- offline interception ------------------------- */

const realFetch = globalThis.fetch
let fetchCalls = []
let fetchReply = null // { status, body } - body object or raw string

globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), opts })
  const r = fetchReply || { status: 200, body: { choices: [{ message: { content: '{}' } }] } }
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    headers: { get: () => 'application/json' },
    text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
  }
}
after(() => {
  globalThis.fetch = realFetch
})

const { coach } = require('../index.js')

/* ------------------------------ env helper ------------------------------ */

const ENV = ['GROQ_API_KEY', 'GROQ_VISION_MODEL', 'XAI_API_KEY', 'PHOTO_MAX_BODY']

/** `undefined` in `over` DELETES the key (the "missing env var" case under test). */
function withEnv(over, fn) {
  const saved = {}
  for (const k of ENV) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const restore = () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
  return Promise.resolve().then(fn).finally(restore)
}

/* ------------------------------- req/res ------------------------------- */

function makeRes() {
  return {
    statusCode: null,
    headerRows: [],
    body: null,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headerRows.push(headers || {})
      return this
    },
    end(chunk) {
      this.ended = true
      if (chunk != null) this.body = String(chunk)
      return this
    },
  }
}

let seq = 0
async function call(handler, opts = {}) {
  const res = makeRes()
  await handler(
    {
      method: opts.method || 'POST',
      url: opts.url || '/api/coach/photo',
      path: opts.path !== undefined ? opts.path : '/api/coach/photo',
      headers: Object.assign({ 'x-forwarded-for': '198.51.100.' + ++seq }, opts.headers || {}),
      body: opts.body !== undefined ? opts.body : {},
    },
    res,
  )
  assert.equal(res.ended, true, 'handler must answer')
  return res
}

const parsed = res => {
  try {
    return JSON.parse(res.body || 'null')
  } catch {
    return null
  }
}

/** Capture console.log/console.error for the duration of fn (the no-image-in-logs pin). */
async function captureConsole(fn) {
  const logs = []
  const errs = []
  const realLog = console.log
  const realErr = console.error
  console.log = (...a) => {
    logs.push(a.map(String).join(' '))
  }
  console.error = (...a) => {
    errs.push(a.map(String).join(' '))
  }
  try {
    await fn()
  } finally {
    console.log = realLog
    console.error = realErr
  }
  return { logs, errs }
}

/* ------------------------------- fixtures ------------------------------- */

const IMG = 'data:image/jpeg;base64,QUJDREVGR0g='

// Foods as the model would return them: portion totals + a 0..1 confidence, plus the
// hostile shapes the server must clamp/drop before anything reaches a client.
const UPSTREAM_OK = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          foods: [
            { name: 'Arroz e feijao', grams: 300, kcal: 450, protein: 10, carbs: 85, fat: 6, confidence: 0.87 },
            { name: 'Frango grelhado', grams: 150, kcal: 248, protein: 46, carbs: 0, fat: 5, confidence: 92 },
            { name: 'Iogurte', grams: 99999, kcal: 60, protein: 3, carbs: 4, fat: 2, confidence: 1.5 },
            { name: '', grams: 100, kcal: 100, protein: 5, carbs: 10, fat: 1, confidence: 0.5 },
            { name: 'Sem gramas', kcal: 100, protein: 5, carbs: 10, fat: 1, confidence: 0.5 },
            ...Array.from({ length: 5 }, (_, i) => ({
              name: 'Extra ' + i,
              grams: 100,
              kcal: 50,
              protein: 2,
              carbs: 6,
              fat: 1,
              confidence: 0.4,
            })),
          ],
        }),
      },
    },
  ],
}

/* -------------------------------- tests -------------------------------- */

test('photo: happy path wires Groq vision JSON mode and normalises the foods', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    fetchReply = { status: 200, body: UPSTREAM_OK }
    const res = await call(coach, { body: { image: IMG } })
    assert.equal(res.statusCode, 200, 'a keyed happy path must answer 200: ' + res.body)

    assert.equal(fetchCalls.length, 1, 'exactly one upstream call')
    const wire = fetchCalls[0]
    assert.equal(wire.url, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(wire.opts.headers.authorization, 'Bearer gsk_photo')
    const body = JSON.parse(wire.opts.body)
    assert.equal(body.model, 'qwen/qwen3.8-27b')
    assert.equal(body.temperature, 0)
    assert.equal(body.response_format && body.response_format.type, 'json_object', 'JSON mode is the contract')
    assert.ok(body.max_tokens > 0, 'a max_tokens budget is sent')
    const user = body.messages[1].content
    assert.ok(Array.isArray(user), 'vision content must be the multimodal array')
    assert.equal(user[0].type, 'text')
    assert.equal(user[1].type, 'image_url')
    assert.equal(user[1].image_url.url, IMG)

    const out = parsed(res)
    assert.equal(out.ok, true)
    assert.equal(out.results.length, 5, 'hostile entries dropped, then capped at five')
    assert.deepEqual(out.results[0], {
      name: 'Arroz e feijao',
      grams: 300,
      kcal: 450,
      protein: 10,
      carbs: 85,
      fat: 6,
      confidence: 0.87,
    })
    assert.equal(out.results[1].confidence, 0.92, 'percent confidences become 0..1')
    assert.equal(out.results[2].grams, 1500, 'grams clamp to the editable ceiling')
    assert.equal(out.results[2].confidence, 1, 'confidence clamps at 1')
    assert.ok(
      out.results.every(r => r.name && Number.isFinite(r.grams) && r.grams >= 1),
      'every surviving entry is editable',
    )
  })
})

test('photo: task "menu" swaps in the cardápio prompt and answers a clean dish list', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    fetchReply = {
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: JSON.stringify({ dishes: ['Feijoada', '  ', '  feijoada ', 'Salada', 42, null] }),
            },
          },
        ],
      },
    }
    const res = await call(coach, { body: { image: IMG, task: 'menu' } })
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(fetchCalls[0].opts.body)
    assert.ok(/dishes/.test(body.messages[0].content), 'the menu prompt names the dishes contract')
    assert.deepEqual(parsed(res).results, ['Feijoada', 'Salada'], 'trimmed, deduped, junk dropped')
  })
})

test('photo: a context string rides the macro prompt and is ignored for task menu', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    fetchReply = { status: 200, body: UPSTREAM_OK }
    const res = await call(coach, { body: { image: IMG, context: 'Arroz, Frango' } })
    assert.equal(res.statusCode, 200, res.body)
    const user = JSON.parse(fetchCalls[0].opts.body).messages[1].content
    assert.ok(user[0].text.includes('Arroz, Frango'), 'the kept dish names reach the prompt')

    fetchCalls = []
    fetchReply = {
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ dishes: ['Sopa'] }) } }] },
    }
    const menu = await call(coach, { body: { image: IMG, task: 'menu', context: 'should be ignored' } })
    assert.equal(menu.statusCode, 200, menu.body)
    const menuUser = JSON.parse(fetchCalls[0].opts.body).messages[1].content
    assert.ok(!menuUser[0].text.includes('should be ignored'), 'context belongs to the macro prompt only')
  })
})

test('photo: task "menu" with text only reads the typed cardápio — no image part', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    fetchReply = {
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ dishes: ['Feijoada', 'Salada'] }) } }] },
    }
    const res = await call(coach, { body: { task: 'menu', text: 'feijoada com arroz, salada de frango' } })
    assert.equal(res.statusCode, 200, res.body)
    const body = JSON.parse(fetchCalls[0].opts.body)
    assert.equal(typeof body.messages[1].content, 'string', 'text-only rides a plain string content')
    assert.ok(body.messages[1].content.includes('feijoada com arroz'), 'the typed menu reaches the prompt')
    assert.deepEqual(parsed(res).results, ['Feijoada', 'Salada'])
  })
})

test('photo: task "menu" without image AND without text -> 400 naming both', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    const res = await call(coach, { body: { task: 'menu' } })
    assert.equal(res.statusCode, 400, res.body)
    assert.match(parsed(res).error || '', /image or text/)
    assert.equal(fetchCalls.length, 0)
  })
})

test('photo: missing GROQ_API_KEY -> 400 naming it, no upstream call', async () => {
  await withEnv({ GROQ_API_KEY: undefined }, async () => {
    fetchCalls = []
    const res = await call(coach, { body: { image: IMG } })
    assert.equal(res.statusCode, 400, 'a missing key is a client-visible 400: ' + res.body)
    assert.match(parsed(res).error || '', /GROQ_API_KEY/)
    assert.equal(fetchCalls.length, 0, 'nothing may leave without a key')
  })
})

test('photo: a body without an image data URL is refused before any key is read', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    const bad = await call(coach, { body: {} })
    assert.equal(bad.statusCode, 400)
    assert.match(parsed(bad).error || '', /image/)
    const notData = await call(coach, { body: { image: 'https://example.com/x.jpg' } })
    assert.equal(notData.statusCode, 400)
    assert.match(parsed(notData).error || '', /data URL/)
    assert.equal(fetchCalls.length, 0, 'no upstream call for either shape')
  })
})

test('photo: upstream 429 -> 429 JSON so the client falls back to manual entry', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    fetchReply = { status: 429, body: { error: { message: 'Rate limit reached' } } }
    const res = await call(coach, { body: { image: IMG } })
    assert.equal(res.statusCode, 429)
    const out = parsed(res)
    assert.equal(out.ok, false)
    assert.ok(/rate|limit/i.test(out.error || ''), 'the message says what happened: ' + out.error)
  })
})

test('photo: upstream 500 and a junk body -> 502, never a crash', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchReply = { status: 500, body: { error: { message: 'boom' } } }
    const res = await call(coach, { body: { image: IMG } })
    assert.equal(res.statusCode, 502)
    assert.equal(parsed(res).ok, false)

    fetchReply = { status: 200, body: 'this is not json {{' }
    const junk = await call(coach, { body: { image: IMG } })
    assert.equal(junk.statusCode, 502)
    assert.equal(parsed(junk).ok, false)
  })
})

test('photo: an oversized body -> 413 with the photo cap', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo', PHOTO_MAX_BODY: '64' }, async () => {
    fetchCalls = []
    const res = await call(coach, {
      body: { image: 'data:image/jpeg;base64,' + 'A'.repeat(400) },
    })
    assert.equal(res.statusCode, 413, res.body)
    assert.match(parsed(res).error || '', /max/)
    assert.equal(fetchCalls.length, 0, 'a refused body never reaches upstream')
  })
})

test('photo: GET is refused before anything leaves', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    const res = await call(coach, { method: 'GET', body: {} })
    assert.equal(res.statusCode, 405)
    assert.equal(fetchCalls.length, 0)
  })
})

test('photo: the image never reaches a log line', async () => {
  await withEnv({ GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchReply = { status: 200, body: UPSTREAM_OK }
    const { logs, errs } = await captureConsole(() => call(coach, { body: { image: IMG } }))
    const all = logs.concat(errs).join('\n')
    assert.ok(!all.includes('base64'), 'no log line carries a base64 payload')
    assert.ok(!all.includes('QUJDREVGR0g'), 'no log line carries the image bytes')
  })
})

test('photo: a non-photo path still runs the coach pipeline untouched', async () => {
  await withEnv({ XAI_API_KEY: undefined, GROQ_API_KEY: 'gsk_photo' }, async () => {
    fetchCalls = []
    const res = await call(coach, { path: '/api/coach/review', url: '/api/coach/review', body: { prompt: 'oi' } })
    assert.equal(res.statusCode, 400, 'the coach branch is unchanged: ' + res.body)
    assert.match(parsed(res).error || '', /XAI_API_KEY/)
    assert.equal(fetchCalls.length, 0, 'the photo key must not leak into the coach path')
  })
})
