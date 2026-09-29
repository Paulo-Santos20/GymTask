# frontend/src/views/

## Responsibility

One file per screen — the full-page components mounted by the `<Routes>` table in
`frontend/src/App.jsx` (react-router-dom `HashRouter`, so every route lives under `#/…`).
Views own the screen composition and the read/write wiring to Zustand; business logic stays in
`frontend/src/lib/*` (progression, history, superset flow, effort, muscles, coach) and
imperative UI (sheets, toasts, confirmations) in `frontend/src/sheets.jsx`.

Route map (App.jsx:144-168; views not in `TabBar` are reached by in-screen links or deep links):

| View | Route |
|---|---|
| `Login.jsx` | rendered instead of `<Routes>` until `user \|\| isGuest` |
| `Home.jsx` | `/home` (default catch-all target) |
| `CheckIn.jsx` | `/checkin` (route only registered when `S.checkIn !== false`) |
| `Plan.jsx` | `/plan` |
| `RoutineEdit.jsx` | `/plan/r/:id` |
| `Workout.jsx` | `/workout` (TabBar center Start button) |
| `Stats.jsx` | `/stats` |
| `History.jsx` | `/history` |
| `Nutrition.jsx` | `/nutrition` |
| `Library.jsx` | `/library` |
| `Muscles.jsx` | `/muscles` |
| `Settings.jsx` | `/settings` |
| `CoachChat.jsx` | `/coach` (TabBar hidden while on it) |
| `CoachIntake.jsx` | `/coach/intake` |
| `CoachSetup.jsx` | `/coach/setup` (mode picker: server / BYOK / off) |
| — | `/coach/proposal` → redirect `/coach` |

TabBar tabs: home, plan, (start → /workout), stats, library.

## Design

- **One file per screen**, default-exported function component; screens never nest each other —
  they link via `useNavigate` or open `sheets.jsx` flows. Shared markup comes from
  `components/ui.jsx` (`Section`, `Row`, `Button`, `Switch`, `Segmented`, `Stepper`,
  `SelectRow`, `SearchField`, `NumberField`, `Check`) and `Icon`.
- **pt-BR-only product copy**: every visible string goes through `t()` from `lib/i18n.js`
  (source strings are English keys; `locales/pt-BR.js` holds the actual text) and
  `exerciseNameFor()` for exercise names. No locale switching in the views themselves beyond
  `Settings` writing `S.lang`.
- **State**: `store/useStore.js` exposes one big `S` state tree (persisted to Firestore /
  localStorage by `boot()`) plus actions (`update`, `replaceState`, `signOut`, `adoptProfile`);
  `store/useUI.js` holds transient UI (sheets, toasts, rest/work timers); `store/nutritionStore.js`
  is a separate persisted slice (`profile`, `targets`, `log`, `lastRemoved`). Views read with
  selectors (`useStore(s => s.S)`) and mutate only through `update(s => …, true)` (immer draft).
- **Config/confirmation sheets** are *not* defined in views; views call into `sheets.jsx`
  (`startFlow`, `exercisePicker`, `exConfigSheet`, `finishWorkout`, `confirmSheet`,
  `bwSheet`, `menuSheet`, `workoutDetailSheet`, …). Views that need a bespoke sheet open it via
  `useUI.getState().openSheet(...)`.
- **Co-located vitest tests**: `*.test.jsx` files next to each screen (`Workout.*`,
  `Settings.*`, `Stats.*`, `Plan.*`, `RoutineEdit.*`, `CheckIn.*`, `Home.*`, `starter-entry`,
  `week-start`); pure helpers are exported from the view files for them (`moveGymCard`,
  `removeActiveExercise`, `reorderRoutineUnit`, `FATIGUE_LEVELS`).
- **Styling** is class-name CSS (`index.css`, plus `nutrition.css` imported by Nutrition and
  `coach.css` by the two Coach views); views carry inline `style` for layout tweaks only.

## Flow

