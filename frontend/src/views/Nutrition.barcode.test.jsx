// @vitest-environment happy-dom
// RF1 (roadmap-features todo 1): a food barcode decoded from the camera or from a photo goes
// through the barcode LOOKUP (mocked here — no network in tests) and prefills the add-food
// entry so one tap on Add saves it; an unknown EAN lands in the panel's existing
// "No matches for {0}" state. The decoder and the camera sheet are stubbed at the same seam
// CheckIn's tests use (vi.mock of lib/scan.js + components/CameraScan.jsx), so this exercises
// Nutrition's own wiring: scan button → CameraScan/importCodeFromImage → lookupBarcode → pick.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  openSheet: vi.fn(),
  lookupBarcode: vi.fn(),
  importCodeFromImage: vi.fn(),
}))

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet, closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/foodApis.js', () => ({
  searchExternal: vi.fn().mockResolvedValue([]),
  lookupBarcode: mocks.lookupBarcode,
}))
vi.mock('../lib/scan.js', () => ({ importCodeFromImage: mocks.importCodeFromImage }))
vi.mock('../components/CameraScan.jsx', () => ({
  default: function FakeCamera({ onFound }) {
    return <button data-testid="cam" onClick={() => onFound({ value: '7891000100103', fmt: 'ean_13' })} />
  },
}))
vi.mock('../nutrition.css', () => ({}))

import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const EAN = '7891000100103'
const granola = { source: 'off', name: 'Granola 400 g', per100g: { kcal: 450, protein: 10, carbs: 60, fat: 15 } }

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

// Opens the panel's scan button and materialises the sheet Nutrition hands to openSheet —
// the same `close => <CameraScan …/>` render-prop shape CheckIn uses (views/CheckIn.jsx:243).
function openCamera() {
  const scanBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Scan barcode')
  expect(scanBtn).toBeTruthy()
  act(() => scanBtn.click())
  expect(mocks.openSheet).toHaveBeenCalled()
  const renderSheet = mocks.openSheet.mock.calls.at(-1)[0]
  const closeCam = vi.fn()
  const camHost = document.createElement('div')
  document.body.appendChild(camHost)
  const root = createRoot(camHost)
  mounted.push(root)
  act(() => root.render(renderSheet(closeCam)))
  return { camHost, closeCam }
}

beforeEach(() => {
  useNutritionStore.setState({ log: {}, lastRemoved: null })
  mocks.toast.mockClear()
  mocks.openSheet.mockClear()
  mocks.lookupBarcode.mockReset()
  mocks.importCodeFromImage.mockReset()
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('food barcode scan', () => {
  it('camera scan of a known EAN prefills the entry and one tap adds it', async () => {
    mocks.lookupBarcode.mockResolvedValue([granola])
    const host = render()
    openPanel(host)

    const { camHost, closeCam } = openCamera()
    await act(async () => {
      camHost.querySelector('[data-testid="cam"]').click()
    })
    expect(closeCam).toHaveBeenCalled()
    expect(mocks.lookupBarcode).toHaveBeenCalledWith(EAN)

    const pick = host.querySelector('.nut-pick')
    expect(pick).toBeTruthy()
    expect(pick.textContent).toContain('Granola 400 g')
    const add = [...pick.querySelectorAll('button')].find(b => b.textContent.includes('Add'))
    expect(add).toBeTruthy()
    await act(async () => {
      add.click()
    })

    const entry = useNutritionStore.getState().log[todayISO()][0]
    expect(entry).toMatchObject({
      meal: 'cafe',
      name: 'Granola 400 g',
      source: 'off',
      grams: 100,
      kcal: 450,
      protein: 10,
      carbs: 60,
      fat: 15,
    })
  })

  it('photo import decodes the EAN with retail barcode formats and prefills the same way', async () => {
    mocks.importCodeFromImage.mockResolvedValue({ value: EAN, fmt: 'ean_13' })
    mocks.lookupBarcode.mockResolvedValue([granola])
    const host = render()
    openPanel(host)

    const input = host.querySelector('.nut-add input[type="file"]')
    expect(input).toBeTruthy()
    const file = new File(['x'], 'ean.png', { type: 'image/png' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // the decoder must be asked for 1D retail formats — jsQR alone only ever reads QR
    expect(mocks.importCodeFromImage.mock.calls[0][1]).toContain('ean_13')
    expect(mocks.lookupBarcode).toHaveBeenCalledWith(EAN)
    expect(host.querySelector('.nut-pick')?.textContent).toContain('Granola 400 g')
  })

  it('an unknown EAN falls back to the existing not-found state', async () => {
    mocks.lookupBarcode.mockResolvedValue([])
    const host = render()
    openPanel(host)

    const { camHost } = openCamera()
    await act(async () => {
      camHost.querySelector('[data-testid="cam"]').click()
    })
    expect(mocks.lookupBarcode).toHaveBeenCalledWith(EAN)

    // the miss drops the code into the search field, where the panel's own debounced
    // search settles it into the usual "No matches for {0}" line
    await act(async () => {
      await new Promise(r => setTimeout(r, 450))
    })
    expect(host.querySelector('.nut-pick')).toBeNull()
    expect(host.textContent).toContain(`No matches for ${EAN}`)
    expect(useNutritionStore.getState().log[todayISO()] ?? []).toHaveLength(0)
  })
})
