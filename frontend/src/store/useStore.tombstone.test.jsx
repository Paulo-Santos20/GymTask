// @vitest-environment happy-dom

/* Deletion tombstones end to end: a workout deleted on one device must not come back from
   another device's copy inside the conflict window. The store diffs every update
   (recordDeletions), the merge drops a tombstoned key from either side (lib/sync-merge.js).
   Harness mirrors useStore.tabs.test.jsx: two "tabs", one localStorage, a server that refuses
   a PUT with a stale baseRev by 409 like api/server.js. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ api: null }))
vi.mock('../lib/api.js', () => ({ api: (...a) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))

const clone = v => JSON.parse(JSON.stringify(v))
const w = (id, d = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const ids = st => (st?.workouts || []).map(x => x.id)
const httpError = (status, data) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })

let tabs = []
let DEF
async function openTab(user = { id: 'u1' }) {
  vi.resetModules()
  const m = await import('./useStore.js')
  DEF = m.DEF
  tabs.push(m.useStore)
  m.useStore.setState({ user })
  m.useStore.setState({ ready: true })
  return m.useStore
}

function server(doc) {
  const s = { doc: doc ? clone(doc) : null, log: [] }
  s.handler = async (path, opts = {}) => {
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : undefined
    s.log.push({ method, path, body })
    if (method === 'GET' && path === '/api/data/rev') return { rev: s.doc?._rev || 0 }
    if (method === 'GET' && path === '/api/data') return { state: s.doc ? clone(s.doc) : null, rev: s.doc?._rev || 0 }
    if (method === 'PUT' && path === '/api/data') {
      const curRev = s.doc?._rev || 0
      if (body.baseRev != null && body.baseRev !== curRev)
        throw httpError(409, { error: 'conflict', rev: curRev, state: s.doc ? clone(s.doc) : null })
      delete body.state.active
      body.state._rev = curRev + 1
      s.doc = body.state
      return { ok: true, ts: body.state._ts || null, rev: body.state._rev }
    }
    if (method === 'POST' && path.startsWith('/api/logout')) return { ok: true }
    throw new Error('unexpected ' + method + ' ' + path)
  }
  s.puts = () => s.log.filter(e => e.method === 'PUT').map(e => e.body)
  h.api = s.handler
  return s
}
const savedCopy = (doc, rev) => {
  const S = clone(doc)
  delete S._rev
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
}

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('gym_owner', 'u1')
  tabs = []
  DEF = (await import('./useStore.js')).DEF
})
afterEach(() => {
  for (const t of tabs) t.setState({ user: null, ready: false })
  localStorage.clear()
})

describe('a deletion stays deleted across the conflict window', () => {
  it('the device that deletes pushes the tombstone; the stale device’s merge drops it', async () => {
    const srv = server({ ...clone(DEF), _ts: 100, workouts: [w('w1'), w('w2', '2026-09-02')], _rev: 1 })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    const B = await openTab()

    // A deletes w2 and pushes — the doc on the server loses it and gains the tombstone
    A.getState().update(s => {
      s.workouts = s.workouts.filter(x => x.id !== 'w2')
    })
    expect(typeof A.getState().S.del.workouts.w2).toBe('number')
    await A.getState().pushState()
    expect(ids(srv.doc)).toEqual(['w1'])
    expect(typeof srv.doc.del?.workouts?.w2).toBe('number')

    // B, untouched since before the deletion, changes a setting and pushes: refused (409),
    // merged with the server copy — and the merge is what drops the resurrected workout.
    B.getState().update(s => {
      s.restSec = 60
    })
    await B.getState().pushState()

    // B quotes the revision it remembers (1) — refused, merged with the server copy (which
    // carries the tombstone), pushed again at 2. The merge is what drops the resurrected
    // workout, exactly as the tabs test's stale tab.
    expect(
      srv
        .puts()
        .map(p => p.baseRev)
        .slice(-2),
    ).toEqual([1, 2])
    expect(ids(srv.doc)).toEqual(['w1'])
    expect(ids(B.getState().S)).toEqual(['w1'])
    expect(typeof srv.doc.del?.workouts?.w2).toBe('number')
    expect(typeof B.getState().S.del?.workouts?.w2).toBe('number')
  })

  it('a sign-in (prefer) does not resurrect what the server deleted', async () => {
    const srv = server({
      ...clone(DEF),
      _ts: 100,
      workouts: [w('w1')],
      del: { workouts: { w2: Date.now() } },
      _rev: 1,
    })
    savedCopy(srv.doc, 1)
    const A = await openTab()
    // A's saved copy still has w2 (it was made before the deletion elsewhere)
    A.setState({ S: { ...A.getState().S, workouts: [w('w1'), w('w2', '2026-09-02')], _ts: 200 } })
    // another device wrote in between, so A's push is refused and the merge runs
    srv.doc = { ...srv.doc, _rev: 2 }
    A.getState().update(s => {
      s.restSec = 45
    })
    await A.getState().pushState()
    expect(ids(srv.doc)).toEqual(['w1'])
    expect(ids(A.getState().S)).toEqual(['w1'])
  })

  it('an imported backup made before the deletion keeps the tombstone (keepDel)', async () => {
    const old = { ...clone(DEF), _ts: 100, workouts: [w('w1'), w('w2', '2026-09-02')] }
    const srv = server({ ...clone(DEF), _ts: 300, workouts: [w('w1')], del: { workouts: { w2: Date.now() } }, _rev: 5 })
    savedCopy(srv.doc, 5)
    const A = await openTab()
    // the user restores the old file (it has no del) — the replace must keep the record
    A.getState().importBackup(old)
    expect(typeof A.getState().S.del?.workouts?.w2).toBe('number')
    // and a stale device merging afterwards still loses w2
    const B = await openTab()
    B.setState({ S: { ...B.getState().S, workouts: [w('w1'), w('w2', '2026-09-02')], _ts: 400 } })
    srv.doc = { ...srv.doc, _rev: 6 }
    B.getState().update(s => {
      s.restSec = 33
    })
    await B.getState().pushState()
    expect(ids(srv.doc)).toEqual(['w1'])
  })
})
