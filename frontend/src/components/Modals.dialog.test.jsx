// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modals from './Modals.jsx'
import { useUI } from '../store/useUI.js'

// The dialog element must carry the dialog semantics (role, aria-modal, a name taken from the
// sheet's own title heading), close on Escape, and hand focus back to whatever opened it.
// The DOM is a fresh happy-dom Window per test — the same harness Stats.recovery.test.jsx
// uses — because linkedom (the history suite next door) does not track document.activeElement.

let dom
let root
let container
let opener

function installDom() {
  dom = new Window({ url: 'http://localhost/' })
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.location })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: dom.history })
  for (const key of ['HTMLElement', 'HTMLIFrameElement', 'Node', 'Element', 'Event', 'MouseEvent']) {
    globalThis[key] = dom[key]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

async function mountWithOpener() {
  installDom()
  opener = document.createElement('button')
  opener.textContent = 'Open'
  document.body.append(opener)
  opener.focus()
  expect(document.activeElement).toBe(opener)
  await act(async () => { root.render(React.createElement(Modals)) })
}

// Mirrors how a view opens a sheet: a render prop whose first element is the title heading,
// followed by a focusable control the dialog hands focus to.
async function open(title, kind = 'center') {
  await act(async () => {
    useUI.getState().openSheet(() => React.createElement(
      React.Fragment, null,
      React.createElement('h3', null, title),
      React.createElement('button', null, 'Confirm'),
    ), { kind })
  })
}

const dialog = () => container.querySelector('.center, .sheet')

async function pressEscape(target) {
  await act(async () => {
    target.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}

describe('Modals dialog semantics', () => {
  beforeEach(() => {
    useUI.setState({ sheets: [] })
  })

  afterEach(async () => {
    if (root) await act(async () => { root.unmount() })
    root = null
    container = null
    if (dom) dom.close()
    dom = null
    useUI.setState({ sheets: [] })
    vi.restoreAllMocks()
  })

  it('marks the centered dialog as a modal dialog named by its own title', async () => {
    await mountWithOpener()
    await open('Pick a day')

    const el = dialog()
    expect(el).toBeTruthy()
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(el.getAttribute('aria-label')).toBe('Pick a day')
  })

  it('marks the bottom sheet as a modal dialog named by its own title', async () => {
    await mountWithOpener()
    await open('Exercises', 'sheet')

    const el = dialog()
    expect(el).toBeTruthy()
    expect(el.getAttribute('role')).toBe('dialog')
    expect(el.getAttribute('aria-modal')).toBe('true')
    expect(el.getAttribute('aria-label')).toBe('Exercises')
  })

  it('closes on Escape and returns focus to the element that opened the dialog', async () => {
    await mountWithOpener()
    await open('Confirm')

    // focus moves into the dialog while it is up — without a restore the close would strand
    // it on the (now detached) button inside the dialog
    const inside = dialog().querySelector('button')
    inside.focus()
    expect(document.activeElement).toBe(inside)

    await pressEscape(dialog())

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(container.querySelector('#modal-root')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
