// @vitest-environment happy-dom
// Coverage-gap tests (todo 22): the History view. Logged workouts come from the mocked store and
// must list newest-first with the count in the header; an empty store must show the dedicated
// empty state; tapping a row must open that workout's detail sheet, the header action must open
// the log sheet, and the header back control must route to /stats. sheets.jsx is mocked so the
// test drives the view's own wiring, not the sheet implementations.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from './History.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  nav: vi.fn(),
  detail: vi.fn(),
  logPast: vi.fn(),
  workouts: [],
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ S: { workouts: mocks.workouts } })
  const useStore = selector => (selector ? selector(snapshot()) : snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../sheets.jsx', () => ({
  WorkoutRow: ({ w, onClick }) => <button className="hrow" onClick={onClick}>{w.name}</button>,
  workoutDetailSheet: mocks.detail,
  logPastWorkoutSheet: mocks.logPast,
}))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<History />))
  return host
}

const rowNames = host => [...host.querySelectorAll('.hrow')].map(el => el.textContent)
const byText = (host, text) =>
  [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  mocks.nav.mockReset()
  mocks.detail.mockReset()
  mocks.logPast.mockReset()
  mocks.workouts = []
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('History view', () => {
  it("lists the store's workouts newest-first with the count in the header", () => {
    const w1 = { id: 'w1', name: 'Push day', date: '2026-09-28' }
    const w2 = { id: 'w2', name: 'Leg day', date: '2026-10-01' }
    mocks.workouts = [w1, w2]
    const host = render()

    expect(host.querySelector('h1').textContent).toBe('History')
    expect(host.querySelector('.sub').textContent).toBe('2 workouts')
    // stored oldest-first, rendered newest-first
    expect(rowNames(host)).toEqual(['Leg day', 'Push day'])
    expect(host.querySelector('.empty')).toBeNull()
  })

  it('shows the empty state when nothing was logged', () => {
    const host = render()

    expect(host.querySelector('.empty').textContent).toContain('No workouts yet.')
    expect(host.querySelector('.list')).toBeNull()
    expect(rowNames(host)).toEqual([])
    expect(host.querySelector('.sub').textContent).toBe('0 workouts')
    // the log action is still offered
    expect(byText(host, 'Log a past workout')).toBeTruthy()
  })

  it('opens the detail sheet for the tapped workout and the log sheet from the header', () => {
    const w1 = { id: 'w1', name: 'Push day', date: '2026-09-28' }
    const w2 = { id: 'w2', name: 'Leg day', date: '2026-10-01' }
    mocks.workouts = [w1, w2]
    const host = render()

    // first visible row is the newest entry (w2)
    act(() => host.querySelector('.hrow').click())
    expect(mocks.detail).toHaveBeenCalledTimes(1)
    expect(mocks.detail).toHaveBeenCalledWith(w2)

    act(() => byText(host, 'Log a past workout').click())
    expect(mocks.logPast).toHaveBeenCalledTimes(1)
  })

  it('routes the header back control to /stats', () => {
    mocks.workouts = [{ id: 'w1', name: 'Push day' }]
    const host = render()

    act(() => host.querySelector('.hdr .iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/stats')
  })
})
