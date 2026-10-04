'use strict'
/* Payload caps — regression tests for audit-fixes todo 3 (red→green).
 *
 * The bug: coach/nutritionProxy accepted unbounded request bodies. The fix enforces
 * per-route byte caps in the same shape api/server.js's MAX_BODY convention uses:
 * check the declared content-length FIRST (no buffering, no handler logic), then
 * measure what the runtime already parsed (chunked bodies arrive with no header).
 * Caps: COACH_MAX_BODY (default 1 MiB) and NUTRITION_MAX_BODY (default 16 KiB),
 * env-overridable so these tests can use small, exact thresholds.
 *
 * Downstream isolation: global fetch is stubbed to RECORD calls, so every test can
 * assert the oversized payload never reached Grok (api.x.ai) or Nutritionix — and the
 * stub also lets the under-cap control cases complete normally without any network.
 * Each request carries a unique x-forwarded-for so the todo-2 limiter never interferes. */
const test = require('node:test')
const assert = require('node:assert/strict')

const realFetch = globalThis.fetch
let fetchCalls = []

globalThis.fetch = async (url, opts) => {
  fetchCalls.push(String(url))
  if (String(url).includes('x.ai')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
    }
  }
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        foods: [{ uuid: 'u1', food_name: 'banana', serving_qty: 1, serving_unit: 'un' }],
      }),
  }
}

const { coach, nutritionProxy } = require('../index.js')

const ENV = ['COACH_MAX_BODY', 'NUTRITION_MAX_BODY', 'XAI_API_KEY', 'NUTRITIONIX_APP_ID', 'NUTRITIONIX_APP_KEY']
function withEnv(over, fn) {
  const saved = {}
  for (const k of ENV) saved[k] = process.env[k]
  Object.assign(process.env, over)
  const restore = () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
  return Promise.resolve().then(fn).finally(restore)
}

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
async function call(handler, opts) {
  const headers = { 'x-forwarded-for': '192.0.2.' + ++seq }
  if (opts.contentLength !== undefined) headers['content-length'] = String(opts.contentLength)
  const res = makeRes()
  await handler({ method: 'POST', url: '/coach', headers, body: opts.body }, res)
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

/* ------------------------------ coach cap ------------------------------ */

test('coach: content-length over the cap → 413 before any handler logic', async () => {
  await withEnv({ COACH_MAX_BODY: '1024', XAI_API_KEY: 'test-key-not-real' }, async () => {
    fetchCalls = []
    const res = await call(coach, { contentLength: 5000, body: { prompt: 'short' } })
    assert.equal(res.statusCode, 413, 'declared oversize must be refused on the header alone')
    const body = parsed(res)
    assert.ok(body && /too large/i.test(body.error || ''), 'clear message: ' + res.body)
    assert.deepEqual(fetchCalls, [], 'oversized payload must never reach api.x.ai')
  })
})

test('coach: body over the cap without content-length → 413, no fetch', async () => {
  await withEnv({ COACH_MAX_BODY: '1024', XAI_API_KEY: 'test-key-not-real' }, async () => {
    fetchCalls = []
    const res = await call(coach, { body: { prompt: 'x'.repeat(2000) } })
    assert.equal(res.statusCode, 413, 'measured oversize (chunked) must be refused')
    assert.deepEqual(fetchCalls, [], 'oversized payload must never reach api.x.ai')
  })
})

test('coach: body under the cap is unaffected (normal 200 path)', async () => {
  await withEnv({ COACH_MAX_BODY: '1024', XAI_API_KEY: 'test-key-not-real' }, async () => {
    fetchCalls = []
    const res = await call(coach, { contentLength: 18, body: { prompt: 'oi' } })
    assert.notEqual(res.statusCode, 413, 'under-cap body must not be refused')
    assert.equal(res.statusCode, 200, 'handler logic still runs: ' + res.body)
    assert.equal(fetchCalls.length, 1, 'downstream call still happens for valid input')
  })
})

/* -------------------------- nutritionProxy cap -------------------------- */

test('nutritionProxy: body over the cap → 413 before Nutritionix is called', async () => {
  await withEnv(
    {
      NUTRITION_MAX_BODY: '512',
      NUTRITIONIX_APP_ID: 'test-app-id',
      NUTRITIONIX_APP_KEY: 'test-app-key',
    },
    async () => {
      fetchCalls = []
      const res = await call(nutritionProxy, { body: { query: 'banana', junk: 'z'.repeat(1000) } })
      assert.equal(res.statusCode, 413, 'oversized body must be refused: ' + res.statusCode)
      assert.deepEqual(fetchCalls, [], 'oversized payload must never reach Nutritionix')
    },
  )
})

test('nutritionProxy: body under the cap is unaffected (normal 200 path)', async () => {
  await withEnv(
    {
      NUTRITION_MAX_BODY: '512',
      NUTRITIONIX_APP_ID: 'test-app-id',
      NUTRITIONIX_APP_KEY: 'test-app-key',
    },
    async () => {
      fetchCalls = []
      const res = await call(nutritionProxy, { body: { query: 'banana' } })
      assert.notEqual(res.statusCode, 413)
      assert.equal(res.statusCode, 200, 'handler logic still runs: ' + res.body)
      const body = parsed(res)
      assert.equal(body && body.count, 1, 'results still flow through')
    },
  )
})

test.after(() => {
  globalThis.fetch = realFetch
})
