// @vitest-environment happy-dom
// The volume-landmark tests below import the store's DEF (its backward-compat overlay is
// part of what they pin), and useStore registers document/window listeners at import time.
import { describe, it, expect, vi } from 'vitest'
import { EXIDX, EXDB, smOf } from './exercises.js'
import {
  LANDMARK_FALLBACK,
  LANDMARK_ROW,
  MUSCLE_NAME,
  MUSCLES,
  SET_LANDMARKS,
  exerciseMuscleSnapshot,
  hasExplicitMuscleMetadata,
  landmarksFor,
  levelsOf,
  loadOf,
  loadOfWorkouts,
  matchesMuscleGroups,
  muscleBalanceWindow,
  muscleGroupsOf,
  musclesOf,
  rankOf,
  weeklyMuscleSeries,
} from './muscles.js'
import { DEF } from '../store/useStore.js'

describe('multi-muscle exercise metadata', () => {
  it('normalizes legacy primary/secondary fields and removes duplicate groups', () => {
    const ex = { tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'chest'] }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps'])
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 0.4 })
  })

  it('uses explicit multi-group metadata when present and supports legacy single groups', () => {
    expect(muscleGroupsOf({ muscleGroups: ['chest', 'pectorals', 'triceps'] })).toEqual(['chest', 'triceps'])
    expect(muscleGroupsOf({ tg: 'chest' })).toEqual(['chest'])
    expect(MUSCLE_NAME.chest).toBe('Chest')
  })

  it('falls back to the legacy body-part map when an optional multi-group field is empty', () => {
    expect(muscleGroupsOf({ bp: 'back', muscleGroups: [] })).toEqual(['upper-back', 'lower-back'])
    expect(matchesMuscleGroups({ bp: 'back', muscleGroups: [] }, ['lower-back'])).toBe(true)
  })

  it('falls back consistently when explicit groups contain only unknown names', () => {
    const ex = { bp: 'back', muscleGroups: ['not-a-drawable-name'] }
    expect(muscleGroupsOf(ex)).toEqual(['upper-back', 'lower-back'])
    expect(musclesOf(ex)).toEqual({ 'upper-back': 0.75, 'lower-back': 0.25 })
  })

  it('matches an exercise when any requested muscle group matches', () => {
    const ex = { muscleGroups: ['chest', 'triceps'] }
    expect(matchesMuscleGroups(ex, ['hamstring', 'triceps'])).toBe(true)
    expect(matchesMuscleGroups(ex, ['hamstring', 'gluteal'])).toBe(false)
    expect(matchesMuscleGroups(ex, [])).toBe(true)
  })

  it('counts one effective set per unique group instead of double counting duplicates', () => {
    expect(loadOf([{ id: 'inline', ex: { tg: 'chest', sm: ['chest', 'triceps'] }, sets: 2 }])).toEqual({
      chest: 2,
      triceps: 0.8,
    })
  })

  it('uses multi-muscle metadata carried by a history entry when its catalogue id is unavailable', () => {
    expect(
      loadOfWorkouts([
        {
          entries: [
            {
              id: 'deleted-custom',
              muscleGroups: ['chest', 'chest', 'triceps'],
              sets: [{ done: true }],
            },
          ],
        },
      ]),
    ).toEqual({ chest: 1, triceps: 1 })
  })
})

describe('catalogue secondary muscles', () => {
  it('maps a bench press to chest, triceps and deltoids', () => {
    expect(musclesOf(EXIDX['0025'])).toMatchObject({
      chest: 1,
      triceps: 0.4,
      deltoids: 0.4,
    })
  })

  it('maps a squat to glutes, quads and hamstrings', () => {
    expect(musclesOf(EXIDX['0043'])).toMatchObject({
      gluteal: 1,
      quadriceps: 1,
      hamstring: 0.4,
    })
  })

  it('maps common row variations to the upper back, biceps and rear deltoids', () => {
    for (const id of ['0027', '0293', '0499', '0861']) {
      expect(musclesOf(EXIDX[id])).toMatchObject({
        'upper-back': 1,
        biceps: 0.4,
        deltoids: 0.4,
      })
    }
  })
})

