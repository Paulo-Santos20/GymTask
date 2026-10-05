// Meal suggestions from the macros left in the day (RF9): pure, deterministic and local -
// reads lib/foods.js only, no network, no store writes. Inputs are the remaining kcal and
// protein, the clock hour (it picks the section the chips render in via mealForHour and
// bounds the portion: snack window and late night get a light cap) and the foods already
// logged today (never suggest a repeat). Ranking is protein per kcal - the protein gap is
// what a meal actually has to close - with the name as the deterministic tie-break, the
// same way searchFoods settles equal ranks (foods.js:276). Portions are floored to 5 g so
// a suggestion can fill the gap but never overshoot it.
import { FOODS, normalizeText } from './foods.js'

export const SUGGEST_LIMIT = 3
const MIN_PORTION_G = 25
const MAIN_PORTION_G = 400
const LIGHT_PORTION_G = 150

export const mealForHour = h =>
  h >= 5 && h < 10 ? 'cafe' : h >= 10 && h < 15 ? 'almoco' : h >= 15 && h < 18 ? 'lanche' : 'jantar'

const lightPortion = h => mealForHour(h) === 'lanche' || h >= 21 || h < 5

const floor5 = g => Math.floor(g / 5) * 5

export function suggestFoods(opts, limit = SUGGEST_LIMIT) {
  const { kcal = 0, protein = 0, hour = 12, logged = [] } = opts || {}
  if (!(Number(kcal) > 0)) return []
  const seen = new Set(
    (Array.isArray(logged) ? logged : []).map(e => normalizeText(typeof e === 'string' ? e : e?.name)),
  )
  const cap = lightPortion(Number(hour) || 0) ? LIGHT_PORTION_G : MAIN_PORTION_G
  const rows = []
  for (const food of FOODS) {
    if (seen.has(normalizeText(food.name))) continue
    const { kcal: k100, protein: p100 } = food.per100g
    const gProtein = Number(protein) > 0 ? (p100 > 0 ? (Number(protein) / p100) * 100 : 0) : Infinity
    const gKcal = k100 > 0 ? (Number(kcal) / k100) * 100 : Infinity
    const grams = floor5(Math.min(gProtein, gKcal, cap))
    if (!(grams >= MIN_PORTION_G)) continue
    rows.push({ food, grams, density: p100 / Math.max(1, k100) })
  }
  rows.sort((a, b) => b.density - a.density || a.food.name.localeCompare(b.food.name))
  return rows.slice(0, Math.max(0, limit)).map(r => ({ ...r.food, grams: r.grams }))
}
