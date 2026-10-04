// @vitest-environment happy-dom
// Nutrition adaptive TDEE surface: with fewer than 14 paired weigh-in + food days the
// Profile section states what is missing (an informational line — no error, no Apply);
// with 14+ it shows the estimate beside the formula TDEE and one tap adopts it as the
// calorie target through setProfile — the log is never touched and nothing auto-applies.
//
// TDD: written before Nutrition.jsx gained the adaptive block (red→green record in
// .omo/evidence/task-1-top5-features.md). Harness mirrors Nutrition.coverage.test.jsx;
// i18n is never mocked, so t() falls back to the English source strings asserted below.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { useStore } from '../store/useStore.js'
import { getTargets, DEFAULT_PROFILE } from '../lib/tdee.js'
import { fmtNum } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: vi.fn(), closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../nutrition.css', () => ({}))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Nutrition />))
  return host
}

const daySeq = (start, n) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10))

// n paired days: weigh-in + food entries per date, −0.1 kg/day trend on a 2500 kcal
// intake → adaptive maintenance of 3270 kcal (same fixture math as tdee-adaptive.test.js).
function seedPaired({ n = 14, start = '2026-09-01' } = {}) {
  const dates = daySeq(start, n)
  const bodyweight = dates.map((d, i) => ({ d, w: 80 - 0.1 * i, t: Date.parse(d + 'T12:00:00Z') }))
  const log = {}
  dates.forEach((d, i) => {
    log[d] = [{ id: `e${i}`, meal: 'cafe', name: 'Oats', grams: 80, kcal: 2500, protein: 10, carbs: 30, fat: 5 }]
  })
  return { bodyweight, log }
}

const applyButton = host => [...host.querySelectorAll('button')].find(b => b.textContent === 'Apply')

beforeEach(() => {
  useNutritionStore.setState({
    profile: { ...DEFAULT_PROFILE },
    targets: getTargets(DEFAULT_PROFILE),
    log: {},
    lastRemoved: null,
  })
  useStore.setState({ S: { ...useStore.getState().S, bodyweight: [], unit: 'kg' } })
  mocks.toast.mockClear()
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('Nutrition adaptive TDEE', () => {
  it('states the data requirement instead of erroring when paired days are short', () => {
    const { bodyweight, log } = seedPaired({ n: 13 })
    act(() => {
      useStore.setState({ S: { ...useStore.getState().S, bodyweight } })
      useNutritionStore.setState({ log })
    })
    const host = render()

    expect(host.textContent).toContain('Adaptive estimate appears after 14 days with weigh-ins and food logged.')
    expect(applyButton(host)).toBeUndefined()
    // informational, not an error: the formula TDEE footer still renders untouched
    expect(host.textContent).toContain('Maintenance')
  })

  it('shows the estimate and adopts it as the calorie target on Apply', () => {
    const { bodyweight, log } = seedPaired({ n: 14 })
    act(() => {
      useStore.setState({ S: { ...useStore.getState().S, bodyweight } })
      useNutritionStore.setState({ log })
    })
    const host = render()

    const btn = applyButton(host)
    expect(btn).toBeDefined()
    const shown = host.querySelector('.nut-adaptive b')
    expect(shown.textContent).toBe(fmtNum(3270))
    // nothing changed until the tap — no auto-apply
    expect(useNutritionStore.getState().profile.kcalTarget).toBeUndefined()
    expect(useNutritionStore.getState().targets.kcal).toBe(getTargets(DEFAULT_PROFILE).kcal)

    act(() => btn.click())
    expect(useNutritionStore.getState().profile.kcalTarget).toBe(3270)
    expect(useNutritionStore.getState().targets.kcal).toBe(3270)
    expect(mocks.toast).toHaveBeenCalledWith('Calorie target updated')
    // the daily summary now counts against the adopted target
    expect(host.querySelector('.nut-kcal span').textContent).toBe(`/ ${fmtNum(3270)} kcal`)
    // the log itself was never mutated
    expect(useNutritionStore.getState().log).toEqual(log)
  })
})
