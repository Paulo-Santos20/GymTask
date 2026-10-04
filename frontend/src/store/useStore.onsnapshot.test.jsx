// @vitest-environment happy-dom

/* RF3 live sync: with Firebase configured the store listens to the account document through
   lib/firebase.js observeUserState (mocked here) and settles every snapshot with the same
   rules a pull uses — the merge is lib/sync-merge.js's (existing conflict rules win), the
   outbound write rides the ordinary 1.5 s debounce, the echo of this device's own write is
   dropped so a write can never loop, the listener is torn down on sign-out and on a profile
   switch, and without Firebase configured nothing subscribes: the legacy pull/push path runs
   byte-identically to useStore.sync.test.jsx. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))
const fb = vi.hoisted(() => ({ configured: true, observeUserState: vi.fn() }))

vi.mock('../lib/firebase.js', () => ({
  get firebaseConfigured() {
    return fb.configured
  },
  observeUserState: (...args) => fb.observeUserState(...args),
  app: null,
  auth: null,
  db: null,
}))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

const clone = value => JSON.parse(JSON.stringify(value))
const workout = (id, d = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const routine = (id, ts, name = id) => ({ id, name, ex: [], _ts: ts })
const sync = () => JSON.parse(localStorage.getItem('gym_sync'))
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const subs = [] // every subscription the store made: { uid, onData, off }

// Sign-in through the real entry point (setUser), then hand the 1.5 s push debounce to the
// test: everything after this line is driven by advanceTimersByTimeAsync.
const signIn = async S => {
  useStore.setState({ S, ready: true })
  await useStore.getState().setUser({ id: 'user-1' })
  vi.useFakeTimers()
}

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  subs.length = 0
  fb.configured = true
  fb.observeUserState.mockReset()
  fb.observeUserState.mockImplementation((uid, onData) => {
    const sub = { uid, onData, off: vi.fn() }
    subs.push(sub)
    return sub.off
  })
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project')
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})
afterEach(async () => {
  await useStore.getState().setUser(null) // tear any listener down through the real path
  vi.useRealTimers()
  vi.unstubAllEnvs()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('onSnapshot settles a remote change', () => {
  it('applies a remote snapshot through the existing conflict rules', async () => {
    await signIn({
      ...clone(DEF),
      _ts: 300,
      workouts: [workout('w1')],
      routines: [routine('r1', 100, 'Old')],
      restSec: 75,
    })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    expect(subs).toHaveLength(1)
    expect(subs[0].uid).toBe('user-1')

    // Another device, earlier whole copy (_ts 200 < 300) but it edited r1 later (_ts 250 > 100):
    // the union keeps both devices' workouts, the per-routine edit time wins for r1, the newer
    // whole copy decides restSec.
    subs[0].onData({
      ...clone(DEF),
      _ts: 200,
      workouts: [workout('w1'), workout('w2')],
      routines: [routine('r1', 250, 'Renamed')],
      restSec: 60,
      active: null,
      _rev: 2,
    })

    const S = useStore.getState().S
    expect(S.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(S.routines).toHaveLength(1)
    expect(S.routines[0].name).toBe('Renamed')
    expect(S.restSec).toBe(75)
    expect(S.active).toBe(null)
  })

  it('drops the echo of its own write — a local write never loops back', async () => {
    await signIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    expect(subs).toHaveLength(1)
    // The PUT answers by echoing the document the way Firestore's local latency compensation
    // does: the snapshot lands BEFORE the write promise resolves (rev still stale in the
    // marker), and again once the server copy is the one just written.
    api.mockImplementation(async (path, opts) => {
      if (path === '/api/data' && opts?.method === 'PUT') {
        const doc = { ...JSON.parse(opts.body).state, _rev: 2 }
        delete doc.active
        subs[0].onData(doc)
        subs[0].onData(doc)
        return { ok: true, rev: 2 }
      }
      return { ok: true, rev: 1 }
    })

    useStore.getState().update(s => {
      s.restSec = 45
    }) // arms the 1.5 s debounce
    await vi.advanceTimersByTimeAsync(1500)
    expect(puts()).toHaveLength(1)

    // The echo changed nothing and armed nothing: no second write, ever.
    const after = JSON.stringify(useStore.getState().S)
    await vi.advanceTimersByTimeAsync(10000)
    expect(puts()).toHaveLength(1)
    expect(JSON.stringify(useStore.getState().S)).toBe(after)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(sync()).toEqual({ rev: 2, ts: useStore.getState().S._ts })
  })

  it('debounces the outbound write a snapshot merge arms', async () => {
    await signIn({ ...clone(DEF), _ts: 300, workouts: [workout('w1')], restSec: 75 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValue({ ok: true, rev: 3 })
    expect(subs).toHaveLength(1)

    subs[0].onData({
      ...clone(DEF),
      _ts: 200,
      workouts: [workout('w1'), workout('w2')],
      restSec: 60,
      active: null,
      _rev: 2,
    })

    expect(puts()).toHaveLength(0) // the merge rides the ordinary debounce, no immediate write
    await vi.advanceTimersByTimeAsync(1499)
    expect(puts()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(2) // conditional on exactly the document the snapshot carried
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(puts()[0].state.restSec).toBe(75)
    expect(sync()).toEqual({ rev: 3, ts: useStore.getState().S._ts })
  })
})

describe('listener lifecycle', () => {
  it('tears the listener down on sign-out and gives the next profile its own', async () => {
    await signIn({ ...clone(DEF) })
    expect(subs).toHaveLength(1)
    expect(subs[0].uid).toBe('user-1')
    api.mockResolvedValue({ ok: true, rev: 1 })

    await useStore.getState().signOut()
    expect(subs[0].off).toHaveBeenCalledTimes(1)
    expect(useStore.getState().user).toBeNull()

    await useStore.getState().setUser({ id: 'user-2' })
    expect(subs).toHaveLength(2)
    expect(subs[1].uid).toBe('user-2')
    expect(subs[0].off).toHaveBeenCalledTimes(1) // the old account's listener is gone, not doubled
  })

  it('never subscribes when the Firebase module reports unconfigured', async () => {
    fb.configured = false
    await signIn({ ...clone(DEF) })
    expect(subs).toHaveLength(0)
  })
})

describe('legacy fallback', () => {
  it('without VITE_FIREBASE_* no listener exists and pull/push run byte-identically', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '')
    fb.configured = false
    const local = { ...clone(DEF), _ts: 300, workouts: [workout('w1')], restSec: 75 }
    await signIn(local)
    expect(subs).toHaveLength(0)

    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api
      .mockResolvedValueOnce({
        state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w2')], _rev: 2 },
        rev: 2,
      })
      .mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pullState()

    // The exact sequence the pre-onSnapshot suite asserts (useStore.sync.test.jsx "merges and
    // pushes once against the server revision when both sides changed").
    expect(api.mock.calls.map(([p, o]) => [p, o?.method || 'GET'])).toEqual([
      ['/api/data', 'GET'],
      ['/api/data', 'PUT'],
    ])
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(2)
    expect(puts()[0].state.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(puts()[0].state.restSec).toBe(75)
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 'w2'])
    expect(sync()).toEqual({ rev: 3, ts: useStore.getState().S._ts })
  })
})
