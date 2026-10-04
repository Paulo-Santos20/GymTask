/* The server's copies of three tiny reading rules, pinned against the frontend's originals.
 *
 * api/coach/payload.js re-implements modeOf, isBw and isPerSide because the api container has
 * no build step in common with the frontend and does not copy frontend/ into its image. That
 * trade-off is fine; what is not fine is the copy drifting, which is exactly what happened
 * when v1.2.4 taught the app about bodyweight work and per-side reps: the server kept reading
 * every set as a loaded rep set, so a push-up progression that was working would have looked
 * like a stalled bench press with the weight left at zero.
 *
 * This test only runs under vitest, which can load both runtimes. It compares behaviour over a
 * table of configs rather than comparing source, so the two are free to be written differently
 * as long as they answer the same.
 */
import { describe, it, expect } from 'vitest'
import { modeOf as uiModeOf, isBw as uiIsBw, isPerSide as uiIsPerSide } from './history.js'
import {
  modeOf as srvModeOf,
  isBw as srvIsBw,
  isPerSide as srvIsPerSide,
  build as srvBuild,
  workoutMeta as srvWorkoutMeta,
} from '../../../api/coach/core/payload.js'
import { exOr } from './exercises.js'
import {
  buildPlan as demoBuildPlan,
  buildDebrief as demoBuildDebrief,
  buildMealPlan as demoBuildMealPlan,
} from './coach-demo.js'

// Real ids from the catalogue, so `eq`/`bp` are whatever the dataset actually says rather than
// whatever this test assumed. 0001 is a bodyweight sit-up; the others are looked up the same way.
const IDS = ['0001', '0025', '0043', 'no-such-exercise']

const CONFIGS = [
  {},
  { mode: 'reps' },
  { mode: 'time' },
  { mode: 'cardio' },
  { mode: 'nonsense' },
  { mode: '' },
  { bodyweight: true },
  { bodyweight: false },
  { bodyweight: true, mode: 'time' },
  { side: true },
  { side: false },
  { side: true, bodyweight: true, mode: 'reps' },
  { reps: 8, sets: 3 },
  { repsMax: 20, reps: 12 },
]

describe('server/client reading rules agree', () => {
  for (const id of IDS) {
    const ex = exOr(id)
    for (const base of CONFIGS) {
      const cfg = { ...base, id }
      const label = `${id} ${JSON.stringify(base)}`

      it(`modeOf — ${label}`, () => {
        expect(srvModeOf(cfg, ex)).toBe(uiModeOf(cfg))
      })

      it(`isBw — ${label}`, () => {
        expect(srvIsBw(cfg, ex)).toBe(uiIsBw(cfg))
      })

      it(`isPerSide — ${label}`, () => {
        expect(srvIsPerSide(cfg)).toBe(uiIsPerSide(cfg))
      })
    }
  }

  it('an explicit flag beats the catalogue, on both sides', () => {
    const bodyweightEx = exOr('0001')
    expect(uiIsBw({ id: '0001' })).toBe(true)
    expect(srvIsBw({ id: '0001' }, bodyweightEx)).toBe(true)
    // A dip done with a belt turns it off; the server must agree, or it keeps reading the
    // added load as no load.
    expect(uiIsBw({ id: '0001', bodyweight: false })).toBe(false)
    expect(srvIsBw({ id: '0001', bodyweight: false }, bodyweightEx)).toBe(false)
  })
})

/* The create payload's `recent` block and the `prDetail` beside every `prs` count exist in two
 * places for the same reason the three reading rules above do: the demo's canned proposal never
 * reaches a server, so coach-demo.js carries its own twin of api/coach/core/payload.js's
 * readers. The demo answers from the frontend's own code — doneUnits for working sets, the
 * badge-awarding fold from doFinishWorkout for a load, EXIDX for a name — while the server
 * re-implements each. Both sides are compared over a table; for the absolute shape a single
 * expected value is pinned too, so the two cannot drift together into the same wrong answer.
 *
 * The table stays on catalogue ids: a custom exercise resolves through the client's registered
 * catalogue on the demo side while the server's shared slice only knows the built-in one — the
 * same gap the payload's `name` fields already have.
 */
