// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, pushOK: false, pushSubscribed: false }
  state.snapshot = () => ({
    S: state.S,
    user: { id: 'u1', name: 'Tester' },
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
  pushSupported: () => mocks.pushOK,
  enablePush: vi.fn(() => Promise.resolve(true)),
  disablePush: vi.fn(() => Promise.resolve(true)),
  sendTestPush: vi.fn(() => Promise.resolve(true)),
  syncPushSubscription: vi.fn(() => Promise.resolve(mocks.pushSubscribed)),
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(),
  confirmSheet: vi.fn(),
  importFromApp: vi.fn(),
  importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(),
}))
vi.mock('../lib/sound.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, unlock: vi.fn() }
})

globalThis.__APP_VERSION__ ??= 'test'

let host, root
const setAudioSession = value =>
  Object.defineProperty(navigator, 'audioSession', { value, configurable: true, writable: true })
beforeEach(() => {
  mocks.S = {
    unit: 'kg',
    restSec: 90,
    restPauseSec: 15,
    sound: true,
    soundOnSilent: false,
    effort: 'none',
    gifSize: 'full',
    workouts: [],
    routines: [],
    exWeights: {},
  }
  mocks.pushOK = false
  mocks.pushSubscribed = false
  setAudioSession({ type: 'auto' })
  Object.defineProperty(navigator, 'userAgent', {
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    configurable: true,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setAudioSession(undefined)
})

const mount = () => act(() => root.render(<Settings />))
const mountAsync = () =>
  act(async () => {
    root.render(<Settings />)
  })
const rowTitled = title =>
  [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

describe('Settings — accessible names (a11y audit)', () => {
  it('every switch exposes a non-empty accessible name', () => {
    mount()
    const switches = [...host.querySelectorAll('[role="switch"]')]
    // check-in, weigh-in, wake lock, sounds, silent-mode flash…
    expect(switches.length).toBeGreaterThanOrEqual(6)
    const unnamed = switches.filter(sw => !(sw.getAttribute('aria-label') || '').trim())
    expect(unnamed.map(sw => sw.outerHTML)).toEqual([])
  })

  it("each switch's name matches the title of the row it sits in", () => {
    mount()
    for (const title of [
      'Gym check-in',
      'Weigh in before workouts',
      'Keep screen awake',
      'Sounds',
      'Flash screen when timer ends',
    ]) {
      const row = rowTitled(title)
      expect(row, title).toBeTruthy()
      const sw = row.querySelector('[role="switch"]')
      expect(sw, title).toBeTruthy()
      expect(sw.getAttribute('aria-label'), title).toBe(title)
    }
  })

  it('names the hidden file-import inputs', () => {
    mount()
    const files = [...host.querySelectorAll('input[type="file"]')]
    expect(files.length).toBe(2)
    const names = files.map(f => f.getAttribute('aria-label'))
    expect(names).toContain('Import backup')
    expect(names).toContain('Import from another app')
  })

  it('labels the reminder time input with the title of its row', async () => {
    mocks.pushOK = true
    mocks.pushSubscribed = true
    await mountAsync()
    const reminderRow = rowTitled('Workout day reminder')
    expect(reminderRow).toBeTruthy()
    // reminder is off until toggled, so the time field is not rendered yet
    expect(host.querySelector('input[type="time"]')).toBeNull()
    const sw = reminderRow.querySelector('[role="switch"]')
    expect(sw.getAttribute('aria-label')).toBe('Workout day reminder')
    await act(async () => {
      sw.click()
    })
    // the test store mock has no subscriptions, so re-render to read the new state
    await mountAsync()
    const time = host.querySelector('input[type="time"]')
    expect(time).toBeTruthy()
    expect(time.getAttribute('aria-label')).toBe('Reminder time')
  })
})
