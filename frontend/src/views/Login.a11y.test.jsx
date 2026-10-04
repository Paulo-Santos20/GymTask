// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.com' }))
vi.mock('../lib/firebase.js', () => ({ auth: {}, firebaseConfigured: true }))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ config: {}, setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn() })
  const useStore = selector => (selector ? selector(snap()) : snap())
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
const mount = () => act(() => root.render(<Login />))

describe('Login inputs have accessible names', () => {
  it('labels the e-mail field', () => {
    mount()
    const email = host.querySelector('input[type="email"]')
    expect(email).toBeTruthy()
    expect(email.getAttribute('aria-label')).toBe('E-mail')
  })

  it('labels the password field', () => {
    mount()
    const pass = host.querySelector('input[type="password"]')
    expect(pass).toBeTruthy()
    expect(pass.getAttribute('aria-label')).toBe('Password')
  })
})
