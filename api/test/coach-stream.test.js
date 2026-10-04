/* The model's answer as it is written: an SSE side-channel beside the status poll.
 *
 * Two things have to stay true while it exists. The proposal the client ends up holding is
 * the same one a watcher-less run produced — byte for byte, volatile fields aside — and a
 * client that does not ask for text/event-stream keeps getting the plain JSON status answer
 * it gets today. The stream is opt-in at the Accept header, never a new default. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempData, writeState, sampleState } from './helpers.mjs'

const DIR = tempData()
const cfg = await import('../coach/config.js')
const jobs = await import('../coach/jobs.js')
const { coachRoutes } = await import('../coach/routes.js')
const { extractJSON } = await import('../coach/core/parse.js')
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js')

cfg.save({ enabled: true, provider: 'fixture' })
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' })

const until = async (cond, ms = 15000) => {
  const t = Date.now() + ms
  while (!cond() && Date.now() < t) await new Promise(r => setTimeout(r, 25))
  assert.ok(cond(), 'condition never became true')
}
const settle = async (uid, ms = 15000) => {
  const t = Date.now() + ms
  while (Date.now() < t) {
    const s = jobs.status(uid)
    if (!s.job) return s
    await new Promise(r => setTimeout(r, 25))
  }
  throw new Error('job never finished')
}

/** The routes layer with fake server helpers — enough of a response object to open an SSE
 *  reply (writeHead/write/end) and to record the events it writes, plus the plain json()
 *  path the non-SSE answer takes. */
function harness(uid) {
  const events = []
  const res = {
    headers: null,
    ended: false,
    headersSent: false,
    writeHead(code, headers) {
      this.headers = { code, headers }
      this.headersSent = true
    },
    write(chunk) {
      const m = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(String(chunk))
      if (m) {
        try {
          events.push({ type: m[1], ...JSON.parse(m[2]) })
        } catch {
          events.push({ type: m[1], raw: m[2] })
        }
      }
    },
    end(chunk) {
      if (chunk !== undefined && chunk !== null) this.write(chunk)
      this.ended = true
    },
  }
  const routes = coachRoutes({
    json: (r, code, body) => {
      r.status = code
      r.body = body
    },
    readBody: async req => req.body || {},
    readSession: () => ({ id: uid }),
  })
  const call = async (accept, url = '/api/coach/stream') =>
    routes['GET /api/coach/stream']({ url, headers: { accept } }, res)
  return { res, events, call, routes }
}

test('a client that does not ask for SSE keeps the plain JSON status answer', async () => {
  const { res, call } = harness('u-plain')
  await call('application/json')
  assert.equal(res.status, 200)
  assert.equal(res.headers, null, 'no stream headers were opened')
  assert.deepEqual(Object.keys(res.body).sort(), ['cap', 'job', 'last', 'pending'])
})

