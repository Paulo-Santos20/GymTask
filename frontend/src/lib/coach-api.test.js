// @vitest-environment happy-dom
// Idle cadence window (plan todo 28; draft audit-fixes.md:59 "cadence 15-min window"):
// with a Coach screen open and no job in flight, useCoachStatus's poll loop idles for
// IDLE_MS between status calls. The audit pins that window at 15 minutes.
// POLL_MS (job running → 3 s) is a different constant and is not in scope.
//
// RF10 (roadmap-features todo 10): photoEstimate's dispatch - the BYOK device takes its own
// Groq key through the EXISTING http adapter (wire asserted here against a stubbed fetch,
// the same style as api/test/adapters-http.test.js), every other keyed configuration goes
// to the server's /api/coach/photo route, and the demo branch never touches the network.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ demo: false }))
vi.mock('./demo.js', () => ({
  get DEMO() {
    return mocks.demo
  },
}))

import * as coachApi from './coach-api.js'
import { useStore } from '../store/useStore.js'
import { clearApiKey, setApiKey } from './coach-secrets.js'

describe('coach idle cadence window', () => {
  it('idles exactly the audit’s 15 minutes between status polls while no job runs', () => {
    expect(coachApi.IDLE_MS).toBe(15 * 60 * 1000)
  })
})

/* -------------------------------- photo -------------------------------- */

const realFetch = globalThis.fetch
let fetchCalls = []

/** fetch stub rich enough for both branches: api()/server() read .json, the adapter reads .text. */
function stubFetch(reply) {
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts })
    const data = typeof reply.body === 'string' ? null : reply.body
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: { get: k => (/content-type/i.test(k) ? 'application/json' : null) },
      json: async () => data || {},
      text: async () => text,
    }
  }
}

const UPSTREAM = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          foods: [{ name: 'Prato', grams: 250, kcal: 400, protein: 20, carbs: 50, fat: 10, confidence: 0.8 }],
        }),
      },
    },
  ],
}
const IMG = 'data:image/jpeg;base64,QUJD'

beforeEach(async () => {
  mocks.demo = false
  fetchCalls = []
  useStore.setState({ coachLocal: null })
  await clearApiKey()
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('photoEstimate dispatch', () => {
  it('a BYOK device with a Groq key drives the existing adapter: JSON mode + vision parts', async () => {
    useStore.setState({ coachLocal: { mode: 'byok', provider: 'groq', model: null, baseUrl: null } })
    await setApiKey('gsk_photo_test')
    stubFetch({ status: 200, body: UPSTREAM })

    const out = await coachApi.photoEstimate(IMG)

    expect(fetchCalls).toHaveLength(1)
    const wire = fetchCalls[0]
    expect(wire.url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(wire.opts.headers.authorization).toBe('Bearer gsk_photo_test')
    const body = JSON.parse(wire.opts.body)
    expect(body.model).toBe('qwen/qwen3.8-27b')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: expect.stringContaining('foods') },
      { type: 'image_url', image_url: { url: IMG } },
    ])
    expect(out.results).toHaveLength(1)
    expect(out.results[0]).toMatchObject({ name: 'Prato', source: 'photo', grams: 250 })
    expect(out.results[0].per100g).toEqual({ kcal: 160, protein: 8, carbs: 20, fat: 4 })
  })

  it('a BYOK device on another provider falls through to the server route', async () => {
    useStore.setState({ coachLocal: { mode: 'byok', provider: 'openai', model: null, baseUrl: null } })
    await setApiKey('sk-something')
    stubFetch({
      status: 200,
      body: {
        ok: true,
        results: [{ name: 'Sopa', grams: 300, kcal: 210, protein: 9, carbs: 30, fat: 5, confidence: 0.7 }],
      },
    })

    const out = await coachApi.photoEstimate(IMG)

    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toMatch(/\/api\/coach\/photo$/)
    expect(JSON.parse(fetchCalls[0].opts.body)).toEqual({ image: IMG })
    expect(out.results[0]).toMatchObject({ name: 'Sopa', source: 'photo', grams: 300 })
  })

  it('a server-mode phone posts the image to the same route', async () => {
    stubFetch({ status: 200, body: { ok: true, results: [] } })
    const out = await coachApi.photoEstimate(IMG)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toMatch(/\/api\/coach\/photo$/)
    expect(JSON.parse(fetchCalls[0].opts.body)).toEqual({ image: IMG })
    expect(out.results).toEqual([])
  })

  it('an upstream 429 surfaces as a rejection the view can turn into its fallback line', async () => {
    stubFetch({ status: 429, body: { ok: false, error: 'rate limit exceeded - retry in 30s' } })
    await expect(coachApi.photoEstimate(IMG)).rejects.toMatchObject({ status: 429 })
    expect(fetchCalls[0].url).toMatch(/\/api\/coach\/photo$/)
  })

  it('the demo branch never touches the network', async () => {
    mocks.demo = true
    stubFetch({ status: 200, body: { ok: true, results: [] } })
    await expect(coachApi.photoEstimate(IMG)).rejects.toThrow(/demo/)
    expect(fetchCalls).toHaveLength(0)
  })
})
