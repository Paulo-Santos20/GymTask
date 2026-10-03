// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ path: '/home', nav: vi.fn() }))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useLocation: () => ({ pathname: mocks.path }),
}))
vi.mock('../store/useStore.js', () => {
  const snap = { S: { active: null }, user: { id: 'u', name: 'Tester' }, isGuest: () => false }
  const useStore = selector => selector ? selector(snap) : snap
  return { useStore }
})

let host, root
beforeEach(() => {
  mocks.path = '/home'
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = path => act(() => { mocks.path = path; root.render(<TabBar onStart={() => {}} />) })
const tab = label => [...host.querySelectorAll('#tabbar button')].find(b => b.textContent === label)

describe('TabBar aria-current', () => {
  it('marks the tab of the active route with aria-current="page"', () => {
    mount('/home')
    expect(tab('Home').getAttribute('aria-current')).toBe('page')
    expect(tab('Plan').hasAttribute('aria-current')).toBe(false)
    expect(tab('Stats').hasAttribute('aria-current')).toBe(false)
    expect(tab('Exercises').hasAttribute('aria-current')).toBe(false)
  })

  it('moves the marker with the route', () => {
    mount('/stats')
    expect(tab('Stats').getAttribute('aria-current')).toBe('page')
    expect(tab('Home').hasAttribute('aria-current')).toBe(false)
  })

  it('follows the tab grouping: /history lights Stats, /muscles lights Exercises', () => {
    mount('/history')
    expect(tab('Stats').getAttribute('aria-current')).toBe('page')
    mount('/muscles')
    expect(tab('Exercises').getAttribute('aria-current')).toBe('page')
    expect(tab('Home').hasAttribute('aria-current')).toBe(false)
  })

  it('routes the click through navigate (behaviour unchanged)', () => {
    mount('/home')
    act(() => tab('Plan').click())
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })
})
