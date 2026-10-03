import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import { buildStarterPlan, starterPlanDays, starterPlanOptions, starterRoutines } from './starter.js'

// The approved prescription, written out again rather than imported: a test that reads the
// same table as the code would pass no matter what that table said. Each plan lists its
// routines once plus the schedule that places them on weekdays (a routine can repeat a day).
const APPROVED = {
  ppl: {
    routines: [
      ['Push Day', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
      ['Pull Day', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
      ['Leg Day', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
    ],
    schedule: [[1, 'Push Day'], [3, 'Pull Day'], [5, 'Leg Day']],
  },
  'upper-lower': {
    routines: [
      ['Upper A', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
      ['Lower A', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
      ['Upper B', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
      ['Lower B', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]],
    ],
    schedule: [[1, 'Upper A'], [2, 'Lower A'], [4, 'Upper B'], [5, 'Lower B']],
  },
  'full-body': {
    routines: [
      ['Full Body A', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
      ['Full Body B', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
      ['Full Body C', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]],
    ],
    schedule: [[1, 'Full Body A'], [3, 'Full Body B'], [5, 'Full Body C']],
  },
  '5x5': {
    routines: [
      ['5×5 A', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
      ['5×5 B', [['0085', 5, 5], ['0426', 5, 5], ['2330', 5, 5]]],
      ['5×5 C', [['0739', 5, 5], ['0047', 5, 5], ['1323', 5, 5]]],
    ],
    schedule: [[1, '5×5 A'], [3, '5×5 B'], [5, '5×5 C']],
  },
  'push-pull': {
    routines: [
      ['Push Day', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
      ['Pull Day', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
    ],
    schedule: [[1, 'Push Day'], [3, 'Pull Day'], [5, 'Push Day']],
  },
  'upper-ab': {
    routines: [
      ['Upper A', [['0025', 3, 8], ['0027', 3, 10], ['0426', 3, 10], ['2330', 3, 10], ['0031', 3, 10], ['0241', 3, 12]]],
      ['Upper B', [['0047', 3, 8], ['1323', 3, 10], ['0251', 3, 10], ['0334', 3, 12], ['0313', 3, 12], ['0092', 3, 12]]],
    ],
    schedule: [[1, 'Upper A'], [3, 'Upper B'], [5, 'Upper A']],
  },
  'bro-upper': {
    routines: [
      ['Chest Day', [['0025', 4, 8], ['0047', 3, 10], ['0251', 3, 10], ['0241', 3, 12], ['0092', 3, 12]]],
      ['Back Day', [['2330', 4, 10], ['0027', 3, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
      ['Shoulders Day', [['0426', 4, 8], ['0334', 3, 12], ['0383', 3, 12], ['0070', 3, 12], ['0060', 3, 12]]],
    ],
    schedule: [[1, 'Chest Day'], [3, 'Back Day'], [5, 'Shoulders Day']],
  },
}

const shape = r => r.ex.map(e => [e.id, e.sets, e.reps])

describe('starter plan catalog', () => {
  it('offers exactly the seven plans, with the day count read off the schedule', () => {
    expect(starterPlanOptions()).toEqual([
      { id: 'ppl', days: 3 }, { id: 'upper-lower', days: 4 },
      { id: 'full-body', days: 3 }, { id: '5x5', days: 3 },
      { id: 'push-pull', days: 3 }, { id: 'upper-ab', days: 3 },
      { id: 'bro-upper', days: 3 },
    ])
    for (const { id, days } of starterPlanOptions()) expect(starterPlanDays(id)).toHaveLength(days)
  })

  it('changes nothing for an unknown plan id', () => {
    expect(buildStarterPlan('nope')).toBeNull()
    expect(buildStarterPlan(undefined)).toBeNull()
    // A click handler wired straight to a loader would hand the event in as the plan.
    expect(buildStarterPlan({ type: 'click' })).toBeNull()
    expect(starterPlanDays('nope')).toBeNull()
  })
})

describe.each(Object.keys(APPROVED))('%s', planId => {
  const approved = APPROVED[planId]

  it('builds the approved exercises, sets and reps in order', () => {
    const { routines } = buildStarterPlan(planId)
    expect(routines.map(r => r.name)).toEqual(approved.routines.map(([name]) => name))
    routines.forEach((r, i) => expect(shape(r)).toEqual(approved.routines[i][1]))
  })

  it('puts each routine on its approved weekday, by identity not position', () => {
    const { routines, schedule } = buildStarterPlan(planId)
    const nameOf = Object.fromEntries(routines.map(r => [r.id, r.name]))
    expect(schedule.map(({ day, routineId }) => [day, nameOf[routineId]]))
      .toEqual(approved.schedule)
  })

  it('references only real exercises and starts every one at weight 0', () => {
    for (const r of buildStarterPlan(planId).routines) {
      for (const e of r.ex) {
        expect(EXIDX[e.id], e.id).toBeTruthy()
        expect(e.sets).toBeGreaterThan(0)
        expect(e.reps).toBeGreaterThan(0)
        expect(e.weight).toBe(0)
      }
    }
  })

  it('mints fresh ids and independent objects on every build', () => {
    const first = buildStarterPlan(planId)
    const second = buildStarterPlan(planId)
    const ids = first.routines.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.routines.some(r => ids.includes(r.id))).toBe(false)
    expect(first.routines[0].ex[0]).not.toBe(second.routines[0].ex[0])
    // and the static definition survives a caller mutating what it got back
    first.routines[0].ex[0].sets = 99
    expect(buildStarterPlan(planId).routines[0].ex[0].sets).toBe(approved.routines[0][1][0][1])
  })
})

describe('starterRoutines (the demo build entry point)', () => {
  it('still returns push, pull and legs unchanged', () => {
    const routines = starterRoutines()
    expect(routines.map(r => r.name)).toEqual(['Push Day', 'Pull Day', 'Leg Day'])
    routines.forEach((r, i) => expect(shape(r)).toEqual(APPROVED.ppl.routines[i][1]))
    expect(routines.map(r => r.emoji)).toEqual(['barbell', 'pullup', 'legs'])
  })

  it('mints fresh ids on every invocation', () => {
    const first = starterRoutines().map(r => r.id)
    const second = starterRoutines().map(r => r.id)
    expect(new Set([...first, ...second]).size).toBe(6)
  })
})
