'use strict';
/* CORS origin allowlist — regression tests for audit-fixes todo 1 (red→green).
 *
 * The bug: functions/index.js answered every response with
 * `Access-Control-Allow-Origin: *`, so ANY website (https://evil.example included)
 * could call coach/nutritionProxy from a browser. The fix echoes a configured
 * origin ONLY when it is on the allowlist (ALLOWED_ORIGINS env, comma-separated,
 * defaulting to the Vercel production domain + the localhost dev/preview origins).
 *
 * Handlers are invoked directly with mock req/res (no network, no emulator, no
 * test framework — built-in node:test + node:assert only). Every request answers
 * through send()/preflight() on a cheap path (POST {} → 400 in buildMessages /
 * missing-query before any upstream call), so each assertion exercises the real
 * header code. Every request also carries a unique x-forwarded-for so these
 * never share a rate-limit bucket with other suites (todo 2+). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { coach, nutritionProxy } = require('../index.js');

/* Production = the Vercel project documented in GYMTASK.md / docs (gymtask-jtu8);
 * dev = vite dev (5173) and vite preview (4173). */
const VERCEL_ORIGIN = 'https://gymtask-jtu8.vercel.app';
const DEV_ORIGIN = 'http://localhost:5173';
const PREVIEW_ORIGIN = 'http://localhost:4173';
const EVIL_ORIGIN = 'https://evil.example';

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

/** Header lookup is case-insensitive, the way a browser/HTTP stack reads it. */
function header(res, name) {
  const want = name.toLowerCase();
  for (const row of res.headerRows) {
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === want) return row[key];
    }
  }
  return undefined;
}

let seq = 0;
function makeReq({ method = 'POST', origin, headers = {}, body = {} } = {}) {
  const h = { 'x-forwarded-for': '203.0.113.' + (++seq), ...headers };
  if (origin !== undefined) h.origin = origin;
  return { method, url: '/coach', headers: h, body };
}

async function call(handler, opts) {
  const res = makeRes();
  await handler(makeReq(opts), res);
  assert.equal(res.ended, true, 'handler must answer');
  return res;
}

/* ---------------------------- the allowlist ---------------------------- */

test('evil origin receives no Access-Control-Allow-Origin', async () => {
  const res = await call(coach, { origin: EVIL_ORIGIN });
  assert.equal(res.statusCode, 400, 'cheap path: {} body → 400 before any upstream call');
  assert.equal(
    header(res, 'Access-Control-Allow-Origin'),
    undefined,
    'an origin that is not on the allowlist must get NO ACAO header'
  );
});

test('the Vercel production origin is echoed verbatim (never "*")', async () => {
  const res = await call(coach, { origin: VERCEL_ORIGIN });
  assert.equal(header(res, 'Access-Control-Allow-Origin'), VERCEL_ORIGIN);
});

test('localhost dev (5173) and preview (4173) origins are allowed', async () => {
  for (const origin of [DEV_ORIGIN, PREVIEW_ORIGIN]) {
    const res = await call(coach, { origin });
    assert.equal(header(res, 'Access-Control-Allow-Origin'), origin, origin);
  }
});

test('nutritionProxy applies the same allowlist', async () => {
  const evil = await call(nutritionProxy, { origin: EVIL_ORIGIN });
  assert.equal(header(evil, 'Access-Control-Allow-Origin'), undefined);
  const good = await call(nutritionProxy, { origin: VERCEL_ORIGIN });
  assert.equal(header(good, 'Access-Control-Allow-Origin'), VERCEL_ORIGIN);
});

/* ------------------------------ preflight ------------------------------ */

test('OPTIONS preflight from an evil origin carries no ACAO', async () => {
  const res = await call(coach, { method: 'OPTIONS', origin: EVIL_ORIGIN });
  assert.equal(res.statusCode, 204);
  assert.equal(header(res, 'Access-Control-Allow-Origin'), undefined);
});

test('OPTIONS preflight from an allowed origin echoes the origin', async () => {
  const res = await call(coach, { method: 'OPTIONS', origin: DEV_ORIGIN });
  assert.equal(res.statusCode, 204);
  assert.equal(header(res, 'Access-Control-Allow-Origin'), DEV_ORIGIN);
});

/* --------------------------- malformed input --------------------------- */

test('malformed Origin values are denied without crashing', async () => {
  const cases = [
    { origin: undefined }, // header absent
    { origin: '' }, // empty string
    { origin: 'https://a.example, https://b.example' }, // multi-value header
    { origin: 'null' }, // opaque/sandboxed origin
    { origin: 'https://evil.example/' } // trailing slash ≠ origin
  ];
  for (const c of cases) {
    const res = await call(coach, c);
    assert.equal(res.ended, true, 'must answer, never crash: ' + JSON.stringify(c.origin));
    assert.equal(
      header(res, 'Access-Control-Allow-Origin'),
      undefined,
      'origin ' + JSON.stringify(c.origin) + ' must not get ACAO'
    );
  }
});
