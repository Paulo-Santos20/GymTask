/* The `/api/admin/*` routes coach/routes.js still exports must be unreachable over HTTP: server.js
   drops them at mount time, so every one of them answers 404 while the non-admin coach routes
   beside them stay registered. The route set comes from the module itself, so a newly added admin
   route is covered without touching this file. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempData } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

tempData();
const { coachRoutes } = await import('../coach/routes.js');

// The dispatch keys are 'METHOD /path' — the path is everything after the first space.
const pathOf = key => key.slice(key.indexOf(' ') + 1);

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-admin-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' }
  });
  const h = { api: `http://127.0.0.1:${port}`, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(up, `server never came up:\n${h.log}`);
  return h;
}

test('every /api/admin/* route the coach exports is a 404, while the non-admin coach routes still answer', async t => {
  const exported = Object.keys(coachRoutes({
    json: () => {}, readBody: async () => ({}), readSession: () => null, requireAdmin: () => false
  }));
  const admin = exported.filter(k => pathOf(k).startsWith('/api/admin/'));
  assert.ok(admin.length > 0, `no /api/admin/* keys exported — this test would pass vacuously (${exported.length} keys)`);

  const h = await startServer(t);
  for (const key of admin) {
    const [method, p] = [key.slice(0, key.indexOf(' ')), pathOf(key)];
    const res = await fetch(`${h.api}${p}`, { method });
    assert.equal(res.status, 404, `${key} should be unreachable at mount time, got ${res.status}\n${h.log}`);
  }

  // The routes beside them are still mounted: a known coach path is routed (401 = handler ran),
  // never the 404 an unregistered key gets.
  const status = await fetch(`${h.api}/api/coach/status`);
  assert.notEqual(status.status, 404, `non-admin coach route lost its registration\n${h.log}`);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
  assert.equal(h.child.exitCode, null, `server exited:\n${h.log}`);
});
