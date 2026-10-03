'use strict';
/* Per-IP rate limit — regression tests for audit-fixes todo 2 (red→green).
 *
 * The bug: coach and nutritionProxy accepted unlimited requests per IP, so one
 * client could burn the paid xAI/Nutritionix quota. The fix is an in-memory
 * fixed-window limiter keyed by client IP (x-forwarded-for, else req.ip), applied
 * to coach + nutritionProxy only — never to OPTIONS preflights and never to the
 * scheduled pushDailyReminder. Env: RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS.
 *
 * Determinism: fixed 60 s window (requests fire in milliseconds — no sleep needed
 * for the burst assertions; the window-reset case uses a 1 s window and only ever
 * sleeps FORWARD past it, so time can only help it, never break it). Each test
 * uses its OWN mock IP so buckets never collide. Response for a normal request
 * here is 400 (empty body / no query) — cheap, no network. */
process.env.RATE_LIMIT_MAX = '5';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
const test = require('node:test');
const assert = require('node:assert/strict');
const { coach, nutritionProxy } = require('../index.js');

function makeRes() {
  return {
    statusCode: null,
    headerRows: [],
    body: null,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headerRows.push(headers || {});
      return this;
    },
    end(chunk) {
      this.ended = true;
      if (chunk != null) this.body = String(chunk);
      return this;
    }
  };
}

function header(res, name) {
  const want = name.toLowerCase();
  for (const row of res.headerRows) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === want) return row[key];
    }
  }
  return undefined;
}

async function call(handler, ip, opts = {}) {
  const res = makeRes();
  await handler(
    {
      method: opts.method || 'POST',
      url: '/coach',
      headers: { 'x-forwarded-for': ip, ...(opts.headers || {}) },
      body: opts.body !== undefined ? opts.body : {}
    },
    res
  );
  assert.equal(res.ended, true, 'handler must answer');
  return res;
}

const parsed = res => {
  try { return JSON.parse(res.body || 'null'); } catch { return null; }
};

/* ------------------------------ the limiter ------------------------------ */

test('the (max+1)-th rapid request from one IP gets exactly one 429', async () => {
  const ip = '198.51.100.7';
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(coach, ip)).statusCode);

  assert.deepEqual(
    statuses.slice(0, 5).map(s => s === 429),
    [false, false, false, false, false],
    'requests within the limit must be answered normally: ' + statuses.slice(0, 5)
  );
  assert.equal(statuses[5], 429, 'the 6th request (max=5) must be throttled: ' + statuses);
  assert.equal(statuses.filter(s => s === 429).length, 1, 'exactly ONE 429 after the threshold');
});

test('the 429 carries a clear message and a retry hint', async () => {
  const ip = '198.51.100.8';
  let last;
  for (let i = 0; i < 6; i++) last = await call(coach, ip);
  assert.equal(last.statusCode, 429);
  const body = parsed(last);
  assert.ok(body && /rate limit/i.test(body.error || ''), 'message must say rate limit: ' + last.body);
  assert.equal(typeof header(last, 'Retry-After'), 'string', 'Retry-After must tell the client when');
  assert.equal(header(last, 'content-type'), 'application/json; charset=utf-8', 'still a JSON answer');
});

test('a different IP is unaffected by the other IP throttling', async () => {
  const ipA = '198.51.100.9';
  const ipB = '203.0.113.50';
  for (let i = 0; i < 6; i++) await call(coach, ipA); // ipA is now over the limit
  const res = await call(coach, ipB);
  assert.notEqual(res.statusCode, 429, 'ipB must not inherit ipA throttling: ' + res.statusCode);
  assert.equal(res.statusCode, 400, 'ipB gets the normal empty-body answer');
});

test('nutritionProxy applies the same per-IP limiter', async () => {
  const ip = '198.51.100.10';
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await call(nutritionProxy, ip)).statusCode);
  assert.equal(statuses[5], 429, '6th request must be throttled: ' + statuses);
  assert.equal(statuses.filter(s => s === 429).length, 1);
  assert.ok(statuses.slice(0, 5).every(s => s === 400), 'first 5 normal: ' + statuses);
});

test('CORS preflights (OPTIONS) are never rate-limited', async () => {
  const ip = '198.51.100.11';
  for (let i = 0; i < 12; i++) {
    const res = await call(coach, ip, { method: 'OPTIONS' });
    assert.equal(res.statusCode, 204, 'preflight #' + i + ' must stay 204');
  }
});

test('the window resets: after it elapses the IP is served again', async () => {
  const prevMax = process.env.RATE_LIMIT_MAX;
  const prevWin = process.env.RATE_LIMIT_WINDOW_MS;
  process.env.RATE_LIMIT_MAX = '2';
  process.env.RATE_LIMIT_WINDOW_MS = '1000';
  try {
    const ip = '198.51.100.12';
    await call(coach, ip);
    await call(coach, ip);
    const blocked = await call(coach, ip);
    assert.equal(blocked.statusCode, 429, 'third request inside the window is throttled');
    await new Promise(r => setTimeout(r, 1100)); // only ever moves FORWARD past resetAt
    const after = await call(coach, ip);
    assert.notEqual(after.statusCode, 429, 'a fresh window serves the IP again: ' + after.statusCode);
  } finally {
    process.env.RATE_LIMIT_MAX = prevMax;
    process.env.RATE_LIMIT_WINDOW_MS = prevWin;
  }
});
