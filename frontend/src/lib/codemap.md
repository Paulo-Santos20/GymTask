# frontend/src/lib/

## Responsibility

Domain layer: 69 plain `.js` modules + 3 JSON data files with every rule the UI only displays —
training logic, nutrition, exercise catalogue, coach state, persistence, import/export. No React
(three exceptions), no store writes: pure functions of state `S` committed by views/`src/store/*`.

- **Prescription — `progression.js`:** `POLICIES = ['off','linear','greyskull','double','time']`
  (linear / Greyskull LP / double-progression over a rep range / time-based), deload
  (`DELOAD_AFTER`, `DELOAD_FACTOR`, `selectDeloadCandidate`); `nextPrescription(S, cfg, routine)`
  derives targets from history alone (finished workouts never written back), `applyPrescription`
  patches rows → `Workout.jsx` (`progressionGuidance`), `RoutineEdit.jsx` (`POLICIES_FOR`).
- **1RM — `onerm.js`:** `FORMULAS` (epley default, brzycki, lombardi…), `REP_CAP = 12` (above it
  an estimate is refused as work-capacity noise), `estimate1RM`, `bestSetOf`, `e1rmSeries`,
  `best1RM`, `is1RMRecord` → `Stats.jsx`.
- **Session read-back — `history.js`** (largest helper): modes (`modeOf` reps/time/cardio),
  `bodyweight`/`side` flags, effort (`EFFORT`, `stepEffort`), `buildSets` (warm-ups capped at
  `MAX_PLANNED_WARMUPS = 5`, seeded from `bestWeightFor`, `pairAdjacent`, `applyIntensifierPlan`),
  counters (`setsDoneActive`, `setUnitsTotal`, `supersetUnits`), routine resolution
  (`effectiveRoutines`, `nextTrainingDay`), notes, `streakWeeks` → `Workout`, `Home`, `Stats`,
  `sheets`, `TabBar`, `RoutineEdit`, `Library`, `Settings`, `CoachChat`.
- **Set rows — `workout-model.js`:** discriminators `phaseForSet` (`work`/`warmup`), `setType`
  (`straight`/`dropset`/`restpause` via `isDropSet`/`isRestPauseSet`, `dropsOf`/`clustersOf`),
  `modeForSet`, per-side rows (`makeSideSet`, `sides:{L,R}` + `syncSideAggregate`) → `Workout`,
  `Stats`.
- **Superset/rest — `supersetFlow.js`:** `supersetFlowStep`, `nextUnfinishedUnit`,
  `restAfterSet`/`restOnRecheck`, `restSecFor`, `warmupRestSecFor` → `Workout.jsx`.
- **Session lifecycle:** `session-start.buildSessionEntries`, `session-merge`, `backfill`,
  `finish-workout.buildCompletedWorkout`, `workout-date` (move a logged session to another
  date/time: re-files history in date order, keeps session length, re-derives PR badges),
  plus `active-workout-order`, `active-exercise-swap`,
  `workout-controls`, `rep-range`, `effort` (RIR summary/histogram), `bar` (`plateSplit`),
  `plates` (plate/stack weights loaded from `S.plates`), `starter`, `plan-share`
  (`buildPlanBundle`/`parsePlan`) → mostly `sheets.jsx`.
- **Recovery/tonnage — `recovery.js`:** per-muscle `sessionTonnages` (kg; `BODYWEIGHT_REF_LOAD`,
  `CARDIO_TONNAGE_PER_MIN`), `fatigueOf` (36 h half-life, `FATIGUE_STATES`), `strengthOf` (14 d
  full / 28 d half-life, `STRENGTH_FLOOR`), `fatiguedMuscles`/`detrainedMuscles`; plus
  `recovery-view.fatigueStateOf`, `strength-exercises.*`, `exercise-history` → `Stats.jsx`.
- **Muscle balance — `muscles.js`:** `MUSCLES` atlas, `musclesOf`, `loadOf` (secondary counts
  `SECONDARY = 0.4`), `loadOfWorkouts`, `muscleBalanceWindow`, `levelsOf`/`rankOf` → `Stats`,
  `BodyMap`, `MuscleExplorer`, `RoutineEdit`.
