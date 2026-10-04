// Talking to the Coach endpoints, and knowing when to stop.
//
// Jobs are minutes-scale, so the client polls. The one rule worth stating: polling only runs
// while a Coach surface is on screen or a job is known to be in flight. An app that pings the
// server every thirty seconds forever because a feature exists is an app that costs battery
// for a feature nobody is using.

import { useEffect, useState, useCallback, useRef } from 'react'
import { api, appBase } from './api.js'
import { DEMO } from './demo.js'
import { t } from './i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

const POLL_MS = 3000 // a job is running: often enough to feel live
export const IDLE_MS = 15 * 60000 // a Coach screen is open but nothing is running — the audit's 15-min cadence window
export const STREAM_POLL_MS = 10000 // a healthy stream is attached: the poll is a backstop, not the heartbeat
const STREAM_FLUSH_MS = 32 // batch token renders — one paint per token is not a feature, it's a jank generator

/* The SSE side-channel's client half.
 *
 * Two jobs, deliberately separate: (1) a bus any surface can watch — the Coach chat renders
 * the accumulating text in place of the typing dots; (2) a job stream reader that follows
 * /api/coach/stream while a job runs. The 3 s status poll is the floor under all of it: a
 * dropped stream falls back to polling (the QA failure scenario), never to silence. The
 * stream is transport — the proposal the poll reports is the same one it always was. */

const streamSubs = new Set()
/** Subscribe to { type: 'text' | 'end' | 'drop', text? }. Returns the unsubscribe fn. */
export function onCoachStream(fn) {
  streamSubs.add(fn)
  return () => streamSubs.delete(fn)
}
const emitStream = ev => {
  for (const fn of [...streamSubs]) {
    try {
      fn(ev)
    } catch {
      /* one bad subscriber must not stop the others */
    }
  }
}

// Accumulated since the last reset: every flush reports the whole text so far, so a late
// subscriber (or a mid-stream flush that already fired) never sees a partial remainder.
let streamBuf = ''
let streamTotal = ''
let streamFlush = null
const beginFeed = () => {
  streamBuf = ''
  streamTotal = ''
  if (streamFlush) {
    clearTimeout(streamFlush)
    streamFlush = null
  }
  emitStream({ type: 'text', text: '' })
}
const feed = text => {
  streamBuf += text
  streamTotal += text
  if (streamFlush) return
  streamFlush = setTimeout(() => {
    streamFlush = null
    emitStream({ type: 'text', text: streamTotal })
  }, STREAM_FLUSH_MS)
}
/** The terminal flush: everything arrived lands at once, before the end event. */
const endFeed = () => {
  if (streamFlush) {
    clearTimeout(streamFlush)
    streamFlush = null
  }
  emitStream({ type: 'text', text: streamTotal })
}
const resetFeed = () => {
  streamBuf = ''
  streamTotal = ''
  if (streamFlush) {
    clearTimeout(streamFlush)
    streamFlush = null
  }
}

/** Parse an SSE body into (type, data) callbacks, buffering across chunk boundaries. */
async function readFrames(res, onEvent) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const type = /^event: (\S+)$/m.exec(frame)
      const data = /^data: (.*)$/m.exec(frame)
      if (!type || !data) continue
      let parsed
      try {
        parsed = JSON.parse(data[1])
      } catch {
        continue
      }
      onEvent(type[1], parsed)
    }
  }
}

let streamGen = 0 // bumped by every stop/end/drop — a reader from an older generation goes quiet
let streamFor = null // the job id currently being followed
const dropped = new Set() // jobs whose stream died — no reconnect loop for the same job

/** True while a job stream is meant to be live — the poll's backstop pacing reads this. */
export const coachStreamActive = () => streamFor != null

const stopStream = () => {
  streamGen++
  streamFor = null
  dropped.clear()
  resetFeed()
}

const dropStream = (jobId, gen) => {
  if (gen !== streamGen) return // a newer stop/end already happened
  streamGen++
  streamFor = null
  dropped.add(jobId)
  emitStream({ type: 'drop' })
}

const finishStream = gen => {
  if (gen !== streamGen) return
  streamGen++
  streamFor = null
  endFeed()
  emitStream({ type: 'end' })
}

