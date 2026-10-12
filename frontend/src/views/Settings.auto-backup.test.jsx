// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
}))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(),
  confirmSheet: vi.fn(),
  importFromApp: vi.fn(),
  importFromHevy: vi.fn(),
  equipmentProfileSheet: vi.fn(),
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
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))
const autoBackupSwitch = () =>
  [...host.querySelectorAll('[role="switch"]')].find(el => el.getAttribute('aria-label') === 'Auto-backup on changes')

describe('Settings — auto-backup', () => {
  it('renders the switch off for a profile that never chose, and writes the choice', () => {
    mount()
    const sw = autoBackupSwitch()
    expect(sw).toBeTruthy()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => sw.click())
    expect(mocks.S.autoBackup).toBe(true)
    mount()
    expect(autoBackupSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('shows the when-it-happens footer only while it is on', () => {
    mount()
    expect(host.textContent).not.toContain('a backup file downloads when you leave the app')
    act(() => autoBackupSwitch().click())
    mount()
    expect(host.textContent).toContain('a backup file downloads when you leave the app')
  })
})