describe('the demo payload mirrors the server recent block and PR detail', () => {
  const day = n => {
    const d = new Date()
    d.setDate(d.getDate() - n)
    return d.toISOString().slice(0, 10)
  }
  const sess = (id, n, entries, prs = []) => ({
    id,
    d: day(n),
    name: 'Full body A',
    start: 1000,
    end: 1000 + 45 * 60000,
    prs,
    entries,
  })
  // Warm-up, two work sets, one unfinished: working sets and load both have something to exclude.
  const plain = () => ({
    id: '0001',
    target: { sets: 3, reps: 10, weight: 20 },
    sets: [
      { w: 40, r: 10, done: true, warmup: true },
      { w: 20, r: 10, done: true },
      { w: 20, r: 9, done: true },
      { w: 20, r: 8, done: false },
    ],
  })
  const timed = () => ({
    id: '0007',
    target: { sets: 3, sec: 45 },
    sets: [
      { sec: 45, done: true },
      { sec: 45, done: true },
      { sec: 40, done: false },
    ],
  })
  const CASES = [
    ['no sessions at all', []],
    ['a session that set no PR gets no detail', [sess('a', 3, [plain()])]],
    ['a badge carries {id, name, load}', [sess('a', 3, [plain()], ['0001'])]],
    ['a timed PR has no load to report — 0, not a guess', [sess('a', 3, [timed()], ['0007'])]],
    [
      'a bodyweight PR with no added load reports 0',
      [sess('a', 3, [{ id: '0001', target: { sets: 3, reps: 15 }, sets: [{ w: 0, r: 15, done: true }] }], ['0001'])],
    ],
    [
      'a per-side row counts each limb for sets and reads the synced aggregate for load',
      [
        sess(
          'a',
          3,
          [
            {
              id: '0043',
              target: { sets: 2, reps: 8, weight: 17.5, side: true },
              sets: [
                {
                  sides: { L: { w: 17.5, r: 8, done: true }, R: { w: 17.5, r: 8, done: true } },
                  w: 17.5,
                  r: 16,
                  done: true,
                },
                {
                  sides: { L: { w: 17.5, r: 8, done: true }, R: { w: 17.5, r: 8, done: false } },
                  w: 17.5,
                  r: 8,
                  done: true,
                },
              ],
            },
          ],
          ['0043'],
        ),
      ],
    ],
    [
      'an assistance machine folds the other way — less help is the better record',
      [
        sess(
          'a',
          3,
          [
            {
              id: '0017',
              target: { sets: 2, reps: 8 },
              sets: [
                { w: 20, r: 8, done: true },
                { w: 25, r: 8, done: true },
              ],
            },
          ],
          ['0017'],
        ),
      ],
    ],
    [
      'the catalogue decides assisted — an entry flag does not re-award the fold',
      [
        sess(
          'a',
          3,
          [
            {
              id: '0017',
              target: { sets: 2, reps: 8, assisted: false },
              sets: [
                { w: 20, r: 8, done: true },
                { w: 25, r: 8, done: true },
              ],
            },
          ],
          ['0017'],
        ),
      ],
    ],
    [
      'a phase-tagged warm-up is prep, not the record',
      [
        sess(
          'a',
          3,
          [
            {
              id: '0001',
              target: { sets: 3, reps: 10, weight: 100 },
              sets: [
                { w: 100, r: 5, done: true, phase: 'warmup' },
                { w: 20, r: 10, done: true },
              ],
            },
          ],
          ['0001'],
        ),
      ],
    ],
    [
      'the newest five win; an older badge falls off the front',
      [
        sess('a', 18, [plain()], ['0001']),
        sess('b', 15, [plain()]),
        sess('c', 12, [plain()]),
        sess('d', 9, [plain()]),
        sess('e', 6, [plain()]),
        sess('f', 3, [plain()]),
      ],
    ],
    ['a badge whose entry is gone still names the exercise, load 0', [sess('a', 3, [plain()], ['0007'])]],
  ]

  const srvRecent = S => srvBuild(S, { handle: 'parity-handle-00', kind: 'create' }).recent

  for (const [label, workouts] of CASES) {
    it(label, () => {
      const S = { workouts }
      expect(demoBuildPlan(S, null).recent).toEqual(srvRecent(S))
    })
  }

  it('reads the way the plan specifies, not merely the way the other reader reads', () => {
    const S = { workouts: [sess('a', 3, [plain()], ['0001'])] }
    expect(demoBuildPlan(S, null).recent).toEqual([
      { d: day(3), entries: [{ id: '0001', sets: 2 }], prDetail: [{ id: '0001', name: '3/4 sit-up', load: 20 }] },
    ])
    expect(demoBuildPlan({ workouts: [] }, null).recent).toEqual([])
  })

  it('the demo debrief card carries the same PR detail as the server card', () => {
    const S = { workouts: [sess('a', 3, [plain()], ['0001']), sess('b', 1, [plain()])] }
    expect(demoBuildDebrief(S, 'a').workout.prDetail ?? null).toEqual(srvWorkoutMeta(S, 'a').prDetail ?? null)
    expect(demoBuildDebrief(S, 'b').workout.prDetail ?? null).toEqual(srvWorkoutMeta(S, 'b').prDetail ?? null)
    expect(demoBuildDebrief(S, 'a').workout.prDetail).toEqual([{ id: '0001', name: '3/4 sit-up', load: 20 }])
  })
})