test('a watched job streams tokens before it ends, and lands the same proposal a watcher-less run produced', async () => {
  // The control: nobody attached, the answer exactly as the poll has always reported it.
  const uidA = 'u-stream-plain'
  writeState(DIR, uidA, sampleState())
  jobs.enqueue(uidA, { kind: 'review' })
  const sA = await settle(uidA)
  assert.equal(sA.pending?.kind, 'review')

  // The same state with a subscriber attached from enqueue to end.
  const uidB = 'u-stream-watched'
  writeState(DIR, uidB, sampleState())
  const { res, events, call } = harness(uidB)
  const { id: jobId } = jobs.enqueue(uidB, { kind: 'review' })
  const t0 = Date.now()
  await call('text/event-stream, */*')
  assert.ok(res.headersSent, 'the handshake must not wait for the job')
  assert.ok(Date.now() - t0 < 1000, `handshake took ${Date.now() - t0} ms`)
  assert.equal(res.headers.code, 200)
  assert.match(res.headers.headers['Content-Type'], /text\/event-stream/)
  await until(() => res.ended)

  const types = events.map(e => e.type)
  assert.equal(types[0], 'job', `first event names the job: ${types.join(',')}`)
  const firstDelta = types.indexOf('delta')
  const endAt = types.indexOf('end')
  assert.ok(firstDelta > 0, `tokens arrived: ${types.join(',')}`)
  assert.ok(endAt > firstDelta, 'tokens precede the end, not dumped with it')
  assert.equal(events[endAt].outcome, 'ready', 'the end says how the job ended')
  for (const e of events) assert.equal(e.jobId, jobId, 'every event belongs to the job asked for')

  const streamed = events.filter(e => e.type === 'delta').map(e => e.text).join('')
  assert.ok(streamed.length > 0, 'the answer arrived as text')
  assert.ok(extractJSON(streamed).value, 'the joined deltas parse by the same parser the job used')
  assert.ok(streamed.includes('"changes"'), 'the deltas are the proposal, not a summary of it')

  const sB = await settle(uidB)
  assert.ok(sB.pending, 'the end is sent after the proposal is written, so a refresh on end finds it')
  const norm = p => {
    const { id, createdAt, expiresAt, ...rest } = p
    return JSON.stringify(rest)
  }
  const a = norm(sA.pending)
  const b = norm(sB.pending)
  console.log('STREAM_PENDING=' + b)
  console.log('LEGACY_PENDING=' + a)
  assert.equal(b, a, 'byte-identical proposal with and without a watcher')
})

test('a stream opened after the job is over ends at once instead of leaving a client waiting', async () => {
  const uid = 'u-stream-late'
  writeState(DIR, uid, sampleState())
  jobs.enqueue(uid, { kind: 'review' })
  await settle(uid)
  const { res, events, call } = harness(uid)
  await call('text/event-stream')
  assert.equal(res.ended, true)
  assert.deepEqual(events.map(e => e.type), ['end'])
})

test('an HTTPS provider streams token deltas whose joined bytes are the exact answer, watched or not', async () => {
  const http = await import('node:http')
  const content = '{"coach_contract":1,"nochange":true,"reading":"Streamed as she goes."}'
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const b = JSON.parse(body || '{}')
      seen.push(b)
      if (b.stream) {
        res.setHeader('content-type', 'text/event-stream')
        for (const p of [content.slice(0, 12), content.slice(12, 30), content.slice(30)])
          res.write(
            'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: p }, finish_reason: null }] }) + '\n\n',
          )
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
        res.write('data: [DONE]\n\n')
        res.end()
      } else {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }))
      }
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`

  const uid = 'u-stream-http'
  writeState(DIR, uid, sampleState())
  cfg.save({
    enabled: true,
    provider: 'compatible',
    providerOptions: { compatible: { baseUrl: base } },
    models: { compatible: 'local-model' },
  })
  try {
    const { res, events, call } = harness(uid)
    jobs.enqueue(uid, { kind: 'review' })
    await call('text/event-stream')
    await until(() => res.ended)
    const streamed = events.filter(e => e.type === 'delta').map(e => e.text).join('')
    assert.equal(streamed, content, 'the bytes on the wire joined in order are the answer itself')
    assert.equal(events.at(-1).type, 'end')
    assert.equal(events.at(-1).outcome, 'nochange')
    assert.ok(events.some(e => e.type === 'job'))

    // And a run nobody watched still lands the same reading — the stream is transport, never answer.
    const uid2 = 'u-stream-http-unwatched'
    writeState(DIR, uid2, sampleState())
    jobs.enqueue(uid2, { kind: 'review' })
    const s2 = await settle(uid2)
    assert.equal(s2.pending, null)
    assert.equal(jobs.readUser(uid2).history.at(-1).outcome, 'nochange')
    assert.equal(jobs.readUser(uid2).history.at(-1).reading, 'Streamed as she goes.')
  } finally {
    cfg.save({ provider: 'fixture' })
    server.close()
    server.closeAllConnections()
  }
})