describe('catalogue secondary additions', () => {
  it('enriches the muscle map without mutating the raw dataset', () => {
    const raw = EXDB.find(e => e.id === '0027')
    expect(raw.sm).not.toContain('rear deltoids')
    expect(smOf(raw)).toContain('rear deltoids')
    // the alias collapses onto the deltoids slug in the canonical muscle map
    expect(musclesOf(raw)).toHaveProperty('deltoids')
  })
})

describe('explicit multi-primary metadata', () => {
  it('gives every primary full weight and secondaries supporting weight', () => {
    const ex = {
      bp: 'chest',
      tg: 'abs',
      mg: 'triceps',
      sm: ['lower back'],
      primaries: ['chest', 'triceps', 'chest'],
      secondaries: ['deltoids', 'triceps'],
    }
    expect(muscleGroupsOf(ex)).toEqual(['chest', 'triceps', 'deltoids'])
    expect(musclesOf(ex)).toEqual({ chest: 1, triceps: 1, deltoids: 0.4 })
  })

  it('keeps the body-part fallback when primaries are absent or explicitly empty', () => {
    const expected = { 'upper-back': 0.75, 'lower-back': 0.25 }
    expect(musclesOf({ bp: 'back' })).toEqual(expected)
    expect(musclesOf({ bp: 'back', primaries: [] })).toEqual(expected)
  })

  it('keeps legacy metadata when a new array field is present but empty', () => {
    expect(exerciseMuscleSnapshot({ bp: 'chest', tg: 'abs', primaries: [] })).toMatchObject({
      muscleGroups: ['abs'],
    })
  })

  it('provides a conservative Full body fallback for legacy custom exercises', () => {
    expect(muscleGroupsOf({ bp: 'full body' })).toEqual([
      'chest',
      'upper-back',
      'gluteal',
      'quadriceps',
      'hamstring',
      'abs',
    ])
    expect(musclesOf({ bp: 'full body' })).toEqual({
      chest: 0.2,
      'upper-back': 0.2,
      gluteal: 0.2,
      quadriceps: 0.2,
      hamstring: 0.1,
      abs: 0.1,
    })
  })

  it('preserves explicit primary and secondary arrays in history snapshots', () => {
    expect(
      exerciseMuscleSnapshot({
        n: 'Deadlift',
        bp: 'full body',
        primaries: ['gluteal', 'lower-back'],
        secondaries: ['hamstring'],
      }),
    ).toMatchObject({
      n: 'Deadlift',
      bp: 'full body',
      primaries: ['gluteal', 'lower-back'],
      secondaries: ['hamstring'],
      muscleGroups: ['gluteal', 'lower-back', 'hamstring'],
    })
  })
})

describe('map load with warm-up phases', () => {
  it('excludes warm-up sets from the by-sets-worked map', () => {
    const w = {
      id: 'w1',
      d: '2026-08-01',
      start: Date.UTC(2026, 7, 1, 10),
      unit: 'kg',
      entries: [
        {
          id: '0025',
          sets: [
            { done: true, phase: 'warmup', w: 20, r: 8 },
            { done: true, phase: 'work', w: 60, r: 8 },
          ],
        },
      ],
    }
    const load = loadOfWorkouts([w], null)
    expect(load.chest).toBe(1)
  })
})

