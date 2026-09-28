import { describe, it, expect } from 'vitest'
import { FOODS, normalizeText, searchFoods } from './foods.js'

describe('normalizeText', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeText('Farinha de Mandioca')).toBe('farinha de mandioca')
    expect(normalizeText('Açaí')).toBe('acai')
    expect(normalizeText('Brócolis')).toBe('brocolis')
  })
  it('handles null/undefined without throwing', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
})

describe('food dataset', () => {
  it('has at least 200 foods with unique names', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(200)
    const names = FOODS.map(f => f.name)
    expect(new Set(names).size).toBe(names.length)
  })
  it('normalises every entry into the shared {source,name,per100g} shape', () => {
    for (const f of FOODS) {
      expect(f.source).toBe('local')
      expect(typeof f.name).toBe('string')
      const { kcal, protein, carbs, fat } = f.per100g
      expect(kcal).toBeGreaterThanOrEqual(0)
      expect(protein).toBeGreaterThanOrEqual(0)
      expect(carbs).toBeGreaterThanOrEqual(0)
      expect(fat).toBeGreaterThanOrEqual(0)
    }
  })
  it('carries the known staples at their expected values', () => {
    const arroz = FOODS.find(f => f.name === 'Arroz branco cozido')
    expect(arroz.per100g).toEqual({ kcal: 128, protein: 2.6, carbs: 28.1, fat: 0.2 })
    const frango = FOODS.find(f => f.name === 'Frango peito grelhado')
    expect(frango.per100g.kcal).toBe(159)
    expect(frango.per100g.protein).toBe(31)
  })
})

describe('searchFoods', () => {
  it('finds accent-insensitive matches', () => {
    const plain = searchFoods('feijao')
    expect(plain.length).toBeGreaterThanOrEqual(3)
    expect(plain.every(f => normalizeText(f.name).includes('feijao'))).toBe(true)
    expect(plain.some(f => f.name === 'Feijão carioca cozido')).toBe(true)
  })
  it('is case-insensitive', () => {
    const lower = searchFoods('arroz branco')
    const upper = searchFoods('ARROZ BRANCO')
    expect(lower.length).toBeGreaterThan(0)
    expect(upper.map(f => f.name)).toEqual(lower.map(f => f.name))
  })
  it('ranks prefix matches first', () => {
    const hits = searchFoods('arroz branco', 5)
    expect(hits[0].name).toBe('Arroz branco cozido')
  })
  it('requires every word of a multi-word query to match', () => {
    const hits = searchFoods('arroz integral')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every(f => normalizeText(f.name).includes('integral'))).toBe(true)
    expect(hits.some(f => f.name === 'Arroz branco cozido')).toBe(false)
  })
  it('respects the limit', () => {
    expect(searchFoods('arroz', 2)).toHaveLength(2)
    expect(searchFoods('feijao', 1)).toHaveLength(1)
  })
  it('returns an empty list for blank or unmatched queries', () => {
    expect(searchFoods('')).toEqual([])
    expect(searchFoods('   ')).toEqual([])
    expect(searchFoods('xyzqwk')).toEqual([])
  })
  it('never mutates the underlying table', () => {
    const before = FOODS.length
    searchFoods('arroz', 3)
    expect(FOODS.length).toBe(before)
  })
})