/* RF6: the demo meal plan is the offline twin of the server's — and it has to satisfy the
   SERVER's validator, not merely look like a meal plan. A demo proposal that only the demo
   would accept is exactly the drift this file exists to catch. */
const { validateMealPlan } = await import('../../../api/coach/core/validate.js')

const MEAL_NUTRITION = {
  targets: { tdee: 2450, kcal: 2450, protein: 165, carbs: 250, fat: 75 },
  recent: [{ d: '2026-10-03', kcal: 2310, protein: 152, carbs: 241, fat: 68 }],
}

describe('the demo meal plan mirrors the server meal plan', () => {
  it('proposes what the SERVER validator accepts, one meal per diary section', () => {
    const pending = demoBuildMealPlan({ workouts: [] }, MEAL_NUTRITION)
    expect(pending.kind).toBe('mealplan')
    expect(pending.meals.map(m => m.slot)).toEqual(['cafe', 'almoco', 'lanche', 'jantar'])
    expect(pending.meals.every(m => m.items.length)).toBe(true)
    const r = validateMealPlan({ coach_contract: 1, ...pending })
    expect(r.ok).toBe(true, JSON.stringify(r.errors))
  })

  it('totals the items the way the server totals them — the same sum, not the model’s claim', () => {
    const pending = demoBuildMealPlan({ workouts: [] }, MEAL_NUTRITION)
    const r = validateMealPlan({
      coach_contract: 1,
      ...pending,
      totals: { kcal: 99999, protein: 0, carbs: 0, fat: 0 },
    })
    expect(r.ok).toBe(true)
    expect(r.proposal.totals).toEqual(pending.totals)
    const items = pending.meals.flatMap(m => m.items)
    expect(pending.totals.kcal).toBe(items.reduce((n, i) => n + i.kcal, 0))
  })

  it('shows the same recorded targets the server payload carries', () => {
    const S = { workouts: [] }
    const demo = demoBuildMealPlan(S, MEAL_NUTRITION)
    const server = srvBuild(S, { handle: 'parity-handle-00', kind: 'mealplan', nutrition: MEAL_NUTRITION })
    expect(demo.target).toEqual(MEAL_NUTRITION.targets)
    expect(demo.target).toEqual(server.nutrition.targets)
  })
})
