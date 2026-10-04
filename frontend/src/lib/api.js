// Backend helpers (ported from the vanilla app).
//
// State persistence moved to Firebase Firestore in phase ②: while a Firebase user is signed
// in, GET/PUT /api/data and GET /api/data/rev are answered from the document
// `users/{uid}/state/app` (the blob's own keys as the document fields, plus the server-owned
// `_rev` counter) with no network call to /api/data — see the block above api() for the full
// layout and the fallback matrix. Every other route keeps its HTTP behaviour everywhere.
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE
  ? 'Face ID / Touch ID'
  : IS_ANDROID
    ? 'fingerprint or face unlock'
    : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'

/* Where this copy of the app is served from, e.g. "/" or "/myGym/" (issue #238).
 *
 * The app routes behind the hash and its assets are relative (vite `base: './'`), so the only
 * thing that assumed the site root was the API call. A reverse proxy that puts openGym under a
 * subpath — and strips that prefix before the container sees it, which is what Caddy's
 * `handle_path` and its equivalents do — got `/api/...` at the proxy's own root, where there is
 * nothing to answer it.
 *
 * `location.pathname` is the base because the router never leaves it: every screen is a hash,
 * and a path that is not a file is sent back to the app's root before React boots
 * (web/nginx.conf.template). Anything after the last slash is therefore index.html or a stale
 * deep link, and is dropped.
 */
export function appBase(loc = typeof location !== 'undefined' ? location : null) {
  const path = (loc && loc.pathname) || '/'
  return path.slice(0, path.lastIndexOf('/') + 1) || '/'
}

/* State persistence: Firestore (phase ②).
 *
 * Doc path: `users/{uid}/state/app` — one document per user holding the whole state blob.
 * The blob's own keys ARE the document fields (no wrapper object): exactly what PUT /api/data
 * stores in `state-<uid>.json`. The single extra field is `_rev`, the write counter the server
 * stamps inside its own file (api/server.js), so `{ state, rev }` / `{ rev }` answers stay
 * shape-identical to the HTTP routes for every caller.
 *
 * Fallback matrix — stateBackend() re-evaluates on every call, so the choice can move under
 * the app (a sign-out mid-session sends the next load/save back to HTTP with no state to clear):
 *
 *   no VITE_FIREBASE_* env → db/auth are null             → HTTP /api/data (original path)
 *   env set, signed out          → auth.currentUser is null → HTTP /api/data (original path)
 *   env set, signed in           → getDoc/setDoc only        → zero network calls to /api/data
 *   a Firestore call fails       → console.error + throw, HTTP-status-shaped for useStore.doPush
 *
 * Firestore itself (offline persistence via persistentLocalCache) is initialized once, in
 * ./firebase.js — the only module allowed to import firebase/*. The modules are loaded lazily
 * so a deployment without the firebase package or without env never pays for either.
 */
let fbModule = null // './firebase' module namespace, or false when it failed to load
let fsModule = null // 'firebase/firestore' module namespace, or false when it failed to load
let lastRev = 0 // highest revision this tab has issued (two writes in the same ms)

async function stateBackend() {
  // Credentials absent → don't even import ./firebase (which pulls the whole firebase chunk
  // tree with it): a self-hosted instance with no VITE_FIREBASE_* pays nothing for phase ②.
  // firebase.js re-checks these same keys authoritatively, so this can only skip dead work.
  if (!import.meta.env || !import.meta.env.VITE_FIREBASE_API_KEY || !import.meta.env.VITE_FIREBASE_PROJECT_ID)
    return null
  if (fbModule === null) {
    fbModule = await import('./firebase').then(
      m => m,
      e => {
        console.error('[api] ./firebase could not be loaded — /api/data stays on HTTP.', e)
        return false
      },
    )
  }
  if (fbModule === false) return null
  const { firebaseConfigured, auth, db } = fbModule
  if (!firebaseConfigured || !db || !auth) return null
  const user = auth.currentUser // read fresh every call — never cached across a sign-out
  if (!user) return null
  if (fsModule === null) {
    fsModule = await import('firebase/firestore').then(
      m => m,
      e => {
        console.error('[api] firebase/firestore could not be loaded — /api/data stays on HTTP.', e)
        return false
      },
    )
  }
  if (fsModule === false) return null
  return { fs: fsModule, db, uid: user.uid }
}