- **Boot / auth gate (App.jsx)**: `boot()` runs once; until `ready`, a dumbbell splash renders.
  `authed = user || isGuest` — false renders `<Login/>` and no routes at all. Scroll position per
  route, theme/accent/lang/wdec application, wake-lock, and `SyncBanner` all live in `Shell`.
- **Login.jsx**: Firebase e-mail/password (`lib/firebase.js` → `createUserWithEmailAndPassword` /
  `signInWithEmailAndPassword` / `sendPasswordResetEmail`). `AUTH_ERRORS` maps `auth/*` codes to
  i18n keys so no raw English SDK string surfaces (fallback = generic message, `fail()` toasts it).
  `finishSignIn` → `setUser({id: uid, name, email})` → `adoptProfile(askAddDeviceData)` (merge
  device-only data via a sheet) → toast. Three early returns: `DEMO` build (guest only),
  `!firebaseConfigured` (configure-hint + guest), and the normal sign-in/sign-up toggle form.
  Guest mode: `setGuest(true)` when `guestAllowed(config)` — local data, no sync.
- **Home.jsx**: derives today from `effectiveRoutines(S, todayISO())` / `S.dayPlan` overrides;
  week strip (`weekStartOf`, per-day dots plan/ovr/done) with `weekOffset` local state; the
  today-row calls `startFlow(ids)` (weigh-in → session) or resumes `S.active`; quick-tap cards to
  `/checkin` and `/nutrition`; body-weight card (`lastBW`, `bwSheet`, `goalSheet`, `LineChart`)
  and streak card (`streakWeeks`, `calendarSheet`); empty-state onboarding
  (`starterPlanSheet` / `/plan`).