/**
 * Follow the current job's token stream. Returns true when a reader is (or already was)
 * running for this job. Never in the demo build or on a phone with its own key — those
 * answer locally and have no server side-channel to follow. A job whose stream already
 * dropped is not re-opened: the poll below is its floor, and a reader that keeps dying must
 * not become a reconnect loop.
 */
export function openJobStream(jobId) {
  if (DEMO || LOCAL()) return false
  if (jobId == null) {
    stopStream()
    return false
  }
  if (streamFor === jobId) return true
  if (dropped.has(jobId)) return false
  stopStream()
  streamFor = jobId
  beginFeed()
  const gen = ++streamGen
  const url = appBase().replace(/\/$/, '') + '/api/coach/stream?job=' + encodeURIComponent(jobId)
  ;(async () => {
    try {
      const res = await fetch(url, { headers: { Accept: 'text/event-stream' } })
      if (gen !== streamGen || streamFor !== jobId) return
      const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '')
      if (!res.ok || !/text\/event-stream/.test(ct)) return dropStream(jobId, gen)
      let ended = false
      await readFrames(res, (type, data) => {
        if (gen !== streamGen || streamFor !== jobId) return
        if (type === 'delta') feed(String((data && data.text) || ''))
        else if (type === 'end') {
          ended = true
          finishStream(gen)
        }
      })
      // Closed without an end event: the connection died mid-job. Fall back to the poll.
      if (!ended && gen === streamGen && streamFor === jobId) dropStream(jobId, gen)
    } catch {
      if (gen === streamGen && streamFor === jobId) dropStream(jobId, gen)
    }
  })()
  return true
}

// The demo build has no backend, so it answers these locally with a canned proposal built
// from its own seeded profile (lib/coach-demo.js). Everything downstream — validation,
// staleness, apply, revert, the log — runs unchanged; only the provider is faked. The module
// is imported dynamically so none of it lands in a self-hosted bundle.
let demoMod = null
const demo = async () => (demoMod = demoMod || (await import('./coach-demo.js')))
const S = () => useStore.getState().S

// The third answer: a device that brought its own API key runs the Coach itself
// (lib/coach-local.js — the same core the server runs, imported lazily so the catalogue and the
// validator only ever load on a device that chose this). A device on the server branch takes
// the api() branch like any other; nothing on the demo build reaches this.
let localMod = null
const LOCAL = () => useStore.getState().coachLocal?.mode === 'byok'
const local = async () => {
  if (!localMod) {
    localMod = await import('./coach-local.js')
    // There is no admin card on a phone: the user is the operator, so failures go to them.
    localMod.setNotifier(ev => {
      const toast = useUI.getState().toast
      if (ev.kind === 'failed') toast(jobErrorText(ev.errorClass, ev.detail))
      else if (ev.kind === 'nochange')
        toast(t('Nothing to change right now: {0}', String(ev.reading || '').slice(0, 140)))
    })
  }
  return localMod
}

/* The server branch's own call. Unset (the default) → api(), byte-identical to before this
   dispatch existed. Set → the deployed Cloud Function's URL (VITE_COACH_FUNCTION_URL), an
   origin of its own: appBase() must NOT be prepended to it — a subpath deployment would
   corrupt the absolute URL (issue #238) — so this branch repeats api()'s request/response
   handling instead of passing an absolute URL through a helper that resolves against the
   page: same JSON headers, same throw of {message, status, data}. Demo and BYOK-local
   answer before this is ever reached. */
const FN = () => {
  try {
    return (import.meta.env?.VITE_COACH_FUNCTION_URL || '').replace(/\/+$/, '')
  } catch {
    return ''
  }
}
const server = async (path, opts) => {
  const base = FN()
  if (!base) return api(path, opts)
  const sse = !!(opts && opts.sse)
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers)
  if (sse) headers.Accept = 'text/event-stream'
  const r = await fetch(base + path, Object.assign({}, opts, { headers }))
  const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '')
  if (sse && r.ok && /text\/event-stream/.test(ct)) {
    // A streaming Cloud Function: deltas feed the bus as they land; the end frame carries the
    // whole answer, byte-identical to what the JSON path returns. An old deploy answering
    // plain JSON falls through to the exact code below, unchanged.
    beginFeed()
    let answer = null
    let failure = null
    await readFrames(r, (type, data) => {
      if (type === 'delta') feed(String((data && data.text) || ''))
      else if (type === 'end') answer = data
      else if (type === 'error') failure = data
    })
    endFeed()
    emitStream({ type: 'end' })
    if (failure) {
      const e = new Error(failure.error || 'stream failed')
      e.status = failure.status || 502
      e.data = failure
      throw e
    }
    if (answer) return answer
    const e = new Error('the stream ended without an answer')
    e.status = 0
    e.data = null
    throw e
  }
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(data.error || 'HTTP ' + r.status)
    e.status = r.status
    e.data = data
    throw e
  }
  return data
}

