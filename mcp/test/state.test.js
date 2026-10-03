// State-layer tests for mcp/src/state.js — the disk half the tool tests never touch. The 63
// tool tests seed state in memory through _seedStateForTests, so uid resolution, the
// defaults merge, the read-only cache refresh and the env guards have no coverage there.
// state.js reads OPENGYM_DATA at import time and caches init() in module scope, so each
// scenario re-imports it against its own temp data directory (vitest isolates this file in
// its own fork — pool: 'forks' — so the re-import never crosses into sibling files).
import { describe, test, expect, vi, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gytask-mcp-state-'))
const MISSING_DIR = path.join(TMP, 'never-created')
const ORIG_DATA = process.env.OPENGYM_DATA
const ORIG_UID = process.env.OPENGYM_UID

let mod = null // the most recently imported state.js instance

// Close the fs.watch handle of the previous instance before dropping it — an open watch
// keeps the temp file locked on Windows and the cleanup in afterAll would fail.
function closeWatcher() {
  if (mod && typeof mod._seedStateForTests === 'function') mod._seedStateForTests(null)
  mod = null
}

// Fresh module per scenario: resetModules drops it from the registry, the env is set, and
// the import re-evaluates the file — DATA_DIR is a module-level const, so this is the only
// way to point one process at several data directories.
async function load({ dir, uid } = {}) {
  closeWatcher()
  vi.resetModules()
  if (dir === undefined) delete process.env.OPENGYM_DATA
  else process.env.OPENGYM_DATA = dir
  if (uid === undefined) delete process.env.OPENGYM_UID
  else process.env.OPENGYM_UID = uid
  mod = await import('../src/state.js')
  return mod
}

function dataDir(name) {
  return fs.mkdirSync(path.join(TMP, name), { recursive: true })
}

afterEach(() => { delete process.env.OPENGYM_UID })

afterAll(() => {
  closeWatcher()
  if (ORIG_DATA === undefined) delete process.env.OPENGYM_DATA
  else process.env.OPENGYM_DATA = ORIG_DATA
  if (ORIG_UID === undefined) delete process.env.OPENGYM_UID
  else process.env.OPENGYM_UID = ORIG_UID
  try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5 }) } catch { /* best-effort */ }
})

describe('state: data directory guard', () => {
  test('init() fails fast on a missing OPENGYM_DATA dir, naming it in the message', async () => {
    const s = await load({ dir: MISSING_DIR })
    expect(() => s.init()).toThrow(/OPENGYM_DATA dir does not exist/)
    // getState() goes through init(), so the guard applies to the first tool call too —
    // a misconfigured path is reported, never answered with a fabricated empty profile.
    expect(() => s.getState()).toThrow(/OPENGYM_DATA dir does not exist/)
    expect(s.dataDir()).toBe(MISSING_DIR)
  })
})

describe('state: uid resolution', () => {
  test('a single state-<uid>.json picks the profile; stored fields win, the rest take defaults', async () => {
    const dir = dataDir('single')
    fs.writeFileSync(path.join(dir, 'state-alice.json'),
      JSON.stringify({ unit: 'lb', targetW: 80, routines: [{ id: 'r1', name: 'Push Day', ex: [] }] }))
    const s = await load({ dir })
    s.init()
    expect(s.dataDir()).toBe(dir)

    const st = s.getState()
    expect(st.unit).toBe('lb')            // the file's value beats the default
    expect(st.targetW).toBe(80)
    expect(st.routines).toHaveLength(1)
    expect(st.restSec).toBe(90)           // defaultsShape merged in — absent from the file
    expect(st.reminder).toEqual({ on: false, time: '08:00', tz: null })

    // No db.json → getUser falls back to a usable identity rather than null/throwing.
    expect(s.getUser()).toEqual({ id: 'alice', name: 'Profile', created: null })
  })

  test('with no state file, db.json alone resolves a fresh account to a null state', async () => {
    const dir = dataDir('fresh')
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
      users: [{ id: 'u1', name: 'Bruna', created: '2026-07-26T00:00:00.000Z' }],
      creds: [], subs: [], invites: []
    }))
    const s = await load({ dir })
    // getState() picks the only db user as the uid, then answers null: the account exists
    // but has never signed in on a device, which is a different fact from an empty profile.
    expect(s.getState()).toBeNull()
    expect(s.getUser()).toEqual({ id: 'u1', name: 'Bruna', created: '2026-07-26T00:00:00.000Z' })
  })

  test('two state files are ambiguous until OPENGYM_UID breaks the tie', async () => {
    const dir = dataDir('two')
    fs.writeFileSync(path.join(dir, 'state-alice.json'), JSON.stringify({ unit: 'kg' }))
    fs.writeFileSync(path.join(dir, 'state-bob.json'), JSON.stringify({ unit: 'lb' }))
    const s = await load({ dir })

    // Guessing between profiles would answer every question with the wrong person's log.
    expect(() => s.init()).toThrow(/multiple GymTask users found/)
    expect(() => s.init()).toThrow(/alice, bob/)

    // The env var is read at resolveUid() time, so the tie-break needs no restart.
    process.env.OPENGYM_UID = 'bob'
    s.init()
    expect(s.getState().unit).toBe('lb')
  })

  test('an OPENGYM_UID that is not filename-safe is rejected before it reaches disk', async () => {
    const dir = dataDir('unsafe-uid')
    const s = await load({ dir, uid: '../escape' })
    // The sanitiser in stateFile() would strip it silently; resolveUid refuses instead, so
    // a typo'd env var surfaces as an error rather than as "no state found".
    expect(() => s.init()).toThrow(/aren't safe in a filename/)
    expect(() => s.init()).toThrow(/"\.\.\/escape"/)
  })
})

describe('state: cache refresh', () => {
  test('a rewrite on disk shows up on the next getState (mtime fallback, no restart)', async () => {
    const dir = dataDir('mtime')
    const file = path.join(dir, 'state-alice.json')
    fs.writeFileSync(file, JSON.stringify({ unit: 'kg' }))
    const s = await load({ dir })
    expect(s.getState().unit).toBe('kg')

    // The api server rewrites state-<uid>.json in place; the MCP session must see it
    // without a restart. The mtime is forced forward rather than slept for — fs timestamp
    // granularity and the watcher's coalesced events make waiting on real time flaky.
    fs.writeFileSync(file, JSON.stringify({ unit: 'lb', bodyweight: [{ d: '2026-07-27', w: 80 }] }))
    const later = (fs.statSync(file).mtimeMs / 1000) + 60
    fs.utimesSync(file, later, later)

    const st = s.getState()
    expect(st.unit).toBe('lb')
    expect(st.bodyweight).toEqual([{ d: '2026-07-27', w: 80 }])
    expect(st.restSec).toBe(90) // the reload re-applies the defaults shape too
  })
})
