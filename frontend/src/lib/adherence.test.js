import { describe, expect, it } from 'vitest'
import { weeklyAdherence } from './adherence.js'
import { MONDAY, SUNDAY, isoOf, startOfWeek } from './format.js'

// A fixed Monday-first week: 2026-01-19 (Mon) .. 2026-01-25 (Sun), the week 2026-01-21 falls in.
const MON = '2026-01-19'
const WED = '2026-01-21'
const FRI = '2026-01-23'
const SAT = '2026-01-24'
const SUN = '2026-01-25'
const PREV_SUN = '2026-01-18' // the Sunday before, i.e. last week for a Monday profile

const routines = [{ id: 'r1', name: 'Push', ex: [] }]
const base = (over = {}) => ({
  week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, // Mon / Wed / Fri
  dayPlan: {},
  routines,
  workouts: [],
  ...over,
})
const w = d => ({ id: 'w-' + d, d, entries: [] })

describe('weeklyAdherence — sessions against the days the effective plan has', () => {
  it('counts two sessions against a Mon/Wed/Fri week', () => {
    expect(weeklyAdherence(base({ workouts: [w(MON), w(WED)] }), WED)).toEqual({
      done: 2,
      planned: 3,
      pct: 67,
    })
  })

  it('honors a moved day: Fri → Sat leaves the week at three planned days', () => {
    const S = base({ dayPlan: { [FRI]: 'rest', [SAT]: 'r1' }, workouts: [w(MON), w(SAT)] })
    expect(weeklyAdherence(S, WED)).toEqual({ done: 2, planned: 3, pct: 67 })
  })

  it('drops a template day the profile marked rest, where the old static count kept it', () => {
    // The Home denominator used to read S.week alone, so clearing Friday still said three.
    expect(weeklyAdherence(base({ dayPlan: { [FRI]: 'rest' } }), WED)).toEqual({
      done: 0,
      planned: 2,
      pct: 0,
    })
  })

  it('adds a day the profile added on top of the template', () => {
    const S = base({ dayPlan: { [SAT]: 'r1' } })
    expect(weeklyAdherence(S, WED).planned).toBe(4)
  })

  it('counts only the week iso falls in, across the boundary', () => {
    const S = base({ workouts: [w(PREV_SUN), w(MON), w(SUN)] })
    // This week (Mon 19 .. Sun 25): the Monday and the Sunday here, not the one before.
    expect(weeklyAdherence(S, WED)).toEqual({ done: 2, planned: 3, pct: 67 })
    // The week before (Mon 12 .. Sun 18): only the straddling Sunday, and the same 3 planned.
    expect(weeklyAdherence(S, PREV_SUN)).toEqual({ done: 1, planned: 3, pct: 33 })
  })

  it('follows a Sunday-first profile’s week start', () => {
    // Same iso and same workouts as the Monday-first reads above: this profile's week is
    // Sun 2026-01-18 .. Sat 2026-01-24, whose only Sunday (its one template day) is the 18th —
    // so it plans 1, where the Monday-first reading of the same iso claims 3, while both the
    // straddling Sunday and the Monday still fall inside the week.
    const S = base({ weekStart: SUNDAY, week: { 0: ['r1'] }, workouts: [w(PREV_SUN), w(MON)] })
    expect(weeklyAdherence(S, WED)).toEqual({ done: 2, planned: 1, pct: 200 })
  })

  it('is a ratio, not a cap: two sessions on the one planned day is 2 of 1', () => {
    const S = base({ week: { 1: ['r1'] }, workouts: [w(MON), w(MON)] })
    expect(weeklyAdherence(S, WED)).toEqual({ done: 2, planned: 1, pct: 200 })
  })

  it('reports pct null when nothing is planned, however much was trained', () => {
    const S = base({ week: {}, workouts: [w(MON)] })
    expect(weeklyAdherence(S, MON)).toEqual({ done: 1, planned: 0, pct: null })
  })

  it('ignores template entries that are no longer a routine', () => {
    expect(weeklyAdherence(base({ week: { 1: ['ghost'], 3: ['r1'] } }), WED).planned).toBe(1)
  })

  it('is total on a profile that has never carried a week template', () => {
    expect(weeklyAdherence({ workouts: [] }, MON)).toEqual({ done: 0, planned: 0, pct: null })
  })

  it('walks the seven days of the week the iso actually sits in', () => {
    // Guard against a helper that assumed Monday: for this iso the week start is itself.
    const S = base({ weekStart: SUNDAY, week: { 0: ['r1'] } })
    const start = startOfWeek(WED, SUNDAY)
    expect(isoOf(start)).toBe('2026-01-18')
    expect(weeklyAdherence(S, WED).planned).toBe(1)
    // and the Monday-first profile still starts on Monday
    expect(isoOf(startOfWeek(WED, MONDAY))).toBe(MON)
  })
})
