# frontend/src/store/

## Responsibility

Three Zustand stores — the only mutable state hubs of the app:

- `useStore.js` (521 lines) — the whole user profile (settings, routines, logged workouts, bodyweight), the session (`user`, guest flag, boot), instance `config`, and the sync engine that keeps the profile identical across devices.
- `nutritionStore.js` (87 lines) — the food diary: TDEE profile + per-date meal log, independent of the workout profile.
- `useUI.js` (203 lines) — ephemeral UI: sheet stack, toast, rest/work countdowns. Never persisted.

Tests sit alongside (`useStore.*.test.jsx`, `useUI*.test.js`).

## Design

**`useStore.js`** — single `create()` with module-level closure state for the sync engine (debounce `pushTm`, in-flight `pushing`/`pulling`, `pushPending`, `forceNext`, `offlineChanges`). The state blob is `S`, defaulted by the exported `DEF` object: every load is `Object.assign(clone(DEF), stored)` so profiles written before a key existed gain the new default (`restSec: 90`, `restPauseSec: 15`, `unit`, `theme`, `workoutView`, `wc`, `effort`, `weekStart`, `wdec`, `gymCards`, `checkIn`, `weighIn`, …). Mutation is one path: `update(mut)` clones `S`, runs the producer, `persist()`s it (stamps `_ts`, writes `gym_state_v1`, schedules a debounced push); `replaceState(S, push)` is the deliberate-overwrite variant that arms `forceNext` (import/reset push without `baseRev`).

`_rev` semantics: the server/Firestore document carries `_rev` (a write counter, stamped by `lib/api.js:146`); the device remembers the last revision it adopted/pushed in `localStorage['gym_sync']` as `{rev, ts}`. Push sends `baseRev` — a mismatch is a 409 carrying the server document, which is merged (`lib/sync-merge.js`) and retried twice. `_ts` (last local change) decides *which copy wins*; `_rev` decides *whether this push is still based on the same document*. Reads/adoptions never re-stamp `_ts` (`persist(S, push, stamp=false)`), or a copied server state would look newer than a real remote edit. In-progress `S.active` is always device-local: pulls carry it forward, the server never receives it.

**`nutritionStore.js`** — `persist()` middleware with `name: 'gym_nutrition_v1'`; `partialize` stores only `{profile, log}` — `targets` is recomputed from `tdee.js` in `merge`, `lastRemoved` (undo slot) resets. `log: { [date]: entry[] }`, entries tagged `cafe|almoco|lanche|jantar` (`MEALS`); `removeEntry` fills `lastRemoved` for one-step `undoRemove`.

**`useUI.js`** — plain `create()`, no persistence. `sheets[]` is a stack of `{id, render, kind, locked}` opened by `openSheet()` which returns `{id, close, lock}`. Rest timer: `startRest(sec, forIdx)` sets `timer {left,total,endsAt,forIdx}` and ticks on `setInterval` + `visibilitychange`; completion beeps/vibrates/only if the countdown ran while visible (`pageHiddenAt` gate), always toasts, fires a SW notification when the tab was hidden, and calls the server `/api/push/rest-timer` (deviceId-scoped) so a suspended tab still gets the alert. `startWork/finishWorkEarly` is the separate in-set timer (no server push); `onDone` receives the elapsed seconds actually held.

## Flow

Boot (`App.jsx` → `boot()`): demo build seeds once and stays guest → `loadConfig()` (`GET /api/config`, gates guest mode) → `GET /api/me` → `pullState()` → `finishBoot()` sets `ready`, flushing any push that arrived during boot (`pushPending`). From then on every mutation: `update` → localStorage → debounced `pushState()` (1500 ms). Pulls are event-driven: `visibilitychange`/`focus`/`pageshow`/`online` plus a 30 s poll call `checkRev()` — a cheap `GET /api/data/rev` that only fetches the document when `rev !== sync.rev` (min 3 s between checks). Offline failures set `gym_dirty=1` + `sync.offline`; the next landed push clears them and toasts. Multi-tab: a `storage` listener on `gym_owner` makes a stale tab drop the profile when another tab signs in; `visibilitychange`/`pagehide` flushes a pending debounce.

## Integration

Persistence is three-tier, resolved inside `lib/api.js` — `GET/PUT /api/data` and `/api/data/rev` answer from Firestore `users/{uid}/state/app` when `VITE_FIREBASE_*` is set and the SDK loads with a signed-in user, else from the HTTP API (`/api/data`, local dev proxied to `api/server.js`, storing `state-<uid>.json`), always with the same `{state, rev}` / `{state, rev: _rev}` shapes. Local truth between writes: `localStorage['gym_state_v1']` (+ `gym_user`, `gym_guest`, `gym_dirty`, `gym_owner`, `gym_sync`). Consumers: every `views/*` and `sheets.jsx` read `S` through a narrow selector (`useStore(s => s.S)` / `useStore(s => s.S.someField)`) and mutate via `update()`; `App.jsx` subscribes field-by-field (`useStore(s => s.S.theme)` etc.) so the shell only re-renders on slices it reads; `useUI` reads `S.sound`/`S.timerFlash` and is lazily imported by `useStore` for toasts (avoids a cycle); `components/SyncBanner.jsx` renders `sync`; `lib/exercises.js registerCustom` runs on every load so `S.customEx` reaches the library index.
