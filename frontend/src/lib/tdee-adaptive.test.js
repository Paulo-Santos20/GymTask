// Adaptive TDEE — the intake-balance estimate over paired weigh-in + food days.
//
// TDD: this file was written BEFORE lib/tdee-adaptive.js (red→green record in
// .omo/evidence/task-1-top5-features.md). Inputs follow the repo's lib convention —
// state passed as args (coach-insights.js precedent), nothing imported from a store:
//   S  = { bodyweight: [{d, w, t}], unit }   — w is in S.unit (lb when unit === 'lb')
//   log = { [iso]: [entries] }               — nutrition diary, entries carry kcal
//
// The estimate itself: over the paired days (a date with BOTH a weigh-in and food
// logged), the least-squares trend of body weight gives kg/day; energy balance says
// maintenance = mean intake − trend × 7700 kcal/kg. Flat weight → maintenance equals
// intake; losing weight → maintenance sits above intake, and vice versa.
import { describe, it, expect } from 'vitest'
import { adaptiveTDEE, MIN_PAIRED_DAYS, WINDOW_DAYS } from './tdee-adaptive.js'
import { LB_TO_KG } from './recovery.js'

const NO_DATA = { ok: false, reason: 'insufficient-data' }

// n consecutive ISO dates starting at `start` (UTC math — no timezone dependence).
const daySeq = (start, n) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))

// A fully paired history: one weigh-in + food entries per date. `weight(i)` is the kg
// value for day i (converted into lb when unit is 'lb' so both storages describe the
// same body); `intake(i)` is that day's kcal.
function paired({ start = '2026-03-01', n = 14, weight = i => 80 - 0.1 * i, intake = () => 2500, unit = 'kg' } = {}) {
  const dates = daySeq(start, n)
  const bodyweight = dates.map((d, i) => ({
    d,
    w: unit === 'lb' ? weight(i) / LB_TO_KG : weight(i),
    t: Date.parse(d + 'T12:00:00Z'),
  }))
  const log = {}
  dates.forEach((d, i) => {
    log[d] = [{ id: `e${i}`, meal: 'cafe', name: 'Oats', kcal: intake(i) }]
  })
  return { S: { bodyweight, unit }, log, dates }
}

describe('adaptiveTDEE — paired-day threshold', () => {
  it('pins the data floors the plan specifies', () => {
    expect(MIN_PAIRED_DAYS).toBe(14)
    expect(WINDOW_DAYS).toBe(60)
  })

  it('reports insufficient-data for no arguments at all', () => {
    expect(adaptiveTDEE()).toEqual(NO_DATA)
    expect(adaptiveTDEE({}, {})).toEqual(NO_DATA)
  })

  it('weigh-ins without any food log never pair', () => {
    const dates = daySeq('2026-03-01', 30)
    const S = { bodyweight: dates.map((d, i) => ({ d, w: 80, t: i })), unit: 'kg' }
    expect(adaptiveTDEE(S, {})).toEqual(NO_DATA)
  })

  it('a food log without weigh-ins never pairs', () => {
    const log = {}
    daySeq('2026-03-01', 30).forEach(d => {
      log[d] = [{ id: 'x', kcal: 2500 }]
    })
    expect(adaptiveTDEE({ bodyweight: [], unit: 'kg' }, log)).toEqual(NO_DATA)
  })

  it('a single paired day is one sample, not a trend', () => {
    const { S, log } = paired({ n: 1 })
    expect(adaptiveTDEE(S, log)).toEqual(NO_DATA)
  })

  it('thirteen paired days stay under the 14-day floor', () => {
    const { S, log } = paired({ n: 13 })
    expect(adaptiveTDEE(S, log)).toEqual(NO_DATA)
  })

  it('a weigh-in without a numeric value does not count as paired', () => {
    const { S, log } = paired({ n: 14 })
    S.bodyweight[0] = { ...S.bodyweight[0], w: null }
    expect(adaptiveTDEE(S, log)).toEqual(NO_DATA)
  })
})

