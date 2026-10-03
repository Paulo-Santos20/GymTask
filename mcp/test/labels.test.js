// Label-formatting tests for mcp/src/labels.js — the glue between the lib helpers (which
// speak {0} templates, mm:ss and locale formatting) and the JSON an LLM reads back. The tool
// tests pin some of these strings end-to-end; here the formatter itself is the subject: every
// exercise mode, the null sentinels, and the unknown-value passthroughs that keep a bad slug
// readable instead of breaking a tool answer.
//
// The file ends with the plain-node loadability check: vitest resolves imports through
// Vite, so it structurally cannot catch a browser-only import (the incident that gave CI
// `npm run check:node-loadable` — a Vite-only `import.meta.glob` in i18n.js shipped 33 green
// tests over a server that died on startup). This test re-runs the touched modules' imports
// under a bare `node` child process, from inside the suite.
import { describe, test, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fmt, exLine, muscleName, policyName, friendlyDate, friendlyDuration, ratio, muscleOrder, setLabel } from '../src/labels.js'

/* ---------- fmt ---------- */

describe('fmt', () => {
  test('substitutes {0},{1}… positionally and leaves unfilled placeholders visible', () => {
    expect(fmt('Item {0} of {1}', ['a', 3])).toBe('Item a of 3')
    expect(fmt('no placeholders', ['x'])).toBe('no placeholders')
    expect(fmt('num {0}', [7])).toBe('num 7')
    // Fewer args than placeholders: the hole stays visible rather than being blanked —
    // a missing number must read as missing, not as "  ".
    expect(fmt('left {1} alone', ['x'])).toBe('left {1} alone')
  })
})

/* ---------- exLine ---------- */

describe('exLine', () => {
  test('a reps prescription renders with its load, or bare when it carries none', () => {
    expect(exLine({ sets: 3, reps: 8, weight: 40 }, 'kg')).toBe('3 × 8 · 40 kg')
    // weight 0 means no bar load — the line must not trail a dangling "· ".
    expect(exLine({ sets: 5, reps: 5, weight: 0 }, 'kg')).toBe('5 × 5')
  })

  test('a double-progression range reads as the range, as the routine editor shows it', () => {
    expect(exLine({ sets: 3, reps: 12, repsMin: 8, weight: 40 }, 'kg')).toBe('3 × 8–12 · 40 kg')
  })

  test('timed entries render mm:ss and default the hold the way the plan does', () => {
    expect(exLine({ mode: 'time', sets: 3, sec: 60, weight: 20 }, 'kg')).toBe('3 × 1:00 · 20 kg')
    expect(exLine({ mode: 'time', sets: 1 }, 'kg')).toBe('1 × 0:45')  // sec defaults to 45
  })

  test('cardio entries render pace, defaulting to 20 min @ 8 km/h', () => {
    expect(exLine({ mode: 'cardio', sets: 1, min: 20, speed: 8 }, 'kg')).toBe('1 × 20 min @ 8 km/h')
    expect(exLine({ mode: 'cardio', sets: 2 }, 'kg')).toBe('2 × 20 min @ 8 km/h')
  })

  test('a fractional load renders through the profile locale (pt-BR decimal comma)', () => {
    // fmtNum() formats for dateLocale(), which defaults to pt-BR on the server — the same
    // number the app shows. Pinning it here catches a locale silently falling back.
    expect(exLine({ mode: 'reps', sets: 2, reps: 10, weight: 152.5 }, 'kg')).toBe('2 × 10 · 152,5 kg')
  })
})

/* ---------- names ---------- */

describe('muscleName / policyName', () => {
  test('muscleName maps known slugs and echoes unknown ones', () => {
    expect(muscleName('quadriceps')).toBe('Quads')
    expect(muscleName('chest')).toBe('Chest')
    expect(muscleName('nope')).toBe('nope')  // a slug outside the map still reads as itself
  })

  test('policyName maps every saveable policy and echoes unknown ones', () => {
    expect(policyName('greyskull')).toBe('Greyskull LP')
    expect(policyName('off')).toBe('No automatic progression')
    expect(policyName('time')).toBe('Add time')
    expect(policyName('mystery')).toBe('mystery')
  })
})

/* ---------- friendlyDate / friendlyDuration ---------- */

describe('friendlyDate / friendlyDuration', () => {
  test('a date formats for the profile locale; nothing to show is null', () => {
    expect(friendlyDate('2026-07-27')).toBe('27 de jul.')
    expect(friendlyDate(null)).toBeNull()
    expect(friendlyDate('')).toBeNull()
  })

  test('durations switch to "H h M m" past the hour; zero never renders as "0 min"', () => {
    expect(friendlyDuration(4260000)).toBe('1h 11m')  // 71 minutes
    expect(friendlyDuration(1800000)).toBe('30 min')
    expect(friendlyDuration(0)).toBeNull()
    expect(friendlyDuration(null)).toBeNull()
    expect(friendlyDuration(undefined)).toBeNull()
  })
})

/* ---------- ratio / muscleOrder / setLabel ---------- */

describe('ratio / muscleOrder / setLabel', () => {
  test('ratio renders done/total verbatim', () => {
    expect(ratio(3, 5)).toBe('3/5')
    expect(ratio(0, 0)).toBe('0/0')
  })

  test('muscleOrder hands out a copy of the 18-muscle head-to-toe order', () => {
    const order = muscleOrder()
    expect(order).toHaveLength(18)
    expect(order[0]).toBe('trapezius')
    expect(order.at(-1)).toBe('tibialis')
    order.push('mutated')
    expect(muscleOrder()).toHaveLength(18)  // the copy cannot corrupt the module's own list
  })

  test('setLabel — the re-export tools.js builds set rows with — renders every mode', () => {
    expect(setLabel('squat', { w: 60, r: 5 }, { mode: 'reps' })).toBe('60×5')
    expect(setLabel('plank', { sec: 90, w: 0 }, { mode: 'time' })).toBe('1:30')
    expect(setLabel('plank', { sec: 90, w: 20 }, { mode: 'time' })).toBe('1:30 · 20')
    expect(setLabel('row', { min: 20, speed: 8 }, { mode: 'cardio' })).toBe('20 min @ 8 km/h')
  })
})

/* ---------- plain-node loadability ---------- */

describe('plain-node loadability', () => {
  test('labels.js and state.js import in a bare node child process, outside vitest/Vite', () => {
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src')
    const labelsUrl = pathToFileURL(path.join(src, 'labels.js')).href
    const stateUrl = pathToFileURL(path.join(src, 'state.js')).href
    // Dynamic import with top-level await: --input-type=module evaluates the snippet as ESM,
    // so nothing in the child resolves through a bundler. A browser-only import in either
    // module — or in the frontend/src/lib chain labels.js drags in — exits non-zero here.
    const script = `
      const labels = await import(${JSON.stringify(labelsUrl)})
      const state = await import(${JSON.stringify(stateUrl)})
      if (typeof labels.exLine !== 'function') throw new Error('labels.js lost exLine')
      if (typeof state.getState !== 'function') throw new Error('state.js lost getState')
      console.log('plain-node import ok')
    `
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(out).toContain('plain-node import ok')
  })
})
