// @vitest-environment happy-dom
// Nutrition's combined chart (RF5): bodyweight, daily intake and weekly training volume on
// one date axis, mounted in the TDEE/Profile section. A gap must render as an open break in
// the line — never a vertex at zero — and the weight series must speak the profile's unit.
//
// TDD: written before Nutrition.jsx gained the chart (red→green record in
// .omo/evidence/task-5-roadmap-features.md). Harness mirrors Nutrition.tdee.test.jsx;
// i18n is never mocked, so t() falls back to the English source strings asserted below.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { useStore } from '../store/useStore.js'
import { DEFAULT_PROFILE } from '../lib/tdee.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: vi.fn(), openSheet: vi.fn(), closeSheet: vi.fn() })
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
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(start + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10),
  )
const WINDOW = daySeq('2026-09-01', 14)

// Same fixture as lib/combined-chart.test.js: no weigh-in on the 5th, no food on the 6th,
// no training in the week of the 7th. unit picks the logged weigh-in scale.
function seed(unit) {
  const base = unit === 'lb' ? 176 : 80
  const bodyweight = WINDOW.filter(d => d !== '2026-09-05').map((d, i) => ({
    d,
    w: base - 0.1 * i,
    t: Date.parse(d + 'T07:30:00Z'),
  }))
  const log = {}
  for (const d of WINDOW) {
    if (d === '2026-09-06') continue
    log[d] = [{ id: 'e1', meal: 'cafe', name: 'Oats', grams: 80, kcal: 2200, protein: 10, carbs: 30, fat: 5 }]
  }
  const trained = (d, sets) => ({
    d,
    entries: [
      {
        id: 'deleted-custom',
        muscleGroups: ['chest'],
        sets: Array.from({ length: sets }, () => ({ done: true, w: 60, r: 8 })),
      },
    ],
  })
  const workouts = [trained('2026-09-02', 3), trained('2026-09-04', 2), trained('2026-09-14', 4)]

  act(() => {
    useStore.setState(s => ({ S: { ...s.S, unit, bodyweight, workouts, weekStart: 1 } }))
    useNutritionStore.setState({ log })
  })
}

function hoverAt(clientX) {
  act(() => {
    document.querySelector('.chart-i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }))
  })
  return document.querySelector('.ctip').textContent
}

beforeEach(() => {
  useNutritionStore.setState({ profile: { ...DEFAULT_PROFILE }, log: {}, lastRemoved: null })
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], workouts: [] } }))
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('Nutrition combined chart', () => {
  it('mounts the three-series chart in the TDEE section with every gap left open', () => {
    seed('kg')
    const host = render()

    expect(host.textContent).toContain('Weight, intake and volume')
    expect(host.textContent).toContain('Weight · kg')
    expect(host.textContent).toContain('Intake · kcal')
    expect(host.textContent).toContain('Volume')

    const lines = [...host.querySelectorAll('.chart-i polyline')]
    // weight breaks at the missing weigh-in (2) + intake breaks at the missing day (2);
    // the empty training week and the single-set week stay dots, not lines.
    expect(lines).toHaveLength(4)
    expect(host.querySelector('.chart-i').innerHTML).not.toContain('NaN')
  })

  it("labels and tooltips the weight series in the profile's unit", () => {
    seed('lb')
    const host = render()

    expect(host.textContent).toContain('Weight · lb')
    expect(hoverAt(0)).toContain('· Weight')
    expect(hoverAt(0)).toContain('176 lb')
  })
})
