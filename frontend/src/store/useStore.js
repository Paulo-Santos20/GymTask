import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { mergeStates, localExtras, mergeStampedMap, inUnitOf, stampRoutines, stampCustomEx, entryKey, keepReset, mergeResetIds, resetIdsOf } from '../lib/sync-merge.js'
import { convertStateUnit } from '../lib/units.js'
import { saveCoachDevice, coachDeviceSettings } from '../lib/coach-device.js'
import { saveWorkoutEdit, deleteEditedWorkout } from '../lib/session-edit.js'

import { WC_DEFAULT } from '../lib/workout-controls.js'
import { DEFAULT_TEMPLATE_ID } from '../lib/structuralBalanceTemplates.js'

const KEY = 'gym_state_v1'
// Where this device stands with the server: the revision it last adopted or pushed, and its own
// `_ts` at that moment. `rev` goes back to the server as `baseRev` on every push, so a write over
// a document this device never saw is refused (409) instead of dropping another device's work;
// `ts` tells a pull whether anything changed here since. See pushState/pullState.
const SYNC_KEY = 'gym_sync'
const CHECK_MIN_MS = 3000 // rev checks closer together than this are the same event (focus + visibility)
const POLL_MS = 30000 // while the app is open and signed in, ask the server for its revision this often
export const DEF = {
  unit: 'kg',
  restSec: 90,
  restPauseSec: 15,
  sound: true,
  soundOnSilent: false,
  timerFlash: false,
  keepAwake: true,
  lang: 'pt-BR',
  theme: 'dark',
  accent: 'lime',
  body: 'male',
  targetW: null,
  bodyweight: [],
  routines: [],
  week: {},
  dayPlan: {},
  exWeights: {},
  workouts: [],
  active: null,
  customEx: [],
  gifSize: 'full',
  // How the active workout is laid out — 'cards' (one exercise at a time with Prev/Next),
  // 'list' (every exercise stacked and scrollable) or 'compact' (that stack stripped to just
  // names and set rows — no media, tags, notes, last-time or progression line). Purely
  // presentational: profiles written before this setting existed overlay onto DEF and keep the
  // 'cards' behaviour. beginWorkout copies the value onto s.active, so the header ⋮ menu can
  // override it for the running session without touching this saved default.
  workoutView: 'cards',
  // What the line under an exercise holds today's rows against (#173, views/Workout.jsx): 'last'
  // is the last time in that routine, 'best' the best set of the exercise ever logged. Tapping
  // the line switches it. Absent reads as 'last', the line as it always was.
  logRef: 'last',
  // Structural Balance (views/StructuralBalance.jsx): which built-in ratio template is active,
  // and per-role exercise overrides keyed by `${templateId}:${roleId}` — see
  // lib/structuralBalance.js's overrideKey(). An override (`{ id, _ts }`, `id: null` once
  // cleared) replaces that role's curated exercise-id whitelist with a single user-chosen
  // exercise id; the stamp is what lets a sync keep the choice made last (lib/sync-merge.js).
  balanceTemplate: DEFAULT_TEMPLATE_ID,
  balanceOverrides: {},
  // Which controls the workout screen shows besides the sets themselves. The default is the
  // lean layout: one "more" button per exercise and a menu on each set number. Every switch
  // brings one of the old always-visible button groups back (Settings → During a workout).
  wc: { ...WC_DEFAULT },
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null },
  effort: null,
  autoBackup: false,
  // Equipment profiles (issue: filter Library/picker/routines by what you actually own —
  // e.g. "Home" vs "Gym" — building on the session-only equipment filter from issue #6).
  equipProfiles: [],
  activeEquipId: null,
  equipFilterOn: false,
  // Standing per-exercise notes, keyed by exercise id: the gym-specific facts that are true
  // every time you do the movement ("seat 4, pin 7"). Distinct from a routine's `note`, which
  // belongs to one exercise in one plan, and from a session note, which belongs to one day.
  exNotes: {},
  // Favourite exercise ids (issue #6) — sorted to the top of the picker/Library. Personal, so
  // it syncs with the profile but is never part of a shared plan bundle (lib/favourites.js).
  favEx: [],
  // First day of the week as a getDay() index — 1 Monday, 0 Sunday. Monday is the default so
  // every profile written before this setting existed keeps the week it has been looking at.
  // See lib/format.js: nothing reads this field directly, everything goes through the helpers.
  weekStart: 1,
  // Decimals on displayed weights: 1 by default, 2 for anyone loading quarter plates or
  // microplates (issue #139). Display only — nothing is stored or rounded differently.
  wdec: 1,
  // Per-exercise bar weight overrides, keyed by exercise id, in the profile unit (see
  // lib/bar.js). Personal equipment, so it syncs with the account but never travels in a
  // shared plan. Logged weights stay the total — this only feeds the plate math.
  barWeights: {},
  // Plate inventory, per unit: { lb: { 45: 1, 35: 1, ..., _ts }, kg: { ... } } - pairs of each
  // size you own (lib/plates.js), stamped with when the list was last changed so a sync keeps
  // the later one (lib/sync-merge.js). Kept per unit: a 45 lb plate is not a 20.4 kg one, so a
  // unit switch shows the other unit's inventory. Absent for a unit, or a list with no sizes =
  // the standard set, plenty of each. Display only, like barWeights.
  plates: {},
  // How an exercise is plate-loaded when the equipment does not say, keyed by exercise id:
  // { kind: 'pairs' | 'single' | 'none' | null, _ts } (lib/plates.js loadKindFor). A plate-loaded
  // leg press is 'single'; a barbell you never load plates on is 'none'. Absent or null = derived
  // from the equipment. Stamped like the plate list, for the same reason.
  loadKind: {},
  // Gym check-in cards (see views/CheckIn.jsx). Each is a membership
  // code shown as a QR/barcode at the gym's turnstile — added by typing it, importing a photo
  // of the card, or scanning it. We only ever keep the code's VALUE, never a photo: the image
  // is regenerated from `value` every time it's shown (lib/qr.js). `fmt` is the barcode symbology
  // ('qrcode' | 'ean13' | 'code128' | … — lower-cased BarcodeFormat) so it renders as the same
  // kind of code the gym issued. Just data, so it syncs and backs up like everything else.
  //   [{ id, label, value, fmt }]
  gymCards: [],
  // The card the check-in screen last settled on, so it reopens where you left it (handy when
  // you have more than one gym). Holds a gymCards id, or null before any card exists / is chosen;
  // a stale id (card since removed) is simply ignored by the view.
  lastGymCardId: null,
  // Whether the check-in feature is on at all (Settings toggle). Off hides the Home
  // card and the /checkin route; the saved gymCards stay so turning it back on restores them.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  checkIn: true,
  // Whether Start opens the quick weigh-in first (sheets.jsx startFlow, issue #137). Off starts
  // the session straight away; weight can still be logged from Home/Stats. Defaults on; an
  // older profile without the key reads as on (`!== false`).
  weighIn: true,
  // Per-muscle weekly set landmarks the user has edited: `{ [slug]: { mev, mav } }`, or null
  // (the default, and what every profile written before this key exists loads as through the
  // DEF overlay in loadState) meaning "show the built-in presets" — lib/muscles.js
  // SET_LANDMARKS via landmarksFor(slug, S.muscleTargets). null rather than {} so "never
  // touched" and "reset to defaults" are the same value: a full reset writes null back and
  // the presets follow any future change to the table. Personal programming preference, so it
  // syncs with the profile like barWeights/exNotes do.
  muscleTargets: null,
}
const clone = o => JSON.parse(JSON.stringify(o))

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) {
    /* ignore */
  }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

