// @vitest-environment happy-dom
// Coverage-gap tests (todo 21): the Nutrition view's diary surface. A day with entries must
// total into the calorie/macro summary and list every meal row; an empty day must show the
// no-meals fallback with zeroed totals; removing an entry must fall back to the empty state
// while offering a working Undo.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { getTargets, DEFAULT_PROFILE } from '../lib/tdee.js'
import { todayISO, fmtNum } from '../lib/format.js'

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

const breakfast = over => ({
  id: 'e1',
  meal: 'cafe',
  name: 'Oatmeal',
  grams: 80,
  kcal: 300,
  protein: 12,
  carbs: 50,
  fat: 6,
  ...over,
})
const rowTitles = host => [...host.querySelectorAll('.lrow-t')].map(el => el.textContent)

beforeEach(() => {
  useNutritionStore.setState({ log: {}, lastRemoved: null })
  mocks.toast.mockClear()
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('Nutrition diary', () => {
  it('totals the logged day into the summary and lists each meal entry', () => {
    const date = todayISO()
    act(() =>
      useNutritionStore.setState({
        log: {
          [date]: [
            breakfast(),
            { id: 'e2', meal: 'almoco', name: 'Rice and beans', grams: 250, kcal: 450, protein: 20, carbs: 80, fat: 5 },
          ],
        },
      }),
    )
    const host = render()

    expect(host.querySelector('h1').textContent).toBe('Nutrition')
    // 300 + 450 kcal from the log, formatted through the view's own number formatting
    expect(host.querySelector('.nut-kcal b').textContent).toBe('750')
    expect(host.querySelector('.nut-none')).toBeNull()

    expect(rowTitles(host)).toEqual(expect.arrayContaining(['Oatmeal', 'Rice and beans']))
    expect(host.querySelector('.nut-ek').textContent).toContain('300')

    // macro bars reflect the entries: 12 + 20 g of protein against the goal
    const protein = [...host.querySelectorAll('.nut-bar-h')].find(el => el.textContent.includes('Protein'))
    expect(protein.textContent).toContain('32 /')

    // under target, the header states the remaining calories for this exact day
    const targets = getTargets(DEFAULT_PROFILE)
    expect(host.querySelector('.nut-rem').textContent).toBe(`Remaining ${fmtNum(Math.abs(targets.kcal - 750))} kcal`)

    // day navigation: today cannot move forward, the previous day is reachable
    expect(host.querySelector("[aria-label='Next day']").disabled).toBe(true)
    expect(host.querySelector("[aria-label='Previous day']").disabled).toBe(false)
  })

  it('shows the no-meals fallback with zeroed totals for an empty diary', () => {
    const host = render()

    expect(host.querySelector('.nut-none').textContent).toContain('No meals logged yet')
    expect(host.querySelector('.nut-kcal b').textContent).toBe('0')
    expect(host.querySelector('.nut-undo')).toBeNull()
    expect(host.querySelectorAll('.nut-del')).toHaveLength(0)
    // every meal section still offers its add action
    expect(rowTitles(host).filter(title => title === 'Add food')).toHaveLength(4)
  })

  it('drops a removed entry into the empty fallback and restores it through Undo', () => {
    const date = todayISO()
    act(() => useNutritionStore.setState({ log: { [date]: [breakfast()] } }))
    const host = render()
    expect(host.querySelectorAll('.nut-del')).toHaveLength(1)

    act(() => host.querySelector('.nut-del').click())
    expect(mocks.toast).toHaveBeenCalledWith('Entry removed')
    expect(rowTitles(host)).not.toContain('Oatmeal')
    expect(host.querySelector('.nut-none').textContent).toContain('No meals logged yet')
    expect(host.querySelector('.nut-kcal b').textContent).toBe('0')

    const undo = host.querySelector('.nut-undo')
    expect(undo.textContent).toContain('Entry removed')
    act(() => undo.querySelector('button').click())

    expect(rowTitles(host)).toContain('Oatmeal')
    expect(host.querySelector('.nut-none')).toBeNull()
    expect(host.querySelector('.nut-undo')).toBeNull()
    expect(host.querySelector('.nut-kcal b').textContent).toBe('300')
  })
})
