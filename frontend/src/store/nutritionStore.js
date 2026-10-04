import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getTargets, calcMacros, DEFAULT_PROFILE } from '../lib/tdee.js'
import { uid } from '../lib/format.js'

export const MEALS = ['cafe', 'almoco', 'lanche', 'jantar']

const mergeProfile = (saved = {}, base = DEFAULT_PROFILE) => {
  const profile = { ...base, ...saved }
  return { ...DEFAULT_PROFILE, ...profile }
}

// ---- recipes (RF7) ----

// Recipe totals on the SAME rounding contract totalsFor uses (whole grams/kcal per gram of
// macro): ingredients are summed raw, then each total is rounded once — the number the
// per-portion math below splits.
export const recipeTotals = recipe => {
  const totals = { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const ing of recipe?.ingredients || []) {
    totals.grams += Number(ing.grams) || 0
    totals.kcal += Number(ing.kcal) || 0
    totals.protein += Number(ing.protein) || 0
    totals.carbs += Number(ing.carbs) || 0
    totals.fat += Number(ing.fat) || 0
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k])
  return totals
}

// One portion of a recipe, by CUMULATIVE rounding: portion i = round(total·(i+1)/n) −
// round(total·i/n). The n portions therefore add back up to the recipe total EXACTLY —
// no kcal or gram is lost to per-portion rounding, whether the total divides evenly or
// not (100 kcal / 3 → 33, 34, 33; the parts still sum to the total). The same function
// backs the on-screen "per portion" figure and every entry the diary split writes.
export const portionOfRecipe = (recipe, index) => {
  const totals = recipeTotals(recipe)
  const portions = Math.max(1, Math.round(recipe?.portions) || 1)
  const i = Math.min(Math.max(0, Math.round(index) || 0), portions - 1)
  const slice = total => Math.round((total * (i + 1)) / portions) - Math.round((total * i) / portions)
  return {
    grams: slice(totals.grams),
    kcal: slice(totals.kcal),
    protein: slice(totals.protein),
    carbs: slice(totals.carbs),
    fat: slice(totals.fat),
  }
}

// Formula targets, with an applied adaptive estimate on top: when the user has tapped
// Apply (profile.kcalTarget — persisted with the profile like every other preference),
// that number IS the calorie target and the macro split is recomputed from it, exactly
// as getTargets would from a formula kcal. No profile.kcalTarget → pure formula, so
// nothing changes for anyone who never tapped Apply (the adaptive estimate is never
// auto-applied — see lib/tdee-adaptive.js).
const deriveTargets = profile => {
  const base = getTargets(profile)
  const applied = Number(profile.kcalTarget)
  if (!(applied > 0)) return base
  const macros = calcMacros(applied, profile)
  return {
    ...base,
    kcal: Math.round(applied),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  }
}