- **Exercise DB:** `exercises-data.js` `EXDB`, 1324 built-ins → `exercises.js` (`CATALOGUE`,
  `EXIDX`, `searchExercises`/`matchExercise`, `registerCustom`, `imgSrc`/`gifSrc`,
  `isBodyweightEq`/`isAssisted`/`betterWeight`), muscle metadata batches
  (`exercise-muscle-batch-1/2`, olympic `.json`), plus `equipment`/`favourites`/`glyphs`/`body-paths`.
- **Nutrition:** `tdee.js` (Mifflin-St Jeor `calcBMR`, `ACTIVITY_FACTORS`, `GOAL_ADJUST`,
  `calcMacros`, `getTargets` → `nutritionStore`), `foods.js` (~209-row BR table, `searchFoods`),
  `foodApis.js` (`searchUSDA`/`searchOFF`/`searchNutritionix` proxy, `searchExternal` → `Nutrition.jsx`).
- **Coach:** `coach.js` proposal domain (`canonicalPlan`/`planHash`, `validateProposal`,
  `applyChangeSet`/`CHANGE_TYPES`, `pushSnapshot`/`revertLast`, chat/log caps); `coach-api.js`
  façade demo/BYOK/server; `coach-local.js` BYOK runtime (`ADAPTERS = { anthropic, openai,
  gemini, compatible, groq, grok }`, `LOCAL_DAILY_CAP = 10`, per-provider timeouts); `coach-secrets`
  (key storage), `coach-device` (`COACH_MODES`), `coach-insights`, `coach-demo`.
- **Persistence/sync/IO:** `api.js` (see Integration), `firebase.js` (only `firebase/*` importer),
  `sync-merge.js` (`mergeStates`, `unionById`, `localExtras`), `import-csv.js` (`parseWorkoutCSV`,
  `parseImport`, `mergeImport` — FitNotes/Strong/Hevy), `import-hevy.js`.
- **UI plumbing:** `format` (dates/weeks/`fmtNum`/`uid`), `i18n-core`/`i18n`, `units`
  (`convertStateUnit`), `speed` (cardio speed stored as km/h; display follows the profile
  unit, km/h or mph), `sound`, `push`, `wakelock`, `viewport-guard`, `use-sheet-keyboard`,
  `qr`, `scan`/`scan-web`, `hchips`, `nav`, `guest`, `demo`/`demoSeed`.

## Design

- **Pure framework-free functions + co-located unit tests (CONTRIBUTING.md rule):** anything
  deciding what you lift next or reading a logged session back is a pure helper here with its
  vitest file beside it (`*.test.js`/`*.jsx` — 75 of them, `npm test` in `frontend/`; never
  documented individually).
- **No framework imports** except `use-sheet-keyboard.js`/`wakelock.js` (React hooks) and
  `i18n.js` (`useLang` via `useSyncExternalStore`).
- **`i18n-core` vs `i18n`:** core holds `t`/dict without Vite globs so plain-Node consumers
  (`mcp/`, `api/`) can import lib; `i18n.js` adds `import.meta.glob` over locales/instr/names.
- **Frozen data + derived indexes:** `EXDB` → `CATALOGUE` → `EXIDX`; `MUSCLES` order; muscle
  metadata merged from JSON batches; `WeakMap`-cached search corpora.
- **Self-describing set rows:** legacy rows default to `phase:'work'`, `type:'straight'`, mode
  `reps`; dropset/rest-pause extras and `sides:{L,R}` ride on the row, `syncSideAggregate`
  keeping the scalar mirror honest.
- **Lazy imports:** `api.js` loads `./firebase`+`firebase/firestore` only with `VITE_FIREBASE_*`
  and a signed-in user; `useStore`/`coach-api.js` dynamic-import `demoSeed`/`coach-demo`.

## Flow

