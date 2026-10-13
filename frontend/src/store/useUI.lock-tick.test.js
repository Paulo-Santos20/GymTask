// @vitest-environment happy-dom
// Rest on a locked phone: the tab is hidden, so the server books the countdown series (`tick`)
// and re-books the end alert alone the moment the phone unlocks. Same tag on every push — the
// lock screen keeps one counting row, not a stack (sw.js, issue #172).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({ ok: true })) }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn() }))

import { api } from '../lib/api.js'
import { useUI } from './useUI.js'
import { useStore } from './useStore.js'

const posts = path => api.mock.calls.filter(([p]) => p === path).map(([, o]) => JSON.parse(o.body))
const hide = hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('a running rest books the lock-screen countdown only while the tab is hidden', () => {
  let original
  beforeEach(() => {
    vi.useFakeTimers()
    original = { S: useStore.getState().S, user: useStore.getState().user }
    useStore.setState({ S: { ...original.S, sound: false }, user: { id: 'u1' } })
    useUI.setState({ timer: null, work: null, toastMsg: '' })
    api.mockClear()
    hide(false)
  })
  afterEach(() => {
    useUI.getState().stopRest()
    useStore.setState(original)
    hide(false)
    vi.useRealTimers()
  })

  it('starts on screen with the end alert alone, re-books with the series on lock, alone again on unlock', () => {
    useUI.getState().startRest(90)
    expect(posts('/api/push/rest-timer').map(b => b.tick)).toEqual([undefined])

    hide(true) // phone locked / app switched away mid-rest
    const rebooked = posts('/api/push/rest-timer').at(-1)
    expect(rebooked.tick).toBe(true)
    expect(rebooked.seconds).toBeGreaterThan(0)
    expect(rebooked.seconds).toBeLessThanOrEqual(90)

    hide(false) // unlocked: the bar is on screen, the countdown row would only duplicate it
    expect(posts('/api/push/rest-timer').at(-1).tick).toBeUndefined()
  })

  it('a paused rest books nothing on lock, and resuming books for wherever the phone is now', () => {
    useUI.getState().startRest(90)
    useUI.getState().pauseRest()
    api.mockClear()
    hide(true)
    expect(api).not.toHaveBeenCalled()
    hide(false)
    expect(api).not.toHaveBeenCalled()

    hide(true) // still locked: resuming here books the series, as a rest started hidden does
    useUI.getState().resumeRest()
    expect(posts('/api/push/rest-timer').at(-1).tick).toBe(true)
  })

  it('a rest started while hidden books the series from the start', () => {
    hide(true)
    useUI.getState().startRest(60)
    expect(posts('/api/push/rest-timer').at(-1).tick).toBe(true)
  })
})
