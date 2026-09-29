# frontend/src/

## Responsibility

The entire React application: entry point, root component/routing, global styles, and the source subfolders (`views/`, `components/`, `store/`, `lib/`, `locales/`, `sheets.jsx`, plus test-only `exercise-names/` and `instr/`). Everything under `src/` is browser code — no server logic lives here except the Coach UI adapter; the pure domain rules are in `lib/` with colocated tests.

## Design

**Entry — `main.jsx` (15 lines).** `createRoot(...).render(<StrictMode><App/></StrictMode>)`, imports the single global stylesheet `./index.css`, sets `history.scrollRestoration = 'manual'` (App.jsx restores scroll per route itself), and registers the PWA service worker `sw.js` — only over `https:` — with errors swallowed.

**`App.jsx` (186 lines).** `App` runs `useStore.boot()` once and renders `<HashRouter><Shell/></HashRouter>` (HashRouter: deployable as static files with no server rewrite rules). `Shell` owns cross-cutting concerns via effects: theme/accent (`data-theme`/`data-accent` on `<html>`, `theme-color` meta, `system` follows `matchMedia` live), language (`setLang`), weight decimals (`setWeightDecimals`), silent-mode beeps, `lib/nav.js` navigate handle, viewport guard, chip-strip drag, wake lock while `S.active`, push-subscription resync per signed-in boot, and per-route scroll memory (forward = top, POP = saved `scrollY`, skipping same-path POPs pushed by sheets). Unauthenticated → `<Login/>`; authenticated → `ErrorBoundary` (keyed on route) + `SyncBanner` + `<Routes>`:

| Route | View |
|---|---|
| `/home` | `Home` |
| `/checkin` | `CheckIn` (route only mounted when `S.checkIn !== false`) |
| `/plan` | `Plan` |
| `/plan/r/:id` | `RoutineEdit` |
| `/workout` | `Workout` |
| `/stats` | `Stats` |
| `/history` | `History` |
| `/nutrition` | `Nutrition` |
| `/library` | `Library` |
| `/muscles` | `Muscles` |
| `/settings` | `Settings` |
| `/coach` | `CoachChat` (also hides the TabBar — its composer takes the bottom) |
| `/coach/intake` | `CoachIntake` |
| `/coach/proposal` | redirect → `/coach` |
| `/coach/setup` | `CoachSetup` (mode picker: server / BYOK / off) |
| `*` | redirect → `/home` |

Persistent chrome outside the routes: `<TabBar onStart={startFlow}>`, `<RestTimer/>`, `<Modals/>` (sheet renderer for `useUI.sheets`), `<Toast/>`, `<TimerFlash/>`, `<SyncBanner/>`.

**Styles.** `main.jsx` imports only `index.css` (global tokens/layout); `nutrition.css` and `coach.css` are imported by their views (`views/Nutrition.jsx`, `views/CoachChat.jsx`, `views/CoachIntake.jsx`) so non-users never load them. Theming is CSS custom properties switched by `data-theme`/`data-accent` attributes.

**Tests.** `*.test.jsx` sit next to their subjects (`sheets.*.test.jsx` for the big `sheets.jsx`, `views/*.test.jsx`, `store/*.test.jsx`) and run under vitest with `happy-dom`/`linkedom` (`vitest.setup.js`).

## Flow

Boot: `main.jsx` → `App` mounts → `boot()` resolves session/config → `Shell` renders the loading dumbbell until `ready || authed`, then Login or the route table. A user action in a view calls `store.update()` (profile) or `useUI` (sheets/timers); re-render flows down from the hooks. Sheets: view → `openSheet(render)` → `Modals` renders the stack → `close()` pops. Navigation: `lib/nav.js` holds `navigate` so non-React code (sheets, timers) can route; TabBar's Start runs `startFlow` (weigh-in → session).

## Integration

- **Downward:** views read `useStore` (`S`, `user`, `config`) + `useNutritionStore` + `useUI`, and call pure logic from `lib/` (progression, 1RM, tdee, sync-merge, i18n `t()`).
- **Upward:** `lib/api.js` reaches `/api/data`, `/api/config`, `/api/me`, push endpoints; `lib/firebase.js` (auth) only when `VITE_FIREBASE_*` is set; `lib/push.js` for Web Push; coach calls via `lib/coach*` → `/api/coach` or `VITE_NUTRITION_PROXY_URL`.
- **Sibling folders:** `views/` (screens) compose `components/` (TabBar, Modals, RestTimer, charts, Media) and `sheets.jsx` (all bottom sheets in one module); `locales/` feeds `lib/i18n.js`.
- **Outside:** built by `frontend/vite.config.js`; `public/sw.js` + `manifest.json` make it a PWA; repo root `api/` and `functions/` are the servers it talks to.