// Decide whether a pulled account state may replace the local saved state. A local active workout
// is deliberately carried forward: the server stores completed/saved state, while the in-progress
// session belongs to the device that is currently running it.
export function restoredStateFor(local, remote, dirty = false) {
  if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
  const next = Object.assign(clone(DEF), remote)
  if (local.active) next.active = local.active
  return next
}

export const useStore = create((set, get) => {
  let pushTm = null
  let toldTooLarge = false
  let pushing = null // the PUT in flight, so a second push waits for it instead of racing it
  let pushAgain = false // a push asked for while one was in flight — run once more after it
  let pulling = null // the GET in flight, so two resume signals make one request
  let pushPending = false // a change made before boot's pull — pushed once boot is through
  let forceNext = false // the next push replaces the server copy outright (import, reset)
  let lastCheck = 0
  let pollTm = null
  let offlineChanges = false // a push failed for lack of network — the next one that lands says so

  const readSync = () => {
    try {
      return JSON.parse(localStorage.getItem(SYNC_KEY)) || null
    } catch {
      return null
    }
  }
  const writeSync = (rev, ts) => localStorage.setItem(SYNC_KEY, JSON.stringify({ rev, ts: ts || 0 }))
  // A change the server has not seen: owed by a failed push, made during boot, or simply newer
  // than the marker's timestamp. Read by importConflict to count this device's own unsent work.
  const owes = () =>
    localStorage.getItem('gym_dirty') === '1' ||
    pushPending ||
    pushTm !== null ||
    !!pushing ||
    (get().S._ts || 0) > (readSync()?.ts || 0)
  // What the banner shows a signed-in user: `offline` when the server could not be reached at
  // all, `pending` while a change is still owed to it (either way, or a push the server refused).
  const setSync = patch => {
    const cur = get().sync
    const next = { ...cur, ...patch }
    if (next.offline !== cur.offline || next.pending !== cur.pending || next.lastSynced !== cur.lastSynced)
      set({ sync: next })
  }
  const isNetworkError = e => e && e.status == null // fetch itself failed: no response at all

  // `_ts` is when this device last changed the data — it decides which copy wins on the next
  // pull (restoredStateFor). A copy merely adopted from the server or the file mirror keeps the
  // stamp it came with: re-stamping a read would make an unchanged copy look newer than a real
  // change made on another device, and push it over that change.
  const persist = (S, push = true, stamp = true) => {
    if (stamp) S._ts = Date.now()
    registerCustom(S.customEx)
    localStorage.setItem(KEY, JSON.stringify(S))
    set({ S })
    if (push && get().user) {
      // Before boot has pulled, the copy in hand may be older than the server's: a push now
      // would carry it with a stale (or no) baseRev. It waits for finishBoot.
      if (!get().ready) {
        pushPending = true
        return
      }
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
  }
  // Boot's last step: from here on changes push, and one made during boot goes now.
  const finishBoot = (extra = {}) => {
    set({ ready: true, ...extra })
    if (pushPending && get().user) {
      clearTimeout(pushTm)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
    pushPending = false
  }

  // A signed-in device shows what the server has. Coming back — to the tab, the window, the app,
  // the network — and every half minute while open, it asks the server for its revision (one
  // small GET) and fetches the document only when the number moved; a change still owed to the
  // server is pushed on the same occasion. A phone that sat in a pocket all afternoon and a
  // desktop tab left open all week used to show, and then push, whatever they last had.
  const checkRev = async (force = false) => {
    if (!get().user || !get().ready || document.visibilityState === 'hidden') return
    if (!force && Date.now() - lastCheck < CHECK_MIN_MS) return
    lastCheck = Date.now()
    if (pulling) return pulling
    const sync = readSync()
    const owed = localStorage.getItem('gym_dirty') === '1' || pushTm !== null || pushPending
    if (!sync || owed) return get().pullState()
    try {
      const { rev } = await api('/api/data/rev')
      setSync({ offline: false })
      if (rev !== sync.rev) return get().pullState()
    } catch (e) {
      if (e.status === 401) return
      if (isNetworkError(e)) setSync({ offline: true })
      else return get().pullState() // a server that lacks the route (older API) — the full pull knows the old protocol
    }
  }
  const schedulePoll = () => {
    clearTimeout(pollTm)
    pollTm = setTimeout(() => {
      checkRev()
      schedulePoll()
    }, POLL_MS)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkRev()
  })
  window.addEventListener('focus', () => checkRev())
  window.addEventListener('pageshow', e => {
    if (e.persisted) checkRev()
  })
  window.addEventListener('online', () => checkRev(true)) // also retries a push that failed offline
  schedulePoll()

  // Both copies changed: keep both sides' entries, let the newer copy decide the rest
  // (lib/sync-merge.js), and remember the server's revision so the push that follows is
  // conditional on exactly the document that was merged. The merged copy is stamped — it is a
  // real change this device now holds — while `ts` in the marker stays old, so a pull that
  // happens before the push lands still sees it as unsent.
  // The workout running on this device, carried from its copy into the one replacing it — in
  // that copy's unit: a merge or a pull can bring the other device's switch to lb along, and a
  // session left in kg would then log kg numbers under an lb label. A switch that only changed
  // the label (`unitSet.convert === false`) relabels the session as it relabels the history.
  const carryActive = (from, to) => {
    const a = from?.active || null
    const fu = from?.unit || 'kg'
    const tu = to?.unit || 'kg'
    return !a || fu === tu ? a : inUnitOf({ unit: fu, active: a }, to).active
  }
  const mergeInto = (local, remote, rev) => {
    const merged = Object.assign(clone(DEF), mergeStates(local, remote))
    merged.active = carryActive(local, merged)
    persist(merged, false)
    writeSync(rev, readSync()?.ts || 0)
  }
  // Take the server's copy as this device's own, timestamp and all (see persist).
  const adopt = (next, rev) => {
    next.active = carryActive(get().S, next)
    persist(next, false, false)
    writeSync(rev, next._ts)
  }

  /* Live sync (RF3): one Firestore listener on this account's document (lib/firebase.js
   * observeUserState), so a write on another device lands here without waiting for the 30 s
   * rev poll. Each snapshot is settled by the same rules as a pull — mergeStates decides the
   * conflict, the marker records the document's revision — but through the ordinary 1.5 s
   * debounce (persist) instead of a round trip. Two guards keep a write from looping back:
   * a snapshot carrying the revision we already hold is our own echo, and a snapshot whose
   * document this device already holds verbatim (Firestore's local latency compensation fires
   * the echo before the write promise resolves, so the marker still has the old revision)
   * merges to itself and is dropped before anything is armed.
   *
   * The listener lives from setUser to setUser: sign-in subscribes, sign-out and a profile
   * switch tear it down, and without VITE_FIREBASE_* nothing is ever loaded — the pull/push
   * cycle above runs exactly as it always did (the HTTP /api/data fallback is untouched). */
  let watchUid = null // the profile a listener is (or is being) attached to — also the claim
  let watchOff = null // its unsubscribe, once attached
  const unwatch = () => {
    if (watchOff) watchOff()
    watchOff = null
    watchUid = null
  }
  const settleSnapshot = state => {
    if (!get().user || !get().ready || !state) return
    const sync = readSync()
    if (!sync) return // before the first pull the marker does not exist — that pull settles it
    const rev = Number(state._rev) || 0
    if (rev === sync.rev) return // the echo of what this device last wrote
    const S = get().S
    const remote = Object.assign(clone(DEF), state, { active: S.active || null })
    const merged = Object.assign(clone(DEF), mergeStates(S, remote))
    merged.active = carryActive(S, merged)
    if (JSON.stringify(merged) === JSON.stringify(S)) return // our own write, seen before its ack
    persist(merged, true) // merged copy is this device's now; the write rides the 1.5 s debounce
    writeSync(rev, sync.ts || 0) // the push that follows is conditional on exactly the merged doc
  }
  const watchUser = async () => {
    const uid = get().user ? get().user.id : null
    if (watchUid === uid) return // already settled for this profile (watching one, or none)
    unwatch()
    if (!uid) return
    // Same env gate as lib/api.js stateBackend: an instance with no VITE_FIREBASE_* never pays
    // for the firebase chunk. firebase.js re-checks the keys authoritatively.
    if (!import.meta.env?.VITE_FIREBASE_API_KEY || !import.meta.env?.VITE_FIREBASE_PROJECT_ID) return
    watchUid = uid
    try {
      const fb = await import('../lib/firebase.js')
      if (watchUid !== uid || get().user?.id !== uid) return // signed out or switched while loading
      if (!fb.firebaseConfigured) {
        watchUid = null
        return
      }
      watchOff = fb.observeUserState(uid, settleSnapshot) || null
    } catch {
      watchUid = null
    }
  }

  const doPush = async (attempt = 0) => {
    const S = get().S
    const sync = readSync()
    const force = forceNext
    const body = { state: S }
    if (!force && sync) body.baseRev = sync.rev
    try {
      const r = await api('/api/data', { method: 'PUT', body: JSON.stringify(body) })
      if (force) forceNext = false
      // A server from before revisions answers without one — then there is nothing to hold the
      // next push to, and the marker must not pretend otherwise.
      if (r.rev == null) localStorage.removeItem(SYNC_KEY)
      else writeSync(r.rev, S._ts)
      localStorage.removeItem('gym_dirty')
      toldTooLarge = false
      // Back from offline with changes that were waiting: say so once — the banner that promised
      // "syncs when you're back online" has just kept its word.
      setSync({ offline: false, pending: false, lastSynced: Date.now() })
      if (offlineChanges) {
        offlineChanges = false
        import('./useUI.js')
          .then(({ useUI }) => useUI.getState().toast(t('Back online — synced with the server.')))
          .catch(() => {})
      }
    } catch (e) {
      // A session that is gone is boot's business (/api/me); the copy stays owed to the server.
      if (e.status === 401) {
        localStorage.setItem('gym_dirty', '1')
        return
      }
      if (isNetworkError(e)) {
        localStorage.setItem('gym_dirty', '1')
        offlineChanges = true
        setSync({ offline: true, pending: true })
        return
      }
      if (e.status === 409 && e.data && attempt < 2) {
        // Another device wrote since this one last read. The server sent its document along;
        // merge and push once more against that revision. A second refusal in a row leaves the
        // copy dirty and the next resume pull takes it from there.
        mergeInto(get().S, e.data.state, e.data.rev || 0)
        return doPush(attempt + 1)
      }
      localStorage.setItem('gym_dirty', '1')
      setSync({ offline: false, pending: true })
      // A 413 comes from the proxy in front of the API (nginx: client_max_body_size), which
      // caps the request body. Every later push is at least as big, so nothing reaches the
      // server until the limit is raised — said once per refusal streak; gym_dirty keeps the
      // retries going. useUI imports this store, hence the lazy import.
      if (e.status === 413 && !toldTooLarge) {
        toldTooLarge = true
        import('./useUI.js')
          .then(({ useUI }) =>
            useUI
              .getState()
              .toast(
                t('Sync failed: the server refused the upload as too large. Your changes have not reached the server.'),
              ),
          )
          .catch(() => {})
      }
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it).
  const flush = () => {
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush) // Safari kills the home-screen app without a visibilitychange at times

  // The owner check in setUser only runs in the tab that signs in. Another tab of the same
  // browser still holding the previous profile would keep writing that profile's data over the
  // shared copy and push it under the new session's cookie — so it drops the profile, and
  // whoever signs in there passes the same check. The owner key is written last on both a
  // sign-in and a sign-out, so on a new owner the copy in storage is already the wiped one; with
  // no owner (a sign-out) this tab falls back to defaults rather than read the key at all — the
  // previous profile's data must not stay here whichever key's event lands first.
  window.addEventListener('storage', e => {
    if (e.key !== 'gym_owner') return
    const user = get().user
    if (!user || e.newValue === user.id) return
    clearTimeout(pushTm)
    pushTm = null
    unwatch() // this tab just lost the profile the listener was on
    set({ user: null, S: e.newValue ? loadState() : clone(DEF) })
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered. The owner
  // goes last, after the wiped copy is written — the storage listener above relies on the order.
  const clearLocalSession = () => {
    get().setUser(null)
    localStorage.removeItem('gym_guest')
    localStorage.removeItem('gym_dirty')
    localStorage.removeItem(SYNC_KEY)
    localStorage.removeItem(KEY)
    persist(clone(DEF), false)
    localStorage.removeItem('gym_owner')
  }

  return {
    S: (() => {
      const s = loadState()
      registerCustom(s.customEx)
      return s
    })(),
    user: (() => {
      try {
        return JSON.parse(localStorage.getItem('gym_user')) || null
      } catch {
        return null
      }
    })(),
    ready: false,
    // Server sync as the banner sees it (components/SyncBanner.jsx). Only meaningful signed in.
    sync: { offline: false, pending: localStorage.getItem('gym_dirty') === '1', lastSynced: 0 },
    /* Instance capabilities from GET /api/config. `config.coach` is present only when the owner
       has both enabled the Coach and connected a provider — every Coach entry point in the app
       hangs off it via coachAvailable(), so an unconfigured instance renders exactly what it
       always did, and a configured one is the only place any of it appears. */
    config: null,
    // How the Coach runs on this device — { mode: 'off'|'server'|'byok',
    // provider, model, baseUrl } from lib/coach-device.js. Never the key, never a proposal.
    coachLocal: null,
    async setCoachLocal(patch) {
      set({ coachLocal: coachDeviceSettings(await saveCoachDevice(patch)) })
    },

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    // Mutate a draft of S via producer fn, then persist + schedule sync. Every routine the change
    // touched carries the time of it, for a conflict to keep the version edited last.
    update(mut, push = true) {
      const prev = get().S
      const S = clone(prev)
      mut(S)
      stampRoutines(prev.routines, S.routines)
      stampCustomEx(prev.customEx, S.customEx)
      persist(S, push)
    },
    // A replace that is meant to reach the server (backup import, reset) is a deliberate
    // overwrite, not a change to merge: the push it arms goes without a baseRev. It never takes
    // the reset stamp back (keepReset).
    replaceState(S, push = false) {
      if (push) forceNext = true
      persist(keepReset(get().S, clone(S)), push)
    },
    // Before a backup replaces this copy (Settings — Import): the workouts the server holds that
    // the backup does not — logged since it was made, or on another device meanwhile. The import
    // is a deliberate replace and deletes them from the profile; the confirm says so and offers
    // to merge them in instead (importBackup). null when there are none, when nobody is signed
    // in, or when the server cannot be asked — the replace then goes as it always has.
    async importConflict(backup) {
      if (!get().user) return null
      let res
      try {
        res = await api('/api/data')
      } catch {
        return null
      }
      const state = res?.state
      if (!state) return null
      const key = w => entryKey('workouts', w)
      const inBackup = new Set((Array.isArray(backup?.workouts) ? backup.workouts : []).filter(Boolean).map(key))
      const server = (Array.isArray(state.workouts) ? state.workouts : []).filter(Boolean)
      const onServer = new Set(server.map(key))
      const workouts = server.filter(w => !inBackup.has(key(w))).length
      // This device's own workouts the server has not received yet go the same way, and count too.
      const mine = owes()
        ? (get().S.workouts || []).filter(w => w && !inBackup.has(key(w)) && !onServer.has(key(w))).length
        : 0
      return workouts + mine
        ? { workouts: workouts + mine, state, rev: res.rev, local: mine > 0 || owes() }
        : null
    },
    // A backup in place of this copy. With `mergeWith` — importConflict's answer — the server's
    // copy is merged in instead of replaced (with this device's changes not yet on it, when there
    // are any): the backup's settings and plan, every entry of all of them (mergeStates with the
    // backup preferred, in the backup's unit), pushed against that revision like any other change,
    // so a workout logged meanwhile elsewhere, or here, is not lost either.
    importBackup(backup, { mergeWith } = {}) {
      const next = Object.assign(clone(DEF), backup)
      if (!mergeWith?.state || !get().user) {
        get().replaceState(next, !!get().user)
        return
      }
      const others = mergeWith.local ? mergeStates(get().S, mergeWith.state) : mergeWith.state
      const merged = keepReset(get().S, Object.assign(clone(DEF), mergeStates(next, others, { prefer: 'a' })))
      merged.active = next.active || null
      persist(merged, true)
      if (mergeWith.rev != null) writeSync(mergeWith.rev, 0)
    },

    // An edit of a saved workout (lib/session-edit.js) is saved or dropped like any other change:
    // the store's own sync takes it to the server, and a conflict on the way is settled by
    // mergeStates like one between two devices. A save that cannot happen throws before anything
    // is written, and the editor stays open with the edits.
    saveHistoryEdit() {
      let saved = null
      get().update(S => {
        saved = saveWorkoutEdit(S)
      })
      return saved
    },
    discardHistoryEdit() {
      get().update(S => {
        S.active = null
      })
    },
    // An edit that took out every set deletes the workout rather than saving it empty.
    deleteHistoryEdit() {
      let removed = false
      get().update(S => {
        removed = deleteEditedWorkout(S)
      })
      return removed
    },
    // Settings — unit. `convert` walks every stored weight into the new unit (lib/units.js); off,
    // only the label changes. Either way the choice is stamped (`unitSet`), so a merge with a
    // copy still in the old unit brings that copy over rather than mixing the two
    // (lib/sync-merge.js), and a conversion goes to the server at once, as an ordinary
    // conditional push: another device still logging in the old unit meets it on its very next
    // push, and a copy it pushed first is converted before it is merged in.
    setUnit(to, { convert = true } = {}) {
      const S0 = get().S
      if ((S0.unit || 'kg') === to) return null
      const S = clone(convert ? convertStateUnit(S0, to) : { ...S0, unit: to })
      S.unitSet = { at: Date.now(), convert }
      persist(S, true)
      return convert && get().ready ? get().pushState() : null
    },
    // Settings — Reset everything: the empty copy, stamped with when (`resetAt`). Pushed as a
    // replace, and the stamp is what makes it hold: a device that has not seen the reset and
    // still pushes a change of its own gets the 409, and its merge keeps only what that device
    // made after the reset instead of bringing the whole profile back (lib/sync-merge.js).
    //
    // With it goes `resetIds`, the names of every entry the reset wiped: this copy's, the earlier
    // resets' (a copy older than those too is still judged right), and the server's once it
    // answers — it may hold entries this device never pulled. A device that has not seen the
    // reset loses exactly those, and keeps whatever else it holds, whatever its dates say.
    // Resolves once the server's names are in (or could not be had).
    resetEverything() {
      const cur = get().S
      const S = clone(DEF)
      S.resetAt = Math.max(Date.now(), (Number(cur.resetAt) || 0) + 1)
      S.resetIds = mergeResetIds(cur.resetIds, resetIdsOf(cur))
      get().replaceState(S, !!get().user)
      if (!get().user) return Promise.resolve()
      return api('/api/data')
        .then(res => {
          const now = get().S
          if (!res?.state || now.resetAt !== S.resetAt) return
          const ids = mergeResetIds(now.resetIds, mergeResetIds(res.state.resetIds, resetIdsOf(res.state)))
          if (JSON.stringify(ids) === JSON.stringify(now.resetIds)) return
          persist(Object.assign(clone(now), { resetIds: ids }), true)
        })
        .catch(() => {})
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) {
      if (v) localStorage.setItem('gym_guest', '1')
      else localStorage.removeItem('gym_guest')
      set({})
    },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    config: null,
    async loadConfig() {
      if (get().config) return get().config
      return get().refreshConfig()
    },
    // Always asks. The cached copy is right for one boot, but an admin can switch the Coach on
    // while a paired phone sits on the setup screen — that screen wants today's answer.
    async refreshConfig() {
      try {
        const c = await api('/api/config')
        set({ config: c })
        return c
      } catch {
        return null
      }
    },

    setUser(u) {
      if (u) {
        // The local copy belongs to whoever last signed in here. When a session expires or is
        // revoked elsewhere, boot() only drops the user and the data stays; a different profile
        // signing in next must not inherit it (pullState would push it into that account, and
        // carry the in-progress workout along). A proper sign-out clears the owner, so a guest's
        // data still moves into a freshly created profile.
        const owner = localStorage.getItem('gym_owner')
        if (owner && owner !== u.id) {
          localStorage.removeItem('gym_dirty')
          localStorage.removeItem(SYNC_KEY)
          localStorage.removeItem(KEY)
          persist(clone(DEF), false)
        }
        localStorage.setItem('gym_owner', u.id)
        localStorage.setItem('gym_user', JSON.stringify(u))
        localStorage.removeItem('gym_guest')
      } else localStorage.removeItem('gym_user')
      set({ user: u })
      return watchUser() // live sync: subscribe on sign-in, tear down on sign-out/switch
    },

    // One PUT at a time: a push asked for while one is in flight runs after it (once, however
    // many asked), and the promise returned covers that follow-up too, so a caller that awaits
    // before signing out knows the last change is on the server.
    async pushState() {
      if (!get().user) return
      clearTimeout(pushTm)
      pushTm = null
      if (pushing) {
        pushAgain = true
        return pushing.then(() => pushing)
      }
      pushing = doPush().finally(() => {
        pushing = null
        if (pushAgain) {
          pushAgain = false
          get().pushState()
        }
      })
      return pushing
    },
    // Ask the server for its copy and settle the difference. Coalesced, and a push still waiting
    // in the debounce goes first — the server's answer is then the one that already includes it,
    // and the push itself is what catches a conflict.
    async pullState() {
      if (pulling) return pulling
      pulling = (async () => {
        try {
          if (pushTm) {
            clearTimeout(pushTm)
            pushTm = null
            await get().pushState()
          } else if (pushing) await pushing
          const res = await api('/api/data')
          lastCheck = Date.now()
          setSync({ offline: false })
          const { state, rev } = res
          const S = get().S
          // Owed to the server: a push that failed, or a change made while boot was still pulling.
          const dirty = localStorage.getItem('gym_dirty') === '1' || pushPending
          const sync = readSync()
          // A server from before revisions: the old rule, newer `_ts` wins outright.
          if (rev == null) {
            localStorage.removeItem(SYNC_KEY)
            const restored = restoredStateFor(S, state, dirty)
            if (restored) {
              restored.active = carryActive(S, restored)
              persist(restored, false, false)
            }
            else if (hasData(S)) await get().pushState()
            return
          }
          // No marker yet — first pull on this device, or a client that just learned about
          // revisions. The newer copy wins as before, except that a copy still owed to the
          // server (dirty) is merged instead of pushed over whatever is there.
          if (!sync) {
            if (dirty && state) {
              mergeInto(S, state, rev)
              pushPending = false
              await get().pushState()
              return
            }
            const restored = restoredStateFor(S, state, false)
            if (restored) adopt(restored, rev)
            else if (hasData(S)) {
              writeSync(rev, 0)
              await get().pushState()
            } else writeSync(rev, state?._ts || 0)
            return
          }
          const serverMoved = rev !== sync.rev
          const localChanged = dirty || (S._ts || 0) > (sync.ts || 0)
          if (!serverMoved) {
            if (localChanged) await get().pushState()
            return
          }
          if (!state) {
            writeSync(rev, 0)
            if (hasData(S)) await get().pushState()
            return
          }
          if (!localChanged) {
            adopt(Object.assign(clone(DEF), state, { active: S.active || null }), rev)
            return
          }
          mergeInto(S, state, rev)
          pushPending = false
          await get().pushState()
        } catch (e) {
          if (isNetworkError(e)) setSync({ offline: true }) /* keep local; the poll retries */
        } finally {
          pulling = null
        }
      })()
      return pulling
    },

    // Sign-in (and pairing a phone) takes the server's profile as this device's copy — the
    // profile is the truth for a signed-in user, whatever the timestamps say. The only thing
    // the device may add are the entries it logged while signed out: `ask(extras)` (a dialog,
    // supplied by the caller) decides whether those workouts, weigh-ins and custom exercises
    // are added to the profile or dropped. A profile with no state yet simply takes the
    // device's data, as creating a profile always did.
    async adoptProfile(ask) {
      if (pulling) await pulling
      const res = await api('/api/data') // a failure here is the caller's toast: sign-in needed the server anyway
      const { state, rev } = res
      const S = get().S
      setSync({ offline: false })
      if (!state) {
        localStorage.removeItem('gym_dirty')
        if (hasData(S)) {
          if (rev != null) writeSync(rev, 0)
          forceNext = true
          await get().pushState()
        } else if (rev != null) writeSync(rev, 0)
        return { adopted: false, added: false }
      }
      const extras = localExtras(S, state)
      const keep =
        (extras.workouts || extras.bodyweight || extras.customEx) && typeof ask === 'function'
          ? await ask(extras)
          : false
      const serverCopy = Object.assign(clone(DEF), state, { active: S.active || null })
      // The stamped settings maps (plate loading, bar choices, Structural Balance overrides)
      // keep the entry set last on either side: a choice this device made before signing in must
      // not be handed back to the server's older one, the same rule mergeStates applies on every
      // other sync path (lib/sync-merge.js mergeStampedMap).
      for (const f of ['balanceOverrides', 'loadKind', 'plates']) {
        const merged = mergeStampedMap(S[f], serverCopy[f])
        if (Object.keys(merged).length) serverCopy[f] = merged
      }
      if (keep) {
        const merged = Object.assign(clone(DEF), mergeStates(state, S, { prefer: 'a' }))
        merged.active = carryActive(S, merged)
        persist(merged, false)
        if (rev != null) writeSync(rev, 0)
        else localStorage.removeItem(SYNC_KEY)
        await get().pushState()
        return { adopted: true, added: true }
      }
      localStorage.removeItem('gym_dirty')
      if (rev != null) adopt(serverCopy, rev)
      else {
        localStorage.removeItem(SYNC_KEY)
        persist(serverCopy, false, false)
      }
      setSync({ pending: false })
      return { adopted: true, added: false }
    },

    async signOut() {
      try {
        await get().pushState()
        await api('/api/logout', { method: 'POST', body: '{}' })
      } catch (e) {
        /* */
      }
      clearLocalSession()
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. Unlike signOut the request is NOT swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    async signOutAll() {
      await get().pushState() // never throws — stores gym_dirty and moves on when offline
      await api('/api/logout/all', { method: 'POST', body: '{}' })
      clearLocalSession()
    },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        finishBoot()
        return
      }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!guestAllowed(cfg)) get().setGuest(false)
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => {
            s.reminder = { ...s.reminder, tz }
          })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
        // Started without a network (a home-screen app reopened in the gym's basement): keep the
        // signed-in copy and say so from the first screen, not only after the first failed push.
        else if (isNetworkError(e) && get().user) setSync({ offline: true })
      }
      finishBoot()
    },
  }
})

export { hasData }
