// @vitest-environment happy-dom
// RF7 (roadmap-features todo 7): the recipe slice of the nutrition store — create/edit/delete,
// the per-portion macro math (including rounding), and the export/import round-trip through the
// SAME localStorage payload the persist middleware has always written ('gym_nutrition_v1').
// The REAL store runs here — no mocks — so the actions are exercised exactly as the Nutrition
// view calls them. The persistence cases re-import the module against a seeded payload, which is
// what "an old export loads clean" means for data that only ever lives in this store.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNutritionStore, recipeTotals, portionOfRecipe } from './nutritionStore.js'
import { DEFAULT_PROFILE } from '../lib/tdee.js'

const KEY = 'gym_nutrition_v1'

const ing = (name, grams, kcal, protein, carbs, fat) => ({ name, grams, kcal, protein, carbs, fat })

const stew = () => ({
  id: 'r1',
  name: 'Beef stew',
  portions: 2,
  ingredients: [ing('Beef', 300, 600, 60, 0, 30), ing('Rice', 200, 260, 5, 56, 1)],
})

const entry = (id, extra = {}) => ({
  id,
  meal: 'almoco',
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 5,
  ...extra,
})

const state = () => useNutritionStore.getState()

// Export → import through the real storage payload: seed what the OLD or CURRENT app would
// have written, re-import the module (fresh store) and let the persist middleware hydrate.
const hydrate = async payload => {
  localStorage.setItem(KEY, JSON.stringify({ state: payload, version: 0 }))
  vi.resetModules()
  const mod = await import('./nutritionStore.js')
  await new Promise(r => setTimeout(r, 10))
  return mod.useNutritionStore
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  useNutritionStore.setState({
    log: {},
    lastRemoved: null,
    recipes: [],
    profile: { ...DEFAULT_PROFILE },
  })
})

