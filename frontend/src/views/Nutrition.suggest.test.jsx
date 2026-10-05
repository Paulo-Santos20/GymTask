// @vitest-environment happy-dom
// RF9 (roadmap-features todo 9): suggestion chips in the current meal's section prefills the
// add-food form - confirmAdd stays the only writer - and the chips disappear when the day's
// budget is spent. No network: suggestions come from the local foods table (lib/foods.js).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  openSheet: vi.fn(),
  searchExternal: vi.fn(),
}))

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet, closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/foodApis.js', () => ({ searchExternal: mocks.searchExternal }))
vi.mock('../nutrition.css', () => ({}))

import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { suggestFoods, mealForHour } from '../lib/meal-suggest.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Nutrition />))
  return host
}

const pristineTargets = useNutritionStore.getState().targets

beforeEach(() => {
  useNutritionStore.setState({ log: {}, lastRemoved: null, targets: { ...pristineTargets } })
  mocks.toast.mockClear()
  mocks.searchExternal.mockReset()
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => {
      root.unmount()
    })
  })
})

describe('meal suggestion chips', () => {
  it('shows chips in the current meal section, prefills on tap, writes only on confirm', () => {
    const host = render()

    const rows = host.querySelectorAll('.nut-sug')
    expect(rows.length).toBe(1)
    const chips = [...rows[0].querySelectorAll('button.chip')]
    expect(chips.length).toBeGreaterThan(0)

    const { targets } = useNutritionStore.getState()
    const expected = suggestFoods({
      kcal: targets.kcal - 0,
      protein: targets.protein - 0,
      hour: new Date().getHours(),
      logged: [],
    })
    expect(chips.map(c => c.textContent)).toEqual(expected.map(f => f.name))

    act(() => chips[0].click())

    // prefill only: the form opens on the picked entry, the diary is untouched
    const pick = host.querySelector('.nut-pick')
    expect(pick).toBeTruthy()
    expect(pick.textContent).toContain(expected[0].name)
    expect(useNutritionStore.getState().log[todayISO()] ?? []).toHaveLength(0)

    const add = [...pick.querySelectorAll('button')].find(b => b.textContent.includes('Add'))
    expect(add).toBeTruthy()
    act(() => add.click())

    const entry = useNutritionStore.getState().log[todayISO()]
    expect(entry).toHaveLength(1)
    expect(entry[0]).toMatchObject({
      meal: mealForHour(new Date().getHours()),
      name: expected[0].name,
      grams: expected[0].grams,
    })
  })

  it('no chips at all when nothing is left of the day - the empty state', () => {
    useNutritionStore.setState({ targets: { kcal: 0, protein: 0, carbs: 0, fat: 0 } })
    const host = render()
    expect(host.querySelectorAll('.nut-sug').length).toBe(0)
  })
})
