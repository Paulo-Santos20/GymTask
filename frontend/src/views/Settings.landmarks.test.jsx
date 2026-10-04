// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Same store double as Settings.update.test.jsx: update() applies the producer to a clone of
// the fixture state, so a row that writes through the store path is observable right here.
const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(),
    setUser: vi.fn(),
    pullState: vi.fn(),
    pushState: vi.fn(),
    signOut: vi.fn(),
    signOutAll: vi.fn(),
    resetDemo: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(), IS_ANDROID: false }))
vi.mock('../lib/push.js', () => ({
  pushSupported: () => false,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  sendTestPush: vi.fn(),
  syncPushSubscription: vi.fn(),
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(),
  confirmSheet: vi.fn(),
  importFromApp: vi.fn(),
  importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(),
  menuSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg',
    restSec: 90,
    restPauseSec: 15,
    sound: false,
    effort: 'none',
    gifSize: 'full',
    workouts: [],
    routines: [],
    exWeights: {},
    muscleTargets: null,
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async () => {
  await act(async () => {
    root.render(<Settings />)
  })
}
const rowTitled = title =>
  [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const fieldsOf = row => [...row.querySelectorAll('input')]
const setInput = async (input, value) =>
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set
    setter.call(input, String(value))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('Settings — volume landmarks editor', () => {
  it('lists every muscle the body map draws, each showing its preset bounds', async () => {
    await mount()
    expect(host.textContent).toContain('Volume landmarks')
    // i18n is never mocked in these files: the pack's English fallback IS the MUSCLE_NAME key.
    const rows = MUSCLES.map(slug => rowTitled(MUSCLE_NAME[slug]))
    expect(rows.filter(Boolean)).toHaveLength(MUSCLES.length)

    // chest's preset is 10/20 (lib/muscles.js SET_LANDMARKS), shown because nothing is edited
    const chest = rowTitled('Chest')
    expect(chest).toBeTruthy()
    expect(fieldsOf(chest).map(f => f.value)).toEqual(['10', '20'])
    // …and every field says which bound it is
    const labels = fieldsOf(chest).map(f => f.getAttribute('aria-label'))
    expect(labels[0]).toContain('Minimum')
    expect(labels[1]).toContain('Maximum')
  })

  it('writes an edited bound into the profile override map, keeping the other preset', async () => {
    await mount()
    await setInput(fieldsOf(rowTitled('Chest'))[0], '14')
    expect(mocks.S.muscleTargets.chest).toEqual({ mev: 14 })

    // an existing override is what the fields show, and editing one bound leaves the other
    mocks.S.muscleTargets = { chest: { mev: 4, mav: 10 } }
    await mount()
    expect(fieldsOf(rowTitled('Chest')).map(f => f.value)).toEqual(['4', '10'])
    await setInput(fieldsOf(rowTitled('Chest'))[1], '22')
    expect(mocks.S.muscleTargets.chest).toEqual({ mev: 4, mav: 22 })
  })

  it('clearing a bound reverts just that bound, and Reset to defaults clears the map', async () => {
    mocks.S.muscleTargets = { chest: { mev: 4, mav: 10 }, biceps: { mav: 18 } }
    await mount()
    expect(fieldsOf(rowTitled('Chest')).map(f => f.value)).toEqual(['4', '10'])

    // cleared → that bound falls back to its preset (chest's MEV is 10), the rest of the map
    // (its own MAV override, and every other muscle) is untouched
    await setInput(fieldsOf(rowTitled('Chest'))[0], '')
    expect(mocks.S.muscleTargets.chest).toEqual({ mav: 10 })
    expect(mocks.S.muscleTargets.biceps).toEqual({ mav: 18 })
    // the mocked store has no subscription — remount is how this file reads a fresh snapshot
    await mount()
    expect(fieldsOf(rowTitled('Chest')).map(f => f.value)).toEqual(['10', '10'])

    const reset = rowTitled('Reset to defaults')
    expect(reset).toBeTruthy()
    await act(async () => {
      reset.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mocks.S.muscleTargets).toBeNull()
    // …and the presets are what the editor shows again
    await mount()
    expect(fieldsOf(rowTitled('Chest')).map(f => f.value)).toEqual(['10', '20'])
  })
})
