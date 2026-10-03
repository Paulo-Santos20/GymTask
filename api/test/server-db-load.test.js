/* db.json load: a corrupt file must never be the reason data disappears (task 8).
   Three shapes, real server.js in a child with a temp DATA_DIR, no new deps:

   1. malformed JSON (a torn write)  — the server still boots, the original bytes stay on disk
      untouched, and they are ALSO kept as db.json.corrupt-<ts>; without that backup the first
      saveDb() after a corrupt load would atomically replace the file with empty defaults and
      the recoverable records would be gone for good.
   2. JSON that parses to a non-object (null, []) — same contract: boot + backup. Both used to
      crash-loop: `db.subs = ...` on null/primitive throws in strict mode, and an array's
      missing `users` takes the health route and the reminder tick down with it.
   3. a valid db.json with user data — round-trips through a real save (POST /api/logout/all
      rewrites db.json): users, creds, subs and an unrelated extra field survive; only the
      legacy `invites` strip applies (the intentional migration, kept). */
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

// Same construction as server.js session tokens: payload `uid:exp:sv`, HMAC-SHA256 over SECRET.
function mintSession(uid, sv = 0) {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

const freePort = () => new Promise(r => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); });
});

async function startServer(t, dbContent) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-dbload-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const dbPath = path.join(dataDir, 'db.json');
  fs.writeFileSync(dbPath, dbContent);
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080' }
  });
  const h = { api: `http://127.0.0.1:${port}`, log: '', dataDir, dbPath, child, exited: false };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  child.on('exit', () => { h.exited = true; });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } fs.rmSync(dataDir, { recursive: true, force: true }); });
  // A crash-looping boot must fail the poll fast instead of burning the full 10s budget.
  let up = false;
  for (let i = 0; i < 100 && !up && !h.exited; i++) {
    try { up = (await fetch(`${h.api}/api/health`)).ok; } catch { /* not up yet */ }
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  h.up = up;
  return h;
}

const backupsIn = dataDir => fs.readdirSync(dataDir).filter(f => /^db\.json\.corrupt-\d+$/.test(f)).sort();
const bytes = (dataDir, f) => fs.readFileSync(path.join(dataDir, f));

test('a malformed db.json: server boots, original bytes untouched, originals kept as db.json.corrupt-<ts>', async t => {
  // A write torn mid-record — the file a crash or a full disk actually leaves behind.
  const torn = '{\n  "users": [\n    { "id": "u_torn", "name": "Ana", "created": "2026-09-01T00:00:00.000Z" }\n  ],\n  "creds": [\n    { "u';
  const original = Buffer.from(torn, 'utf8');
  const h = await startServer(t, torn);

  assert.ok(h.up, `server must still boot on a corrupt db.json:\n${h.log}`);
  assert.deepEqual(fs.readFileSync(h.dbPath), original, 'loading must not touch the corrupt file');

  const backups = backupsIn(h.dataDir);
  assert.equal(backups.length, 1,
    `expected exactly one db.json.corrupt-<ts> backup next to db.json, found: ${backups.length ? backups.join(', ') : 'none'}`);
  assert.deepEqual(bytes(h.dataDir, backups[0]), original, 'the backup must hold the original bytes byte-for-byte');

  // An old session cookie can't rescue the file either: no user resolves after a corrupt load,
  // so the request is rejected and db.json still stands.
  const r = await fetch(`${h.api}/api/logout/all`, {
    method: 'POST', headers: { Authorization: `Bearer ${mintSession('u_torn')}` }
  });
  assert.equal(r.status, 401, 'without a resolvable user the mutation is refused');
  assert.deepEqual(fs.readFileSync(h.dbPath), original, 'a rejected request must not rewrite db.json');
  assert.deepEqual(backupsIn(h.dataDir), [backups[0]], 'still exactly one backup afterwards');
});

test('db.json that parses to a non-object boots with the original backed up, never a crash-loop', async t => {
  for (const shape of ['null', '[]']) {
    await t.test(`parses to ${shape}`, async t2 => {
      const original = Buffer.from(shape, 'utf8');
      const h = await startServer(t2, shape);

      assert.ok(h.up, `server must boot when db.json parses to ${shape} (no crash-loop):\n${h.log}`);
      const backups = backupsIn(h.dataDir);
      assert.equal(backups.length, 1,
        `expected exactly one db.json.corrupt-<ts> backup, found: ${backups.length ? backups.join(', ') : 'none'}`);
      assert.deepEqual(bytes(h.dataDir, backups[0]), original, 'the backup must hold the original bytes byte-for-byte');
      assert.deepEqual(fs.readFileSync(h.dbPath), original, 'loading must not touch the original file');
    });
  }
});

test('a valid db.json round-trips through a real save: everything kept, only invites stripped', async t => {
  const valid = {
    users: [{ id: 'u_ok', name: 'Rita', created: '2026-09-01T00:00:00.000Z' }],
    creds: [{ uid: 'u_ok', hash: 'scrypt$fake$hash', salt: 'salt-1' }],
    subs: [{ userId: 'u_ok', endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' }, created: '2026-09-02T00:00:00.000Z' }],
    invites: ['LEGACY-CODE-123'],
    custom: { keep: 'me', n: 42 }
  };
  const h = await startServer(t, JSON.stringify(valid, null, 2));
  assert.ok(h.up, `server must boot on a valid db.json:\n${h.log}`);
  assert.deepEqual(backupsIn(h.dataDir), [], 'a healthy file must never be backed up');

  // POST /api/logout/all bumps the session version and rewrites db.json (saveDb) — a real save,
  // so the round-trip below proves load did not lose or mangle anything on the way in.
  const r = await fetch(`${h.api}/api/logout/all`, {
    method: 'POST', headers: { Authorization: `Bearer ${mintSession('u_ok', 0)}` }
  });
  assert.equal(r.status, 200, `logout/all must succeed: ${r.status} ${await r.text()}`);

  const saved = JSON.parse(fs.readFileSync(h.dbPath, 'utf8'));
  assert.deepEqual(saved.users, [{ ...valid.users[0], sv: 1 }], 'users survive the save (sv bumped by logout/all)');
  assert.deepEqual(saved.creds, valid.creds, 'creds survive the save');
  assert.deepEqual(saved.subs, valid.subs, 'push subscriptions survive the save');
  assert.deepEqual(saved.custom, valid.custom, 'an unrelated extra field survives the save');
  assert.ok(!('invites' in saved), 'legacy invite codes are stripped on load — the intentional migration');
  assert.deepEqual(backupsIn(h.dataDir), [], 'a healthy file is never backed up');
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200, 'server still serving after the save');
});
