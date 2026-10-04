// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The web app updates with its server — there is no package to download and no installer to
// hand off to. Settings must therefore never offer an "update", "check for updates" or
// "get the Android app" row: those belonged to the native build, which this fork does not ship.
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
vi.mock('../lib/api.js', () => ({
  api: vi.fn(),
  IS_ANDROID: false,
}))
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
const row = text => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes(text))

describe('Settings — the web app has nothing to install', () => {
  it('offers no APK, update-check or update row, and still shows the version footer', async () => {
    await mount()
    expect(row('Get the Android app')).toBeUndefined()
    expect(row('Download the APK')).toBeUndefined()
    expect(row('Check for updates')).toBeUndefined()
    expect(row('Update to GymTask')).toBeUndefined()
    expect(host.textContent).toMatch(/GymTask v\d/)
  })
})
