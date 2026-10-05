// @vitest-environment happy-dom
// RF11 — sending to Apple Health is an ADD-ON on top of the two save paths: a weigh-in and a
// finished workout must land in the profile whether or not the `shortcuts://` scheme exists.
// The guard case (no scheme → no send button → Save still writes the entry) is the point.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bwSheet, FinishSummary } from './sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile'

const setDevice = (userAgent, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

let clicked = []
const captureAnchors = () => {
  const real = document.createElement.bind(document)
  return vi.spyOn(document, 'createElement').mockImplementation(tag => {
    const el = real(tag)
    if (tag === 'a') el.click = () => clicked.push(el.getAttribute('href'))
    return el
  })
}

const mounted = []
const mountEl = element => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(element))
  return host
}
const openAndRender = open => {
  act(() => open())
  const sheet = useUI.getState().sheets.at(-1)
  return mountEl(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const buttonNamed = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(label))
const firedPayload = () => JSON.parse(decodeURIComponent(clicked[0].split('&input=')[1]))

afterEach(() => {
  vi.restoreAllMocks()
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
  document.body.innerHTML = ''
})

describe('send a weigh-in to Apple Health', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', bodyweight: [], active: null, weighIn: false } }))
    clicked = []
    setDevice(IPHONE)
    captureAnchors()
  })

  it('saves the weigh-in and fires a bodyweight sample (happy path)', () => {
    const host = openAndRender(() => bwSheet())
    const send = buttonNamed(host, 'Send to Apple Health')
    expect(send).toBeTruthy()

    act(() => send.click())

    const saved = useStore.getState().S.bodyweight
    expect(saved).toHaveLength(1)
    expect(saved[0].w).toBe(70) // the sheet's starting value — last weigh-in is empty here
    expect(saved[0].d).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(clicked).toHaveLength(1)
    expect(clicked[0].startsWith('shortcuts://run-shortcut?name=GymTask%20Log&input=')).toBe(true)
    const payload = firedPayload()
    expect(payload.type).toBe('bodyweight')
    expect(payload.value).toBe(70)
    expect(payload.unit).toBe('kg')
    expect(payload.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('GUARD: with no scheme the send button is absent and Save still writes the entry', () => {
    setDevice(ANDROID)
    const host = openAndRender(() => bwSheet())
    expect(buttonNamed(host, 'Send to Apple Health')).toBeUndefined()
    expect(clicked).toHaveLength(0)

    act(() => buttonNamed(host, 'Save').click())

    const saved = useStore.getState().S.bodyweight
    expect(saved).toHaveLength(1)
    expect(saved[0].w).toBe(70)
    expect(clicked).toHaveLength(0) // nothing was fired, and nothing blocked the save
  })

  it('sends the unit the profile is logged in', () => {
    useStore.setState(s => ({ S: { ...s.S, unit: 'lb' } }))
    const host = openAndRender(() => bwSheet())
    act(() => buttonNamed(host, 'Send to Apple Health').click())
    expect(firedPayload().unit).toBe('lb')
  })
})

describe('send a finished workout to Apple Health', () => {
  const workout = () => ({
    id: 'w1',
    d: '2026-10-04',
    start: Date.parse('2026-10-04T18:00:00Z'),
    end: Date.parse('2026-10-04T19:12:00Z'),
    routineIds: ['routine-1'],
    routineId: 'routine-1',
    name: 'Push',
    bw: null,
    vol: 4800,
    prs: [],
    entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], target: { sets: 1, reps: 8 } }],
  })

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    clicked = []
    setDevice(IPHONE)
    captureAnchors()
  })

  it('fires a workout sample dated at the finish', () => {
    const host = mountEl(<FinishSummary w={workout()} prs={[]} e1prs={[]} close={() => {}} />)
    const send = buttonNamed(host, 'Send to Apple Health')
    expect(send).toBeTruthy()

    act(() => send.click())

    expect(clicked).toHaveLength(1)
    const payload = firedPayload()
    expect(payload).toEqual({
      type: 'workout',
      value: 72,
      unit: 'min',
      date: '2026-10-04T19:12:00.000Z',
    })
  })

  it('GUARD: no send button where the scheme does not exist', () => {
    setDevice(ANDROID)
    const host = mountEl(<FinishSummary w={workout()} prs={[]} e1prs={[]} close={() => {}} />)
    expect(buttonNamed(host, 'Send to Apple Health')).toBeUndefined()
    expect(host.textContent).toContain('Workout complete!')
    expect(clicked).toHaveLength(0)
  })
})
