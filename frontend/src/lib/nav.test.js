// Module-level router indirection: App registers the real `navigate`, sheet flows call `nav`.
// Pure functions, so the default node environment is enough.
import { describe, expect, it, vi } from 'vitest'
import { nav, setNav } from './nav.js'

describe('nav', () => {
  it('is a silent no-op before any router registers itself', () => {
    expect(() => nav('/home')).not.toThrow()
  })

  it('forwards the route to the registered router', () => {
    const router = vi.fn()
    setNav(router)
    nav('/routine/abc')
    expect(router).toHaveBeenCalledTimes(1)
    expect(router).toHaveBeenCalledWith('/routine/abc')
  })

  it('hands back whatever the router returns', () => {
    setNav(to => `went:${to}`)
    expect(nav('/stats')).toBe('went:/stats')
  })

  it('replaces the previous router instead of stacking registrations', () => {
    const first = vi.fn()
    const second = vi.fn()
    setNav(first)
    setNav(second)
    nav('/history')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('/history')
  })
})
