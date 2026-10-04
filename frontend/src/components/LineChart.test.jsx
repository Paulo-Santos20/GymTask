// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import LineChart from './LineChart.jsx'
import { fmtDate, isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const point = (year, month, day, y) => ({
  d: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  t: new Date(year, month - 1, day, 12).getTime(),
  y,
})

const firstPoints = [
  { t: Date.UTC(2026, 0, 1), y: 80, d: '2026-01-01' },
  { t: Date.UTC(2026, 0, 15), y: 82, d: '2026-01-15' },
]
const nextPoints = [
  { t: Date.UTC(2026, 1, 1), y: 78, d: '2026-02-01' },
  { t: Date.UTC(2026, 1, 15), y: 79, d: '2026-02-15' },
]

function renderChart(points) {
  act(() => root.render(<LineChart points={points} axes={false} unit="kg" />))
}

function hoverAt(clientX) {
  act(() => {
    container.querySelector('.chart-i').dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX }))
  })
  return container.querySelector('.ctip').textContent
}

describe('LineChart hover date', () => {
  it('keeps same-year points in the compact format', () => {
    const first = point(2026, 1, 15, 70)
    renderChart([first, point(2026, 2, 15, 71)])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true)} · 70 kg`)
  })

  it('includes the calendar year at a short cross-year boundary', () => {
    const first = point(2025, 11, 30, 70)
    const last = point(2026, 2, 1, 71)
    renderChart([first, last])

    expect(hoverAt(0)).toBe(`${fmtDate(first.d, true, true)} · 70 kg`)
    expect(hoverAt(340)).toBe(`${fmtDate(last.d, true, true)} · 71 kg`)
  })

  it('keeps a single point compact', () => {
    const only = point(2026, 7, 4, 70)
    renderChart([only])

    expect(hoverAt(170)).toBe(`${fmtDate(only.d, true)} · 70 kg`)
  })

  it('uses timestamp-only points when deciding whether to show the year', () => {
    const first = point(2025, 12, 31, 70)
    const last = point(2026, 1, 1, 71)
    const timestampOnly = [
      { t: first.t, y: first.y },
      { t: last.t, y: last.y },
    ]
    renderChart(timestampOnly)

    const lastIso = isoOf(new Date(last.t))
    expect(hoverAt(340)).toBe(`${fmtDate(lastIso, true, true)} · 71 kg`)
  })
})

describe('LineChart hover state', () => {
  it('clears the tooltip and hover markers when points are replaced, then allows hovering again', () => {
    renderChart(firstPoints)
    hoverAt(170)

    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
    expect(container.querySelector('.chl')).toBeTruthy()

    renderChart(nextPoints)

    expect(container.querySelector('.ctip')).toBeNull()
    expect(container.querySelector('.cvl')).toBeNull()
    expect(container.querySelector('.chl')).toBeNull()

    hoverAt(170)
    expect(container.querySelector('.ctip')).toBeTruthy()
    expect(container.querySelector('.cvl')).toBeTruthy()
  })
})

// Combined chart (RF5): several series share one date axis, each with its own scale and its
// own unit, and a null y is an open break — no vertex, no zero, nothing to misread.
const multiSeries = [
  {
    label: 'Weight',
    unit: 'kg',
    color: 'var(--teal)',
    points: [
      { t: Date.UTC(2026, 8, 1, 12), y: 80, d: '2026-09-01' },
      { t: Date.UTC(2026, 8, 5, 12), y: null, d: '2026-09-05' },
      { t: Date.UTC(2026, 8, 9, 12), y: 79, d: '2026-09-09' },
      { t: Date.UTC(2026, 8, 14, 12), y: 79.4, d: '2026-09-14' },
    ],
  },
  {
    label: 'Intake',
    unit: 'kcal',
    color: 'var(--blue)',
    points: [
      { t: Date.UTC(2026, 8, 1, 12), y: 2200, d: '2026-09-01' },
      { t: Date.UTC(2026, 8, 14, 12), y: 2100, d: '2026-09-14' },
    ],
  },
]

function renderSeries(series) {
  act(() => root.render(<LineChart series={series} axes={false} />))
}

describe('LineChart multi-series', () => {
  it('draws each series on the shared date axis and stops the line at a null gap', () => {
    renderSeries(multiSeries)

    const lines = [...container.querySelectorAll('polyline')]
    expect(lines).toHaveLength(2)
    // weight is broken by its null into one drawn segment, intake into one whole line
    expect(lines.map(l => l.getAttribute('points').trim().split(/\s+/).length)).toEqual([2, 2])
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.textContent).not.toContain('No data yet')
  })

  it('names the hovered series and shows its own unit', () => {
    renderSeries(multiSeries)

    expect(hoverAt(0)).toContain('· Weight')
    expect(hoverAt(0)).toContain('80 kg')
  })

  it('falls back to the empty state when every series is empty', () => {
    renderSeries([{ label: 'Weight', unit: 'kg', color: 'var(--teal)', points: [] }])

    expect(container.textContent).toContain('No data yet')
    expect(container.querySelectorAll('polyline')).toHaveLength(0)
  })
})
