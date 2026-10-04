/* GymTask — FCM messaging service worker. Receives the daily reminder the Cloud Function
   `pushDailyReminder` sends to the topic `gytask-daily` (functions/index.js) and shows it.

   A service worker runs outside the page, so it cannot read import.meta.env — Vite also
   copies public/ verbatim. The __VITE_FIREBASE_*__ placeholders are therefore filled from
   the build env by the `gytask-fcm-sw` plugin in vite.config.js (build + a dev middleware),
   the same deal `sw.js` has with its `__BUILD__` stamp. Firebase web config keys are not
   secrets — they ship in the client bundle anyway — but they still belong in env, not in git.

   Unfilled placeholders (build without VITE_FIREBASE_*) leave Firebase uninitialised and
   the plain push fallback below keeps answering pushes, so the browser never sees a silent
   push (Chrome revokes the permission for those). The compat scripts are the ones that work
   through importScripts: the non-compat `firebase-app.js`/`firebase-messaging.js` files on
   gstatic are ES modules and throw there (verified against 10.14.1 and 12.19.0). */
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/12.19.0/firebase-messaging-compat.js')

const firebaseConfig = {
  apiKey: '__VITE_FIREBASE_API_KEY__',
  authDomain: '__VITE_FIREBASE_AUTH_DOMAIN__',
  projectId: '__VITE_FIREBASE_PROJECT_ID__',
  storageBucket: '__VITE_FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__VITE_FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__VITE_FIREBASE_APP_ID__'
}

if (firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('__')) {
  firebase.initializeApp(firebaseConfig)
  firebase.messaging().onBackgroundMessage(({ notification }) => {
    if (!notification) return
    self.registration.showNotification(notification.title, { body: notification.body, icon: '/icon-512.png' })
  })
} else {
  // Fallback for an unconfigured worker: FCM wraps the payload as { notification: { title,
  // body } }, while the rest-timer pushes from api/ post a flat { title, body } — cover both.
  self.addEventListener('push', e => {
    e.waitUntil((async () => {
      let data = {}
      try { data = e.data ? await e.data.json() : {} } catch { data = {} }
      const n = data.notification || data
      await self.registration.showNotification(n.title || 'GymTask', {
        body: n.body || '',
        icon: '/icon-512.png',
        tag: n.tag || 'gytask'
      })
    })())
  })
}
