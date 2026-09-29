# frontend/src/components/

## Responsibility

The presentational layer: every reusable widget the app draws with. Views (`src/views/`) and
the sheet catalogue (`src/sheets.jsx`) compose these; nothing here routes, fetches, or owns
business rules — that lives in `src/lib/` (pure, unit-tested) and `src/store/`.

Inventory (consumers by grep of import sites):

| Component | Job | Consumed by |
|---|---|---|
| `ui.jsx` | Whole custom control set: `NumberField`, `TextField`, `TextArea`, `SearchField`, `Switch`, `Segmented`, `Stepper`, `Slider`, `Check`, `Section`, `Row`, `SelectRow`, `MultiSelectRow`, `Button`, `numWidthCh`, `SLIDER_GRAB_PX`, `bindUI` | every view, `sheets.jsx`, `Modals`, `CameraScan`, `ErrorBoundary`; `ui.test.jsx` |
| `Icon.jsx` | Hand-drawn 24×24 stroke icon set, `currentColor`; exports `ICON_NAMES` | everywhere; `lib/glyphs.js` validates glyph names against it |
| `Modals.jsx` | Single sheet/dialog host: swipe-to-dismiss, Android back + `history` entries, scroll-lock, Escape, keyboard/viewport restore | mounted once in `App.jsx`; content pushed by `useUI().openSheet` |
| `Toast.jsx`, `SyncBanner.jsx` | Transient toast line; offline/pending-sync banner with tap-to-retry | `App.jsx` |
| `RestTimer.jsx`, `TimerFlash.jsx` | Rest + timed-set countdown bar (fixed above tab bar); theme-flip alert flash | `App.jsx`, driven by `useUI` |
| `TabBar.jsx` | 4 tabs + centre Start/Resume button (resolves today's routines) | `App.jsx` |
| `ErrorBoundary.jsx` | Per-route render guard with "Reload" / "Discard the running workout" | `App.jsx` |
| `Media.jsx` | Exercise demo animation (autoplay GIF, tap-to-pause, minimize/expand persisted to `gifSize`, failure fallbacks) + `Thumb` thumbnail | `Workout`, `Library`, `RoutineEdit`, `sheets.jsx` |
| `LineChart.jsx` | SVG line chart: hover tooltip, `goal` line, `invert` y-axis, per-point `m`/`note` | `Stats`, `Home`, `CoachChat`, `sheets.jsx` |
| `Heatmap.jsx` | GitHub-style 53-week activity grid, quartile shading, week-start aware | `Stats.jsx` |
| `BodyMap.jsx` | Front/back muscle SVG shaded l0–l4 (same steps as the heatmap) + `BodyMapLegend`; ~90 KB geometry lazy-`import()`ed and cached | `Stats`, `RoutineEdit`, `MuscleExplorer`, `sheets.jsx` |
| `MuscleExplorer.jsx` | Muscle map + body-part/equipment/favourites filter + paginated catalogue; `onPick` makes it a picker | `views/Muscles.jsx` (full), `sheets.jsx` `ExercisePicker` (select mode) |
| `SwipeToDelete.jsx` | Horizontal reveal-delete with axis lock; coexists with RoutineEdit's drag-reorder | `RoutineEdit.jsx` |
| `QrCanvas.jsx`, `CameraScan.jsx` | Check-in QR render (lean-qr, pixelated CSS scale); live getUserMedia QR decode with in-place errors | `CheckIn.jsx` |
| `NumField.jsx`, `Stepper.jsx` | 3-line shims re-exporting the `ui.jsx` implementations | legacy import sites (`sheets.jsx` imports `Stepper.jsx`) |

Tests sit beside their subject: `ui`, `Modals`, `LineChart`, `Heatmap`, `BodyMap`, `Media`.

## Design

- **Controlled only.** Every `ui.jsx` control is `(value, onChange)` — no internal source of
  truth, so state stays in views/stores and is trivially serialisable. `bindUI(useUI)` is called
  once at boot (`App.jsx`) so `SelectRow`/`MultiSelectRow` can open their sheets without an
  import cycle back into the store.
- **No native widgets.** `<select>`, `<input type=range>`, checkboxes and `type=number` are all
  rebuilt: one visual language across iOS/Android, dark-mode-safe, ≥44px hit targets,
  `:active` feedback, `focus-visible` rings. `NumberField` accepts `,` as decimal and keeps a
  local draft so partial input survives; `nullable` distinguishes "cleared" from 0 (RIR).
- **Gesture rules are centralised.** `Modals.jsx` owns sheet dismissal (axis lock after ~8px,
  `NODRAG` = sliders / `[data-nodrag]` / chip strips / heatmap) and `SwipeToDelete.jsx` mirrors
  the same drag-ref pattern horizontally with a non-passive `touchmove` listener.
- **Routing is passed in, never imported** — except `TabBar`, the one navigation-aware widget.
- **Callbacks, not dispatch.** Charts/maps take `onDay`/`onMuscle`/`onPick`; the caller decides
  (Stats opens `workoutDetailSheet`, MuscleExplorer opens detail or returns the pick).
- **`Sheet` is a render-prop**: `openSheet(close => <X close={close}/>, { kind, locked })`.
- **Perf/robustness is local**: dynamic `import()` for body geometry and QR lib, `useLayoutEffect`
  for chart tooltip placement (kept off the render path), class `ErrorBoundary` for render throws.

## Flow

1. `main.jsx` → `App.jsx` binds `bindUI`, mounts `TabBar`, `SyncBanner`, route views inside
   `ErrorBoundary`, then `Modals`, `Toast`, `RestTimer`, `TimerFlash`.
2. A view renders controls from `ui.jsx`; a control calls `onChange` → view/store updates →
   props flow back down. Components never mutate state directly (`Media` is the exception:
   it writes `S.gifSize`, its own display preference).
3. `SelectRow`/`MultiSelectRow`/any sheet caller does `require_ui().openSheet(...)` → sheet is
   pushed onto `useUI.sheets` → `Modals` renders it, pushes a `history` entry, locks body scroll
   and blurs the page-behind field → `close()` / Android back / Escape pops it.
4. Live chrome: `RestTimer`/`TimerFlash`/`Toast` subscribe to `useUI` (`timer`, `work`,
   `timerFlashId`, `toastMsg`); `SyncBanner`/`Media`/`ErrorBoundary` subscribe to `useStore`
   (`sync`, `user`, `S`), so a store write re-renders them without any event bus.
5. Data inside the widget layer comes pre-reduced: `Heatmap` aggregates `S.workouts` itself,
   `LineChart` takes sorted `points`, `BodyMap` takes `load` levels from `lib/muscles.levelsOf`.

## Integration

- **Upstream:** `store/useStore.js` (app state `S`, `user`, sync) and `store/useUI.js` (sheet
  stack, timer, toast) — both are Zustand, read via hooks or `getState()` for imperative calls.
- **Logic:** `lib/muscles.js` (MUSCLES, `levelsOf`), `lib/exercises.js` (`imgSrc`/`gifSrc`,
  search), `lib/history.js` (best weights, routines), `lib/format.js` (dates, volume, `t`), 
  `lib/i18n.js` (`t`, `exerciseNameFor`), `lib/qr.js` + `lib/scan-web.js` (lazy-loaded),
  `lib/viewport-guard.js` (`keyboardOpen`), `lib/favourites.js`, `lib/equipment.js`.
- **Sheet catalogue:** `src/sheets.jsx` is this folder's biggest consumer — `ExConfig`
  (per-exercise prescription: sets/reps, progression, warm-ups and the **Intensifier** picker —
  `SelectRow` → dropset/rest-pause with `Stepper`s), `ExerciseDetail`/`ExerciseHistory`,
  `ExercisePicker` (hosts `MuscleExplorer`), `CustomExForm`, import/export and workout sheets.
  Those sheets are the only place UI and workout rules meet, and they delegate rules to `lib/`.
- **Styling:** `src/index.css` only — class contracts here (`.sect`, `.lrow`, `.seg`, `.stp`,
  `.sld`, `.chk`, `.hm-c.l0-l4`, `.bm-m`, `.exmedia`, `#timer`, `#toast`, `#modal-root`) are
  consumed by tests and by `index.css` itself.
- **Shell:** `App.jsx` is the only file that mounts the always-on components; views never do.
