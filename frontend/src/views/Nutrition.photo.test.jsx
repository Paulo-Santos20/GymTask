// @vitest-environment happy-dom
// RF10 (roadmap-features todo 10): photo -> macro estimate in the add-food panel. The plan's
// QA pair, red first: consent OFF -> the tap asks for sharing and NOTHING leaves the device;
// consent ON -> the photo goes through lib/photo + coach-api (both stubbed here, no network),
// the candidates land as rows, one tap prefills the existing grams form and confirmAdd is
// still the only writer. Demo build -> the button does not exist (a demo never sends photos).
// Mock seam mirrors Nutrition.barcode.test.jsx (useUI/foodApis/scan/CameraScan + css).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  openSheet: vi.fn(),
  searchExternal: vi.fn(),
  importCodeFromImage: vi.fn(),
  fileToDataUrl: vi.fn(),
  photoEstimate: vi.fn(),
  demo: false,
}))

vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: mocks.toast, openSheet: mocks.openSheet, closeSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snapshot()) : snapshot())
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('../lib/foodApis.js', () => ({ searchExternal: mocks.searchExternal }))
vi.mock('../lib/scan.js', () => ({ importCodeFromImage: mocks.importCodeFromImage }))
vi.mock('../components/CameraScan.jsx', () => ({ default: function FakeCamera() {} }))
vi.mock('../nutrition.css', () => ({}))
vi.mock('../lib/photo.js', () => ({ fileToDataUrl: mocks.fileToDataUrl }))
vi.mock('../lib/coach-api.js', () => ({ photoEstimate: mocks.photoEstimate }))
vi.mock('../lib/demo.js', () => ({
  get DEMO() {
    return mocks.demo
  },
}))

import Nutrition from './Nutrition.jsx'
import { useNutritionStore } from '../store/nutritionStore.js'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const CANDIDATE = {
  name: 'Arroz com frango',
  source: 'photo',
  grams: 300,
  per100g: { kcal: 150, protein: 15, carbs: 20, fat: 3 },
  confidence: 0.87,
}

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

const photoButton = host => [...host.querySelectorAll('button')].find(b => b.textContent.includes('Photo of the meal'))

async function choosePhoto(panel) {
  const input = panel.querySelector('input[capture]')
  expect(input).toBeTruthy()
  const file = new File(['x'], 'meal.jpg', { type: 'image/jpeg' })
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
  mocks.importCodeFromImage.mockReset()
  mocks.fileToDataUrl.mockReset()
  mocks.photoEstimate.mockReset()
  mocks.demo = false
  document.body.innerHTML = ''
})
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach(root => root.unmount())
  })
})

describe('meal photo estimate', () => {
  it('without Coach consent the tap asks for sharing and nothing leaves the device', async () => {
    setConsent(false)
    const host = render()
    openPanel(host)

    const btn = photoButton(host)
    expect(btn).toBeTruthy()
    await act(async () => {
      btn.click()
    })

    expect(mocks.toast).toHaveBeenCalledWith('Share your data with the Coach first')
    expect(mocks.fileToDataUrl).not.toHaveBeenCalled()
    expect(mocks.photoEstimate).not.toHaveBeenCalled()
  })

  it('a consented photo prefills an editable entry and one tap adds it', async () => {
    setConsent(true)
    mocks.fileToDataUrl.mockResolvedValue('data:image/jpeg;base64,QUJD')
    mocks.photoEstimate.mockResolvedValue({ results: [CANDIDATE] })

    const host = render()
    const panel = openPanel(host)
    const btn = photoButton(host)
    expect(btn).toBeTruthy()
    await act(async () => {
      btn.click()
    })

    const file = await choosePhoto(panel)
    expect(mocks.fileToDataUrl).toHaveBeenCalledWith(file)
    expect(mocks.photoEstimate).toHaveBeenCalledWith('data:image/jpeg;base64,QUJD')

    const row = [...panel.querySelectorAll('.lrow')].find(r => r.textContent.includes('Arroz com frango'))
    expect(row).toBeTruthy()
    expect(row.textContent).toContain('87%')
    await act(async () => {
      row.click()
    })

    const pick = host.querySelector('.nut-pick')
    expect(pick).toBeTruthy()
    expect(pick.textContent).toContain('Arroz com frango')
    const add = [...pick.querySelectorAll('button')].find(b => b.textContent.includes('Add'))
    expect(add).toBeTruthy()
    await act(async () => {
      add.click()
    })

    const entry = useNutritionStore.getState().log[todayISO()][0]
    expect(entry).toMatchObject({
      meal: 'cafe',
      name: 'Arroz com frango',
      source: 'photo',
      grams: 300,
      kcal: 450,
      protein: 45,
      carbs: 60,
      fat: 9,
    })
  })

  it('a failed estimate (429 or offline) shows the fallback line and manual entry stays open', async () => {
    setConsent(true)
    mocks.fileToDataUrl.mockResolvedValue('data:image/jpeg;base64,QUJD')
    mocks.photoEstimate.mockRejectedValue(Object.assign(new Error('rate limit'), { status: 429 }))

    const host = render()
    const panel = openPanel(host)
    await act(async () => {
      photoButton(host).click()
    })
    await choosePhoto(panel)

    expect(host.textContent).toContain('Could not analyze that photo')
    expect(useNutritionStore.getState().log[todayISO()] ?? []).toHaveLength(0)
    expect(host.querySelector('.nut-add')).toBeTruthy()
    expect(photoButton(host)).toBeTruthy()
  })

  it('the demo build never shows the photo button, so a demo never sends a photo', async () => {
    mocks.demo = true
    setConsent(true)
    const host = render()
    openPanel(host)
    expect(photoButton(host)).toBeUndefined()
    expect(host.querySelector('input[capture]')).toBeNull()
    expect(mocks.photoEstimate).not.toHaveBeenCalled()
  })
})
