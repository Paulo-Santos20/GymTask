// @vitest-environment happy-dom

/* Structural Balance's per-role exercise choices (S.balanceOverrides) through the store's own
   sync paths. Each choice carries the time it was made, and "Use default exercise" is a stamped
   clear rather than a delete, so a conflict keeps whichever device chose last — a clear included —
   instead of handing the whole map to the copy that happened to be newer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import { withOverride } from '../lib/structuralBalance.js'

const DIPS = 'poliquin:dips'
const PULLUPS = 'atg:pullups'
const clone = value => JSON.parse(JSON.stringify(value))
const httpError = (status, data = {}) => Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT').map(([, o]) => JSON.parse(o.body))
const USER = { id: 'user-1', name: 'One' }
const fresh = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const signedIn = S => useStore.setState({ S, user: USER, ready: true, sync: { ...fresh } })
// What the screen's "Change exercise" and "Use default exercise" write.
const choose = (key, id) =>
  useStore.getState().update(s => {
    s.balanceOverrides = withOverride(s.balanceOverrides, key, id)
  })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset()
  toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})
afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})

describe('a role chosen here and a conflict with the other device', () => {
  it('keeps the choice and the clear made here over the older ones in a newer copy', async () => {
    const shared = { ...clone(DEF), _ts: 100, balanceOverrides: { [PULLUPS]: { id: '0017', _ts: 90 } } }
    signedIn(clone(shared))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    choose(DIPS, '0009')
    choose(PULLUPS, null)
    // The other device logged a set after that, and had picked the dips machine long before.
    const there = {
      ...clone(shared),
      _ts: Date.now() + 60_000,
      restSec: 45,
      workouts: [{ id: 'w9', d: '2026-09-20', start: 1, entries: [] }],
    }
    there.balanceOverrides[DIPS] = { id: '0251', _ts: 50 }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()).toHaveLength(2)
    for (const S of [puts()[1].state, useStore.getState().S]) {
      expect(S.restSec).toBe(45) // settings: the newer copy
      expect(S.workouts.map(w => w.id)).toEqual(['w9'])
      expect(S.balanceOverrides[DIPS].id).toBe('0009') // chosen here, later
      expect(S.balanceOverrides[PULLUPS].id).toBe(null) // cleared here, later
    }
  })

  it("takes the other device's choice when it was made after the one here", async () => {
    signedIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    choose(DIPS, '0009')
    const mine = useStore.getState().S.balanceOverrides[DIPS]._ts
    const there = { ...clone(DEF), _ts: 50, balanceOverrides: { [DIPS]: { id: '2364', _ts: mine + 1_000 } } }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()[1].state.balanceOverrides[DIPS].id).toBe('2364')
    expect(useStore.getState().S.balanceOverrides[DIPS].id).toBe('2364')
  })
})

describe('a role chosen here before a sign-in', () => {
  it("is kept over the server's older choice when the profile is adopted", async () => {
    signedIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    choose(DIPS, '0009')
    const chosen = clone(useStore.getState().S.balanceOverrides[DIPS])

    const server = {
      ...clone(DEF),
      _ts: 50,
      _rev: 2,
      balanceOverrides: { [DIPS]: { id: '0251', _ts: 20 }, [PULLUPS]: { id: '0017', _ts: 30 } },
    }
    api.mockReset()
    api.mockImplementation(async (path, o) =>
      o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 },
    )
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)

    const S = useStore.getState().S
    expect(S.balanceOverrides[DIPS]).toEqual(chosen) // set here, later
    expect(S.balanceOverrides[PULLUPS]).toEqual({ id: '0017', _ts: 30 }) // only the server had it
  })
})
