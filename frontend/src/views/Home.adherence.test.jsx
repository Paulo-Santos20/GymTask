// @vitest-environment happy-dom
// Home's "x / y this week" line used to read y straight off the S.week template, so a day moved
// with the day planner (or simply marked rest) left the denominator describing a week that no
// longer exists. The count comes from the same helper Stats shows as a tile, so the two numbers
// on the two screens can never disagree.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { isoOf, startOfWeek, todayISO, weekStartOf } from '../lib/format.js'
import Home from './Home.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(),
  bwSheet: vi.fn(),
  goalSheet: vi.fn(),
  dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(),
  startFlow: vi.fn(),
  bwDeltaColor: () => '',
}))

const routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: '0025' }] }]

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// The seven dates of the week today sits in, index 0 = the profile's week start, and a
// weekday-keyed template over three of them — written from the indices so the scenario reads
// "first, third and fifth day of this week" whichever day the profile starts on.
const day = (() => {
  const start = startOfWeek(todayISO(), weekStartOf(useStore.getState().S))
  return i => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return isoOf(d)
  }
})()
const weekdayOf = iso => new Date(iso + 'T12:00:00').getDay()
const wd = { [weekdayOf(day(0))]: ['r1'], [weekdayOf(day(2))]: ['r1'], [weekdayOf(day(4))]: ['r1'] }
const setS = (over = {}) =>
  useStore.setState(s => ({
    S: {
      ...s.S,
      routines,
      week: wd,
      dayPlan: {},
      workouts: [],
      active: null,
      weighIn: false,
      ...over,
    },
    user: null,
  }))
const mount = () => act(() => root.render(<Home />))
const line = () => host.textContent.match(/\d+\s*\/\s*\d+ this week/)?.[0].replace(/\s+/g, ' ')

describe('Home — the weekly denominator comes from the effective plan', () => {
  it('shows the week as the plan actually has it after a Fri → Sat move', () => {
    // Mon and Sat trained; the template said Mon/Wed/Fri, the planner says Mon/Wed/Sat.
    const workouts = [
      { id: 'a', d: day(0), entries: [] },
      { id: 'b', d: day(5), entries: [] },
    ]
    setS({ dayPlan: { [day(4)]: 'rest', [day(5)]: 'r1' }, workouts })
    mount()
    expect(line()).toBe('2 / 3 this week')
  })

  it('drops a day the profile marked rest — the static template count kept it', () => {
    setS({ dayPlan: { [day(4)]: 'rest' }, workouts: [] })
    mount()
    expect(line()).toBe('0 / 2 this week')
  })

  it('keeps the line as plain sessions over planned days when nothing was ever overridden', () => {
    const workouts = [{ id: 'a', d: day(0), entries: [] }]
    setS({ workouts })
    mount()
    expect(line()).toBe('1 / 3 this week')
  })
})