export const coachStatus = async () =>
  DEMO ? (await demo()).demoStatus() : LOCAL() ? (await local()).localStatus() : server('/api/coach/status')
export const requestReview = async note =>
  DEMO
    ? (await demo()).demoReview(S())
    : LOCAL()
      ? (await local()).localReview(S(), note)
      : server('/api/coach/review', { method: 'POST', body: JSON.stringify({ note: note || '' }), sse: true })
export const requestPlan = async intake =>
  DEMO
    ? (await demo()).demoPlan(S(), intake)
    : LOCAL()
      ? (await local()).localPlan(S(), intake)
      : server('/api/coach/plan', { method: 'POST', body: JSON.stringify({ intake }), sse: true })
export const refinePlan = async text =>
  DEMO
    ? (await demo()).demoRefine(S())
    : LOCAL()
      ? (await local()).localRefine(S(), text)
      : server('/api/coach/plan', { method: 'POST', body: JSON.stringify({ refine: text }), sse: true })
export const requestDebrief = async workoutId =>
  DEMO
    ? (await demo()).demoDebrief(S(), workoutId)
    : LOCAL()
      ? (await local()).localDebrief(S(), workoutId)
      : server('/api/coach/debrief', { method: 'POST', body: JSON.stringify({ workoutId: workoutId || null }), sse: true })
// The room: anonymous medians across the profiles on this instance that opted in. Only a
// server has a room; a phone with its own key and the demo both answer locally.
export const cohortStats = async () =>
  DEMO ? (await demo()).demoCohort(S()) : LOCAL() ? { ok: false, enabled: false } : server('/api/coach/cohort')
export const setCohortShare = async share =>
  DEMO || LOCAL()
    ? { ok: true, sharing: !!share }
    : server('/api/coach/cohort/share', { method: 'POST', body: JSON.stringify({ share: !!share }) })
export const resolvePending = async body =>
  DEMO
    ? (await demo()).demoResolve()
    : LOCAL()
      ? (await local()).localResolve(body)
      : server('/api/coach/pending/resolve', { method: 'POST', body: JSON.stringify(body) })
export const forgetCoach = async () =>
  DEMO
    ? (await demo()).demoResolve()
    : LOCAL()
      ? (await local()).localForget()
      : server('/api/coach/forget', { method: 'POST', body: '{}' })
export const disclosure = async () =>
  DEMO ? (await demo()).demoDisclosure() : LOCAL() ? (await local()).localDisclosure() : server('/api/coach/disclosure')

/* Whose provider account this profile is about to spend. Its own call because the constraint is
   that the Coach screen states it too, not just the admin card — and because in instance mode a
   second profile is refused outright, which is something the user has to be able to read before
   they ask for anything rather than after a job is turned down. */
export const coachAccount = async () =>
  DEMO
    ? {
        mode: 'instance',
        provider: 'demo',
        providerLabel: 'Demo',
        account: null,
        connected: true,
        reason: null,
        message: null,
      }
    : LOCAL()
      ? {
          mode: 'device',
          provider: useStore.getState().coachLocal.provider,
          providerLabel: null,
          account: null,
          connected: true,
          reason: null,
          message: null,
        }
      : api('/api/coach/account')

/**
 * Live job/proposal state.
 *
 * `active` lets a caller (the Home card) subscribe only while it is mounted and visible;
 * everything else keeps the poll off. Errors are swallowed on purpose — a Coach status call
 * failing while you are mid-workout is not something to interrupt anyone about.
 */
