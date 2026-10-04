import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { doc, initializeFirestore, onSnapshot, persistentLocalCache } from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Without credentials the app must still build and run (guest/demo stay usable): nothing is
// initialized and the login screen says what to configure instead of crashing on a null auth.
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId)

let _app = null
let _auth = null
let _db = null
if (firebaseConfigured) {
  _app = initializeApp(cfg)
  _auth = getAuth(_app)
  _db = initializeFirestore(_app, { localCache: persistentLocalCache() })
}

export const app = _app
export const auth = _auth
export const db = _db

/**
 * Live sync (RF3): one listener on this account's document — the same `users/{uid}/state/app`
 * that GET/PUT /api/data reads and writes (lib/api.js) — so a change made on another device
 * reaches this one the moment it lands instead of on the next rev poll. The callback gets the
 * document's own fields (null before the first write); the store settles each snapshot through
 * the same rules as a pull (useStore settleSnapshot → lib/sync-merge.js).
 *
 * Returns Firestore's unsubscribe function — a no-op one when nothing is configured, so callers
 * need no branch of their own.
 */
export function observeUserState(uid, onData) {
  if (!firebaseConfigured || !uid) return () => {}
  return onSnapshot(doc(_db, 'users', uid, 'state', 'app'), snap => onData(snap.exists() ? snap.data() : null))
}