// Firestore reports failures as codes, not HTTP statuses. Map them onto the vocabulary
// useStore.doPush already branches on — 401 session-gone, 409 conflict, `status == null`
// network/offline — and log every one: permission-denied must surface as "sync pending" in
// the banner (and in the console), never as fake-offline or a silent drop.
function stateError(e, what) {
  const code = (e && e.code) || ''
  console.error('[api] Firestore ' + what + ' failed' + (code ? ' (' + code + ')' : '') + ':', e)
  e.status =
    code === 'unauthenticated'
      ? 401
      : code === 'permission-denied'
        ? 403
        : code === 'unavailable' || code === 'deadline-exceeded' || code === 'cancelled'
          ? undefined
          : 500
  return e
}

const stateRef = (fs, db, uid) => fs.doc(db, 'users', uid, 'state', 'app')

// GET /api/data and GET /api/data/rev with exactly the shapes the HTTP routes answer:
// an account with no document yet reads as `{ state: null, rev: 0 }` (api/server.js).
async function stateGet(backend, path) {
  const { fs, db, uid } = backend
  let snap
  try {
    snap = await fs.getDoc(stateRef(fs, db, uid))
  } catch (e) {
    throw stateError(e, 'read')
  }
  const state = snap.exists() ? snap.data() : null
  const rev = (state && state._rev) || 0
  return path === '/api/data/rev' ? { rev } : { state, rev }
}

// PUT /api/data — a full document replace (setDoc without merge, the overwrite PUT performs),
// mirroring api/server.js: shape checks answer 400, non-entry list junk is dropped, `baseRev`
// refused over a document this device never saw answers 409 with the current one (useStore
// merges and retries), in-progress `active` stays device-local, `_rev` is stamped by us.
async function statePut(backend, opts) {
  const { fs, db, uid } = backend
  let body
  try {
    body = JSON.parse((opts && opts.body) || '{}')
  } catch {
    body = null
  }
  if (!body || typeof body !== 'object') {
    const e = new Error('invalid JSON body')
    e.status = 400
    throw e
  }
  const st = body.state
  if (!st || typeof st !== 'object' || Array.isArray(st)) {
    const e = new Error('state required')
    e.status = 400
    throw e
  }
  const list = v => v == null || Array.isArray(v)
  if (!list(st.workouts) || !list(st.routines)) {
    const e = new Error('invalid state')
    e.status = 400
    throw e
  }

  const next = { ...st }
  for (const k of ['workouts', 'routines']) {
    if (Array.isArray(next[k])) next[k] = next[k].filter(x => !!x && typeof x === 'object' && !Array.isArray(x))
  }
  delete next.active

  let snap
  try {
    snap = await fs.getDoc(stateRef(fs, db, uid))
  } catch (e) {
    throw stateError(e, 'read')
  }
  const cur = snap.exists() ? snap.data() : null
  const curRev = (cur && cur._rev) || 0
  if (body.baseRev != null && body.baseRev !== curRev) {
    const e = new Error('conflict')
    e.status = 409
    e.data = { error: 'conflict', rev: curRev, state: cur }
    throw e
  }

  // One document is capped near 1 MB — the same ceiling nginx's client_max_body_size put in
  // front of the HTTP route, and the reason useStore has a dedicated 413 toast. Raised here
  // first so the client reports it the way it always has instead of as a generic failure.
  if (JSON.stringify(next).length > 1000000) {
    const e = new Error('state too large')
    e.status = 413
    throw e
  }

  // A revision that changes on every write: wall-clock, floored by the document's own counter
  // (a clock behind the last writer) and by this tab's last issue (same-millisecond writes).
  next._rev = lastRev = Math.max(Date.now(), curRev + 1, lastRev + 1)
  try {
    await fs.setDoc(stateRef(fs, db, uid), next)
  } catch (e) {
    throw stateError(e, 'write')
  }
  return { ok: true, ts: next._ts || null, rev: next._rev }
}

export async function api(path, opts) {
  // State routes → Firestore when configured + signed in (block above); otherwise fall through.
  if (path === '/api/data' || path === '/api/data/rev') {
    const backend = await stateBackend()
    if (backend) return (opts && opts.method) === 'PUT' ? statePut(backend, opts) : stateGet(backend, path)
  }
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers)
  // Relative to where the app is served, so a subpath deployment reaches its own API instead
  // of the proxy's root.
  const url = appBase().replace(/\/$/, '') + path
  const r = await fetch(url, Object.assign({}, opts, { headers }))
  const data = await r.json().catch(() => ({}))
  // The body rides along on the error: a 409 from /api/data carries the server's document.
  if (!r.ok) {
    const e = new Error(data.error || 'HTTP ' + r.status)
    e.status = r.status
    e.data = data
    throw e
  }
  return data
}
