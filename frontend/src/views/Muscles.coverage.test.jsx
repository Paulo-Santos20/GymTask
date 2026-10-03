// @vitest-environment happy-dom
// Coverage-gap tests (todo 21): the Muscles view — the explorer draws the body map (the
// muscle heatmap) once its lazy geometry lands, and every muscle chip carries an exercise
// count computed from the catalogue; a selected muscle whose filters match nothing must
// fall back to the no-match empty state.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Muscles from './Muscles.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { nav: vi.fn(), S: null }
  state.snapshot = () => ({ S: state.S, user: null, ready: true, update: mut => mut(state.S) })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({ exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn() }))

// Same warm-cache trick as components/BodyMap.test.jsx: the map geometry is a ~90 KB
// dynamic import, so import it up front and let the wait cover rendering, not module loading.
beforeAll(() => import('../lib/body-paths.js'))

const mounted = []
async function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  await act(async () => { root.render(<Muscles />) })
  return host
}
const chip = (host, name) => [...host.querySelectorAll('.chip')].find(c => c.textContent.startsWith(name))

beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', body: 'male', routines: [], workouts: [],
    customEx: [], exWeights: {}, equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  }
  mocks.nav.mockClear()
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Muscles explorer', () => {
  it('draws the body map with data and counts the catalogue per muscle', async () => {
    const host = await render()
    expect(host.querySelector('h1').textContent).toBe('Explore muscles')

    // heatmap with data: both views of the body arrive and the muscle paths are drawn
    await vi.waitFor(() => expect(host.querySelectorAll('.bm-v')).toHaveLength(2), { timeout: 5000 })
    expect(host.querySelectorAll('.bm-m').length).toBeGreaterThan(0)

    // every muscle chip carries its exercise count computed from the catalogue
    const chest = chip(host, 'Chest')
    expect(chest).toBeTruthy()
    expect(Number(chest.querySelector('.dim').textContent)).toBeGreaterThan(0)

    // the header's back control routes to the Library
    act(() => host.querySelector('.hdr .iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/library')
  })

  it('falls back to the no-match empty state when the selection filters to nothing', async () => {
    const host = await render()
    act(() => chip(host, 'Chest').click())
    expect(host.textContent).toContain('Exercises for Chest')
    expect(host.querySelectorAll('.item').length).toBeGreaterThan(0)

    const input = host.querySelector('.search input')
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set
    act(() => {
      setter.call(input, 'zzqqxx-no-match')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(host.querySelectorAll('.item')).toHaveLength(0)
    expect(host.querySelector('.list .empty').textContent).toContain('No match')
  })
})
