'use strict'
/* RF8 — the scheduled weekly review (roadmap plan todo 8). node:test + node:assert only.
 *
 * What this pins down, per plan todo 8 + functions/README.md's contracts:
 *   weeklyReview  opted-in fixture user with new data → the model runs ONCE (fetch stubbed)
 *                 and exactly ONE pending proposal lands in the SAME store the app resolves:
 *                 DATA_DIR/coach/<uid>.json — proven round-trip by importing the api's OWN
 *                 jobs.js and asserting status() serves it and resolvePending() clears it.
 *   re-run        same week → still one pending (0 extra model calls): idempotent.
 *   skips         no consent / cadence off / no new data / wrong weekday → nothing written,
 *                 no model call (red before the implementation exists).
 *   nochange      {"nochange":true} → nothing written (the api's nochange outcome).
 *   unusable      garbage answer → nothing written, the run does not throw.
 *
 * How: DATA_DIR is a temp dir laid out exactly like api/coach/jobs.js:36-37 expects
 * (state-<uid>.json + coach/<uid>.json); global fetch is stubbed BEFORE index.js loads, so
 * nothing ever leaves the process. The schedule itself runs through the same `.run()`
 * entry the pushDailyReminder suite uses. */
const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/* ------------------------- offline interception ------------------------- */

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gymtask-weekly-'))
process.env.DATA_DIR = DATA // the api's own variable (api/coach/jobs.js:36)
process.env.XAI_API_KEY = 'test-key'

const realFetch = globalThis.fetch
let fetchCalls = []
let answer = null // the canned model output for the run under test

globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), sent: JSON.parse(opts.body) })
  const content = answer
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
  }
}
after(() => {
  globalThis.fetch = realFetch
})

const { weeklyReview } = require('../index.js')

/* ------------------------------ fixtures ------------------------------- */

const DAY = 86400000
const NOW = Date.now()
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const weekdayIn = (tz, d) => {
  try {
    return DAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d))
  } catch {
    return d.getUTCDay()
  }
}
const TODAY_DAY = weekdayIn('America/Sao_Paulo', new Date(NOW))
const iso = ms => new Date(ms).toISOString().slice(0, 10)

const coachFile = uid => path.join(DATA, 'coach', uid + '.json')
const readCoach = uid => {
  try {
    return JSON.parse(fs.readFileSync(coachFile(uid), 'utf8'))
  } catch {
    return null
  }
}
const writeState = (uid, S) => fs.writeFileSync(path.join(DATA, 'state-' + uid + '.json'), JSON.stringify(S))

const GOOD = JSON.stringify({
  summary: 'Duas sugestões para a semana.',
  changes: [
    {
      id: 'c1',
      type: 'sets',
      target: { routineId: 'r1', exId: 'ex1' },
      why: 'Você completou 8 reps nas 3 séries das últimas sessões.',
      after: 4,
    },
    {
      id: 'c2',
      type: 'rename-routine',
      target: { routineId: 'r1' },
      why: 'Nome curto, o plano só tem uma rotina.',
      after: 'Força A',
    },
  ],
})

const baseState = () => ({
  lang: 'pt',
  unit: 'kg',
  targetW: 82,
  reminder: { tz: 'America/Sao_Paulo' },
  coach: {
    consent: { agreedAt: '2026-01-01', version: 1 },
    cadence: { weekly: { day: TODAY_DAY, time: '18:00' } },
    lastReview: null,
    profile: {
      goal: 'Ganhar força',
      experience: '2 anos',
      daysPerWeek: 3,
      preferredDays: [1, 3, 5],
      sessionMin: 60,
      equipment: ['barra'],
      limitations: '',
      likes: '',
      dislikes: '',
      notes: '',
    },
  },
  routines: [
    {
      id: 'r1',
      name: 'A',
      prog: 'linear',
      ex: [{ id: 'ex1', sets: 3, reps: 8, weight: 60, prog: 'linear', inc: 2.5 }],
    },
  ],
  week: { 1: ['r1'] },
  workouts: [
    {
      id: 'w1',
      d: iso(NOW - 2 * DAY),
      end: NOW - 2 * DAY,
      name: 'A',
      entries: [{ id: 'ex1', sets: [{ done: true, r: 8, w: 60 }] }],
    },
  ],
  bodyweight: [{ d: iso(NOW - DAY), w: 82.4 }],
})

/** Write an opted-in profile, patching the coach block (and anything else) as needed. */
const mk = (uid, patch = {}) => {
  const S = baseState()
  if (patch.coach) S.coach = { ...S.coach, ...patch.coach }
  for (const k of Object.keys(patch)) if (k !== 'coach') S[k] = patch[k]
  writeState(uid, S)
  return S
}

mk('fx') // the opted-in fixture user with new data
mk('noconsent', { coach: { consent: null } })
mk('optout', { coach: { cadence: 'off' } })
mk('nodata', {
  coach: { lastReview: { at: NOW - 10 * DAY } },
  workouts: [{ id: 'old', d: iso(NOW - 12 * DAY), end: NOW - 12 * DAY, name: 'A', entries: [] }],
})
mk('wrongday', { coach: { cadence: { weekly: { day: (TODAY_DAY + 1) % 7, time: '18:00' } } } })

/* --------------------------------- tests -------------------------------- */

