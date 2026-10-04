// @vitest-environment happy-dom
// RF4 stream reader (plan todo 4): coach-api consumes the server's SSE side-channel, and the
// 3 s status poll stays the floor under every streamed byte. Pinned red-first:
//   - deltas reach subscribers batched to >=32 ms (no layout per token)
//   - while the stream is healthy the status poll runs on its backstop cadence; when the
//     stream drops mid-job the 3 s poll resumes (the QA failure scenario)
//   - a Cloud Function that streams feeds the same bus and resolves with the final event;
//     one that answers plain JSON (an old deploy) resolves exactly as before
//   - a phone with its own key never opens a stream
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openJobStream, onCoachStream, requestReview, useCoachStatus } from './coach-api.js'
import { useStore } from '../store/useStore.js'

const enc = new TextEncoder()
const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

/** A fake SSE response: the frames in order, then (park) a reader that stays open until the
 *  test drops it — the shape of a connection that dies without sending its end event. */
function sseRes(frames, { park = false } = {}) {
  let i = 0
  let unpark = null
  const res = {
    ok: true,
    status: 200,
    headers: { get: k => (/content-type/i.test(String(k)) ? 'text/event-stream' : null) },
    body: {
      getReader: () => ({
        read: async () => {
          if (i < frames.length) return { done: false, value: enc.encode(frames[i++]) }
          if (!park) return { done: true, value: undefined }
          return new Promise(r => {
            unpark = r
          })
        },
      }),
    },
  }
  res.drop = () => unpark && unpark({ done: true })
  return res
}

const jsonRes = body => ({
  ok: true,
  status: 200,
  headers: { get: k => (/content-type/i.test(String(k)) ? 'application/json' : null) },
  json: async () => body,
})

const flushMicro = async (n = 30) => {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

let root, container
function installDom() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
}

beforeEach(() => {
  openJobStream(null)
  useStore.setState({ coachLocal: null })
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  if (root) {
    await act(async () => {
      root.unmount()
    })
    root = null
  }
  if (container) {
    container.remove()
    container = null
  }
  useStore.setState({ coachLocal: null })
})

describe('the coach SSE reader', () => {
  it('delivers deltas to subscribers batched to at least 32 ms', async () => {
    vi.useFakeTimers()
    const seen = []
    const un = onCoachStream(ev => seen.push(ev))
    const fetchMock = vi.fn(async () =>
      sseRes(
        [
          frame('job', { type: 'job', jobId: 'j1' }),
          frame('delta', { type: 'delta', jobId: 'j1', text: 'hello ' }),
          frame('delta', { type: 'delta', jobId: 'j1', text: 'world' }),
        ],
        { park: true },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(openJobStream('j1')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/coach/stream?job=j1')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Accept: 'text/event-stream' })
    await flushMicro()

    // Only the reset has been announced; the deltas are still held for the flush window.
    expect(seen).toEqual([{ type: 'text', text: '' }])
    vi.advanceTimersByTime(20)
    expect(seen).toEqual([{ type: 'text', text: '' }])
    vi.advanceTimersByTime(20)
    expect(seen).toEqual([
      { type: 'text', text: '' },
      { type: 'text', text: 'hello world' },
    ])
    un()
  })

  it('falls back to the 3 s poll when the stream drops mid-job', async () => {
    vi.useFakeTimers()
    let statusCalls = 0
    let streamRes = null
    const fetchMock = vi.fn(async url => {
      const u = String(url)
      if (u.includes('/api/coach/status')) {
        statusCalls++
        return jsonRes({
          job: { id: 'j1', kind: 'review', state: 'running', startedAt: Date.now() },
          pending: null,
          cap: { used: 1, limit: 0 },
          last: null,
        })
      }
      if (u.includes('/api/coach/stream')) {
        streamRes = sseRes(
          [frame('job', { type: 'job', jobId: 'j1' }), frame('delta', { type: 'delta', jobId: 'j1', text: '{"a"' })],
          { park: true },
        )
        return streamRes
      }
      throw new Error('unexpected fetch: ' + u)
    })
    vi.stubGlobal('fetch', fetchMock)

    let probe = null
    const Probe = () => {
      probe = useCoachStatus(true)
      return null
    }
    installDom()
    await act(async () => {
      root.render(React.createElement(Probe))
    })
    await act(async () => {
      await flushMicro()
    })
    expect(statusCalls).toBe(1, 'the first status call found the job')
    expect(streamRes, 'the job opened a stream').toBeTruthy()
    expect(probe.streamText).toBe('')

    // Healthy stream: the 3 s poll must have slowed to its backstop cadence.
    await act(async () => {
      vi.advanceTimersByTime(3500)
    })
    expect(statusCalls).toBe(1, 'no 3 s poll while the stream is alive')

    // The stream drops mid-job — the 3 s poll is the floor and resumes.
    await act(async () => {
      streamRes.drop()
      await flushMicro()
    })
    await act(async () => {
      vi.advanceTimersByTime(3500)
    })
    expect(statusCalls).toBeGreaterThan(1, 'the poll resumed after the drop')
  })

  it('a Cloud Function that streams feeds the bus and resolves with the final event', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', 'https://fn.test')
    const answer = { nochange: true, reading: 'Streamed from the edge.' }
    const text = JSON.stringify({ coach_contract: 1, ...answer })
    const fetchMock = vi.fn(async () =>
      sseRes([
        frame('delta', { type: 'delta', text: text.slice(0, 10) }),
        frame('delta', { type: 'delta', text: text.slice(10) }),
        frame('end', { ok: true, model: 'grok-3-mini', text, answer }),
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const seen = []
    const un = onCoachStream(ev => seen.push(ev))

    const out = await requestReview('oi')
    expect(out).toEqual({ ok: true, model: 'grok-3-mini', text, answer })
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://fn.test/api/coach/review')
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    })
    const texts = seen.filter(e => e.type === 'text').map(e => e.text)
    expect(texts.at(-1)).toBe(text)
    expect(seen.at(-1).type).toBe('end')
    un()
  })

  it('a Cloud Function that answers plain JSON (old deploy) resolves exactly as before', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', 'https://fn.test')
    const body = { ok: true, model: 'grok-3-mini', text: 'plain', answer: { x: 1 } }
    const fetchMock = vi.fn(async () => jsonRes(body))
    vi.stubGlobal('fetch', fetchMock)

    const out = await requestReview('oi')
    expect(out).toEqual(body)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://fn.test/api/coach/review')
  })

  it('a phone with its own key never opens a stream', () => {
    useStore.setState({ coachLocal: { mode: 'byok', provider: 'compatible' } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(openJobStream('j1')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
