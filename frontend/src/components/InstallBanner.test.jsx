// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InstallBanner from './InstallBanner.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const fire = outcome => {
  const prompt = vi.fn()
  const userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice }))
  return { prompt, userChoice }
}

let host, root
beforeEach(() => {
  localStorage.clear()
  // a clean offer state between tests: the lib keeps `deferred` for the module's lifetime
  window.dispatchEvent(new Event('appinstalled'))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<InstallBanner />))

describe('InstallBanner', () => {
  it('renders nothing until the browser offers an install', () => {
    mount()
    expect(host.querySelector('.pwa-banner')).toBeNull()
    act(() => fire('accepted'))
    expect(host.querySelector('.pwa-banner')).toBeTruthy()
  })

  it('Install calls the browser prompt', async () => {
    mount()
    let prompt
    act(() => {
      prompt = fire('accepted').prompt
    })
    await act(async () => {
      ;[...host.querySelectorAll('button')].find(b => b.textContent === 'Install').click()
    })
    expect(prompt).toHaveBeenCalled()
  })

  it('Dismiss hides the banner and remembers it across a remount', () => {
    mount()
    act(() => fire('accepted'))
    act(() => host.querySelector('.pwa-x').click())
    expect(host.querySelector('.pwa-banner')).toBeNull()
    expect(localStorage.getItem('gym_pwa_dismiss')).toBe('1')
    mount()
    expect(host.querySelector('.pwa-banner')).toBeNull()
  })
})