1. **Day → session:** `Home`/`TabBar` use `effectiveRoutines`/`nextTrainingDay` → `sheets.jsx`
   builds rows (`buildSessionEntries`/`buildCombinedEntries`) → `Workout.jsx` renders via `buildSets`
   + `workout-controls`, seeds `bestWeightFor`, asks `nextPrescription` (`progressionGuidance` explains).
2. **Logging:** edits via `workout-model.js` (sides, drops, clusters) and `history.js` counters;
   superset progression by `supersetFlowStep`; PRs by `onerm.is1RMRecord`; finish →
   `buildCompletedWorkout` → the store pushes into `S.workouts`.
3. **Analytics:** `Stats.jsx` composes `e1rmSeries`/`best1RM`, `fatigueOf`/`strengthOf`,
   `loadOfWorkouts`/`muscleBalanceWindow`, `effortSummary`, `strengthExerciseRowsForMuscle`;
   `recovery-view.fatigueStateOf` maps numbers to states; `BodyMap`/`MuscleExplorer` render levels.
4. **Persistence:** `useStore` reads/writes the blob via `api()`; on save
   `sync-merge.mergeStates` resolves conflicts by `_ts`/`_rev` (`localExtras` keeps device-only
   data) before the PUT; a 409 is merged and retried.
5. **Coach:** `CoachChat`/`CoachIntake` → `coach-api.requestReview/requestPlan/refinePlan/
   requestDebrief` → `DEMO`→`coach-demo`, BYOK→`coach-local` (`api/coach/core/` pipeline,
   `coach-secrets` key, daily cap), else HTTP `/api/coach/*`; proposals apply only on approval.
6. **Nutrition & import:** `nutritionStore` seeds from `tdee.getTargets`; `Nutrition.jsx` uses
   `searchFoods`→`searchExternal`; `sheets.jsx` runs `parseImport`/`importHevyData`→`mergeImport`.

## Integration

- **Consumers:** `store/useStore.js` (`api`, `sync-merge`, `registerCustom`, `demo`,
  `coach-device`, `workout-controls`), `store/useUI.js` (`sound`, `push.deviceId`),
  `store/nutritionStore.js` (`tdee`); views `Workout`, `Stats`, `Home`, `Plan`, `TabBar`,
  `sheets.jsx` (imports, plan-share, session-*, backfill, finish-workout, starter), `RoutineEdit`,
  `Library`, `MuscleExplorer`, `Nutrition`, `Settings`, `CoachChat`/`CoachIntake`; components
  `BodyMap`, `Media`, `Heatmap`, `LineChart`.
- **`api.js` persistence interceptor:** single client for every backend route. For
  `GET/PUT /api/data` and `/api/data/rev`, `stateBackend()` re-evaluates per call: with
  `VITE_FIREBASE_*` set and a user signed in, the request is answered from the Firestore doc
  `users/{uid}/state/app` (blob keys as document fields + server-owned `_rev`, full replace on
  PUT, `baseRev` mismatch → HTTP-shaped 409 carrying current doc, >1 MB → 413, Firestore errors
  mapped by `stateError`) with zero traffic to `/api/data`; otherwise it falls through to `fetch`
  on `appBase()`-relative URLs (subpath deployments), and with no API the store degrades to
  `localStorage`. All other routes stay plain HTTP; failures throw with an HTTP-shaped `status`
  so `useStore.doPush` branches unchanged.
- **`coach-local.js`** imports the server's shared core (`api/coach/core/{providers,pipeline,
  payload}.js` + `adapters/*.js`), so BYOK runs the same pipeline as the Cloud Function.
- **`mcp/`** imports lib directly as Node ESM (`onerm`, `history`, `progression`, `muscles`,
  `format`, `demoSeed`, …); `check-node-loadable.mjs` fails if a module becomes Vite-only.
- **External boundaries:** media via `VITE_IMG_BASE`/`VITE_GIF_BASE`; `foodApis` via
  `VITE_NUTRITION_PROXY_URL` + USDA/Open Food Facts; `push.js` via `/api/push/*` (VAPID);
  `firebase.js` is the only Firebase SDK entry.
