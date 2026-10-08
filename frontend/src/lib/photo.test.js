// RF10 (roadmap-features todo 10): the pure half of the meal-photo estimate - how a photo
// becomes a JPEG payload, and how the vision model's JSON (or the server's normalised copy
// of it) becomes the per-100 g entries the existing add-food form edits. Nothing here
// touches the network or the DOM (fileToDataUrl is exercised through the view's module mock,
// the same seam scan-web uses).
import { describe, expect, it } from 'vitest'
import { MENU_SYSTEM, PHOTO_MODEL, PHOTO_SYSTEM, fitWithin, parseEstimate, parseMenu } from './photo.js'

describe('fitWithin', () => {
  it('scales a landscape photo to the max edge keeping the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1024)).toEqual({ width: 1024, height: 768 })
  })
  it('scales a portrait photo, and leaves anything already small untouched', () => {
    expect(fitWithin(3024, 4032, 1024)).toEqual({ width: 768, height: 1024 })
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 })
  })
})

describe('parseEstimate', () => {
  const food = over => ({
    name: 'Arroz',
    grams: 200,
    kcal: 300,
    protein: 6,
    carbs: 60,
    fat: 2,
    confidence: 0.9,
    ...over,
  })

  it('parses the model JSON text into editable per-100 g entries', () => {
    const out = parseEstimate(JSON.stringify({ foods: [food()] }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'Arroz', source: 'photo', grams: 200, confidence: 0.9 })
    expect(out[0].per100g).toEqual({ kcal: 150, protein: 3, carbs: 30, fat: 1 })
  })

  it('converts portion totals to per-100 g with whole numbers the stepper can edit', () => {
    const out = parseEstimate([food({ grams: 150, kcal: 250, protein: 37, carbs: 0, fat: 15 })])
    expect(out[0].per100g).toEqual({ kcal: 167, protein: 25, carbs: 0, fat: 10 })
  })

  it('accepts an object or an array straight from the server', () => {
    expect(parseEstimate({ foods: [food()] })).toHaveLength(1)
    expect(parseEstimate({ results: [food()] })).toHaveLength(1)
    expect(parseEstimate([food()])).toHaveLength(1)
  })

  it('clamps confidence and grams, drops junk, and caps at five', () => {
    const out = parseEstimate({
      foods: [
        food({ name: 'Pct', confidence: 92 }),
        food({ name: 'High', confidence: 1.5 }),
        food({ name: 'Huge', grams: 99999 }),
        food({ name: '   ' }),
        food({ name: 'NoMacros', kcal: 'x' }),
        food({ name: 'E1' }),
        food({ name: 'E2' }),
        food({ name: 'E3' }),
      ],
    })
    expect(out.length).toBeLessThanOrEqual(5)
    expect(out.find(e => !e.name)).toBeUndefined()
    expect(out.find(e => !Number.isFinite(e.per100g.kcal))).toBeUndefined()
    expect(out[0].confidence).toBe(0.92)
    expect(out[1].confidence).toBe(1)
    expect(out[2].grams).toBe(1500)
    expect(out.map(e => e.name)).not.toContain('E3')
  })

  it('answers empty for garbage instead of throwing', () => {
    expect(parseEstimate('not json at all')).toEqual([])
    expect(parseEstimate(null)).toEqual([])
    expect(parseEstimate(undefined)).toEqual([])
    expect(parseEstimate({ foods: 'nope' })).toEqual([])
    expect(parseEstimate({ foods: [] })).toEqual([])
    expect(parseEstimate({})).toEqual([])
  })
})

it('names the approved vision model and the JSON contract the prompt pins', () => {
  expect(PHOTO_MODEL).toBe('qwen/qwen3.8-27b')
  expect(PHOTO_SYSTEM).toMatch(/foods/)
  expect(PHOTO_SYSTEM).toMatch(/confidence/)
})

describe('parseMenu', () => {
  it('parses the model JSON text into a clean dish list', () => {
    const out = parseMenu(JSON.stringify({ dishes: ['Feijoada', '  ', '  feijoada ', 'Salada de frango', 42, null] }))
    expect(out).toEqual(['Feijoada', 'Salada de frango'])
  })

  it('accepts the server string array and caps at 15', () => {
    expect(parseMenu(['Prato 1', 'Prato 2'])).toEqual(['Prato 1', 'Prato 2'])
    expect(parseMenu(Array.from({ length: 20 }, (_, i) => 'Dish ' + i))).toHaveLength(15)
  })

  it('answers empty for garbage instead of throwing', () => {
    expect(parseMenu('not json')).toEqual([])
    expect(parseMenu(null)).toEqual([])
    expect(parseMenu({ dishes: 'nope' })).toEqual([])
    expect(parseMenu([])).toEqual([])
  })

  it('pins the cardápio prompt contract the server copy mirrors', () => {
    expect(MENU_SYSTEM).toMatch(/dishes/)
    expect(MENU_SYSTEM).toMatch(/cardápio/)
  })
})
