// @vitest-environment happy-dom
// Coverage-gap tests (todo 22): the Login view. The sign-in form must render for a configured
// Firebase project; a rejected auth/invalid-email must surface as the mapped validation message;
// a successful sign-in must adopt the credential's profile into the store and welcome the user;
// a password reset with no e-mail must refuse locally without touching Firebase; and with no
// configuration the view must say so instead of rendering a form whose submit could only throw.
// Both Firebase boundaries (lib/firebase.js and firebase/auth) are mocked, so no real SDK code
// or network call can run — sign-in is asserted against the mock auth sentinel itself.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  setUser: vi.fn(),
  adoptProfile: vi.fn(),
  setGuest: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendReset: vi.fn(),
  auth: { __auth: 'mock-auth' },
  configured: true,
}))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({
    setUser: mocks.setUser,
    adoptProfile: mocks.adoptProfile,
    setGuest: mocks.setGuest,
    config: null,
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
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../lib/firebase.js', () => ({
  get app() { return null },
  get db() { return null },
  get auth() { return mocks.auth },
  get firebaseConfigured() { return mocks.configured },
}))
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: mocks.signUp,
  signInWithEmailAndPassword: mocks.signIn,
  sendPasswordResetEmail: mocks.sendReset,
}))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Login />))
  return host
}

const byText = (host, text) =>
  [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const setInput = (input, value) => {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      .set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  mocks.toast.mockReset()
  mocks.setUser.mockReset()
  mocks.adoptProfile.mockReset().mockImplementation(() => Promise.resolve())
  mocks.setGuest.mockReset()
  mocks.signIn.mockReset()
  mocks.signUp.mockReset()
  mocks.sendReset.mockReset()
  mocks.configured = true
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Login view', () => {
  it('renders the sign-in form for a configured project without calling Firebase', () => {
    const host = render()

    expect(host.querySelector('h1').textContent).toBe('GymTask')
    expect(host.querySelector('input[type="email"]')).toBeTruthy()
    expect(host.querySelector('input[type="password"]')).toBeTruthy()
    expect(byText(host, 'Sign in')).toBeTruthy()
    expect(byText(host, 'Forgot my password?')).toBeTruthy()
    expect(byText(host, 'Continue without account')).toBeTruthy()

    // rendering alone must not touch either Firebase boundary
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(mocks.signUp).not.toHaveBeenCalled()
    expect(mocks.sendReset).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('shows the mapped validation message when the e-mail is rejected', async () => {
    mocks.signIn.mockRejectedValueOnce({ code: 'auth/invalid-email' })
    const host = render()
    setInput(host.querySelector('input[type="email"]'), 'not-an-email')
    setInput(host.querySelector('input[type="password"]'), 'secret123')

    await act(async () => { byText(host, 'Sign in').click() })

    expect(mocks.toast).toHaveBeenCalledWith('Invalid e-mail address')
    // the call carried the mock auth instance — the real SDK never ran
    expect(mocks.signIn).toHaveBeenCalledWith(mocks.auth, 'not-an-email', 'secret123')
    expect(mocks.adoptProfile).not.toHaveBeenCalled()
    expect(mocks.setUser).not.toHaveBeenCalled()
  })

  it('adopts the credential profile into the store after a successful sign-in', async () => {
    mocks.signIn.mockResolvedValueOnce({
      user: { uid: 'u7', displayName: null, email: 'ana@example.com' },
    })
    const host = render()
    setInput(host.querySelector('input[type="email"]'), 'ana@example.com')
    setInput(host.querySelector('input[type="password"]'), 'secret123')

    await act(async () => { byText(host, 'Sign in').click() })

    expect(mocks.signIn).toHaveBeenCalledWith(mocks.auth, 'ana@example.com', 'secret123')
    expect(mocks.setUser).toHaveBeenCalledWith({
      id: 'u7', name: 'ana', email: 'ana@example.com',
    })
    expect(mocks.adoptProfile).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Welcome back, ana')
  })

  it('refuses a password reset with no e-mail without calling Firebase', async () => {
    const host = render()

    await act(async () => { byText(host, 'Forgot my password?').click() })

    expect(mocks.toast).toHaveBeenCalledWith('Enter your e-mail')
    expect(mocks.sendReset).not.toHaveBeenCalled()
  })

  it('explains the missing configuration instead of rendering a submittable form', () => {
    mocks.configured = false
    const host = render()

    expect(host.querySelector('input[type="email"]')).toBeNull()
    expect(host.querySelector('input[type="password"]')).toBeNull()
    expect(byText(host, 'Sign in')).toBeUndefined()
    expect(host.textContent).toContain('Configure Firebase in the .env file to sign in.')
    // the guest entrance stays available — it never needed Firebase
    expect(byText(host, 'Continue without account')).toBeTruthy()
  })
})
