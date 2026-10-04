import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'

// The effort stepper's +/- styling in index.css used to key off the English aria-labels
// (`[aria-label=Decrease]` in English words), coupling presentation to copy: the moment
// todo 14 translates those labels through t(), every one of those rules would silently stop
// matching and the buttons would lose their sizing/hiding rules. The contract now is a
// locale-independent `data-aria="decrease|increase"` hook rendered alongside the (kept,
// now-translated) aria-label, and this suite is the regression gate: it fails while the CSS
// still selects on English text or while the rendered controls are missing the hook.
const cssSource = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const sheetsSource = readFileSync(new URL('../sheets.jsx', import.meta.url), 'utf8')

const mocks = vi.hoisted(() => {
  const state = {
    S: null,
    startRest: vi.fn(),
    stopRest: vi.fn(),
    stopWork: vi.fn(),
    toast: vi.fn(),
    effortPickerSheet: vi.fn(),
  }
  state.storeSnapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  state.uiSnapshot = () => ({
    timer: null,
    work: null,
    startRest: state.startRest,
    stopRest: state.stopRest,
    stopWork: state.stopWork,
    shiftRestOwner: vi.fn(),
    startWork: vi.fn(),
    toast: state.toast,
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.storeSnapshot())
  useStore.getState = mocks.storeSnapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const useUI = selector => (selector ? selector(mocks.uiSnapshot()) : mocks.uiSnapshot())
  useUI.getState = mocks.uiSnapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(),
  exercisePicker: vi.fn(),
  exConfigSheet: vi.fn(),
  exerciseDetailSheet: vi.fn(),
  topWeightSheet: vi.fn(),
  finishWorkout: vi.fn(),
  workoutCompleteSheet: vi.fn(),
  confirmSheet: vi.fn(),
  swapActiveWorkoutExercise: vi.fn(),
  menuSheet: vi.fn(),
  barWeightSheet: vi.fn(),
  exerciseNoteSheet: vi.fn(),
  sessionNoteSheet: vi.fn(),
  renameWorkoutSheet: vi.fn(),
  effortPickerSheet: mocks.effortPickerSheet,
  exerciseHistorySheet: vi.fn(),
  addRoutineToSessionSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})),
  IS_APPLE: false,
  IS_ANDROID: false,
  BIO: 'biometrics',
}))

let dom
let root
let container

function workout(entries) {
  return {
    unit: 'kg',
    restSec: 90,
    sound: false,
    effort: 'rir',
    gifSize: 'full',
    workouts: [],
    exWeights: {},
    routines: [],
    active: { id: 'active', name: 'Test workout', start: Date.now(), cur: 0, entries },
  }
}

function installDom() {
  const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
  dom = parsed.window
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  for (const key of ['HTMLElement', 'Node', 'Element', 'Event', 'Blob']) globalThis[key] = dom[key]
  dom.Element.prototype.scrollIntoView = vi.fn()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.getElementById('root')
  root = createRoot(container)
}

// A logged rating renders the stepper (`.effcell-stp`) instead of the empty `.effcell`
// button — that stepper is exactly what index.css styles.
async function mountLoggedEffort(rir = 2) {
  mocks.S = workout([
    {
      id: 'plain-bench',
      target: { mode: 'reps', reps: 5, weight: 60, bodyweight: false },
      sets: [{ w: 60, r: 5, done: false, rir }],
    },
  ])
  installDom()
  await act(async () => {
    root.render(React.createElement(Workout))
  })
}

async function unmount() {
  if (!root) return
  await act(async () => {
    root.unmount()
  })
  root = null
  container = null
  dom = null
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await unmount()
})

describe('effort stepper styling is decoupled from English aria-labels', () => {
  it('index.css contains zero [aria-label=…] attribute selectors', () => {
    const offenders = cssSource
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes('[aria-label='))
      .map(({ n, line }) => `${n}: ${line.trim()}`)
    expect(offenders, `index.css must not select by English aria-label:\n${offenders.join('\n')}`).toEqual([])
  })

  it('index.css selects the effort stepper buttons through the data-aria hook', () => {
    expect(cssSource).toContain('[data-aria="decrease"]')
    expect(cssSource).toContain('[data-aria="increase"]')
  })

  it('the rendered effort stepper buttons carry data-aria next to their aria-label', async () => {
    await mountLoggedEffort(2)

    const cell = container.querySelector('.effcell-stp')
    expect(cell, 'logged effort rating must render the stepper cell').toBeTruthy()

    const decrease = cell.querySelector('button[data-aria="decrease"]')
    const increase = cell.querySelector('button[data-aria="increase"]')
    expect(decrease, '.effcell-stp must expose a [data-aria="decrease"] button').toBeTruthy()
    expect(increase, '.effcell-stp must expose a [data-aria="increase"] button').toBeTruthy()

    // The a11y labels stay — now through t(): rendered values are the pt-BR translation at
    // runtime and this suite's English fallback (no pack loaded under test).
    expect(decrease.getAttribute('aria-label')).toBe('Decrease')
    expect(increase.getAttribute('aria-label')).toBe('Increase')
  })

  it("the effort picker's exact-value stepper carries the hook too", () => {
    // The picker's free-value row renders the same .effcell-stp markup (sheets.jsx); a source
    // assertion keeps the gate without standing up the whole sheet host.
    expect(sheetsSource).toMatch(/aria-label=\{t\('Decrease'\)\}[^>]*data-aria="decrease"/)
    expect(sheetsSource).toMatch(/aria-label=\{t\('Increase'\)\}[^>]*data-aria="increase"/)
  })
})
