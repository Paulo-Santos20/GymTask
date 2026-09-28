import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore'

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
