// RF10 (roadmap-features todo 10): the meal-photo estimate, client half.
//
// One photo in (a downscaled JPEG data URL), the per-100 g entries the add-food form already
// edits out. PHOTO_MODEL and PHOTO_SYSTEM are byte-copied into functions/index.js's server
// route: the functions bundle ships only its own directory and cannot import this ESM module
// - the same duplication trade-off as SYSTEM_PROMPT, pinned by both suites' contract tests.
// The downscale rides the same createImageBitmap + canvas path lib/scan-web.js decodes with.
export const PHOTO_MODEL = 'qwen/qwen3.8-27b'
export const PHOTO_SYSTEM =
  'You estimate the macros of a meal photo. Reply ONLY with JSON: ' +
  '{"foods":[{"name":string,"grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,"confidence":number}]}. ' +
  'grams is the estimated portion size of that item; kcal, protein, carbs and fat are TOTALS for that portion. ' +
  'confidence is between 0 and 1. List at most 5 foods you can actually see, with Portuguese (pt-BR) names.'

const MAX_EDGE = 1024
const JPEG_QUALITY = 0.7

/** Largest-edge fit: a 12 MP camera photo becomes ~1024 px before it is ever encoded. */
export function fitWithin(width, height, max = MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  if (width <= max && height <= max) return { width, height }
  const scale = Math.min(max / width, max / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** File -> scaled canvas -> JPEG data URL (quality ~0.7, well under the 4 MiB route cap). */
export async function fileToDataUrl(file, opts = {}) {
  const max = opts.max || MAX_EDGE
  const quality = opts.quality || JPEG_QUALITY
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if (typeof bitmap.close === 'function') bitmap.close()
  return canvas.toDataURL('image/jpeg', quality)
}

/** 0..1 stays, a percent (and the odd over-shoot like 1.5) resolves back into 0..1. */
const conf = v => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n > 2 ? n / 100 : n))
}

/** One portion-shaped food -> the entry confirmAdd scales (Nutrition.jsx pick/confirmAdd). */
function toEntry(f) {
  if (!f || typeof f !== 'object') return null
  const name = typeof f.name === 'string' ? f.name.trim().slice(0, 60) : ''
  const grams = Number(f.grams)
  if (!name || !Number.isFinite(grams) || grams <= 0) return null
  const g = Math.min(1500, Math.max(1, Math.round(grams)))
  const macro = v => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN
  }
  const totals = {
    kcal: macro(f.kcal),
    protein: macro(f.protein),
    carbs: macro(f.carbs),
    fat: macro(f.fat),
  }
  if (
    !Number.isFinite(totals.kcal) ||
    !Number.isFinite(totals.protein) ||
    !Number.isFinite(totals.carbs) ||
    !Number.isFinite(totals.fat)
  )
    return null
  const scale = 100 / g
  return {
    name,
    source: 'photo',
    grams: g,
    per100g: {
      kcal: Math.round(totals.kcal * scale),
      protein: Math.round(totals.protein * scale),
      carbs: Math.round(totals.carbs * scale),
      fat: Math.round(totals.fat * scale),
    },
    confidence: conf(f.confidence),
  }
}

/** Model JSON text | server result array | {foods}/{results} -> editable candidates, ≤ 5. */
export function parseEstimate(input) {
  let value = input
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      const s = value.indexOf('{')
      const e = value.lastIndexOf('}')
      try {
        value = s >= 0 && e > s ? JSON.parse(value.slice(s, e + 1)) : null
      } catch {
        value = null
      }
    }
  }
  const foods = Array.isArray(value)
    ? value
    : value && Array.isArray(value.foods)
      ? value.foods
      : value && Array.isArray(value.results)
        ? value.results
        : []
  return foods.map(toEntry).filter(Boolean).slice(0, 5)
}
