// @vitest-environment happy-dom
// RF11 — the Apple Health setup screen only exists where the `shortcuts://` scheme does.
// Android and desktop get nothing: a button that fires a URL scheme the OS does not know is
// a dead tap, and the plan's failure scenario is "non-iOS → feature hidden".
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
    update: vi.fn(),
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

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

const setDevice = (userAgent, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

let host, root
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, workouts: [], routines: [], exWeights: {} }
  setDevice(IPHONE)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings />))
const sectionTitles = () => [...host.querySelectorAll('.sect-t')].map(el => el.textContent)

describe('Settings — Apple Health setup (RF11)', () => {
  it('shows the setup steps on an iPhone, naming the exact shortcut the link runs', () => {
    mount()
    expect(sectionTitles()).toContain('Apple Health')
    const section = [...host.querySelectorAll('.sect')].find(
      s => s.querySelector('.sect-t')?.textContent === 'Apple Health',
    )
    const text = section.textContent
    expect(text).toContain('GymTask Log')
    expect(text).toContain('bodyweight')
    expect(text).toContain('workout')
    expect(text).toContain('Send to Apple Health')
    expect(section.querySelectorAll('li')).toHaveLength(5)
  })

  it('hides the whole section on Android — the scheme does not exist there', () => {
    setDevice(ANDROID)
    mount()
    expect(sectionTitles()).not.toContain('Apple Health')
    expect(host.textContent).not.toContain('GymTask Log')
  })

  it('hides the whole section on a desktop Mac', () => {
    setDevice(MAC, 0)
    mount()
    expect(sectionTitles()).not.toContain('Apple Health')
    expect(host.textContent).not.toContain('GymTask Log')
  })

  it('shows it on an iPad reporting as a Mac with a touch screen', () => {
    setDevice(MAC, 5)
    mount()
    expect(sectionTitles()).toContain('Apple Health')
  })
})
