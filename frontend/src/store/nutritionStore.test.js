// @vitest-environment happy-dom
// Same reason as useUI.test.js: the persist middleware writes localStorage, so a DOM
// environment is required. The REAL store runs here — no mocks — so addEntry/removeEntry/
// undoRemove/totalsFor are exercised exactly as the Nutrition view calls them.
import { describe, expect, it, beforeEach } from 'vitest'
import { useNutritionStore } from './nutritionStore.js'
import { getTargets, DEFAULT_PROFILE } from '../lib/tdee.js'

const entry = (id, extra = {}) => ({
  id, meal: 'almoco', kcal: 100, protein: 10, carbs: 10, fat: 5, ...extra,
})

const ids = date => useNutritionStore.getState().entriesFor(date).map(e => e.id)

const add = (date, ...entries) => entries.forEach(e => useNutritionStore.getState().addEntry(date, e))

beforeEach(() => {
  // Fresh session state per test; profile/targets back to the store's own defaults.
  useNutritionStore.setState({
    log: {},
    lastRemoved: null,
    profile: { ...DEFAULT_PROFILE },
    targets: getTargets(DEFAULT_PROFILE),
  })
})

describe('nutritionStore meal log', () => {
  it('appends entries to their day, keeps days independent, and defaults a missing day to empty', () => {
    add('2026-10-03', entry('a'), entry('b'))
    add('2026-10-04', entry('c'))
    expect(ids('2026-10-03')).toEqual(['a', 'b'])
    expect(ids('2026-10-04')).toEqual(['c'])
    expect(useNutritionStore.getState().entriesFor('2026-01-01')).toEqual([])
  })

  it('removeEntry drops the entry by id and records it (with its index) for undo', () => {
    add('2026-10-03', entry('a'), entry('b'), entry('c'))
    useNutritionStore.getState().removeEntry('2026-10-03', 'b')
    expect(ids('2026-10-03')).toEqual(['a', 'c'])
    const slot = useNutritionStore.getState().lastRemoved
    expect(slot.date).toBe('2026-10-03')
    expect(slot.entry.id).toBe('b')
    expect(slot.index).toBe(1)
  })

  it('removeEntry with an unknown id leaves the day and the undo slot untouched', () => {
    add('2026-10-03', entry('a'))
    useNutritionStore.getState().removeEntry('2026-10-03', 'nope')
    expect(ids('2026-10-03')).toEqual(['a'])
    expect(useNutritionStore.getState().lastRemoved).toBe(null)
  })

  it('undoRemove puts the entry back at its original position and clears the slot', () => {
    add('2026-10-03', entry('a'), entry('b'), entry('c'))
    useNutritionStore.getState().removeEntry('2026-10-03', 'b')
    useNutritionStore.getState().undoRemove()
    expect(ids('2026-10-03')).toEqual(['a', 'b', 'c'])
    expect(useNutritionStore.getState().lastRemoved).toBe(null)
  })

  it('undoRemove is a no-op when there is nothing to undo — and never duplicates', () => {
    expect(() => useNutritionStore.getState().undoRemove()).not.toThrow()
    expect(ids('2026-10-03')).toEqual([])
    add('2026-10-03', entry('a'))
    useNutritionStore.getState().removeEntry('2026-10-03', 'a')
    useNutritionStore.getState().undoRemove()
    useNutritionStore.getState().undoRemove()   // second undo: slot already cleared
    expect(ids('2026-10-03')).toEqual(['a'])
  })

  it('clearRemoved empties the undo slot without giving the entry back', () => {
    add('2026-10-03', entry('a'))
    useNutritionStore.getState().removeEntry('2026-10-03', 'a')
    useNutritionStore.getState().clearRemoved()
    expect(useNutritionStore.getState().lastRemoved).toBe(null)
    expect(ids('2026-10-03')).toEqual([])
  })
})

describe('nutritionStore totals and profile', () => {
  it('totalsFor sums the day and rounds each macro to whole numbers', () => {
    add('2026-10-03',
      entry('a', { kcal: 150.6, protein: 10.4, carbs: 20.5, fat: 5.4 }),
      entry('b', { kcal: 149.6, protein: 12.6, carbs: 10.4, fat: 1.7 }))
    expect(useNutritionStore.getState().totalsFor('2026-10-03'))
      .toEqual({ kcal: 300, protein: 23, carbs: 31, fat: 7 })
    expect(useNutritionStore.getState().totalsFor('2026-01-01'))
      .toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('setProfile recomputes the targets from the patched profile', () => {
    const before = useNutritionStore.getState().targets
    useNutritionStore.getState().setProfile({ peso: 90 })
    const s = useNutritionStore.getState()
    expect(s.profile.peso).toBe(90)
    expect(s.profile.altura).toBe(DEFAULT_PROFILE.altura)   // patch merges, not replaces
    expect(s.targets.kcal).not.toBe(before.kcal)
    expect(s.targets).toEqual(getTargets({ ...DEFAULT_PROFILE, peso: 90 }))
    expect(s.targets.protein).toBe(Math.round(90 * 1.8))    // manter goal: 1.8 g/kg
  })
})