export function useCoachStatus(active = true) {
  const [state, setState] = useState({ job: null, pending: null, cap: null, loading: true, streamText: '' })
  const timer = useRef(null)
  const loop = useRef(null) // the running poll loop's `tick`, so a manual refresh can re-pace it

  // How often the status poll should run given what we just learned: idle when nothing is
  // running, backstop (never the primary transport) while a healthy stream is attached,
  // the usual 3 s cadence otherwise — the floor under every failure mode.
  const paceFor = useCallback(
    s => (!s?.job ? IDLE_MS : coachStreamActive() ? STREAM_POLL_MS : POLL_MS),
    [],
  )

  const refresh = useCallback(async () => {
    try {
      const s = await coachStatus()
      setState(prev => ({ ...prev, ...s, loading: false }))
      // Follow (or release) the job's token stream alongside the status itself.
      if (s?.job) openJobStream(s.job.id)
      else openJobStream(null)
      // A refresh that finds a job in flight — the one the caller just started — must not leave
      // the loop asleep on its idle cadence: without this the card shows up to fifteen minutes
      // after the job ended, sitting on "thinking…" the whole time.
      if (s?.job && loop.current) {
        clearTimeout(timer.current)
        timer.current = setTimeout(loop.current, paceFor(s))
      }
      return s
    } catch {
      setState(s => ({ ...s, loading: false }))
      return null
    }
  }, [paceFor])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const repace = ms => {
      if (stopped) return
      clearTimeout(timer.current)
      timer.current = setTimeout(loop.current, ms)
    }
    // The stream's lifecycle drives the poll: text lands in state as it arrives, the end
    // event means "look for the proposal right now", a drop falls back to the 3 s floor.
    const un = onCoachStream(ev => {
      if (ev.type === 'text') setState(prev => ({ ...prev, streamText: ev.text }))
      else if (ev.type === 'end') repace(0)
      else if (ev.type === 'drop') repace(POLL_MS)
    })
    const tick = async () => {
      const s = await refresh()
      if (stopped) return
      clearTimeout(timer.current)
      timer.current = setTimeout(tick, paceFor(s))
    }
    loop.current = tick
    tick()
    return () => {
      stopped = true
      loop.current = null
      un()
      clearTimeout(timer.current)
    }
  }, [active, refresh, paceFor])

  return { ...state, refresh }
}

// Server failure classes, in the app's voice. The provider's own words go to the admin card;
// what a lifter needs is what it means for them and whether trying again will help.
export const JOB_ERRORS = {
  off: 'The Coach isn’t set up on this instance.',
  busy: 'The Coach is already thinking about your training.',
  cap: 'The Coach is resting — try again tomorrow.',
  consent: 'The Coach needs your go-ahead first.',
  timeout: 'The Coach took too long and gave up.',
  auth: 'The Coach couldn’t sign in to its provider — the instance owner needs to check its setup.',
  missing: 'The Coach isn’t installed properly on this instance.',
  provider: 'The Coach couldn’t run — the instance owner needs to check its setup.',
  unusable: 'The Coach answered with something the app couldn’t use.',
  restart: 'The server restarted while the Coach was thinking.',
  nostate: 'The Coach couldn’t read your training data.',
  noworkout: 'There is no workout to look at yet — log one first.',
  internal: 'Something went wrong on the server.',
}

// The same failures on a phone that brought its own key: there is no instance owner to
// check anything, the person reading this is the operator, and the provider's own words
// are the only thing that lets them fix it (a spent quota, a wrong model, a rejected key).
export const BYOK_ERRORS = {
  auth: 'Your AI provider rejected the key on this phone — check it under Settings → AI Coach.',
  missing: 'The Coach isn’t set up on this phone — check Settings → AI Coach.',
  provider: 'Your AI provider couldn’t answer.',
  unusable: 'The Coach answered with something the app couldn’t use.',
  internal: 'Something went wrong on this phone.',
}

/** The line the person sees for a failed job — with the reason attached where they can act on it. */
export function jobErrorText(cls, detail) {
  const own = LOCAL()
  const base = (own && BYOK_ERRORS[cls]) || JOB_ERRORS[cls] || (own ? BYOK_ERRORS.internal : JOB_ERRORS.internal)
  const why = own && detail ? String(detail).trim().slice(0, 300) : ''
  return why ? `${base}\n${why}` : base
}
