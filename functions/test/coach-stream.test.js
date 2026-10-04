/* RF4, functions side: `coach` answers a text/event-stream client with the model's tokens as
 * they arrive, and lands on the exact same final answer the JSON path produces.
 *
 * Guardrails pinned here: without the SSE Accept header nothing changes (one JSON answer, no
 * stream), the handshake is written before the upstream call answers, and an upstream failure
 * after the headers are open reaches the client as an `error` event rather than a broken
 * stream. Built-ins only, same offline interception style as handlers.test.js. */
const test = require('node:test')
const assert = require('node:assert/strict')

/* ------------------------- offline interception ------------------------- */

const realFetch = globalThis.fetch
let fetchCalls = []
let sseChunks = [] // frames the fake xAI streams when asked to stream
let deferred = null // when set, a stream request parks on it until released

function sseBody() {
  const enc = new TextEncoder()
  let i = 0
  return {
    getReader: () => ({
      read: async () => {
        if (deferred) {
          const release = deferred
          deferred = null
          await new Promise(r => release.then(r))
        }
        if (i >= sseChunks.length) return { done: true, value: undefined }
        return { done: false, value: enc.encode(sseChunks[i++]) }
      },
    }),
  }
}

const JSON_ANSWER = '{"coach_contract":1,"nochange":true,"reading":"Streamed from the edge."}'

globalThis.fetch = async (url, opts) => {
  const body = JSON.parse((opts && opts.body) || '{}')
  fetchCalls.push({ url: String(url), body })
  if (String(url).includes('x.ai')) {
    if (body.stream) {
      return {
        ok: true,
        status: 200,
        headers: { get: k => (String(k).toLowerCase() === 'content-type' ? 'text/event-stream' : null) },
        body: sseBody(),
      }
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: JSON_ANSWER } }] }),
    }
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ foods: [] }),
  }
}

const { coach } = require('../index.js')

/* ------------------------------ env helper ------------------------------ */

function withKey(fn) {
  const saved = process.env.XAI_API_KEY
  process.env.XAI_API_KEY = 'sk-test'
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (saved === undefined) delete process.env.XAI_API_KEY
      else process.env.XAI_API_KEY = saved
    })
}

/* ------------------------------- req/res ------------------------------- */

function makeRes() {
  return {
    statusCode: null,
    headerRows: [],
    body: null,
    ended: false,
    chunks: [],
    writeHead(status, headers) {
      this.statusCode = status
      this.headerRows.push(headers || {})
      return this
    },
    write(chunk) {
      this.chunks.push(String(chunk))
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
async function call(accept) {
  const res = makeRes()
  await coach(
    {
      method: 'POST',
      url: '/coach',
      headers: { 'x-forwarded-for': '198.51.100.' + ++seq, ...(accept ? { accept } : {}) },
      body: { kind: 'review', payload: { unit: 'kg' } },
    },
    res,
  )
  assert.equal(res.ended, true, 'handler must answer')
  return res
}

/** The SSE frames written so far, parsed into { type, ...data } records. */
function events(res) {
  const out = []
  for (const c of res.chunks) {
    const m = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(c)
    if (m) {
      try {
        out.push({ type: m[1], ...JSON.parse(m[2]) })
      } catch {
        out.push({ type: m[1], raw: m[2] })
      }
    }
  }
  return out
}

test.after(() => {
  globalThis.fetch = realFetch
})

/* -------------------------------- tests -------------------------------- */

test('an SSE client gets token deltas and a final event byte-identical to the JSON answer', async () => {
  await withKey(async () => {
    fetchCalls = []
    sseChunks = [
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: JSON_ANSWER.slice(0, 20) } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: JSON_ANSWER.slice(20, 55) } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: JSON_ANSWER.slice(55) } }] }) + '\n\n',
      'data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
      'data: [DONE]\n\n',
    ]
    const res = await call('text/event-stream, */*')

    assert.equal(res.statusCode, 200)
    assert.match(res.headerRows[0]['content-type'], /text\/event-stream/)
    assert.equal(fetchCalls.length, 1, 'exactly one upstream call')
    assert.equal(fetchCalls[0].body.stream, true, 'the upstream was asked to stream')

    const evs = events(res)
    const deltas = evs.filter(e => e.type === 'delta')
    assert.ok(deltas.length >= 3, `deltas arrived: ${evs.map(e => e.type).join(',')}`)
    assert.equal(
      deltas.map(d => d.text).join(''),
      JSON_ANSWER,
      'the joined deltas are the answer itself, in order',
    )

    const end = evs.at(-1)
    assert.equal(end.type, 'end', 'the stream closes on an end event')
    assert.equal(end.ok, true)
    assert.equal(end.text, JSON_ANSWER)

    // Byte-identity: the same call without SSE gets the same answer as JSON.
    fetchCalls = []
    const plain = await call()
    assert.equal(plain.headerRows[0]['content-type'].includes('application/json'), true)
    const body = JSON.parse(plain.body)
    assert.equal(end.text, body.text, 'text is byte-identical between stream and JSON runs')
    assert.deepEqual(end.answer, body.answer, 'answer is deep-equal between stream and JSON runs')
    assert.equal(fetchCalls[0].body.stream, undefined, 'a JSON client never triggers an upstream stream')
  })
})

test('the handshake is written before the upstream answers', async () => {
  await withKey(async () => {
    fetchCalls = []
    sseChunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: '{}' } }] }) + '\n\n', 'data: [DONE]\n\n']
    // Park the upstream until the assertions below have seen the headers.
    let release
    const gate = new Promise(r => (release = r))
    deferred = gate

    const res = makeRes()
    const done = coach(
      {
        method: 'POST',
        url: '/coach',
        headers: { 'x-forwarded-for': '198.51.100.' + ++seq, accept: 'text/event-stream' },
        body: { kind: 'review', payload: {} },
      },
      res,
    )
    for (let i = 0; i < 50 && res.statusCode === null; i++) await new Promise(r => setTimeout(r, 10))
    assert.equal(res.statusCode, 200, 'headers must not wait for the model')
    assert.match(res.headerRows[0]['content-type'], /text\/event-stream/)
    release()
    await done
    assert.equal(res.ended, true)
  })
})

test('an upstream failure after the headers are open reaches the client as an error event', async () => {
  await withKey(async () => {
    fetchCalls = []
    sseChunks = []
    const okFetch = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: { message: 'upstream unavailable' } }),
    })
    try {
      const res = await call('text/event-stream')
      assert.equal(res.statusCode, 200, 'headers were already open')
      const evs = events(res)
      const err = evs.at(-1)
      assert.equal(err.type, 'error', `last frame: ${res.chunks.join('|')}`)
      assert.equal(err.ok, false)
      assert.match(err.error, /upstream unavailable/)
      assert.equal(err.status, 502)
      assert.equal(res.ended, true)
    } finally {
      globalThis.fetch = okFetch
    }
  })
})

test('without the SSE accept header nothing changes: one JSON answer, no stream frames', async () => {
  await withKey(async () => {
    fetchCalls = []
    sseChunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: 'nobody asked' } }] }) + '\n\n']
    const res = await call('application/json')
    assert.deepEqual(res.chunks, [], 'no SSE frames were written')
    assert.equal(res.headerRows[0]['content-type'].includes('application/json'), true)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.text, JSON_ANSWER)
    assert.equal(fetchCalls[0].body.stream, undefined)
  })
})