- **Workout.jsx** (largest screen, ~1140 lines): `S.active ? <ActiveWorkout/> : <StartChooser/>`.
  - `StartChooser` — today's routines via `effectiveRoutineIds`, other routines, freestyle
    (`startFlow([])`), all through `sheets.jsx startFlow`.
  - `ActiveWorkout` — reads `S.active = { id, name, entries[], cur, start, d, backfill?, note?,
    workoutView? }`. Entries grouped into superset *units* (`supersetUnits`), navigation by
    `S.active.cur` (Prev/Next buttons, touch swipe with `SWIPE_MIN_DISTANCE`, or "Set current" in
    list mode). Layout: `cards` (one unit), `list` (all units, sticky header, auto-scroll to
    current), `compact` (list minus media/notes/progression, `dense` prop).
  - `ExerciseBlock` renders one entry: `Media` demo, tags, three note layers (plan note, standing
    `exNoteFor`, pinned `pinnedNoteFor`), "last time" recap, bar/plate chip (`barWeightFor`,
    `plateSplit`), progression line (`entry.plan` + `progressionGuidance`), then the set table.
    Columns depend on `modeOf`: reps (weight × reps), time (seconds + play button), cardio
    (duration + speed); optional effort column (`EFFORT` rir/rpe picker, `effortColor`) that ticks
    the set when picked. Warm-up rows phase-separate numbering; unilateral exercises render L/R
    sub-rows (`isPerSide` → `sideRow`/`sideExtras`) whose aggregate stays in sync via
    `lib/workout-model.js`.
  - Drops/clusters are **sub-rows inside the same set row** (`dropsOf`/`clustersOf`, `+ Drop` /
    `+ Burst` chips or the set's number menu) — no new set, no long rest; planned intensifiers are
    pre-seeded by `applyIntensifierPlan`. Editing uses `mutSet` → `update(..., true)`;
    weight edits cascade (`cascadeWeight`).
  - `toggle(idx, i, side)` is the control tower: beep/vibrate, `exJustDone`/`workoutDone`
    detection, `topW` capture, then a progress-high-water gate (`setProgressHighWater`) drives
    rest timers (`restSecFor`, `warmupRestSecFor`, `restAfterSet`), superset stepping
    (`supersetFlowStep`, `nextUnfinishedUnit`) and `workoutCompleteSheet()`.
    `startTimed` uses `useUI.startWork` to log actual hold duration.
  - A 20s heartbeat POSTs `/api/activity` for the admin dashboard (signed-in only).
  - Header: discard (confirm → `s.active = null`), elapsed clock (`Elapsed` isolated so the tree
    doesn't re-render every second), ⋮ menu (rename, add routine, layout), finish
    (`finishWorkout` sheet). Exercise ops: add (`exercisePicker` + `exConfigSheet`), swap, move
    (`moveActiveWorkoutUnit`), remove (`removeActiveExercise` exports the shared splice).
- **Nutrition.jsx**: local state `date` (day nav: `shift(±1)`, future disabled, Today button),
  `adding` (meal key with open add-panel), `query`/`picked`/`grams`, debounced (350 ms) external
  search via `searchExternal` (`onlineState`: idle|loading|done|error, offline = explicit error).
  Reads `useNutritionStore`: `profile`, `targets`, `log`, `totalsFor(date)`, `lastRemoved` →
  rendered calorie summary (kcal vs target, over/remaining) + macro bars (protein/carbs/fat).
  Four `MEALS` sections (café/almoço/lanche/jantar → breakfast/lunch/snack/dinner) each with rows
  and an "Add food" panel: local `searchFoods` first, then online (USDA/OFF/Nutritionix, source
  badge), pick → grams stepper → portion preview → `addEntry(date, …)` (per-100 g scaled).
  Remove shows an undo strip (`removeEntry` / `undoRemove` / `clearRemoved` on date change).
  Bottom **TDEE profile form**: weight/height/age steppers, sex segmented, activity and goal chips
  → `setProfile`, footer shows `targets.bmr` / `targets.tdee` (Mifflin-St Jeor, computed in
  `store/nutritionStore.js`).
- **Stats.jsx**: analytics hub. Tiles (workouts/month/streak/30d weight delta), 12-month
  `Heatmap`, `MuscleBalance` card (Segmented: balance | fatigue | strength → `BodyMap` with
  thresholds `FATIGUE_LEVELS`/`STRENGTH_LEVELS`, window 7/30/90/all, hard-sets toggle, per-muscle
  exercise rows with est. 1RM decay), `EffortCard` (weekly avg line + histogram, gated by
  `hasEffort`), body-weight `LineChart` with range, exercise progress picker (`exHist` derived
  from `S.workouts`, metric segmented top-set / est. 1RM `e1rmSeries` / effort, `repsOnly`
  fallback), recent workouts (`WorkoutRow` → `workoutDetailSheet`).
- **Settings.jsx**: sections — Account (sign-out / sign-out-everywhere / guest / demo),
  AI Coach (row → `/coach/setup` mode picker),
  General (lang, kg↔lb with convert-or-relabel sheet, weight decimals, week start, check-in
  switch), During a workout (weigh-in, workout view cards/list/compact, `WorkoutControlsSheet`
  toggles for steppers/set shortcuts/pair buttons/exercise buttons, rest timers, keep-awake,
  animations size, sounds, RIR/RPE effort + help sheet), Notifications (`PushCard`),
  Equipment (`EquipmentCard` profiles), Appearance (theme/body/accent), Data (starter plan,
  imports FitNotes/Strong/Hevy/Apple Health, JSON export/import, reset — `replaceState(DEF)`),
  Tip + version. Local sub-components in the same file: `WorkoutControlsSheet`, `effortHelpSheet`,
  `PushCard`, `EquipmentCard`.
- **Plan.jsx**: week schedule (routine ids per weekday in `S.week`, day sheets
  `dayAssignSheet`/`dayAddRoutineSheet`, inline ✕) + routines list (`S.routines` order, ↑↓ reorder
  via `moveRoutine`, new → `/plan/r/:id`), Coach CTA gated by `coachAvailable(config, user, …)`.
- **RoutineEdit.jsx**: single-routine editor (`useParams().id`) — exercise rows with
  long-press drag reorder (superset units moved whole via `reorderRoutineUnit`), swipe-to-delete,
  config/progression per exercise (`exConfigSheet`, `POLICIES_FOR`), routine name/glyph, muscle
  `BodyMap` summary.
- **Library.jsx / Muscles.jsx**: searchable, chip-filtered exercise browser (body part,
  equipment honouring `activeProfile`, favourites first, paged 40 at a time) → `exerciseDetailSheet`
  / `addToRoutineSheet` / `customExSheet`; `Muscles` is a thin header over `components/MuscleExplorer.jsx`.
- **History.jsx**: reversed `S.workouts` list of `WorkoutRow` + `logPastWorkoutSheet`.
- **CheckIn.jsx**: membership QR cards (`S.gymCards`), regenerated QR via `QrCanvas`,
  camera/photo import (`importCodeFromImage`), reorder (`moveGymCard`), last-card memory.
- **CoachIntake.jsx / CoachChat.jsx**: intake is a one-question-per-screen wizard (consent first,
  `?edit=1` = profile editor) writing `S.coach.profile`; chat polls `useCoachStatus`, threads
  `S.coach.chat` + live job/pending proposal, applies/undoes via `lib/coach.js`
  (`applyChangeSet`, `applyCreatedPlan`, `revertLast`), history kept in `S.coach.log`.
- **CoachSetup.jsx**: mode picker at `/coach/setup` — server (`coachLocal.mode='server'`) or
  BYOK (provider chips from `HTTP_PROVIDERS`, key in `coach-secrets`, one lazy
  `import('../lib/coach-local.js')` behind a 3-step prepare line; static core imports limited
  to `providers.js` + `categories.js`, pinned by `CoachSetup.test.jsx`) or off.

## Integration

- **Upward**: mounted only by App.jsx's route table; every screen sits inside `ErrorBoundary`
  keyed on the route, under `TabBar` (hidden on `/coach`), with `RestTimer`, `Modals`, `Toast`,
  `TimerFlash` and `SyncBanner` as app-level chrome. Views trigger navigation with `useNavigate`
  and cross-screen flows through `sheets.jsx` (`startFlow` opens weigh-in → builds `S.active` →
  navigates).
- **State stores**: `store/useStore.js` — all views except `Nutrition.jsx` import it;
  key consumers of `S` are Workout (`S.active`, `S.routines`, `S.exWeights`, `S.barWeights`,
  `S.restSec`, `S.workoutView`, `S.wc`), Home/Stats (`S.workouts`, `S.bodyweight`, `S.week`,
  `S.dayPlan`), Plan/RoutineEdit (`S.routines`, `S.week`), Settings (nearly every key + `DEF`
  defaults), Library (`S.favs`/equipment via `lib/equipment.js`), CoachChat (`S.coach`),
  Login (`user`, `config`, `setUser`/`setGuest`). `store/nutritionStore.js` is imported only by
  `Nutrition.jsx`. `store/useUI.js` (sheets/toast/timers) is imported by Workout, Nutrition,
  Settings, Login, CoachChat, CoachIntake, CoachSetup, CheckIn, RoutineEdit.
- **Pure logic**: `lib/` does the heavy lifting — `history.js`/`workout-model.js`/`supersetFlow.js`
  (session structure), `progression.js` (prescriptions), `muscles.js`/`recovery.js`/`effort.js`/
  `onerm.js` (Stats), `foods.js`/`foodApis.js` (Nutrition), `coach.js`/`coach-api.js` (Coach),
  `firebase.js` (auth), `push.js`/`wakelock.js`/`sound.js` (device features, some driven from
  Settings and App Shell).
- **Downward**: views render `components/` (`Icon`, `Media`/`Thumb`, `LineChart`, `Heatmap`,
  `BodyMap`, `QrCanvas`, `CameraScan`, `SwipeToDelete`, `MuscleExplorer`) and open everything
  modal through `sheets.jsx`. Data persistence is entirely in the stores (Firestore `users/{uid}/state/app`
  when configured, else localStorage `gym_state_v1` / `gym_nutrition_v1`); views never touch
  Firebase directly except `Login.jsx`.
- **External**: `Workout` posts `/api/activity` (admin presence); `Nutrition` calls the
  nutrition proxy (`VITE_NUTRITION_PROXY_URL`); `Settings` manages push subscription and
  import/export files; Coach views call Cloud Functions via `lib/coach-api.js`.
