import { useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS, setWeightDecimals } from './lib/format.js'
import { setLang, useLang, getLang } from './lib/i18n.js'
import { setPlayOnSilent } from './lib/sound.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { installViewportGuard } from './lib/viewport-guard.js'
import { installChipDrag } from './lib/hchips.js'
import { syncPushSubscription } from './lib/push.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import SyncBanner from './components/SyncBanner.jsx'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import CheckIn from './views/CheckIn.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Library from './views/Library.jsx'
import CoachIntake from './views/CoachIntake.jsx'
import CoachSetup from './views/CoachSetup.jsx'
// Heavy secondary views split per route (task 16); Home/Login stay eager — a
// spinner on first paint would be a visible regression.
const Stats = lazy(() => import('./views/Stats.jsx'))
const History = lazy(() => import('./views/History.jsx'))
const Muscles = lazy(() => import('./views/Muscles.jsx'))
const Settings = lazy(() => import('./views/Settings.jsx'))
const CoachChat = lazy(() => import('./views/CoachChat.jsx'))
const Nutrition = lazy(() => import('./views/Nutrition.jsx'))

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map()

bindUI(useUI) // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme =>
  theme === 'light' || theme === 'dark'
    ? theme
    : window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  // Narrow slices, not the whole store: update() replaces S with a fresh clone on every
  // change (store/useStore.js), so a bare whole-store subscription re-rendered this shell —
  // and every route under it — on any change anywhere. One selector per field read here:
  // the shell re-renders only when a slice it actually uses moves.
  const soundOnSilent = useStore(s => s.S.soundOnSilent)
  const theme = useStore(s => s.S.theme)
  const accent = useStore(s => s.S.accent)
  const lang = useStore(s => s.S.lang)
  const wdec = useStore(s => s.S.wdec)
  const active = useStore(s => s.S.active)
  const keepAwake = useStore(s => s.S.keepAwake)
  const checkIn = useStore(s => s.S.checkIn)
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  // iOS: whether timer sounds get past the ring/silent switch (Settings → Sounds). Page-level,
  // so it is applied here on load and on change rather than at each beep.
  useEffect(() => {
    setPlayOnSilent(!!soundOnSilent)
  }, [soundOnSilent])
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang() // re-renders the whole shell when the language (pack) changes
  useEffect(() => {
    setNav(navigate)
  }, [navigate])
  useEffect(() => {
    applyPrefs(theme, accent)
  }, [theme, accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(theme, accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme, accent])
  useEffect(() => {
    setLang(lang || 'pt-BR')
  }, [lang])
  // Same shape as the language: a module-level display setting, pushed when it changes (#139).
  useEffect(() => {
    setWeightDecimals(wdec)
  }, [wdec])
  useEffect(() => {
    document.documentElement.lang = getLang()
  }, [langV, lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef(null)
  // iOS leaves the page displaced after the keyboard goes away (see lib/viewport-guard.js).
  useEffect(() => installViewportGuard(), [])
  // Click-drag a horizontal chip strip to scroll it sideways (lib/hchips.js) — on a desktop
  // browser there's otherwise no way to reach the filters past the edge.
  useEffect(() => installChipDrag(), [])
  // Once per signed-in boot, hand the server this browser's push subscription again (see
  // lib/push.js): a subscription the instance lost is back before the next reminder is due,
  // with nobody having to visit Settings.
  useEffect(() => {
    if (!user || !ready) return
    syncPushSubscription().catch(() => {})
  }, [user?.id, ready])
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    const samePath = pathRef.current === loc.pathname
    pathRef.current = loc.pathname
    if (navType !== 'POP') {
      window.scrollTo(0, 0)
      return
    }
    // A POP that stays on the route we are on is not a back-navigation: it is the history
    // entry a sheet pushed (Modals.jsx, #63) being unwound as the sheet closes. Nothing new
    // mounted, Modals puts the page back where it was itself, and a view that scrolled on
    // purpose because the sheet closed — the workout list going to the current exercise after
    // ⋯ → Layout → List (#224) — must not be dragged back to a position recorded before that
    // scroll's event had even been dispatched.
    if (samePath) return
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!active && keepAwake !== false)

  const authed = user || isGuest
  if (!ready && !authed)
    return (
      <div id="app">
        <div
          style={{
            paddingTop: '44vh',
            display: 'flex',
            justifyContent: 'center',
            fontSize: 34,
            color: 'var(--label-3)',
          }}
        >
          <Icon name="dumbbell" />
        </div>
      </div>
    )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {authed && <SyncBanner />}
          {!authed ? (
            <Login />
          ) : (
            <Suspense
              fallback={
                <div
                  style={{
                    paddingTop: '44vh',
                    display: 'flex',
                    justifyContent: 'center',
                    fontSize: 34,
                    color: 'var(--label-3)',
                  }}
                >
                  <Icon name="dumbbell" />
                </div>
              }
            >
              <Routes>
                <Route path="/home" element={<Home />} />
                {/* Gym check-in — switched off in Settings, the route falls through to the
                  catch-all redirect below. */}
                {checkIn !== false && <Route path="/checkin" element={<CheckIn />} />}
                <Route path="/plan" element={<Plan />} />
                <Route path="/plan/r/:id" element={<RoutineEdit />} />
                <Route path="/workout" element={<Workout />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/history" element={<History />} />
                <Route path="/nutrition" element={<Nutrition />} />
                <Route path="/library" element={<Library />} />
                <Route path="/muscles" element={<Muscles />} />
                <Route path="/settings" element={<Settings />} />
                {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
                <Route path="/coach" element={<CoachChat />} />
                <Route path="/coach/intake" element={<CoachIntake />} />
                <Route path="/coach/proposal" element={<Navigate to="/coach" replace />} />
                {/* /coach/setup is the mode picker: run on the server, or in this browser
                  with the user's own API key. */}
                <Route path="/coach/setup" element={<CoachSetup />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      {/* The chat owns the bottom of the screen: its composer sits where the tabs would be. */}
      {loc.pathname !== '/coach' && <TabBar onStart={startFlow} />}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => {
    boot()
  }, [boot])
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
