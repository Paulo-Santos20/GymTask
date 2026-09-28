// TDEE / macro targets — pure functions, no state, no DOM (tests beside them in tdee.test.js).
//
// BMR: Mifflin-St Jeor (10·kg + 6.25·cm − 5·yr + 5 men / −161 women), the equation the
// common online calculators use and the most accurate one that needs no body-fat measure.
// TDEE = BMR × activity factor. The daily calorie target then adjusts for the goal, and the
// macro split is derived from that calorie target: protein per kg of body weight (higher on a
// cut to protect lean mass), fat as a share of calories (hormonal floor ~25%), carbs take
// whatever energy is left.
//
// These are estimates for training guidance, not medical advice — the view says so too.

// Activity levels as stored in the profile (sedentary = desk job, very intense = training
// most days + physical job).
export const ACTIVITY_FACTORS = {
  sedentario: 1.2,
  leve: 1.375,
  moderado: 1.55,
  intenso: 1.725,
  muito_intenso: 1.9,
}
export const DEFAULT_ACTIVITY = 'moderado'

// Goal → daily energy adjustment. Cutting sits between −15% and −20% (midpoint −17.5%):
// enough of a deficit to lose ~0.5 kg/week for most profiles without crushing training.
export const GOAL_ADJUST = {
  emagrecer: -0.175,
  manter: 0,
  ganhar: 0.1,
}
export const DEFAULT_GOAL = 'manter'

// Protein g per kg of body weight, by goal (ISSM / ISSN ranges: 1.6–2.2 g/kg).
export const PROTEIN_G_PER_KG = {
  emagrecer: 2.2,
  manter: 1.8,
  ganhar: 1.6,
}

// Fat as a fraction of daily calories, by goal (25–30% band).
export const FAT_KCAL_FRAC = {
  emagrecer: 0.25,
  manter: 0.275,
  ganhar: 0.3,
}

export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 }

// The form's default profile — also what a fresh store starts with.
export const DEFAULT_PROFILE = {
  peso: 75,        // kg
  altura: 175,     // cm
  idade: 30,       // years
  sexo: 'male',    // 'male' | 'female' — Mifflin-St Jeor's only demographic input
  atividade: DEFAULT_ACTIVITY,
  objetivo: DEFAULT_GOAL,
}

// kcal/day at rest. Non-numeric or missing fields fall back to the defaults rather than
// producing NaN targets while the user is still typing into the form.
export function calcBMR(profile = {}) {
  const peso = Number(profile.peso) || DEFAULT_PROFILE.peso
  const altura = Number(profile.altura) || DEFAULT_PROFILE.altura
  const idade = Number(profile.idade) || DEFAULT_PROFILE.idade
  const base = 10 * peso + 6.25 * altura - 5 * idade
  return profile.sexo === 'female' ? base - 161 : base + 5
}

// BMR × activity factor; an unknown level is treated as the default rather than 1.2, so a
// profile written before a level existed still gets a sensible number.
export function calcTDEE(bmr, atividade) {
  const factor = ACTIVITY_FACTORS[atividade] ?? ACTIVITY_FACTORS[DEFAULT_ACTIVITY]
  return bmr * factor
}

// TDEE adjusted for the goal. Unknown goal = maintain.
export function calcCalories(tdee, objetivo) {
  const adj = GOAL_ADJUST[objetivo] ?? GOAL_ADJUST[DEFAULT_GOAL]
  return tdee * (1 + adj)
}

// Macro split for a calorie target: protein from body weight, fat from the calorie share,
// carbs as the remainder (never below zero for implausibly low targets).
export function calcMacros(kcal, profile = {}) {
  const peso = Number(profile.peso) || DEFAULT_PROFILE.peso
  const objetivo = profile.objetivo ?? DEFAULT_GOAL
  const protein = peso * (PROTEIN_G_PER_KG[objetivo] ?? PROTEIN_G_PER_KG[DEFAULT_GOAL])
  const fat = kcal * (FAT_KCAL_FRAC[objetivo] ?? FAT_KCAL_FRAC[DEFAULT_GOAL]) / KCAL_PER_G.fat
  const carbs = Math.max(0, (kcal - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs)
  return { protein, carbs, fat }
}

// Everything the Nutrition screen shows, rounded to whole grams/calories for display.
// Raw values stay available through the individual functions if a caller needs precision.
export function getTargets(profile = {}) {
  const bmr = calcBMR(profile)
  const tdee = calcTDEE(bmr, profile.atividade ?? DEFAULT_ACTIVITY)
  const kcal = calcCalories(tdee, profile.objetivo ?? DEFAULT_GOAL)
  const macros = calcMacros(kcal, profile)
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    kcal: Math.round(kcal),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  }
}