describe('nutritionStore recipes', () => {
  it('saveRecipe creates a recipe with an id when it has none, and lists it', () => {
    const id = state().saveRecipe({ name: 'Beef stew', portions: 2, ingredients: stew().ingredients })
    const list = state().recipes
    expect(list).toHaveLength(1)
    expect(list[0].id).toBeTruthy()
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Beef stew')
  })

  it('saveRecipe edits in place by id without duplicating the recipe', () => {
    const id = state().saveRecipe(stew())
    state().saveRecipe({ ...stew(), name: 'Beef stew, revisited' })
    const list = state().recipes
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Beef stew, revisited')
  })

  it('removeRecipe drops one recipe by id and leaves the others alone', () => {
    state().saveRecipe(stew())
    state().saveRecipe({ id: 'r2', name: 'Omelette', portions: 1, ingredients: [ing('Eggs', 120, 180, 15, 1, 14)] })
    state().removeRecipe('r1')
    expect(state().recipes.map(r => r.id)).toEqual(['r2'])
    state().removeRecipe('nope')
    expect(state().recipes).toHaveLength(1)
  })

  it('recipeTotals sums the ingredients and rounds on the totalsFor contract', () => {
    expect(recipeTotals(stew())).toEqual({ grams: 500, kcal: 860, protein: 65, carbs: 56, fat: 31 })
    expect(recipeTotals({ ingredients: [ing('x', 100.6, 150.4, 10.5, 20.4, 5.5)] })).toEqual({
      grams: 101,
      kcal: 150,
      protein: 11,
      carbs: 20,
      fat: 6,
    })
    expect(recipeTotals({})).toEqual({ grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('portionOfRecipe splits every total so the portions sum back exactly', () => {
    // 2 portions: each half, and the halves are whole numbers that add up to the recipe.
    expect(portionOfRecipe(stew(), 0)).toEqual({ grams: 250, kcal: 430, protein: 33, carbs: 28, fat: 16 })
    expect(portionOfRecipe(stew(), 1)).toEqual({ grams: 250, kcal: 430, protein: 32, carbs: 28, fat: 15 })

    // Odd total over 3 portions: rounding may not land on the same number each time, but the
    // portions MUST add back to the recipe total exactly (cumulative rounding, no lost kcal).
    const thirds = { id: 'r3', name: 'Split', portions: 3, ingredients: [ing('x', 100, 100, 0, 0, 0)] }
    const slices = [0, 1, 2].map(i => portionOfRecipe(thirds, i))
    expect(slices.map(s => s.kcal)).toEqual([33, 34, 33])
    expect(slices.reduce((n, s) => n + s.kcal, 0)).toBe(100)
    expect(slices.reduce((n, s) => n + s.grams, 0)).toBe(100)
  })

  it('addRecipeToDiary writes one entry per portion through the existing entry shape', () => {
    state().saveRecipe(stew())
    state().addEntry('2026-10-03', entry('before'))
    const added = state().addRecipeToDiary('2026-10-03', 'almoco', 'r1')

    expect(added).toBe(2)
    const day = state().log['2026-10-03']
    expect(day).toHaveLength(3)
    expect(day[0].id).toBe('before') // appended after what was already there

    const portions = day.slice(1)
    expect(portions.map(e => Object.keys(e).sort())).toEqual([
      ['carbs', 'fat', 'grams', 'id', 'kcal', 'meal', 'name', 'protein', 'source'],
      ['carbs', 'fat', 'grams', 'id', 'kcal', 'meal', 'name', 'protein', 'source'],
    ])
    expect(portions[0]).toMatchObject({
      meal: 'almoco',
      name: 'Beef stew',
      source: 'receita',
      grams: 250,
      kcal: 430,
      protein: 33,
      carbs: 28,
      fat: 16,
    })
    expect(portions[0].id).toBeTruthy()
    expect(portions[1].id).not.toBe(portions[0].id)

    // The happy path of the todo: a 2-portion recipe split into entries sums EXACTLY.
    for (const k of ['grams', 'kcal', 'protein', 'carbs', 'fat']) {
      expect(portions.reduce((n, e) => n + e[k], 0)).toBe(recipeTotals(stew())[k])
    }
    // The day-level reader sees the same sum — totalsFor itself is untouched.
    expect(state().totalsFor('2026-10-03')).toEqual({ kcal: 960, protein: 75, carbs: 66, fat: 36 })
  })

  it('addRecipeToDiary logs only the portions asked for, and writes nothing for an unknown id', () => {
    state().saveRecipe(stew())
    expect(state().addRecipeToDiary('2026-10-03', 'jantar', 'r1', 1)).toBe(1)
    const day = state().log['2026-10-03']
    expect(day).toHaveLength(1)
    expect(day[0]).toMatchObject({ meal: 'jantar', source: 'receita', kcal: 430, protein: 33 })

    expect(state().addRecipeToDiary('2026-10-03', 'jantar', 'nope')).toBe(0)
    expect(state().log['2026-10-03']).toHaveLength(1)
    expect(state().log['2026-10-04']).toBeUndefined()
  })
})

describe('nutritionStore recipes persistence (export/import)', () => {
  it('saved recipes survive an export → import round-trip through the store payload', async () => {
    state().saveRecipe(stew())
    const exported = JSON.parse(localStorage.getItem(KEY)).state
    expect(exported.recipes).toHaveLength(1)

    const fresh = await hydrate(exported)
    expect(fresh.getState().recipes).toEqual([stew()])
    expect(fresh.getState().profile).toEqual({ ...DEFAULT_PROFILE })
  })

  it('an old export without a recipes field loads clean (profile and log intact)', async () => {
    const oldExport = {
      profile: { ...DEFAULT_PROFILE, peso: 81 },
      log: { '2026-10-03': [entry('a', { kcal: 500 })] },
    }
    expect(oldExport.recipes).toBeUndefined() // genuinely pre-recipes

    const fresh = await hydrate(oldExport)
    const s = fresh.getState()
    expect(s.recipes).toEqual([])
    expect(s.profile.peso).toBe(81)
    expect(s.log['2026-10-03'][0].id).toBe('a')
    expect(s.targets.kcal).toBeGreaterThan(0) // targets still derived, not loaded
    expect(s.lastRemoved).toBe(null)
  })
})
