/* The `/api/admin/*` surface must be unreachable over HTTP while the non-admin coach routes
   beside them stay registered — todo 7's regression, tightened by todo 29: the handlers are now
   deleted from coach/routes.js entirely, not merely dropped at mount time. The export assertion
   proves they are gone from the module (a reintroduced admin key fails right there); the fixed
   path list below still proves the server answers 404 for every one of them. Real server.js in
   a child. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tempData } from './helpers.mjs'

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

tempData()
const { coachRoutes } = await import('../coach/routes.js')

// The dispatch keys are 'METHOD /path' — the path is everything after the first space.
const pathOf = key => key.slice(key.indexOf(' ') + 1)

// Every path the upstream admin panel used to own. Fixed, because the module no longer exports
// them — deriving the list from the exports would assert nothing at all.
const ADMIN_PATHS = [
  ['GET', '/api/admin/coach'],
  ['POST', '/api/admin/coach/config'],
  ['POST', '/api/admin/coach/test'],
  ['POST', '/api/admin/coach/models'],
  ['POST', '/api/admin/coach/connect'],
  ['POST', '/api/admin/coach/disconnect'],
]

const freePort = () =>
  new Promise(r => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => r(p))
    })
  })

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-'))
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }))
  const port = await freePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' },
  })
  const h = { api: `http://127.0.0.1:${port}`, child, log: '' }
  child.stdout.on('data', d => (h.log += d))
  child.stderr.on('data', d => (h.log += d))
  t.after(() => {
    child.kill('SIGKILL')
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  let up = false
  for (let i = 0; i < 100 && !up; i++) {
    try {
      up = (await fetch(`${h.api}/api/health`)).ok
    } catch {
      /* not up yet */
    }
    if (!up) await new Promise(r => setTimeout(r, 100))
  }
  assert.ok(up, `server never came up:\n${h.log}`)
  return h
}

test('the admin handlers are gone from coach/routes.js and every /api/admin/* path answers 404, while the non-admin coach routes still answer', async t => {
  const exported = Object.keys(
    coachRoutes({
      json: () => {},
      readBody: async () => ({}),
      readSession: () => null,
    }),
  )
  const exportedAdmin = exported.filter(k => pathOf(k).startsWith('/api/admin/'))
  assert.deepEqual(
    exportedAdmin,
    [],
    `coach/routes.js exports admin handlers again — they were deleted as unreachable (${exported.length} keys)`,
  )

  const h = await startServer(t)
  for (const [method, p] of ADMIN_PATHS) {
    const res = await fetch(`${h.api}${p}`, { method })
    assert.equal(res.status, 404, `${method} ${p} should be unreachable, got ${res.status}\n${h.log}`)
  }

  // The routes beside them are still mounted: a known coach path is routed (401 = handler ran),
  // never the 404 an unregistered key gets.
  const status = await fetch(`${h.api}/api/coach/status`)
  assert.notEqual(status.status, 404, `non-admin coach route lost its registration\n${h.log}`)
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200)
  assert.equal(h.child.exitCode, null, `server exited:\n${h.log}`)
})
