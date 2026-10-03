// Which optional control groups the workout screen shows: defaults, how a Settings toggle
// transitions them, and that resolved state is never shared mutable memory. Pure module.
import { describe, expect, it } from 'vitest'
import { workoutControls, WC_DEFAULT } from './workout-controls.js'

// How Settings flips a switch: read the resolved value, patch S.wc, then every reader
// re-resolves through workoutControls. Starts from `{}` — a profile that predates the setting.
const toggle = (S, key) => {
  const resolved = workoutControls(S)
  return { ...S, wc: { ...(S.wc || {}), [key]: !resolved[key] } }
}

describe('workoutControls', () => {
  it('falls back to the lean defaults whenever the state carries no wc flags', () => {
    const lean = { steppers: true, setShortcuts: false, pairButtons: false, exerciseButtons: false }
    expect(workoutControls()).toEqual(lean)
    expect(workoutControls(null)).toEqual(lean)
    expect(workoutControls({})).toEqual(lean)
    expect(workoutControls({ wc: null })).toEqual(lean)
    expect(workoutControls({ wc: {} })).toEqual(lean)
  })

  it('turns one group on without disturbing the others — and off again', () => {
    const on = workoutControls({ wc: { setShortcuts: true } })
    expect(on.setShortcuts).toBe(true)
    expect(on.steppers).toBe(true)          // untouched default still applies
    expect(on.pairButtons).toBe(false)
    expect(on.exerciseButtons).toBe(false)

    const off = workoutControls({ wc: { steppers: false } })
    expect(off.steppers).toBe(false)        // a default can be disabled too
    expect(off.setShortcuts).toBe(false)
    expect(off.pairButtons).toBe(false)
  })

  it('follows a Settings toggle through both flips', () => {
    let S = {}
    S = toggle(S, 'pairButtons')
    expect(workoutControls(S).pairButtons).toBe(true)
    S = toggle(S, 'pairButtons')
    expect(workoutControls(S).pairButtons).toBe(false)
    S = toggle(S, 'exerciseButtons')
    expect(workoutControls(S).exerciseButtons).toBe(true)
    expect(workoutControls(S).pairButtons).toBe(false)
  })

  it('hands out a fresh object each call, so a reader cannot corrupt later reads', () => {
    const a = workoutControls({ wc: { steppers: false } })
    a.steppers = true
    a.injected = 'boom'
    const b = workoutControls({ wc: { steppers: false } })
    expect(b.steppers).toBe(false)
    expect(b.injected).toBeUndefined()
    expect(WC_DEFAULT.steppers).toBe(true)
  })

  it('keeps the shared defaults frozen', () => {
    expect(Object.isFrozen(WC_DEFAULT)).toBe(true)
    expect(() => { WC_DEFAULT.setShortcuts = true }).toThrow(TypeError)
  })
})