// A custom exercise that was deleted from the catalogue survives in history only as the
// muscleSnapshot finish-workout wrote. Reading it back is what keeps those sessions in the
// body map and in Stats instead of silently contributing nothing.
describe('deleted custom exercises', () => {
  const snapshotEntry = {
    id: 'gone-custom-1',
    sets: [{ w: 60, r: 8, done: true }],
    muscleSnapshot: { n: 'Deleted custom', bp: 'chest', muscleGroups: ['chest'], muscleWeights: { chest: 1 } },
  }

  it('reads muscle load back out of the snapshot', () => {
    expect(loadOfWorkouts([{ d: '2026-08-01', entries: [snapshotEntry] }])).toEqual({ chest: 1 })
  })

  it('reports the snapshot groups as explicit metadata', () => {
    expect(hasExplicitMuscleMetadata(snapshotEntry)).toBe(true)
    expect(muscleGroupsOf(snapshotEntry)).toEqual(['chest'])
  })

  it("still prefers the entry's own metadata when it has any", () => {
    const withOwn = { ...snapshotEntry, tg: 'quadriceps' }
    expect(muscleGroupsOf(withOwn)).toEqual(['quadriceps'])
  })
})

// muscles.js counts completed work, so its warm-up boundary has to agree with the one the
// session runtime uses — including the legacy spellings phaseForSet normalises.
describe('warm-up boundary', () => {
  it('excludes every phase spelling the workout model treats as a warm-up', () => {
    const entries = spelling => [{ id: '0025', sets: [{ w: 100, r: 5, done: true, phase: spelling }] }]
    for (const spelling of ['warmup', 'warm-up', 'warm_up', 'Warmup', ' warmup ']) {
      expect(loadOfWorkouts([{ d: '2026-08-01', entries: entries(spelling) }]), spelling).toEqual({})
    }
  })
})

describe('muscle balance windows and ranking', () => {
  const now = new Date('2026-08-27T12:00:00').getTime()
  const workouts = [
    { id: 'monday', d: '2026-08-24', start: new Date('2026-08-24T12:00:00').getTime() },
    { id: 'sunday', d: '2026-08-23', start: new Date('2026-08-23T12:00:00').getTime() },
    { id: 'boundary', d: '2026-07-28', start: now - 30 * 86400000 },
    { id: 'inside', d: '2026-07-29', start: now - 29 * 86400000 },
  ]

  it('preserves calendar-week, strict trailing-day, and all-history semantics', () => {
    expect(muscleBalanceWindow(workouts, 7, now, '2026-08-27').map(w => w.id)).toEqual(['monday'])
    expect(muscleBalanceWindow(workouts, 30, now, '2026-08-27').map(w => w.id)).toEqual(['monday', 'sunday', 'inside'])
    expect(muscleBalanceWindow(workouts, 0, now, '2026-08-27')).toEqual(workouts)
  })

  it('uses relative levels and canonical order to break load ties', () => {
    const load = { chest: 2, deltoids: 2, biceps: 1 }
    expect(rankOf(load).worked).toEqual(['deltoids', 'chest', 'biceps'])
    expect(levelsOf(load)).toMatchObject({ deltoids: 4, chest: 4, biceps: 2, abs: 0 })
  })

  it('keeps catalogue precedence and deleted-custom snapshot weights', () => {
    const known = { id: '0025', muscleGroups: ['quadriceps'], sets: [{ done: true }] }
    const deleted = { id: 'deleted', muscleSnapshot: { muscleWeights: { chest: 1 } }, sets: [{ done: true }] }
    expect(loadOfWorkouts([{ entries: [known] }])).toEqual({ chest: 1, triceps: 0.4, deltoids: 0.4, biceps: 0.4 })
    expect(loadOfWorkouts([{ entries: [deleted] }])).toEqual({ chest: 1 })
  })
})

// MUSCLE_NAME values are the i18n keys — a value no pack defines renders English in every
// language. The Library list showed "Cardiovascular system" untranslated for every cardio
// exercise (QA copy): the packs only ever had the dataset's own lowercase spelling.
describe('MUSCLE_NAME as i18n keys', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true })
  it('every display name is a key in every locale pack', () => {
    expect(Object.keys(packs).length).toBe(2)
    for (const [file, mod] of Object.entries(packs)) {
      const missing = Object.values(MUSCLE_NAME).filter(name => !(name in mod.default))
      expect(missing, file).toEqual([])
    }
  })
})

