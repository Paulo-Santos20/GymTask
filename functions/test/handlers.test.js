'use strict';
/* Handler env guards — audit-fixes todo 5 (node:test suite, zero new deps).
 *
 * What these tests pin down, per functions/README.md's behavior contracts:
 *   coach              missing XAI_API_KEY → 400, message NAMES XAI_API_KEY
 *   nutritionProxy     missing NUTRITIONIX_APP_ID / NUTRITIONIX_APP_KEY → 400 naming them
 *                      (either one missing is enough — both are checked)
 *   pushDailyReminder  DAILY_REMINDER_ENABLED=0 (also false/off/no, any case) → the run
 *                      is skipped; unset → exactly ONE FCM send to the gytask-daily topic
 *
 * How: the HTTPS handlers are invoked directly with mock req/res (the same style as the
 * cors/ratelimit/payload-cap suites) and the scheduled handler through its `.run()`
 * entry (firebase-functions attaches the raw handler to every v2 function). Everything
 * downstream is intercepted BEFORE index.js loads, so nothing ever leaves the process:
 *   - global fetch is stubbed to RECORD calls (no api.x.ai, no Nutritionix);
 *   - Messaging.prototype.send is stubbed to RECORD payloads (no FCM).
 * The "control" tests are the point: they prove each guard is the ONLY thing standing
 * between the request and the paid upstream — so a green "missing key" test can't be a
 * false pass from a broken client. Unique x-forwarded-for per request keeps the todo-2
 * rate limiter out of the way. Built-ins only: node:test + node:assert, no new deps. */
const test = require('node:test');
const assert = require('node:assert/strict');

/* ------------------------- offline interception ------------------------- */

const realFetch = globalThis.fetch;
let fetchCalls = [];

globalThis.fetch = async (url, opts) => {
  fetchCalls.push(String(url));
  if (String(url).includes('x.ai')) {
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'pong' } }] })
    };
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      foods: [{ uuid: 'u1', food_name: 'banana', serving_qty: 1, serving_unit: 'un', nf_calories: 89 }]
    })
  };
};

/* Patch BEFORE index.js can ever build a Messaging instance: every send becomes a
 * recorded entry instead of an FCM delivery (Messaging.prototype.send is a writable
 * method, so this is a plain method swap — no dependency, no emulator). */
const { Messaging } = require('firebase-admin/messaging');
const realSend = Messaging.prototype.send;
let sendCalls = [];

Messaging.prototype.send = async function (payload) {
  sendCalls.push(payload);
  return 'test-message-id';
};

const { coach, nutritionProxy, pushDailyReminder } = require('../index.js');

/* ------------------------------ env helper ------------------------------ */

const ENV = ['XAI_API_KEY', 'NUTRITIONIX_APP_ID', 'NUTRITIONIX_APP_KEY', 'DAILY_REMINDER_ENABLED'];

