// @vitest-environment happy-dom
// The Shortcuts bridge (RF11, plan decision 1 = option A): the app never talks to HealthKit.
// It builds a `shortcuts://run-shortcut` deep link carrying a four-key JSON sample, and hands
// it to the Shortcuts app. Everything here is the contract that the one-time Shortcut reads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHORTCUT_NAME,
  appleHealthSupported,
  bodyweightPayload,
  healthLink,
  healthPayload,
  openHealth,
  workoutPayload,
} from './apple-health.js'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const MAC = IPAD_AS_MAC
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0'

const setDevice = (userAgent, maxTouchPoints = 0) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })
}

const WEIGH_IN = { d: '2026-10-04', w: 82.4, t: Date.parse('2026-10-04T07:30:00Z') }
const SESSION = { start: Date.parse('2026-10-04T18:00:00Z'), end: Date.parse('2026-10-04T19:12:00Z') }

let clicked = []

beforeEach(() => {
  setDevice(IPHONE)
  clicked = []
})
afterEach(() => {
  vi.restoreAllMocks()
})

// Records every anchor the app fires instead of letting happy-dom navigate.
function captureAnchors() {
  const real = document.createElement.bind(document)
  return vi.spyOn(document, 'createElement').mockImplementation(tag => {
    const el = real(tag)
    if (tag === 'a') {
      el.click = () => clicked.push(el.getAttribute('href'))
    }
    return el
  })
}

describe('payload serialization', () => {
  it('is exactly the four documented keys, in order', () => {
    const json = healthPayload({
      type: 'bodyweight',
      value: 82.4,
      unit: 'kg',
      date: '2026-10-04T07:30:00.000Z',
    })
    expect(json).toBe('{"type":"bodyweight","value":82.4,"unit":"kg","date":"2026-10-04T07:30:00.000Z"}')
    expect(Object.keys(JSON.parse(json))).toEqual(['type', 'value', 'unit', 'date'])
  })

  it('builds the bodyweight sample from a saved weigh-in, in the profile unit', () => {
    expect(bodyweightPayload(WEIGH_IN, 'kg')).toBe(
      '{"type":"bodyweight","value":82.4,"unit":"kg","date":"2026-10-04T07:30:00.000Z"}',
    )
    expect(JSON.parse(bodyweightPayload({ ...WEIGH_IN, w: 181.7 }, 'lb'))).toEqual({
      type: 'bodyweight',
      value: 181.7,
      unit: 'lb',
      date: '2026-10-04T07:30:00.000Z',
    })
  })

  it('builds the workout sample as whole minutes, dated at the finish', () => {
    expect(workoutPayload(SESSION)).toBe('{"type":"workout","value":72,"unit":"min","date":"2026-10-04T19:12:00.000Z"}')
  })

  it('rounds an odd duration to the nearest minute', () => {
    const w = { start: Date.parse('2026-10-04T18:00:00Z'), end: Date.parse('2026-10-04T19:00:20Z') }
    expect(JSON.parse(workoutPayload(w)).value).toBe(60)
  })
})

describe('link construction', () => {
  it('names the GymTask shortcut and carries the JSON as `input`', () => {
    const link = healthLink(bodyweightPayload(WEIGH_IN, 'kg'))
    expect(SHORTCUT_NAME).toBe('GymTask Log')
    expect(link.startsWith('shortcuts://run-shortcut?name=GymTask%20Log&input=')).toBe(true)
    const input = decodeURIComponent(link.split('&input=')[1])
    expect(JSON.parse(input)).toEqual({
      type: 'bodyweight',
      value: 82.4,
      unit: 'kg',
      date: '2026-10-04T07:30:00.000Z',
    })
  })

  it('keeps a workout payload readable after the round trip', () => {
    const input = decodeURIComponent(healthLink(workoutPayload(SESSION)).split('&input=')[1])
    expect(JSON.parse(input)).toEqual({
      type: 'workout',
      value: 72,
      unit: 'min',
      date: '2026-10-04T19:12:00.000Z',
    })
  })
})

describe('openHealth', () => {
  it('fires the deep link through a temporary anchor and reports true', () => {
    captureAnchors()
    expect(openHealth(bodyweightPayload(WEIGH_IN, 'kg'))).toBe(true)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].startsWith('shortcuts://run-shortcut?name=GymTask%20Log&input=')).toBe(true)
    expect(JSON.parse(decodeURIComponent(clicked[0].split('&input=')[1])).type).toBe('bodyweight')
  })

  it('never throws: a browser that refuses the anchor reports false', () => {
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(
      openHealth(healthPayload({ type: 'workout', value: 30, unit: 'min', date: '2026-10-04T19:12:00.000Z' })),
    ).toBe(false)
  })
})

describe('capability detection', () => {
  it('is available on an iPhone', () => {
    setDevice(IPHONE)
    expect(appleHealthSupported()).toBe(true)
  })

  it('is available on an iPad, which reports itself as a Mac with a touch screen', () => {
    setDevice(IPAD_AS_MAC, 5)
    expect(appleHealthSupported()).toBe(true)
  })

  it('is not available on Android', () => {
    setDevice(ANDROID)
    expect(appleHealthSupported()).toBe(false)
  })

  it('is not available on a desktop Mac', () => {
    setDevice(MAC, 0)
    expect(appleHealthSupported()).toBe(false)
  })

  it('is not available on Windows', () => {
    setDevice(WINDOWS)
    expect(appleHealthSupported()).toBe(false)
  })
})