describe('adaptiveTDEE — estimation', () => {
  it('flat weight means maintenance equals mean intake (every entry summed per day)', () => {
    // Each day logs two entries summing to 2500/2200 alternating → mean exactly 2100.
    const { S, log, dates } = paired({ n: 14, weight: () => 80, intake: i => 2000 + (i % 2) * 200 })
    dates.forEach((d, i) => {
      log[d] = [
        { id: 'a', kcal: 1500 },
        { id: 'b', kcal: (2000 + (i % 2) * 200) - 1500 },
      ]
    })
    const res = adaptiveTDEE(S, log)
    expect(res).toEqual({ ok: true, kcal: 2100, days: 14, window: { from: '2026-03-01', to: '2026-03-14' } })
    expect(Object.keys(res).sort()).toEqual(['days', 'kcal', 'ok', 'window'])
  })

  it('losing weight puts maintenance above intake: 2500 + 0.1 kg/day × 7700 = 3270', () => {
    // 14 days, −0.1 kg/day (trend exactly −0.1): deficit 770 kcal/day hidden under a
    // constant 2500 kcal intake, so the body actually sustains 3270.
    const { S, log } = paired({ n: 14, weight: i => 80 - 0.1 * i, intake: () => 2500 })
    expect(adaptiveTDEE(S, log)).toEqual({
      ok: true,
      kcal: 3270,
      days: 14,
      window: { from: '2026-03-01', to: '2026-03-14' },
    })
  })

  it('gaining weight puts maintenance below intake: 3000 − 0.1 kg/day × 7700 = 2230', () => {
    const { S, log } = paired({ n: 20, weight: i => 75 + 0.1 * i, intake: () => 3000 })
    expect(adaptiveTDEE(S, log)).toEqual({
      ok: true,
      kcal: 2230,
      days: 20,
      window: { from: '2026-03-01', to: '2026-03-20' },
    })
  })

  it('rounds to a whole calorie', () => {
    // −0.05 kg/day × 7700 = 385 kcal/day on top of 2400 → 2785 exactly; assert integer.
    const { S, log } = paired({ n: 14, weight: i => 82 - 0.05 * i, intake: () => 2400 })
    const res = adaptiveTDEE(S, log)
    expect(res.ok).toBe(true)
    expect(Number.isInteger(res.kcal)).toBe(true)
    expect(res.kcal).toBe(2785)
  })
})

describe('adaptiveTDEE — unit conversion', () => {
  it('lb-stored weigh-ins give the same estimate as kg', () => {
    const kg = paired({ n: 14, weight: i => 80 - 0.1 * i, intake: () => 2500, unit: 'kg' })
    const lb = paired({ n: 14, weight: i => 80 - 0.1 * i, intake: () => 2500, unit: 'lb' })
    expect(lb.S.unit).toBe('lb')
    expect(lb.S.bodyweight[0].w).toBeCloseTo(80 / LB_TO_KG, 10)
    const fromKg = adaptiveTDEE(kg.S, kg.log)
    const fromLb = adaptiveTDEE(lb.S, lb.log)
    expect(fromKg.kcal).toBe(3270)
    expect(fromLb).toEqual(fromKg)
  })
})

describe('adaptiveTDEE — window bounds', () => {
  it('an explicit to trims later paired days off the window', () => {
    const { S, log } = paired({ n: 16 })
    const full = adaptiveTDEE(S, log)
    expect(full.days).toBe(16)
    expect(full.window).toEqual({ from: '2026-03-01', to: '2026-03-16' })

    const toMid = adaptiveTDEE(S, log, { to: '2026-03-14' })
    expect(toMid).toEqual({
      ok: true,
      kcal: 3270,
      days: 14,
      window: { from: '2026-03-01', to: '2026-03-14' },
    })

    expect(adaptiveTDEE(S, log, { to: '2026-03-13' })).toEqual(NO_DATA)
  })

  it('an explicit from trims earlier paired days off the window', () => {
    const { S, log } = paired({ n: 16 })
    expect(adaptiveTDEE(S, log, { from: '2026-03-03' })).toEqual({
      ok: true,
      kcal: 3270,
      days: 14,
      window: { from: '2026-03-03', to: '2026-03-16' },
    })
    expect(adaptiveTDEE(S, log, { from: '2026-03-04' })).toEqual(NO_DATA)
  })
})

describe('adaptiveTDEE — rolling window', () => {
  // Newest paired day 2026-03-14 → the rolling window opens 59 days earlier, 2026-01-14.
  it('drops a paired day older than WINDOW_DAYS behind the newest data', () => {
    const recent = paired({ start: '2026-03-02', n: 13 })
    const old = { d: '2026-01-13', w: 80, t: 1 }
    const S = { bodyweight: [old, ...recent.S.bodyweight], unit: 'kg' }
    const log = { '2026-01-13': [{ id: 'old', kcal: 2500 }], ...recent.log }
    expect(adaptiveTDEE(S, log)).toEqual(NO_DATA)
  })

  it('keeps a paired day sitting exactly on the rolling-window boundary', () => {
    const recent = paired({ start: '2026-03-02', n: 13 })
    const boundary = { d: '2026-01-14', w: 80, t: 1 }
    const S = { bodyweight: [boundary, ...recent.S.bodyweight], unit: 'kg' }
    const log = { '2026-01-14': [{ id: 'old', kcal: 2500 }], ...recent.log }
    const res = adaptiveTDEE(S, log)
    expect(res.ok).toBe(true)
    expect(res.days).toBe(14)
    expect(res.window.from).toBe('2026-01-14')
    expect(res.window.to).toBe('2026-03-14')
  })

  it('an old cluster behind a recent one cannot resurrect a stale estimate', () => {
    const old = paired({ start: '2025-06-01', n: 20 })
    const recent = paired({ start: '2026-03-01', n: 10 })
    const S = { bodyweight: [...old.S.bodyweight, ...recent.S.bodyweight], unit: 'kg' }
    const log = { ...old.log, ...recent.log }
    expect(adaptiveTDEE(S, log)).toEqual(NO_DATA)
  })
})