/** `undefined` in `over` DELETES the key (the "missing env var" case under test). */
function withEnv(over, fn) {
  const saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

/* ------------------------------- req/res ------------------------------- */

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

let seq = 0;
async function call(handler, opts = {}) {
  const res = makeRes();
  await handler(
    {
      method: opts.method || 'POST',
      url: '/handler',
      headers: { 'x-forwarded-for': '203.0.113.' + (++seq) },
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

/** Capture console.log/console.error for the duration of fn (scheduled-handler logs). */
async function captureConsole(fn) {
  const logs = [];
  const errs = [];
  const realLog = console.log;
  const realErr = console.error;
  console.log = (...a) => { logs.push(a.map(String).join(' ')); };
  console.error = (...a) => { errs.push(a.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.log = realLog;
    console.error = realErr;
  }
  return { logs, errs };
}

/* -------------------------------- coach -------------------------------- */

test('coach: missing XAI_API_KEY → 400 naming XAI_API_KEY, no upstream call', async () => {
  await withEnv({ XAI_API_KEY: undefined }, async () => {
    fetchCalls = [];
    const res = await call(coach, { body: { prompt: 'oi' } });
    assert.equal(res.statusCode, 400, 'a missing key must be a client-visible 400: ' + res.body);
    const body = parsed(res);
    assert.ok(body, '400 must carry a JSON body: ' + res.body);
    assert.match(
      body.error || '',
      /XAI_API_KEY/,
      'the message must NAME the variable so an operator knows what to set: ' + body.error
    );
    assert.deepEqual(fetchCalls, [], 'no key → the request must never reach api.x.ai');
  });
});

test('coach: XAI_API_KEY set → guard passes and the request reaches the model (control)', async () => {
  await withEnv({ XAI_API_KEY: 'test-key-not-real' }, async () => {
    fetchCalls = [];
    const res = await call(coach, { body: { prompt: 'oi' } });
    assert.equal(res.statusCode, 200, 'with a key the guard must open: ' + res.body);
    assert.equal(fetchCalls.length, 1, 'exactly one downstream call');
    assert.ok(fetchCalls[0].includes('x.ai'), 'and it targets api.x.ai: ' + fetchCalls[0]);
  });
});

/* ----------------------------- nutritionProxy ---------------------------- */

test('nutritionProxy: missing NUTRITIONIX keys → 400 naming both variables, no upstream call', async () => {
  await withEnv({ NUTRITIONIX_APP_ID: undefined, NUTRITIONIX_APP_KEY: undefined }, async () => {
    fetchCalls = [];
    const res = await call(nutritionProxy, { body: { query: 'banana prata' } });
    assert.equal(res.statusCode, 400, 'missing keys must be a client-visible 400: ' + res.body);
    const body = parsed(res);
    assert.match(body.error || '', /NUTRITIONIX_APP_ID/, 'message must name APP_ID: ' + body.error);
    assert.match(body.error || '', /NUTRITIONIX_APP_KEY/, 'message must name APP_KEY: ' + body.error);
    assert.deepEqual(fetchCalls, [], 'no keys → the request must never reach Nutritionix');
  });
});

test('nutritionProxy: APP_KEY alone missing → still 400 (either key fails the guard)', async () => {
  await withEnv({ NUTRITIONIX_APP_ID: 'test-app-id', NUTRITIONIX_APP_KEY: undefined }, async () => {
    fetchCalls = [];
    const res = await call(nutritionProxy, { body: { query: 'banana prata' } });
    assert.equal(res.statusCode, 400, 'a half-configured proxy must not go upstream: ' + res.body);
    assert.match(parsed(res).error || '', /NUTRITIONIX_APP_KEY/, 'message names the missing one');
    assert.deepEqual(fetchCalls, [], 'no Nutritionix call');
  });
});

test('nutritionProxy: both keys set → guard passes and Nutritionix is called (control)', async () => {
  await withEnv({ NUTRITIONIX_APP_ID: 'test-app-id', NUTRITIONIX_APP_KEY: 'test-app-key' }, async () => {
    fetchCalls = [];
    const res = await call(nutritionProxy, { body: { query: 'banana prata' } });
    assert.equal(res.statusCode, 200, 'with both keys the guard must open: ' + res.body);
    assert.equal(fetchCalls.length, 1, 'exactly one downstream call');
    assert.ok(fetchCalls[0].includes('nutritionix'), 'targets Nutritionix: ' + fetchCalls[0]);
    assert.equal(parsed(res).count, 1, 'results still flow through');
  });
});

/* --------------------------- pushDailyReminder --------------------------- */

test('pushDailyReminder: DAILY_REMINDER_ENABLED=0 skips the run (no send, logs the skip)', async () => {
  const before = sendCalls.length;
  await withEnv({ DAILY_REMINDER_ENABLED: '0' }, async () => {
    const { logs } = await captureConsole(() => pushDailyReminder.run({}));
    assert.ok(
      logs.some(l => /DAILY_REMINDER_ENABLED is off/.test(l)),
      'the skip must be visible in the logs: ' + JSON.stringify(logs)
    );
  });
  assert.equal(sendCalls.length, before, 'disabled means ZERO FCM sends');
});

test('pushDailyReminder: false/off/no (any case) also skip the run', async () => {
  const before = sendCalls.length;
  for (const value of ['false', 'OFF', 'No', '  off  ']) {
    await withEnv({ DAILY_REMINDER_ENABLED: value }, async () => {
      const { logs } = await captureConsole(() => pushDailyReminder.run({}));
      assert.ok(
        logs.some(l => /DAILY_REMINDER_ENABLED is off/.test(l)),
        'value ' + JSON.stringify(value) + ' must skip: ' + JSON.stringify(logs)
      );
    });
  }
  assert.equal(sendCalls.length, before, 'every off-spelling means ZERO FCM sends');
});

test('pushDailyReminder: unset → exactly one FCM send to gytask-daily (control)', async () => {
  const before = sendCalls.length;
  await withEnv({ DAILY_REMINDER_ENABLED: undefined }, async () => {
    const { errs } = await captureConsole(() => pushDailyReminder.run({}));
    assert.ok(
      !errs.some(e => /could not initialize/.test(e)),
      'firebase-admin must initialize (v14 modular API) : ' + JSON.stringify(errs)
    );
  });
  assert.equal(sendCalls.length, before + 1, 'enabled means exactly ONE send per run');
  const payload = sendCalls[sendCalls.length - 1];
  assert.equal(payload.topic, 'gytask-daily', 'the documented topic');
  assert.equal(payload.notification && payload.notification.title, 'GymTask');
  assert.match(
    payload.notification && payload.notification.body || '',
    /treino/,
    'the documented pt-BR body'
  );
  assert.equal(payload.webpush && payload.webpush.fcmOptions && payload.webpush.fcmOptions.link, '/');
});

test.after(() => {
  globalThis.fetch = realFetch;
  Messaging.prototype.send = realSend;
});