// T1 volume landmarks (plan TC3): what each calendar week delivered and what the routine
// planned for it, per muscle. Both sides key off weekKey, so a week that crosses a month —
// or the profile's first weekday — buckets exactly like every other week grouping here.
describe('weekly muscle set series', () => {
  const bench = sets => ({
    id: '0025',
    sets: Array.from({ length: sets }, () => ({ done: true, w: 60, r: 8 })),
  })
  const session = (d, sets) => ({ d, entries: [bench(sets)] })
  const push = { id: 'push', name: 'Push', ex: [{ id: '0025', sets: 4 }] }
  const state = over => ({ workouts: [], routines: [], week: {}, dayPlan: {}, weekStart: 1, ...over })

  it('buckets completed sets by the week they fall in, oldest week first', () => {
    const S = state({
      workouts: [session('2026-08-24', 3), session('2026-08-30', 5), session('2026-08-31', 7)],
    })
    const series = weeklyMuscleSeries(S, { weeks: 2, today: '2026-09-02' })
    expect(series.map(w => w.k)).toEqual(['2026-08-24', '2026-08-31'])
    // Sunday 8/30 belongs to the week that started Monday 8/24: 3 + 5.
    expect(series.map(w => w.done.chest)).toEqual([8, 7])
    expect(series[0].done.deltoids).toBeCloseTo(0.4 * 8)
  })

  it('moves the Sunday session when the profile starts its week on Sunday', () => {
    const S = state({
      weekStart: 0,
      workouts: [session('2026-08-24', 3), session('2026-08-30', 5), session('2026-08-31', 7)],
    })
    const series = weeklyMuscleSeries(S, { weeks: 2, today: '2026-09-02' })
    expect(series.map(w => w.k)).toEqual(['2026-08-23', '2026-08-30'])
    expect(series.map(w => w.done.chest)).toEqual([3, 12])
  })

  it('counts what the routine plans for each week, honoring a rested day override', () => {
    const S = state({
      routines: [push],
      week: { 1: ['push'], 3: ['push'] },
      dayPlan: { '2026-08-31': 'rest' },
    })
    const series = weeklyMuscleSeries(S, { weeks: 2, today: '2026-09-02' })
    expect(series.map(w => w.planned.chest)).toEqual([8, 4])
    expect(series[0].done).toEqual({})
  })

  it('keeps the done and planned sides separate for the same week', () => {
    const S = state({ workouts: [session('2026-08-31', 6)], routines: [push], week: { 1: ['push'] } })
    const series = weeklyMuscleSeries(S, { today: '2026-09-02' })
    expect(series).toHaveLength(1)
    expect(series[0].k).toBe('2026-08-31')
    expect(series[0].done.chest).toBe(6)
    expect(series[0].planned.chest).toBe(4)
  })
})

