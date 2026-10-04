import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getTargets, calcMacros, DEFAULT_PROFILE } from '../lib/tdee.js'

export const MEALS = ['cafe', 'almoco', 'lanche', 'jantar']

const mergeProfile = (saved = {}, base = DEFAULT_PROFILE) => {
  const profile = { ...base, ...saved }
  return { ...DEFAULT_PROFILE, ...profile }
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
    }),
    {
      name: 'gym_nutrition_v1',
      // Only user data is persisted: profile (recomputed into targets on load) and the log.
      // targets and lastRemoved are derived/session state — merge rebuilds them so an old
      // stored profile always comes back with fresh tdee.js math applied.
      partialize: s => ({ profile: s.profile, log: s.log }),
      merge: (persisted, current) => {
        const profile = mergeProfile(persisted?.profile, current.profile)
        return {
          ...current,
          profile,
          targets: deriveTargets(profile),
          log: persisted?.log || {},
          lastRemoved: null,
        }
      },
    },
  ),
)
