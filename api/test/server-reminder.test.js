/* Two halves of the same rule — a state whose `workouts` or `routines` is not an array must not
   be able to take the api down:
   - PUT /api/data refuses the shape at the door (every real client sends arrays or leaves the
     field out, so nothing legitimate changes);
   - a file that got onto disk anyway is logged and skipped by the reminder tick, which runs
     outside the per-route try/catch, and the users after it still get their reminders.
   Real server.js in a child. The tick runs every 10 s, so the second
   test waits on the log rather than on a fixed sleep. */
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

// Same construction as server.js makeSession(): payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const cookie = { Cookie: `gymsid=${mintSession('u_test_1')}` };

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

const USERS = [
  { id: 'u_test_1', name: 'One', created: new Date().toISOString() },
  { id: 'u_test_2', name: 'Two', created: new Date().toISOString() }
];

async function startServer(t, subs = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-reminder-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs, invites: [] }));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }
  });
  const h = { api: `http://127.0.0.1:${port}`, dataDir, child, log: '' };
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

test('PUT /api/data refuses a state whose workouts or routines is not an array', async t => {
  const h = await startServer(t);
  const put = state => fetch(`${h.api}/api/data`, { method: 'PUT', headers: cookie, body: JSON.stringify({ state }) });
  const file = path.join(h.dataDir, 'state-u_test_1.json');

  for (const bad of [{ workouts: {} }, { workouts: 'abc' }, { workouts: 7 }, { workouts: true }, { routines: {} }, { routines: 'r1' }, { workouts: [], routines: {} }]) {
    const r = await put({ _ts: 1, ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.deepEqual(await r.json(), { error: 'invalid state' }, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(file), false, 'nothing landed on disk');

  // the shapes real clients send still go through: arrays, the field left out, or null
  assert.equal((await put({ _ts: 2, workouts: [], routines: [] })).status, 200);
  assert.equal((await put({ _ts: 3 })).status, 200);
  assert.equal((await put({ _ts: 4, workouts: null, routines: null })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))._ts, 4);
});

test('a non-array workouts on disk is logged and skipped by the reminder tick; the next user still fires', async t => {
  const keys = { p256dh: 'p', auth: 'a' };
  // localhost resolves to a loopback address, which PUSH_AGENT refuses — the send that follows the
  // reminder fails locally and quietly, with no socket leaving this machine
  const subs = USERS.map(u => ({ userId: u.id, endpoint: 'https://localhost/x', keys, created: new Date().toISOString() }));
  const h = await startServer(t, subs);

  const routines = [{ id: 'r1', name: 'Full body', emoji: '💪', ex: [] }];
  const week = { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' };
  // hh:mm exactly the way server.js userNow() derives it, so the reminder is "now" in UTC
  const nowHHMM = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
    const g = type => parts.find(p => p.type === type)?.value;
    return `${g('hour')}:${g('minute')}`;
  };
  // The tick re-reads each state file every pass and only acts when the reminder is for the
  // current minute, so both files are rewritten with "now" until the log shows the tick has done
  // its work — a minute rolling over mid-wait cannot make it miss.
  const seed = () => {
    const reminder = { on: true, time: nowHHMM(), tz: 'UTC' };
    fs.writeFileSync(path.join(h.dataDir, 'state-u_test_1.json'), JSON.stringify({ reminder, routines, week, workouts: {} }));
    fs.writeFileSync(path.join(h.dataDir, 'state-u_test_2.json'), JSON.stringify({ reminder, routines, week, workouts: [] }));
  };
  const done = () => /reminder tick u_test_1/.test(h.log) && /reminder firing u_test_2 r1/.test(h.log);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !done() && h.child.exitCode === null) {
    seed();
    await new Promise(r => setTimeout(r, 500));
  }

  assert.equal(h.child.exitCode, null, `server exited:\n${h.log}`);
  assert.match(h.log, /reminder tick u_test_1 TypeError/, h.log);
  assert.match(h.log, /reminder firing u_test_2 r1/, h.log);
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200);
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  assert.ok(db.users.find(u => u.id === 'u_test_2').lastReminder, 'the good user\'s reminder was recorded');
});
