/* The byte guard on PUT /api/data: a body over the cap is refused with 413 and the store on
   disk is left byte-for-byte as it was — not "same content", the same bytes — while a body
   under the cap still lands (200, persisted, revision bumped) and GET keeps answering from
   exactly that file. The cap itself lives in readBody (MAX_BODY, 5 MiB); this pins the
   contract the sync path depends on. Real server.js in a child, same harness as
   server-bad-input.test.js. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const UID = 'u_cap_1';

// Same construction as server.js session tokens: payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const authed = { Cookie: `gymsid=${mintSession(UID)}`, 'Content-Type': 'application/json' };

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

// A profile is seeded BEFORE boot so the guard is measured against a store that already has
// bytes on disk — the case that matters is an existing document surviving an oversized push.
async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-cap-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: UID, name: 'One', created: new Date().toISOString() }], creds: [], subs: []
  }));
  fs.writeFileSync(path.join(dataDir, `state-${UID}.json`), JSON.stringify({
    unit: 'kg', workouts: [{ id: 'w0', d: '2026-01-01', name: 'seed' }], routines: [], _rev: 3
  }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '', dataDir };
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

const put = async (h, body) => {
  const r = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: authed, body });
  return { status: r.status, body: await r.json() };
};

test('PUT /api/data: over the cap is 413 with the store byte-identical; under it, 200 and persisted', async t => {
  const h = await startServer(t);
  const stateFile = path.join(h.dataDir, `state-${UID}.json`);
  const dbFile = path.join(h.dataDir, 'db.json');
  const snap = () => ({ state: fs.readFileSync(stateFile), db: fs.readFileSync(dbFile) });

  // Happy path: a body well under the cap lands and bumps the revision.
  let r = await put(h, JSON.stringify({ state: { unit: 'kg', workouts: [{ id: 'w1', d: '2026-02-02', name: 'small' }], routines: [] }, baseRev: 3 }));
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 4);
  const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.deepEqual(persisted.workouts.map(w => w.id), ['w1']);
  assert.equal(persisted._rev, 4);

  // Failure path: over the cap every byte on disk is left exactly where it was — the write
  // must not start, so a pre-existing document (this one) survives untouched, and db.json
  // (accounts) is not rewritten by the refused request either.
  const before = snap();
  r = await put(h, JSON.stringify({ state: { workouts: [], routines: [], pad: 'x'.repeat(6 * 1024 * 1024) }, baseRev: 4 }));
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'body too large');
  const after = snap();
  assert.ok(before.state.equals(after.state), 'state-<uid>.json changed after an oversized PUT');
  assert.ok(before.db.equals(after.db), 'db.json changed after an oversized PUT');

  // GET is untouched by the guard: it still answers from the same file, rev and all.
  const g = await fetch(`${h.api}/api/data`, { headers: authed });
  assert.equal(g.status, 200);
  const doc = await g.json();
  assert.equal(doc.rev, 4);
  assert.deepEqual(doc.state.workouts.map(w => w.id), ['w1']);
});
