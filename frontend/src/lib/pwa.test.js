// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { installAvailable, promptInstall, subscribeInstall } from './pwa.js'

// The browser hands the app a BeforeInstallPromptEvent it must capture. happy-dom has no such
// constructor, so the event is built by hand with the two methods the app calls — exactly the
// duck type lib/pwa.js works with.
const fire = (outcome = 'accepted') => {
  const prompt = vi.fn()
  const userChoice = Promise.resolve({ outcome })
  const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice })
  window.dispatchEvent(e)
  return { prompt, userChoice }
}

beforeEach(() => {
  window.dispatchEvent(new Event('appinstalled')) // a clean slate between tests
})

describe('pwa install prompt', () => {
  it('is unavailable until the browser offers one', () => {
    expect(installAvailable()).toBe(false)
  })

  it('becomes available when the event arrives, and the event was prevented', () => {
    let prevented = false
    window.addEventListener('beforeinstallprompt', e => {
      prevented = e.defaultPrevented
    })
    fire()
    expect(prevented).toBe(true)
    expect(installAvailable()).toBe(true)
  })

  it('prompt() shows the dialog and answers the outcome', async () => {
    const { prompt } = fire()
    expect(await promptInstall()).toBe(true)
    expect(prompt).toHaveBeenCalled()
    expect(installAvailable()).toBe(false) // one prompt per event
  })

  it('a dismissal ends the offer', async () => {
    fire('dismissed')
    expect(await promptInstall()).toBe(false)
    expect(installAvailable()).toBe(false)
  })

  it('appinstalled clears the offer', () => {
    fire()
    expect(installAvailable()).toBe(true)
    window.dispatchEvent(new Event('appinstalled'))
    expect(installAvailable()).toBe(false)
  })

  it('notifies subscribers when the offer appears and ends', () => {
    const seen = []
    const off = subscribeInstall(() => seen.push(installAvailable()))
    fire()
    window.dispatchEvent(new Event('appinstalled'))
    expect(seen).toEqual([true, false])
    off()
    fire()
    expect(seen).toEqual([true, false]) // unsubscribed: no more calls
  })
})
