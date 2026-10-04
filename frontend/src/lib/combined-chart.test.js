// The combined Nutrition chart's data half: bodyweight, daily kcal intake and weekly
// training volume share ONE date axis, so a day (or a week) with nothing recorded is a
// gap — `y: null`, never a fake 0 that reads as "you ate nothing" or "you benched zero".
import { describe, expect, it } from 'vitest'
import { buildCombinedSeries } from './combined-chart.js'

// Tue 1 Sep 2026 → Mon 14 Sep 2026: 14 days across three Monday-based week buckets.
const seq = (start, n) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  )
const WINDOW = seq('2026-09-01', 14)
const MONDAY = 1

const eaten = kcal => [{ id: 'e1', meal: 'cafe', name: 'Oats', grams: 80, kcal, protein: 10, carbs: 30, fat: 5 }]
// `deleted-custom` is not in the catalogue, so the entry's own muscleGroups is what counts:
// N done sets → { chest: N }, i.e. the weekly volume number is loadOfWorkouts' own sum.
const trained = (d, sets) => ({
  d,
  entries: [
    {
      id: 'deleted-custom',
      muscleGroups: ['chest'],
      sets: Array.from({ length: sets }, () => ({ done: true, w: 60, r: 8 })),
    },
  ],
})

const fixture = () => {
  const log = {}
  for (const d of WINDOW) if (d !== '2026-09-06') log[d] = eaten(2200)
  const bodyweight = WINDOW.filter(d => d !== '2026-09-05').map((d, i) => ({
    d,
    w: 80 - 0.1 * i,
    t: Date.parse(d + 'T07:30:00Z'),
  }))
  const workouts = [trained('2026-09-02', 3), trained('2026-09-04', 2), trained('2026-09-14', 4)]
  return { bodyweight, log, workouts }
}

const build = (over = {}) =>
  buildCombinedSeries({ ...fixture(), unit: 'kg', days: 14, today: '2026-09-14', ws: MONDAY, ...over })

describe('combined chart series builder', () => {
  it('puts weight, intake and weekly volume on one 14-day date axis with every gap left null', () => {
    const s = build()

    expect(s.dates).toEqual(WINDOW)
    expect(s.weight.map(p => p.d)).toEqual(WINDOW)
    expect(s.intake.map(p => p.d)).toEqual(WINDOW)

    // the three gaps: a day with no weigh-in, a day with no food, a week with no training
    expect(s.weight[4]).toMatchObject({ d: '2026-09-05', y: null })
    expect(s.intake[5]).toMatchObject({ d: '2026-09-06', y: null })
    expect(s.volume.map(p => p.d)).toEqual(['2026-09-01', '2026-09-07', '2026-09-14'])
    expect(s.volume.map(p => p.y)).toEqual([5, null, 4])

    // recorded values survive: 80 kg weigh-in, 2200 kcal day, 3+2 = 5 working sets that week
    expect(s.weight[0].y).toBeCloseTo(80, 6)
    expect(s.weight[6]).toMatchObject({ d: '2026-09-07' })
    expect(s.weight[6].y).toBeCloseTo(79.5, 6)
    expect(s.intake[0].y).toBe(2200)
    expect(s.weight).toHaveLength(14)
    expect(s.intake).toHaveLength(14)
    expect(s.volume).toHaveLength(3)

    for (const p of [...s.weight, ...s.intake, ...s.volume]) {
      expect(Number.isFinite(p.t)).toBe(true)
    }
    for (const series of [s.weight, s.intake]) {
      const t = series.map(p => p.t)
      expect(t).toEqual([...t].sort((a, b) => a - b))
    }
  })

  it("reads a lb profile's weigh-ins in lb and emits the weight series in kg", () => {
    const s = build({
      unit: 'lb',
      bodyweight: [{ d: '2026-09-14', w: 180, t: Date.parse('2026-09-14T07:30:00Z') }],
    })

    expect(s.weight.at(-1).y).toBeCloseTo(180 * 0.45359237, 6)
    expect(s.weight.at(-1).y).not.toBe(180)
    // the gap is still a gap in the lb profile
    expect(s.weight[4].y).toBeNull()
  })

  it('leaves a kg profile’s weigh-ins untouched', () => {
    const s = build({ bodyweight: [{ d: '2026-09-14', w: 80, t: Date.parse('2026-09-14T07:30:00Z') }] })

    expect(s.weight.at(-1).y).toBe(80)
  })

  it('survives empty input instead of throwing', () => {
    const s = build({ bodyweight: [], log: {}, workouts: [], days: 14 })

    expect(s.weight).toHaveLength(14)
    expect(s.weight.every(p => p.y === null)).toBe(true)
    expect(s.intake.every(p => p.y === null)).toBe(true)
    expect(s.volume.map(p => p.y)).toEqual([null, null, null])
  })
})
