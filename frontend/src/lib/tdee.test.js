import { describe, it, expect } from 'vitest'
import {
  ACTIVITY_FACTORS,
  GOAL_ADJUST,
  PROTEIN_G_PER_KG,
  FAT_KCAL_FRAC,
  DEFAULT_PROFILE,
  calcBMR,
  calcTDEE,
  calcCalories,
  calcMacros,
  getTargets,
} from './tdee.js'

// 80 kg / 180 cm / 30 yr man: 800 + 1125 − 150 + 5 = 1780.
const man = { peso: 80, altura: 180, idade: 30, sexo: 'male', atividade: 'moderado', objetivo: 'manter' }
// 60 kg / 165 cm / 25 yr woman: 600 + 1031.25 − 125 − 161 = 1345.25.
const woman = { peso: 60, altura: 165, idade: 25, sexo: 'female', atividade: 'sedentario', objetivo: 'manter' }

describe('calcBMR (Mifflin-St Jeor)', () => {
  it('computes the male formula', () => {
    expect(calcBMR(man)).toBe(1780)
  })
  it('computes the female formula', () => {
    expect(calcBMR(woman)).toBeCloseTo(1345.25, 5)
  })
  it('differs by exactly 166 kcal between sexes on the same measurements', () => {
    expect(calcBMR({ ...man, sexo: 'female' })).toBe(calcBMR(man) - 166)
  })
  it('coerces numeric strings and falls back on garbage (the form is being typed into)', () => {
    expect(calcBMR({ peso: '80', altura: '180', idade: '30', sexo: 'male' })).toBe(1780)
    expect(Number.isFinite(calcBMR({ peso: 'abc', altura: null, idade: undefined, sexo: 'male' }))).toBe(true)
  })
})

describe('calcTDEE', () => {
  it('applies the activity factor table', () => {
    expect(calcTDEE(1780, 'sedentario')).toBeCloseTo(2136, 5)
    expect(calcTDEE(1780, 'leve')).toBeCloseTo(2447.5, 5)
    expect(calcTDEE(1780, 'moderado')).toBeCloseTo(2759, 5)
    expect(calcTDEE(1780, 'intenso')).toBeCloseTo(3070.5, 5)
    expect(calcTDEE(1780, 'muito_intenso')).toBeCloseTo(3382, 5)
    expect(ACTIVITY_FACTORS.moderado).toBe(1.55)
  })
  it('treats an unknown level as the default instead of 1.2', () => {
    expect(calcTDEE(1780, 'nunca')).toBe(calcTDEE(1780, DEFAULT_PROFILE.atividade))
  })
})

describe('calcCalories', () => {
  it('keeps maintenance at 0%, cuts −17.5%, and a surplus of +10%', () => {
    expect(GOAL_ADJUST.manter).toBe(0)
    expect(GOAL_ADJUST.ganhar).toBeCloseTo(0.1, 5)
    expect(GOAL_ADJUST.emagrecer).toBeCloseTo(-0.175, 5)
    expect(calcCalories(2759, 'manter')).toBe(2759)
    expect(calcCalories(2759, 'emagrecer')).toBeCloseTo(2276.175, 3)
    expect(calcCalories(2759, 'ganhar')).toBeCloseTo(3034.9, 3)
  })
  it('falls back to maintenance for an unknown goal', () => {
    expect(calcCalories(2000, 'qualquer')).toBe(2000)
  })
})

describe('calcMacros', () => {
  it('protein tracks body weight per goal', () => {
    expect(calcMacros(2759, man).protein).toBeCloseTo(80 * PROTEIN_G_PER_KG.manter, 5)
    expect(calcMacros(2759, { ...man, objetivo: 'emagrecer' }).protein).toBeCloseTo(176, 5)
    expect(calcMacros(2759, { ...man, objetivo: 'ganhar' }).protein).toBeCloseTo(128, 5)
  })
  it('fat lands in the 25–30% kcal band of each goal', () => {
    for (const objetivo of ['emagrecer', 'manter', 'ganhar']) {
      const kcal = calcCalories(2759, objetivo)
      const { fat } = calcMacros(kcal, { ...man, objetivo })
      const frac = (fat * 9) / kcal
      expect(frac).toBeGreaterThanOrEqual(FAT_KCAL_FRAC[objetivo] - 1e-9)
      expect(frac).toBeLessThanOrEqual(FAT_KCAL_FRAC[objetivo] + 1e-9)
      expect(FAT_KCAL_FRAC[objetivo]).toBeGreaterThanOrEqual(0.25)
      expect(FAT_KCAL_FRAC[objetivo]).toBeLessThanOrEqual(0.3)
    }
  })
  it('carbs take the remainder and never go negative', () => {
    const m = calcMacros(2759, man)
    expect(m.carbs * 4 + m.protein * 4 + m.fat * 9).toBeCloseTo(2759, 5)
    expect(calcMacros(100, man).carbs).toBe(0)
  })
})

describe('getTargets', () => {
  it('snapshots the whole pipeline for a moderate, maintaining man', () => {
    expect(getTargets(man)).toEqual({ bmr: 1780, tdee: 2759, kcal: 2759, protein: 144, carbs: 356, fat: 84 })
  })
  it('snapshots a cut: −17.5% kcal, 2.2 g/kg protein, 25% fat', () => {
    expect(getTargets({ ...man, objetivo: 'emagrecer' })).toEqual({
      bmr: 1780,
      tdee: 2759,
      kcal: 2276,
      protein: 176,
      carbs: 251,
      fat: 63,
    })
  })
  it('snapshots a bulk: +10% kcal, 1.6 g/kg protein, 30% fat', () => {
    expect(getTargets({ ...man, objetivo: 'ganhar' })).toEqual({
      bmr: 1780,
      tdee: 2759,
      kcal: 3035,
      protein: 128,
      carbs: 403,
      fat: 101,
    })
  })
  it('snapshots a sedentary woman', () => {
    expect(getTargets(woman)).toEqual({ bmr: 1345, tdee: 1614, kcal: 1614, protein: 108, carbs: 185, fat: 49 })
  })
  it('works on an empty profile without NaN', () => {
    const targets = getTargets()
    for (const v of Object.values(targets)) expect(Number.isFinite(v)).toBe(true)
    expect(targets.kcal).toBeGreaterThan(1000)
  })
  it('does not mutate the profile it is given', () => {
    const before = { ...man }
    getTargets(man)
    expect(man).toEqual(before)
  })
})
