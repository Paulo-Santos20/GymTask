import { describe, expect, it } from 'vitest'
import { suggestFoods, mealForHour } from './meal-suggest.js'
import { FOODS } from './foods.js'

const density = f => f.per100g.protein / Math.max(1, f.per100g.kcal)

describe('mealForHour', () => {
  it('maps clock hours to the meal section they belong to', () => {
    expect(mealForHour(7)).toBe('cafe')
    expect(mealForHour(12)).toBe('almoco')
    expect(mealForHour(16)).toBe('lanche')
    expect(mealForHour(19)).toBe('jantar')
    expect(mealForHour(3)).toBe('jantar')
  })
})

describe('suggestFoods', () => {
  it('ranks the most protein-dense foods first when 30 g of protein is left', () => {
    const items = suggestFoods({ kcal: 600, protein: 30, hour: 12, logged: [] })
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items[0].name).toBe('Camarão grelhado')
    expect(density(items[0])).toBe(Math.max(...FOODS.map(density)))
    const densities = items.map(density)
    for (let i = 1; i < densities.length; i++) {
      expect(densities[i - 1]).toBeGreaterThanOrEqual(densities[i])
    }
  })

  it('never suggests a portion past the remaining protein or kcal', () => {
    const items = suggestFoods({ kcal: 600, protein: 30, hour: 12 })
    expect(items.length).toBeGreaterThan(0)
    for (const f of items) {
      expect((f.per100g.protein * f.grams) / 100).toBeLessThanOrEqual(30 + 1e-9)
      expect((f.per100g.kcal * f.grams) / 100).toBeLessThanOrEqual(600 + 1e-9)
      expect(f.grams % 5).toBe(0)
      expect(f.grams).toBeGreaterThanOrEqual(25)
    }
  })

  it('skips foods already logged today and hands the slot to the next best', () => {
    const items = suggestFoods({ kcal: 600, protein: 30, hour: 12, logged: [{ name: 'Camarão grelhado' }] })
    expect(items.map(f => f.name)).not.toContain('Camarão grelhado')
    expect(items[0].name).toBe('Peru peito grelhado')
  })

  it('keeps the portion light during the snack window and late at night', () => {
    const noon = suggestFoods({ kcal: 5000, protein: 500, hour: 12 })
    const dinner = suggestFoods({ kcal: 5000, protein: 500, hour: 19 })
    const snack = suggestFoods({ kcal: 5000, protein: 500, hour: 16 })
    const late = suggestFoods({ kcal: 5000, protein: 500, hour: 23 })
    expect(noon[0].grams).toBe(400)
    expect(dinner[0].grams).toBe(400)
    expect(snack[0].grams).toBe(150)
    expect(late[0].grams).toBe(150)
  })

  it('answers an empty list when nothing is left or the data is missing entirely', () => {
    expect(suggestFoods({ kcal: 0, protein: 0, hour: 12 })).toEqual([])
    expect(suggestFoods({ kcal: -100, protein: 40, hour: 12 })).toEqual([])
    expect(suggestFoods({ kcal: 'lots', protein: 30, hour: 12 })).toEqual([])
    expect(suggestFoods()).toEqual([])
    expect(suggestFoods(null)).toEqual([])
  })

  it('is deterministic - the same inputs always give the same list', () => {
    const a = suggestFoods({ kcal: 800, protein: 40, hour: 19, logged: [] })
    const b = suggestFoods({ kcal: 800, protein: 40, hour: 19, logged: [] })
    expect(a).toEqual(b)
    expect(a.length).toBe(3)
  })
})
