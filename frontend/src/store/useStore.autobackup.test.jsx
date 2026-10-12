// @vitest-environment happy-dom

/* Auto-backup: with S.autoBackup on, leaving the app (the tab hidden) downloads one backup
   file, at most once a day; off, nothing is ever downloaded. The listener is installed once
   when the store module loads, so the harness is: set the flag, hide the tab, assert. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null, downloadBackup: null }))
vi.mock('../lib/api.js', () => ({ api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
vi.mock('../lib/backup-file.js', () => ({ downloadBackup: (...a) => h.downloadBackup(...a) }))

const clone = v => JSON.parse(JSON.stringify(v))
const DAY = 24 * 3600 * 1000

// ONE store import for the whole file: the listener is installed once per module instance, and
// resetModules per test would leave the previous test's listener on the document, reading its
// own (already stale) store — a fresh flag per test is the honest reset.
const { useStore } = await import('./useStore.js')

const withFlag = v => {
  useStore.setState({ S: { ...clone(useStore.getState().S), autoBackup: v } })
}

beforeEach(() => {
  localStorage.clear()
  h.downloadBackup = vi.fn()
  h.api = async () => ({ state: null, rev: 0 })
  withFlag(false)
})
afterEach(() => useStore.setState({ user: null, ready: false }))

const hide = () => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('auto-backup on visibility change', () => {
  it('downloads one backup when the tab is hidden and the flag is on', async () => {
    withFlag(true)
    hide()
    await vi.waitFor(() => expect(h.downloadBackup).toHaveBeenCalledTimes(1))
    expect(h.downloadBackup.mock.calls[0][0].autoBackup).toBe(true)
  })

  it('does not download again inside the throttle gap', async () => {
    localStorage.setItem('gym_autobackup', String(Date.now() - 1000))
    withFlag(true)
    hide()
    await new Promise(r => setTimeout(r, 10))
    expect(h.downloadBackup).not.toHaveBeenCalled()
  })

  it('downloads again once the gap has passed', async () => {
    localStorage.setItem('gym_autobackup', String(Date.now() - DAY))
    withFlag(true)
    hide()
    await vi.waitFor(() => expect(h.downloadBackup).toHaveBeenCalledTimes(1))
  })

  it('downloads nothing with the flag off', async () => {
    withFlag(false)
    hide()
    await new Promise(r => setTimeout(r, 10))
    expect(h.downloadBackup).not.toHaveBeenCalled()
  })

  it('downloads nothing while the tab is merely visible', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    withFlag(true)
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise(r => setTimeout(r, 10))
    expect(h.downloadBackup).not.toHaveBeenCalled()
  })
})