test('weeklyReview: opted-in fixture user with new data → exactly one pending proposal', async () => {
  answer = GOOD
  fetchCalls = []
  await weeklyReview.run({})

  assert.equal(fetchCalls.length, 1, 'one model call for the one due profile')
  const msgs = fetchCalls[0].sent.messages
  assert.equal(msgs.length, 2, 'system rules + payload user block')
  assert.match(msgs[0].content, /GymTask Coach/, 'the shared system prompt leads')
  assert.match(msgs[1].content, /"task":"review"/, 'the review payload rides')
  assert.ok(msgs[1].content.length < 100000, 'payload stays small')

  const rec = readCoach('fx')
  assert.ok(rec, 'the proposal store exists for the fixture profile')
  assert.ok(rec.pending, 'a pending proposal is waiting')
  assert.equal(rec.pending.kind, 'review')
  assert.equal(rec.pending.iteration, 1)
  assert.ok(Math.abs(rec.pending.expiresAt - (rec.pending.createdAt + 14 * 86400000)) < 5000, 'FR-33 14-day expiry')
  assert.equal(rec.pending.summary, 'Duas sugestões para a semana.')
  assert.equal(rec.pending.changes.length, 2)
  assert.equal(rec.pending.changes[0].before, 3, 'before is read off the plan the client compares against')
  assert.equal(rec.pending.changes[1].before, 'A')
  assert.equal(rec.pending.changes[0].why.length > 0, true)
  const line = (rec.history || []).at(-1)
  assert.equal(line.kind, 'review')
  assert.equal(line.trigger, 'scheduled')
  assert.equal(line.outcome, 'ready')

  for (const uid of ['noconsent', 'optout', 'nodata', 'wrongday']) {
    assert.equal(readCoach(uid), null, uid + ' must be skipped with nothing written')
  }
})

test('weeklyReview: re-running the same week is idempotent — still one pending, no second call', async () => {
  const before = readCoach('fx').pending
  fetchCalls = []
  await weeklyReview.run({})
  assert.equal(fetchCalls.length, 0, 'a waiting proposal stops the run before the model')
  const after = readCoach('fx')
  assert.equal(after.pending.id, before.id, 'the same pending, not a second one')
  assert.equal(after.pending.changes.length, before.changes.length)
})

test("the written proposal is the api store's own — status() serves it, resolvePending() clears it", async () => {
  const jobs = await import('../../api/coach/jobs.js')
  const served = jobs.status('fx')
  assert.ok(served.pending, 'GET /api/coach/status would answer with this proposal')
  assert.deepEqual(served.pending, readCoach('fx').pending, 'byte-identical to the file the function wrote')
  assert.equal(served.pending.kind, 'review')

  const res = jobs.resolvePending('fx', { accepted: ['c1'], rejected: [] })
  assert.deepEqual(res, { ok: true })
  assert.equal(jobs.status('fx').pending, null, 'POST /api/coach/pending/resolve clears it')
  const line = readCoach('fx').history.at(-1)
  assert.equal(line.outcome, 'applied')
  assert.equal(line.kind, 'review')
  assert.equal(line.accepted, 1)
})

test('weeklyReview: after the proposal was resolved the same week, no new one is created', async () => {
  fetchCalls = []
  await weeklyReview.run({})
  assert.equal(fetchCalls.length, 0, 'a review finished this week stops the run before the model')
  assert.equal(readCoach('fx').pending, null, 'still zero pending proposals for the profile')
})

test('weeklyReview: {"nochange":true} writes nothing', async () => {
  mk('quiet')
  answer = JSON.stringify({ nochange: true, reading: 'Nothing worth changing this week.' })
  fetchCalls = []
  await weeklyReview.run({})
  assert.equal(fetchCalls.length, 1, 'the due profile still asked the model')
  const rec = readCoach('quiet')
  assert.equal(rec && rec.pending, null, 'no proposal is held when there is nothing to propose')
  // The api records nochange as "reviewed" (jobs.finish outcome nochange, read by
  // cadence.js:76-77), so this run must leave the same line or cadence would re-ask daily.
  assert.equal(rec.history.at(-1).outcome, 'nochange')
  assert.equal(rec.history.at(-1).kind, 'review')
})

test('weeklyReview: an unusable answer is dropped, the run does not throw', async () => {
  mk('broken', { coach: { cadence: { weekly: { day: TODAY_DAY, time: '18:00' } } } })
  answer = '{"changes": "not-an-array"}'
  fetchCalls = []
  await weeklyReview.run({})
  assert.equal(fetchCalls.length, 1)
  const rec = readCoach('broken')
  assert.equal(rec.pending, null, 'nothing partial is ever left behind')
  // Paid for, garbage out: recorded exactly like api's failed/unusable, which cadence
  // (jobs.js history + cadence.js:76-78) counts as reviewed instead of retrying tomorrow.
  assert.equal(rec.history.at(-1).outcome, 'failed')
  assert.equal(rec.history.at(-1).errorClass, 'unusable')
  assert.equal(readCoach('fx').pending, null, 'profiles already reviewed are untouched')
})

test('weeklyReview: no XAI_API_KEY → the run skips before spending anything', async () => {
  mk('nokey') // due on its own — the key gate must be what stops it
  const key = process.env.XAI_API_KEY
  delete process.env.XAI_API_KEY
  fetchCalls = []
  try {
    await weeklyReview.run({})
  } finally {
    process.env.XAI_API_KEY = key
  }
  assert.equal(fetchCalls.length, 0, 'no model call without a key')
  assert.equal(readCoach('nokey'), null, 'and nothing written for the profile it would have served')
  assert.equal(readCoach('fx').pending, null)
})
