// @vitest-environment happy-dom
// The menu-assisted estimate: a cardápio photo -> the dishes the AI read as chips (all on)
// -> the user taps out what they did NOT eat -> the meal photo goes through photoAsk with
// the kept names as context, and the candidates land in the SAME pick/confirmAdd form.
// Consent OFF -> nothing leaves the device, same backstop as the plain meal photo.
// photo.js keeps its real MENU_SYSTEM/parseMenu/parseEstimate (only fileToDataUrl is
// stubbed); coach-api's photoAsk/photoEstimate are module-mocked, no network.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  openSheet: vi.fn(),
  searchExternal: vi.fn(),
  lookupBarcode: vi.fn(),
  importCodeFromImage: vi.fn(),
  fileToDataUrl: vi.fn(),
  photoEstimate: vi.fn(),
  photoAsk: vi.fn(),
  demo: false,
}))

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet, closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/foodApis.js', () => ({ searchExternal: mocks.searchExternal, lookupBarcode: mocks.lookupBarcode }))
vi.mock('../lib/scan.js', () => ({ importCodeFromImage: mocks.importCodeFromImage }))
vi.mock('../components/CameraScan.jsx', () => ({ default: function FakeCamera() {} }))
vi.mock('../nutrition.css', () => ({}))
vi.mock('../lib/photo.js', async importOriginal => ({
  ...(await importOriginal()),
  fileToDataUrl: mocks.fileToDataUrl,
}))
vi.mock('../lib/coach-api.js', () => ({ photoEstimate: mocks.photoEstimate, photoAsk: mocks.photoAsk }))
vi.mock('../lib/demo.js', () => ({
  get DEMO() {
    return mocks.demo
  },
}))

import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { useStore } from '../store/useStore.js'
import { MENU_SYSTEM } from '../lib/photo.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const MENU_JSON = JSON.stringify({ dishes: ['Feijoada', 'Salada de frango', 'Sopa de legumes'] })
const MEAL_JSON = JSON.stringify({
  foods: [{ name: 'Feijoada', grams: 250, kcal: 400, protein: 25, carbs: 30, fat: 18, confidence: 0.8 }],
})

function setConsent(on) {
  const s = useStore.getState().S || {}
  useStore.setState({
    S: {
      ...s,
      coach: { ...(s.coach || {}), consent: on ? { agreedAt: '2026-10-04T00:00:00.000Z', version: 1 } : null },
    },
  })
}

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Nutrition />))
  return host
}

function openPanel(host) {
  const add = [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Add food'))
  expect(add).toBeTruthy()
  act(() => add.click())
  expect(host.querySelector('.nut-add')).toBeTruthy()
  return host.querySelector('.nut-add')
}

const menuButton = host => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Menu photo'))
const mealPhotoButton = host =>
  [...host.querySelectorAll('button')].find(b => b.textContent.includes('Photo of the meal'))

async function chooseFile(panel, label, name) {
  const input = [...panel.querySelectorAll('input[type="file"]')].find(i => i.getAttribute('aria-label') === label)
  expect(input).toBeTruthy()
  const file = new File(['x'], name, { type: 'image/jpeg' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => {})
  return file
}

beforeEach(() => {
  useNutritionStore.setState({ log: {}, lastRemoved: null })
  setConsent(false)
  mocks.toast.mockClear()
  mocks.openSheet.mockClear()
  mocks.searchExternal.mockReset()
  mocks.lookupBarcode.mockReset()
  mocks.importCodeFromImage.mockReset()
  mocks.fileToDataUrl.mockReset()
  mocks.photoEstimate.mockReset()
  mocks.photoAsk.mockReset()
  mocks.demo = false
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('menu photo -> dishes -> meal photo', () => {
  it('without Coach consent the tap asks for sharing and nothing leaves the device', async () => {
    setConsent(false)
    const host = render()
    openPanel(host)

    await act(async () => {
      menuButton(host).click()
    })

    expect(mocks.toast).toHaveBeenCalledWith('Share your data with the Coach first')
    expect(mocks.fileToDataUrl).not.toHaveBeenCalled()
    expect(mocks.photoAsk).not.toHaveBeenCalled()
  })

  it('reads the menu, prunes a dish, and the meal photo carries only the kept names', async () => {
    setConsent(true)
    mocks.fileToDataUrl.mockResolvedValue('data:image/jpeg;base64,QUJD')
    mocks.photoAsk.mockResolvedValueOnce(MENU_JSON).mockResolvedValueOnce(MEAL_JSON)

    const host = render()
    const panel = openPanel(host)

    await act(async () => {
      menuButton(host).click()
    })
    await chooseFile(panel, 'Menu photo', 'menu.jpg')

    expect(mocks.photoAsk).toHaveBeenNthCalledWith(1, 'data:image/jpeg;base64,QUJD', {
      system: MENU_SYSTEM,
      menu: true,
    })

    const chips = [...panel.querySelectorAll('.chip')]
    expect(chips.map(c => c.textContent)).toEqual(['Feijoada', 'Salada de frango', 'Sopa de legumes'])
    chips.forEach(c => expect(c.className).toContain('on'))

    // tap out what was NOT eaten
    await act(async () => {
      chips[0].click()
    })
    expect([...panel.querySelectorAll('.chip')][0].className).not.toContain('on')

    await chooseFile(panel, 'Photo of the meal', 'meal.jpg')

    expect(mocks.photoAsk).toHaveBeenNthCalledWith(2, 'data:image/jpeg;base64,QUJD', {
      context: 'Salada de frango, Sopa de legumes',
    })

    const row = [...panel.querySelectorAll('.lrow')].find(r => r.textContent.includes('Feijoada'))
    expect(row).toBeTruthy()
    await act(async () => {
      row.click()
    })
    const pick = host.querySelector('.nut-pick')
    const add = [...pick.querySelectorAll('button')].find(b => b.textContent.includes('Add'))
    await act(async () => {
      add.click()
    })

    const entry = useNutritionStore.getState().log[todayISO()][0]
    expect(entry).toMatchObject({ name: 'Feijoada', source: 'photo', grams: 250, kcal: 400 })
  })

  it('dropping every dish blocks the meal photo with a toast — no wasted vision call', async () => {
    setConsent(true)
    mocks.fileToDataUrl.mockResolvedValue('data:image/jpeg;base64,QUJD')
    mocks.photoAsk.mockResolvedValueOnce(MENU_JSON)

    const host = render()
    const panel = openPanel(host)
    await act(async () => {
      menuButton(host).click()
    })
    await chooseFile(panel, 'Menu photo', 'menu.jpg')

    for (const chip of [...panel.querySelectorAll('.chip')]) {
      await act(async () => {
        chip.click()
      })
    }
    await chooseFile(panel, 'Photo of the meal', 'meal.jpg')

    expect(mocks.toast).toHaveBeenCalledWith('Select at least one dish')
    expect(mocks.photoAsk).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.nut-add')).toBeTruthy()
  })

  it('an unreadable menu shows the fallback line and the panel stays usable', async () => {
    setConsent(true)
    mocks.fileToDataUrl.mockResolvedValue('data:image/jpeg;base64,QUJD')
    mocks.photoAsk.mockRejectedValueOnce(new Error('no menu'))

    const host = render()
    const panel = openPanel(host)
    await act(async () => {
      menuButton(host).click()
    })
    await chooseFile(panel, 'Menu photo', 'menu.jpg')

    expect(host.textContent).toContain('Could not read that menu')
    expect(panel.querySelectorAll('.chip')).toHaveLength(0)
    expect(mealPhotoButton(host)).toBeTruthy()
  })
})
