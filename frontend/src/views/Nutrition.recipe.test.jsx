// @vitest-environment happy-dom
// RF7 (roadmap-features todo 7): the recipe UI mounted in Nutrition — the list, the editor
// (ingredient rows built from the same field components the add-food entry uses), and the
// "add to diary" sheet that splits a recipe into per-portion entries through the EXISTING
// entry shape with source 'receita'. The REAL Nutrition view and REAL store run here; only
// the UI store (toast/sheet host) is stubbed, the same seam Nutrition.barcode.test.jsx uses.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ toast: vi.fn(), openSheet: vi.fn() }))

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet, closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../nutrition.css', () => ({}))

import Nutrition from './Nutrition.jsx'
import { useNutritionStore, recipeTotals } from '../store/nutritionStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const ing = (name, grams, kcal, protein, carbs, fat) => ({ name, grams, kcal, protein, carbs, fat })
const stew = () => ({
  id: 'r1',
  name: 'Beef stew',
  portions: 2,
  ingredients: [ing('Beef', 300, 600, 60, 0, 30), ing('Rice', 200, 260, 5, 56, 1)],
})

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Nutrition />))
  return host
}

// Materialise the sheet Nutrition just handed to openSheet — the `close => <Sheet …/>`
// render-prop shape the app uses everywhere (views/Nutrition.jsx doScan, sheets.jsx).
function openSheet() {
  expect(mocks.openSheet).toHaveBeenCalled()
  const renderProp = mocks.openSheet.mock.calls.at(-1)[0]
  const close = vi.fn()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(renderProp(close)))
  return { host, close }
}

const type = (el, value) =>
  act(() => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })

const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
const row = (host, label) => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(label))

beforeEach(() => {
  useNutritionStore.setState({ log: {}, lastRemoved: null, recipes: [] })
  mocks.toast.mockClear()
  mocks.openSheet.mockClear()
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => {
      root.unmount()
    })
  })
})

describe('Nutrition recipes', () => {
  it('shows the recipes section with an empty state when there are none', () => {
    const host = render()
    expect(host.textContent).toContain('Recipes')
    expect(host.textContent).toContain('No recipes yet')
    expect(row(host, 'New recipe')).toBeTruthy()
  })

  it('lists a saved recipe with its portions and per-portion calories', () => {
    useNutritionStore.setState({ recipes: [stew()] })
    const host = render()
    const r = row(host, 'Beef stew')
    expect(r).toBeTruthy()
    expect(r.textContent).toContain('2 portions · 430 kcal per portion')
  })

  it('creates a recipe through the editor: ingredient rows → saved with computed totals', () => {
    const host = render()
    act(() => row(host, 'New recipe').click())
    const { host: sheet, close } = openSheet()

    type(sheet.querySelector('[aria-label="Recipe name"]'), 'Beef stew')
    type(sheet.querySelector('.stp-w .num'), '2')

    const [first] = sheet.querySelectorAll('.nut-ing-row')
    type(first.querySelector('[aria-label="Ingredient name"]'), 'Beef')
    type(first.querySelector('[aria-label="Grams"]'), '300')
    type(first.querySelector('[aria-label="Calories"]'), '600')
    type(first.querySelector('[aria-label="Protein"]'), '60')
    type(first.querySelector('[aria-label="Carbs"]'), '0')
    type(first.querySelector('[aria-label="Fat"]'), '30')

    act(() => button(sheet, 'Add ingredient').click())
    const second = sheet.querySelectorAll('.nut-ing-row')[1]
    type(second.querySelector('[aria-label="Ingredient name"]'), 'Rice')
    type(second.querySelector('[aria-label="Grams"]'), '200')
    type(second.querySelector('[aria-label="Calories"]'), '260')
    type(second.querySelector('[aria-label="Protein"]'), '5')
    type(second.querySelector('[aria-label="Carbs"]'), '56')
    type(second.querySelector('[aria-label="Fat"]'), '1')

    act(() => button(sheet, 'Save').click())
    expect(close).toHaveBeenCalled()

    const list = useNutritionStore.getState().recipes
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Beef stew', portions: 2 })
    expect(list[0].ingredients).toHaveLength(2)
    expect(recipeTotals(list[0])).toEqual({ grams: 500, kcal: 860, protein: 65, carbs: 56, fat: 31 })
    expect(mocks.toast).toHaveBeenCalledWith('Recipe saved')
  })

  it('adds a 2-portion recipe to the diary: split into entries that sum exactly', () => {
    useNutritionStore.setState({ recipes: [stew()] })
    const host = render()
    act(() => row(host, 'Beef stew').click())
    const { host: sheet, close } = openSheet()

    expect(sheet.textContent).toContain('430')
    expect(sheet.textContent).toContain('Protein')
    act(() => button(sheet, 'Dinner').click())
    act(() => button(sheet, 'Add to diary').click())
    expect(close).toHaveBeenCalled()

    const day = useNutritionStore.getState().log[todayISO()]
    expect(day).toHaveLength(2, 'one entry per portion')
    expect(day.map(e => e.meal)).toEqual(['jantar', 'jantar'])
    expect(day[0]).toMatchObject({
      name: 'Beef stew',
      source: 'receita',
      grams: 250,
      kcal: 430,
      protein: 33,
      carbs: 28,
      fat: 16,
    })
    for (const k of ['grams', 'kcal', 'protein', 'carbs', 'fat']) {
      expect(day.reduce((n, e) => n + e[k], 0)).toBe(recipeTotals(stew())[k])
    }
    expect(mocks.toast).toHaveBeenCalledWith('Added 2 portions to your diary')
  })

  it('edits and deletes a recipe from the editor', () => {
    useNutritionStore.setState({ recipes: [stew()] })
    const host = render()

    act(() => row(host, 'Beef stew').click())
    const log1 = openSheet()
    act(() => button(log1.host, 'Edit recipe').click())
    const ed1 = openSheet()
    type(ed1.host.querySelector('[aria-label="Recipe name"]'), 'Beef stew v2')
    act(() => button(ed1.host, 'Save').click())
    expect(ed1.close).toHaveBeenCalled()
    expect(useNutritionStore.getState().recipes).toHaveLength(1)
    expect(useNutritionStore.getState().recipes[0].name).toBe('Beef stew v2')

    // the list itself picks the rename up, then the same path deletes the recipe
    act(() => row(host, 'Beef stew v2').click())
    const log2 = openSheet()
    act(() => button(log2.host, 'Edit recipe').click())
    const ed2 = openSheet()
    act(() => button(ed2.host, 'Delete').click())
    expect(ed2.close).toHaveBeenCalled()
    expect(useNutritionStore.getState().recipes).toHaveLength(0)
    expect(mocks.toast).toHaveBeenCalledWith('Recipe deleted')
  })
})
