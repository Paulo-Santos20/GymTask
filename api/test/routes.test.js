/* The Coach disclosure and community routes, driven with fake server helpers — the layer
 * between the route and the config store. The user routes are exercised through jobs.test.js. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { tempData } from './helpers.mjs'

tempData()
const cfg = await import('../coach/config.js')
const { coachRoutes } = await import('../coach/routes.js')

// Every test starts from an empty coach.json: reset() only forgets the cache, and save() merges
// over what is on disk, so a key filed by the previous test would otherwise still be there.
const fresh = (patch = {}) => {
  cfg.reset()
  cfg.save({ enabled: true, provider: 'fixture', auth: {}, models: {}, providerOptions: {}, boundUid: {}, ...patch })
}

// The helpers server.js hands in, as fakes: one fixed signed-in user.
function harness() {
  const out = {}
  const routes = coachRoutes({
    json: (res, status, body) => {
      res.status = status
      res.body = body
    },
    readBody: async req => req.body || {},
    readSession: () => ({ id: 'admin-1' }),
  })
  const call = async (key, body) => {
    const res = {}
    await routes[key]({ body }, res)
    return res
  }
  out.call = call
  out.routes = routes
  return out
}

test('the disclosure names the provider and the same six categories the payload builds from', async () => {
  fresh({ provider: 'gemini' })
  const { call } = harness()
  const r = await call('GET /api/coach/disclosure')
  assert.equal(r.status, 200)
  assert.equal(r.body.providerLabel, 'Google Gemini')
  assert.deepEqual(r.body.categories, ['plan', 'training', 'bodyweight', 'profile', 'prefs', 'photo'])
})

/* ---------- debrief + cohort routes ---------- */
test('a debrief is enqueued as its own kind, and the cohort routes gate on the community switch and the opt-in', async () => {
  fresh({ community: false })
  const jobs = await import('../coach/jobs.js')
  const { writeState, sampleState } = await import('./helpers.mjs')
  const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js')
  forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' })
  writeState(process.env.DATA_DIR, 'admin-1', sampleState())
  const { call } = harness()

  const off = await call('GET /api/coach/cohort')
  assert.deepEqual(off.body, { ok: false, enabled: false })

  cfg.save({ community: true })
  assert.equal(cfg.load().community, true)
  assert.equal(cfg.publicConfig().community, true)

  const notSharing = await call('GET /api/coach/cohort')
  assert.deepEqual(notSharing.body, { ok: false, enabled: true, sharing: false })
  const share = await call('POST /api/coach/cohort/share', { share: true })
  assert.deepEqual(share.body, { ok: true, sharing: true })
  assert.equal(jobs.isSharing('admin-1'), true)
  const alone = await call('GET /api/coach/cohort')
  assert.equal(alone.body.ok, false)
  assert.equal(alone.body.sharing, true)
  assert.equal(alone.body.people, 1)

  const r = await call('POST /api/coach/debrief', { workoutId: 'w1' })
  assert.equal(r.status, 202)
  assert.equal(jobs.status('admin-1').job.kind, 'debrief')
  const until = Date.now() + 15000
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25))
  const s = jobs.status('admin-1')
  assert.equal(s.pending.kind, 'debrief')
  assert.deepEqual(s.pending.workout, {
    id: 'w1',
    d: '2026-07-20',
    name: 'Full body A',
    minutes: 45,
    vol: 600,
    sets: 3,
    prs: 0,
  })
  assert.equal(s.pending.score, 8)
  assert.ok(s.pending.summary.includes('3 sets'))
  assert.ok(Array.isArray(s.pending.nextTime) && s.pending.nextTime.length)
  assert.equal('changes' in s.pending, false)

  // A profile with nothing logged cannot be debriefed.
  jobs.resolvePending('admin-1', { accepted: ['debrief'] })
  writeState(process.env.DATA_DIR, 'admin-1', sampleState({ workouts: [] }))
  await call('POST /api/coach/debrief', {})
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25))
  assert.equal(jobs.status('admin-1').last.errorClass, 'noworkout')
})

/* ---------- mealplan ---------- */
test('a meal plan is enqueued with the nutrition block from the body and lands as a reviewable proposal', async () => {
  fresh()
  const jobs = await import('../coach/jobs.js')
  const { writeState, sampleState } = await import('./helpers.mjs')
  const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js')
  forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' })
  writeState(process.env.DATA_DIR, 'admin-1', sampleState())
  const { call } = harness()

  const nutrition = {
    targets: { tdee: 2450, kcal: 2450, protein: 165, carbs: 250, fat: 75 },
    recent: [{ d: '2026-10-03', kcal: 2310, protein: 152, carbs: 241, fat: 68 }],
  }
  const r = await call('POST /api/coach/mealplan', { nutrition })
  assert.equal(r.status, 202)

  const until = Date.now() + 15000
  while (jobs.status('admin-1').job && Date.now() < until) await new Promise(res => setTimeout(res, 25))
  const s = jobs.status('admin-1')

  assert.equal(s.pending.kind, 'mealplan')
  assert.equal(s.pending.meals.length, 4, 'one meal per diary section')
  assert.deepEqual(
    s.pending.meals.map(m => m.slot),
    ['cafe', 'almoco', 'lanche', 'jantar'],
  )
  assert.ok(
    s.pending.meals.every(m => m.items.length),
    'every meal carries its foods',
  )
  assert.ok(s.pending.totals.kcal > 0, 'the totals were computed from the items')
  // The fixture echoes the calorie target it was handed: this asserts the body field actually
  // rode through the route, the queue and the payload all the way to the model.
  assert.ok(s.pending.summary.includes('2450'), `summary "${s.pending.summary}" never saw the recorded TDEE`)
  jobs.resolvePending('admin-1', { dismissed: true })
})