// The presets behind every profile that has not edited a landmark, and the mapping from the
// app's muscle slugs onto the preset rows the plan names (traps ≠ trapezius, quads ≠
// quadriceps, …). The fallback keeps any slug — drawn or not — resolvable to a usable range.
describe('weekly set landmarks presets', () => {
  it('maps every muscle the body map can draw to a named preset row', () => {
    for (const slug of MUSCLES) {
      expect(LANDMARK_ROW[slug], slug).toBeTruthy()
      expect(SET_LANDMARKS[LANDMARK_ROW[slug]], slug).toEqual(landmarksFor(slug))
    }
  })

  it('resolves every slug the exercise dataset can produce', () => {
    const producible = new Set(MUSCLES)
    for (const ex of EXDB) for (const slug of Object.keys(musclesOf(ex))) producible.add(slug)
    expect(producible.has('cardiovascular system')).toBe(true) // the cardio pseudo-muscle
    for (const slug of producible) {
      const target = landmarksFor(slug)
      expect(Number.isFinite(target.mev) && target.mev > 0, slug).toBe(true)
      expect(target.mav, slug).toBeGreaterThanOrEqual(target.mev)
    }
  })

  it('pins the plan preset numbers', () => {
    expect(landmarksFor('chest')).toEqual({ mev: 10, mav: 20 })
    expect(landmarksFor('upper-back')).toEqual({ mev: 10, mav: 22 })
    expect(landmarksFor('lower-back')).toEqual({ mev: 10, mav: 22 })
    expect(landmarksFor('deltoids')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('quadriceps')).toEqual({ mev: 8, mav: 18 })
    expect(landmarksFor('hamstring')).toEqual({ mev: 6, mav: 16 })
    expect(landmarksFor('adductors')).toEqual({ mev: 6, mav: 16 })
    expect(landmarksFor('gluteal')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('biceps')).toEqual({ mev: 6, mav: 14 })
    expect(landmarksFor('triceps')).toEqual({ mev: 6, mav: 14 })
    expect(landmarksFor('calves')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('tibialis')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('abs')).toEqual({ mev: 6, mav: 12 })
    expect(landmarksFor('obliques')).toEqual({ mev: 6, mav: 12 })
    expect(landmarksFor('hip-flexors')).toEqual({ mev: 6, mav: 12 })
    expect(landmarksFor('trapezius')).toEqual({ mev: 6, mav: 14 })
    expect(landmarksFor('forearm')).toEqual({ mev: 4, mav: 10 })
    expect(landmarksFor('serratus')).toEqual({ mev: 8, mav: 16 })
  })

  it('falls back to 8/16 for a slug it has no row for', () => {
    expect(LANDMARK_FALLBACK).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('not-a-muscle')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor('cardiovascular system')).toEqual({ mev: 8, mav: 16 })
    expect(landmarksFor()).toEqual({ mev: 8, mav: 16 })
  })

  it('layers a profile override over the preset without dropping the other bound', () => {
    expect(landmarksFor('chest', { chest: { mev: 14 } })).toEqual({ mev: 14, mav: 20 })
    expect(landmarksFor('chest', { chest: { mav: 30 } })).toEqual({ mev: 10, mav: 30 })
    expect(landmarksFor('biceps', { chest: { mev: 14 } })).toEqual({ mev: 6, mav: 14 })
    expect(landmarksFor('chest', null)).toEqual({ mev: 10, mav: 20 })
    expect(landmarksFor('chest', { chest: { mev: 'bad' } })).toEqual({ mev: 10, mav: 20 })
  })
})

// The store key behind the editable half: null means "show the presets", and a profile
// written before the key existed has to load as null rather than as undefined (which a
// Settings editor reading `??` would read as "never been set" all the same — the point is
// that every read path through the DEF overlay sees one value).
describe('DEF.muscleTargets', () => {
  it('defaults to null so unedited profiles show the presets', () => {
    expect(DEF.muscleTargets).toBeNull()
  })

  it('overlays null onto a profile saved before the key existed', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ unit: 'lb', restSec: 120, _ts: 5, workouts: [] }))
    vi.resetModules()
    const fresh = await import('../store/useStore.js')
    const S = fresh.useStore.getState().S
    expect(S.muscleTargets).toBeNull()
    expect(S.restSec).toBe(120)
    expect(S.unit).toBe('lb')
    localStorage.removeItem('gym_state_v1')
    vi.resetModules()
  })

  it('keeps an override map a profile already carries', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ muscleTargets: { chest: { mev: 14, mav: 22 } }, _ts: 9 }))
    vi.resetModules()
    const fresh = await import('../store/useStore.js')
    expect(fresh.useStore.getState().S.muscleTargets).toEqual({ chest: { mev: 14, mav: 22 } })
    localStorage.removeItem('gym_state_v1')
    vi.resetModules()
  })
})
