// @vitest-environment happy-dom
// Coverage-gap tests (todo 22): the Coach intake questionnaire. With no consent on record the
// flow must lead with the disclosure (categories rendered from the same list the payload is
// built from), declining must leave without writing anything, agreeing must store the current
// consent version and move on. With consent given, the first question must gate Continue until
// an answer is picked, and a completed walk-through must submit the exact profile payload to
// requestPlan (mocked — no coach AI call) and route to /coach. coach-api.js is mocked; coach.js
// stays real so consent/version bookkeeping is genuinely exercised.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachIntake from './CoachIntake.jsx'
import { CONSENT_VERSION } from '../lib/coach.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  nav: vi.fn(),
  toast: vi.fn(),
  requestPlan: vi.fn(),
  disclosure: vi.fn(),
  S: null,
  user: { id: 'u1' },
  config: { coach: { enabled: true } },
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useSearchParams: () => [{ get: () => null }],
}))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({
    S: mocks.S,
    user: mocks.user,
    config: mocks.config,
    coachLocal: null,
    update: fn => fn(mocks.S),
  })
  const useStore = selector => (selector ? selector(snapshot()) : snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/coach-api.js', () => ({
  requestPlan: mocks.requestPlan,
  disclosure: mocks.disclosure,
}))
vi.mock('../coach.css', () => ({}))

const consentedCoach = () => ({
  coach: {
    consent: { agreedAt: '2026-01-01T00:00:00.000Z', version: CONSENT_VERSION },
    profile: null, cadence: 'off', lastReview: null,
    log: [], snapshots: [], chat: [], timings: [],
  },
})
const unansweredCoach = () => ({
  coach: {
    consent: null,
    profile: null, cadence: 'off', lastReview: null,
    log: [], snapshots: [], chat: [], timings: [],
  },
})

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<CoachIntake />))
  return host
}

const heading = host => host.querySelector('.ob-h').textContent
const choice = (host, title) =>
  [...host.querySelectorAll('.ob-choice')].find(b => b.textContent.includes(title))
const primaryFoot = host => host.querySelector('.ob-foot button')
const footByLabel = (host, label) =>
  [...host.querySelectorAll('.ob-foot button')].find(b => b.textContent.includes(label))
const pick = (host, title) => act(() => { choice(host, title).click() })
const step = (host, choiceTitle) => {
  if (choiceTitle) pick(host, choiceTitle)
  act(() => { primaryFoot(host).click() })
}

beforeEach(() => {
  mocks.nav.mockReset()
  mocks.toast.mockReset()
  mocks.requestPlan.mockReset().mockResolvedValue({})
  mocks.disclosure.mockReset().mockResolvedValue({
    categories: ['plan', 'training'],
    payer: 'instance',
    providerLabel: 'Groq',
  })
  mocks.S = consentedCoach()
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Coach intake', () => {
  it('leads with the consent disclosure and renders its category list', async () => {
    mocks.S = unansweredCoach()
    const host = render()
    await act(async () => {}) // flush disclosure()

    expect(heading(host)).toBe('Meet the Coach')
    expect(mocks.disclosure).toHaveBeenCalledTimes(1)
    const rows = [...host.querySelectorAll('.ob-consent-row')]
      .map(r => r.querySelector('b').textContent)
    // exactly the categories the payload builder uses — no hard-coded list here
    expect(rows).toEqual(['Your plan', 'Your logged training'])
    expect(host.textContent).toContain('Groq')
    expect(host.querySelector('.ob-hint')).toBeNull()
  })

  it('declining the disclosure leaves without writing consent', async () => {
    mocks.S = unansweredCoach()
    const host = render()
    await act(async () => {})

    act(() => { footByLabel(host, 'Not now').click() })

    expect(mocks.nav).toHaveBeenCalledWith('/plan')
    expect(mocks.S.coach.consent).toBeNull()
    expect(mocks.requestPlan).not.toHaveBeenCalled()
  })

  it('agreeing stores the current consent version and moves to the first question', async () => {
    mocks.S = unansweredCoach()
    const host = render()
    await act(async () => {})

    act(() => { footByLabel(host, 'I understand').click() })

    expect(mocks.S.coach.consent.version).toBe(CONSENT_VERSION)
    expect(typeof mocks.S.coach.consent.agreedAt).toBe('string')
    expect(heading(host)).toBe('What are you training for?')
    expect(host.querySelectorAll('.ob-choice')).toHaveLength(5)
  })

  it('gates the first question until an answer is picked', () => {
    const host = render()

    expect(heading(host)).toBe('What are you training for?')
    let next = primaryFoot(host)
    expect(next.disabled).toBe(true)
    expect(host.querySelector('.ob-hint').textContent).toContain('Pick one to continue.')

    pick(host, 'Get stronger')

    expect(host.querySelector('.ob-hint')).toBeNull()
    next = primaryFoot(host)
    expect(next.disabled).toBe(false)
    act(() => { next.click() })
    expect(heading(host)).toBe('Where are you starting from?')
  })

  it('submits the completed intake as the plan payload and routes to the coach', async () => {
    const host = render()

    // goal → experience → days → length → equipment
    step(host, 'Get stronger')
    expect(heading(host)).toBe('Where are you starting from?')
    step(host, 'Training regularly')
    expect(heading(host)).toBe('How many days a week?')
    step(host)
    expect(heading(host)).toBe('How long is a session?')
    step(host)
    expect(heading(host)).toBe('What can you train with?')
    step(host)
    // limits: type a limitation, then continue
    expect(heading(host)).toBe('Anything to work around?')
    const ta = host.querySelector('textarea')
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        .set.call(ta, 'bad shoulder')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    step(host)
    expect(heading(host)).toBe('Anything else?')
    expect(primaryFoot(host).textContent).toContain('Build my plan')

    await act(async () => { primaryFoot(host).click() })

    expect(mocks.requestPlan).toHaveBeenCalledTimes(1)
    expect(mocks.requestPlan).toHaveBeenCalledWith({
      goal: 'strength',
      experience: 'regular',
      daysPerWeek: 3,
      preferredDays: [1, 3, 5],
      sessionMin: 60,
      equipment: [],
      limitations: 'bad shoulder',
      likes: '',
      dislikes: '',
      notes: '',
    })
    expect(mocks.nav).toHaveBeenCalledWith('/coach', { replace: true })
    // the answers are persisted and open the conversation
    expect(mocks.S.coach.profile).toMatchObject({ goal: 'strength', daysPerWeek: 3 })
    expect(mocks.S.coach.chat.some(m => m.kind === 'intake')).toBe(true)
  })
})
