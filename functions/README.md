# GymTask Cloud Functions

Firebase Cloud Functions for GymTask. CommonJS (`index.js`, no `"type"` field), firebase-functions v7 + firebase-admin v14, Node 22 (see `engines`).

| Export | Type | What it does |
| --- | --- | --- |
| `coach` | HTTPS | xAI Grok call mirroring `api/coach` prompt/message shape |
| `nutritionProxy` | HTTPS | Nutritionix pt-BR natural search proxy (keys stay server-side) |
| `pushDailyReminder` | Scheduled | One FCM topic push per day — see below |

## Deploy

```bash
npm install -g firebase-tools   # once
firebase login
firebase deploy --only functions
```

> Note: the repo has a root `firebase.json` already pointing at this directory (`{"functions": {"source": "functions"}}` plus the Firestore rules mapping) — the first deploy just needs `firebase use <your-project-id>`.

- Env vars are read from `functions/.env` (deployed) / `functions/.env.local` (emulator) — copy `functions/.env.example` and fill it in. They are **server-side only**, never in any client bundle.
- Deploying **is** the opt-in for each function: whatever you deploy runs. `pushDailyReminder` fires daily at 09:00 `America/Sao_Paulo`; undeploy it with `firebase functions:delete pushDailyReminder` when you don't want it.

## Environment variables

| Var | Function | Required? |
| --- | --- | --- |
| `XAI_API_KEY` | `coach` | Yes for `coach` (400 with a clear message when missing) |
| `XAI_MODEL` | `coach` | No — defaults to `grok-3-mini` |
| `NUTRITIONIX_APP_ID` / `NUTRITIONIX_APP_KEY` | `nutritionProxy` | Yes for `nutritionProxy` (400 naming the variable) |
| `DAILY_REMINDER_ENABLED` | `pushDailyReminder` | No — **default on when unset**; set `0`/`false`/`off`/`no` to skip the run. Deploying the function is the opt-in |
| `ALLOWED_ORIGINS` | `coach`, `nutritionProxy` | No — comma-separated CORS origin allowlist that overrides the defaults (`https://gymtask-jtu8.vercel.app`, `http://localhost:5173`, `http://localhost:4173`); non-listed origins get no `Access-Control-Allow-Origin` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `coach`, `nutritionProxy` | No — per-IP fixed-window limit, defaults `30` requests / `60000` ms (in-memory per warm instance); never applied to OPTIONS preflights or `pushDailyReminder` |

No credential is needed for FCM itself: `admin.initializeApp()` on Cloud Functions uses the runtime's default credentials.

## pushDailyReminder — server side

- Schedule: `every day 09:00`, `timeZone: 'America/Sao_Paulo'`.
- Sends **one** message to the FCM topic **`gytask-daily`**:

```js
{
  topic: 'gytask-daily',
  notification: { title: 'GymTask', body: 'Hora do treino de hoje — abra o app para registrar suas séries.' },
  webpush: { fcmOptions: { link: '/' } }
}
```

- Recipients = clients subscribed to the topic. **No token storage, no Firestore reads.** Init/send failures are `console.error`'d and swallowed — a scheduled function must not crash-loop.

## Client-side contract (for the later frontend pass)

The frontend must subscribe each device to `gytask-daily`. The Firebase web config (`VITE_FIREBASE_*`) already exists in `frontend/.env.example`, and `frontend/src/lib/firebase.js` already exports `app`. Still needed:

1. Add `VITE_FIREBASE_VAPID_KEY=` to `frontend/.env.example` + `.env` (Firebase Console → Project Settings → Cloud Messaging → Web Push certificate).
2. Add `firebase-messaging` (part of the already-used `firebase` package) and `frontend/public/firebase-messaging-sw.js`:

```js
// frontend/public/firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js')
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js')

firebase.initializeApp({
  apiKey: '...', authDomain: '...', projectId: '...',
  storageBucket: '...', messagingSenderId: '...', appId: '...' // same VITE_FIREBASE_* values
})

firebase.messaging().onBackgroundMessage(({ notification }) => {
  if (!notification) return
  self.registration.showNotification(notification.title, { body: notification.body, icon: '/icon-192.png' })
})
```

3. Subscribe once (e.g. from Settings, after login/guest):

```js
import { getMessaging, getToken, subscribeToTopic, isSupported } from 'firebase/messaging'
import { app, firebaseConfigured } from './firebase.js'

if (firebaseConfigured && (await isSupported())) {
  const permission = await Notification.requestPermission() // must end as 'granted'
  if (permission === 'granted') {
    const messaging = getMessaging(app)
    const token = await getToken(messaging, { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY })
    if (token) await subscribeToTopic(messaging, 'gytask-daily') // topic name must match exactly
  }
}
```

4. Permissions: the browser prompt (`Notification.requestPermission()`); HTTPS or `localhost` required. `getToken()` needs the service worker registered; the topic name `gytask-daily` must match the server exactly. Unsubscribe later with `unsubscribeFromTopic(messaging, 'gytask-daily')` and `deleteToken(messaging)`.