export const useNutritionStore = create(
  persist(
    (set, get) => ({
      profile: { ...DEFAULT_PROFILE },
      targets: deriveTargets(DEFAULT_PROFILE),
      log: {},
      recipes: [],
      lastRemoved: null,

      setProfile: patch =>
        set(state => {
          const profile = { ...state.profile, ...patch }
          return { profile, targets: deriveTargets(profile) }
        }),

      addEntry: (date, entry) =>
        set(state => {
          const day = state.log[date] || []
          return { log: { ...state.log, [date]: [...day, entry] } }
        }),

      removeEntry: (date, id) =>
        set(state => {
          const day = state.log[date] || []
          const index = day.findIndex(e => e.id === id)
          if (index < 0) return {}
          const entry = day[index]
          return {
            log: { ...state.log, [date]: day.filter(e => e.id !== id) },
            lastRemoved: { date, entry, index },
          }
        }),

      undoRemove: () => {
        const { lastRemoved, log } = get()
        if (!lastRemoved) return
        const day = (log[lastRemoved.date] || []).slice()
        day.splice(Math.min(lastRemoved.index, day.length), 0, lastRemoved.entry)
        set({ log: { ...log, [lastRemoved.date]: day }, lastRemoved: null })
      },

      clearRemoved: () => set({ lastRemoved: null }),

      entriesFor: date => get().log[date] || [],

      totalsFor: date => {
        const day = get().log[date] || []
        const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
        for (const e of day) {
          totals.kcal += e.kcal || 0
          totals.protein += e.protein || 0
          totals.carbs += e.carbs || 0
          totals.fat += e.fat || 0
        }
        for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k])
        return totals
      },

      // Same reader, narrowed to one meal of one day: what the per-meal protein bar asks.
      // The rounding contract is totalsFor's own (whole grams/kcal), a missing meal or a
      // missing day answers zeros so the bar renders at 0 without a branch, and totalsFor
      // itself is untouched — the day-level bars read the day, this reads a section.
      mealTotalsFor: (date, meal) => {
        const day = (get().log[date] || []).filter(e => e.meal === meal)
        const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
        for (const e of day) {
          totals.kcal += e.kcal || 0
          totals.protein += e.protein || 0
          totals.carbs += e.carbs || 0
          totals.fat += e.fat || 0
        }
        for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k])
        return totals
      },

      // Recipe CRUD: save is an upsert (an id already in the list replaces it in place, a
      // recipe without one gets a fresh id) and returns that id so the caller can open or
      // log it right away. Recipes are never derived state — they ride along in partialize.
      saveRecipe: recipe => {
        const saved = { ...recipe, id: recipe.id || uid() }
        set(state => {
          const list = state.recipes || []
          const i = list.findIndex(r => r.id === saved.id)
          return { recipes: i < 0 ? [...list, saved] : list.map((r, j) => (j === i ? saved : r)) }
        })
        return saved.id
      },

      removeRecipe: id => set(state => ({ recipes: (state.recipes || []).filter(r => r.id !== id) })),

      // "Add to diary": the recipe split into ONE ENTRY PER PORTION through the EXISTING
      // entry shape Nutrition.confirmAdd writes ({id, meal, name, source, grams, kcal,
      // protein, carbs, fat}) — source 'receita' tags where it came from, the same way the
      // coach's meal plan tags its own entries 'coach' (views/CoachChat.jsx). Portions come
      // from portionOfRecipe's cumulative rounding, so the entries sum back to the recipe
      // totals EXACTLY. `count` limits how many portions are logged (default: all of them).
      addRecipeToDiary: (date, meal, recipeId, count) => {
        const recipe = (get().recipes || []).find(r => r.id === recipeId)
        if (!recipe) return 0
        const portions = Math.max(1, Math.round(recipe.portions) || 1)
        const want = count == null ? portions : Math.max(0, Math.round(count) || 0)
        const n = Math.min(portions, want)
        const addEntry = get().addEntry
        for (let i = 0; i < n; i++) {
          const p = portionOfRecipe(recipe, i)
          addEntry(date, {
            id: uid(),
            meal,
            name: recipe.name,
            source: 'receita',
            grams: p.grams,
            kcal: p.kcal,
            protein: p.protein,
            carbs: p.carbs,
            fat: p.fat,
          })
        }
        return n
      },
    }),
    {
      name: 'gym_nutrition_v1',
      // Only user data is persisted: profile (recomputed into targets on load), the log and
      // the recipes. targets and lastRemoved are derived/session state — merge rebuilds them
      // so an old stored profile always comes back with fresh tdee.js math applied. A payload
      // written BEFORE recipes existed (an old export) has no `recipes` key: merge defaults
      // it to [] and everything else loads exactly as it did, untouched.
      partialize: s => ({ profile: s.profile, log: s.log, recipes: s.recipes || [] }),
      merge: (persisted, current) => {
        const profile = mergeProfile(persisted?.profile, current.profile)
        return {
          ...current,
          profile,
          targets: deriveTargets(profile),
          recipes: persisted?.recipes || [],
          log: persisted?.log || {},
          lastRemoved: null,
        }
      },
    },
  ),
)
