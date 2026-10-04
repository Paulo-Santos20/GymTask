# GymTask Cloud Functions

Firebase Cloud Functions for GymTask. CommonJS (`index.js`, no `"type"` field), firebase-functions v7 + firebase-admin v14, Node 22 (see `engines`).

| Export | Type | What it does |
| --- | --- | --- |
| `coach` | HTTPS | xAI Grok call mirroring `api/coach` prompt/message shape |
| `nutritionProxy` | HTTPS | Nutritionix pt-BR natural search proxy (keys stay server-side) |
| `pushDailyReminder` | Scheduled | One FCM topic push per day — see below |
| `weeklyReview` | Scheduled | The opted-in weekly review, held as a pending proposal in the api's store — see below |

## Deploy

```bash
npm install -g firebase-tools   # once
firebase login
firebase deploy --only functions
```

> Note: the repo has a root `firebase.json` already pointing at this directory (`{"functions": {"source": "functions"}}` plus the Firestore rules mapping) — the first deploy just needs `firebase use <your-project-id>`.

- Env vars are read from `functions/.env` (deployed) / `functions/.env.local` (emulator) — copy `functions/.env.example` and fill it in. They are **server-side only**, never in any client bundle.
- Deploying **is** the opt-in for each function: whatever you deploy runs. `pushDailyReminder` fires daily at 09:00 `America/Sao_Paulo`; `weeklyReview` fires daily at 18:00 `America/Sao_Paulo`; undeploy either with `firebase functions:delete <name>` when you don't want it.

### Manual deploy checklist for `weeklyReview` (decision 4: deploys stay manual)

No CI job runs this. When enabling it on a project, check, in order:

1. `XAI_API_KEY` set for the project (`firebase functions:secrets:set XAI_API_KEY` or `functions/.env`) — without it the run logs and skips, spending nothing.
2. `DATA_DIR` points at the **same** directory the api serves (`api/coach/jobs.js` reads `DATA_DIR`, default `/data`) — a mounted volume shared with the api container. If the function writes to its own private disk, the proposal lands where no `GET /api/coach/status` will ever read it.
3. Opt-in state is per profile, in the synced state file: `coach.consent.agreedAt` (the consent screen) **and** `coach.cadence.weekly = { day, time }` (the Automatic-reviews sheet; `off` and `everyWorkouts` are the api's own scheduler's modes).
4. `firebase deploy --only functions:weeklyReview`, then confirm one run in the Cloud Functions logs (`weeklyReview: skip <uid> - <reason>` lines are normal; `proposal for <uid>` is a written proposal).

## Environment variables

| Var | Function | Required? |
| --- | --- | --- |
| `XAI_API_KEY` | `coach`, `weeklyReview` | Yes for `coach` (400 with a clear message when missing) and `weeklyReview` (logs + skips the run) |
| `XAI_MODEL` | `coach`, `weeklyReview` | No — defaults to `grok-3-mini` |
| `DATA_DIR` | `weeklyReview` | No for the code (defaults to `/data`, same as `api/coach/jobs.js`), **yes in practice**: it must be the api's store directory or no proposal will ever be resolved |
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

## weeklyReview — server side

The scheduled weekly review (RF8): a daily tick at 18:00 `America/Sao_Paulo` that reviews each **opted-in** profile's last training week with the `review` model call and writes the answer as a **pending proposal** — the exact record `api/coach/jobs.js` serves through `GET /api/coach/status` and clears through `POST /api/coach/pending/resolve`, so the app resolves it with the same `resolvePending` flow it already has.

- **Who runs:** a profile is due when `coach.consent.agreedAt` is set, `coach.cadence.weekly = { day, time }` exists (the Automatic-reviews sheet's weekly mode — `off` and `everyWorkouts` belong to the api's in-process `cadence.js`), no proposal is already waiting, no job is running, no review finished in the last 7 days (its `history` line, or the client-stamped `lastReview`), today's weekday in the profile's own timezone is the chosen `day`, and a workout ended after that last review. Up to 10 profiles per run (`REVIEW_MAX_PER_RUN`).
- **What runs:** one Grok call (`temperature 0`) through the same `buildMessages`/`callGrok`/`extractJson` helpers as `coach`, over a compact review payload (meta + profile + plan + last 12 sessions + bodyweight + previously-declined summaries). The answer passes a structural twin of `validateReview` — and, because this channel ships no exercise catalogue, only the types that don't need one: adjustments, removals, renames, `week`, `reorder` (no `add-exercise`/`swap-exercise`/`superset`/`add-routine`).
- **What is written:** `DATA_DIR/coach/<uid>.json` — `pending` in the `jobs.finish` shape (`{id, kind:'review', createdAt, expiresAt:+14d, iteration:1, summary, evidence, changes, notes}`) plus one `history` line (`ready` / `nochange` / `failed+unusable`), so the api's own cadence sees these reviews as its own. `nochange` writes the history line and no proposal; an unreadable answer records `failed+unusable` and retries next week.
- **Known ceilings** (documented at the function in `index.js`): the chosen *time* is honoured only for the default 18:00 (other times land on the chosen day at 18:00 — the api's in-process cadence honours the minute); no `planHash` is attached (fingerprinting needs the exercise catalogue, which cannot ship here — `markStale`'s per-`before` check still guards every scalar change); no `cohort` block is attached (the medians are computed by `api/coach/cohort.js` from every profile's state, which this function deliberately does not read — so a non-sharer sees exactly what the api would show them, and a sharer just loses the comparison context); one attempt, no repair round.
- **`coach-names.js`** is generated from `api/coach/core/library-data.js` (library ids are 4-digit strings; the model needs names). Regenerate after a catalogue change with:

```bash
node -e "const fs=require('fs');const t=fs.readFileSync('api/coach/core/library-data.js','utf8');const rows=JSON.parse(t.match(/export const EXERCISES = (\[[\s\S]*?\]);/)[1]);fs.writeFileSync('functions/coach-names.js','/* GENERATED — see functions/README.md. */\nmodule.exports = '+JSON.stringify(Object.fromEntries(rows.map(e=>[e.id,e.n])))+'\n')"
```


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
