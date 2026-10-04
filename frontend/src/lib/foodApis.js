// External food search — three sources behind one normalised shape:
//   { source, name, per100g: { kcal, protein, carbs, fat } }
// so the add-food flow can list local and online results identically.
//
//   USDA FoodData Central — GET /fdc/v1/foods/search with the public DEMO_KEY (rate-limited
//     but keyless for us); nutrients come back per 100 g, keyed by nutrientId/number.
//   Open Food Facts — no key at all; the classic cgi/search.pl JSON endpoint, per-100 g
//     fields under `nutriments`.
//   Nutritionix — only through the app's own proxy (VITE_NUTRITION_PROXY_URL, set later);
//     it needs an app key that must never ship in the bundle. Unset = the source is
//     silently skipped, so the app builds and runs with no external keys.
//
// Every source fails soft against the others: a timeout, a 429 from the DEMO_KEY pool or an
// offline device lets searchExternal return whatever the surviving sources produced. When
// EVERY source fails there are no survivors — searchExternal then rejects with a
// distinguishable error, so the caller (Nutrition.jsx) shows its explicit error state
// instead of an empty result the UI would render as "no matches" (plan todo 28, audit #13).

const TIMEOUT_MS = 7000

async function fetchJSON(url, { method = 'GET', body, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const tm = setTimeout(() => ctrl.abort(), timeout)
  try {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally {
    clearTimeout(tm)
  }
}

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round1 = v => Math.round(v * 10) / 10

// USDA nutrient ids (and the legacy nutrientNumber fallbacks) for the four macros.
const USDA_KEYS = new Map([
  [1008, 'kcal'], [208, 'kcal'],
  [1003, 'protein'], [203, 'protein'],
  [1005, 'carbs'], [205, 'carbs'],
  [1004, 'fat'], [204, 'fat'],
])

export async function searchUSDA(query) {
  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
    + '?api_key=DEMO_KEY&pageSize=8&query=' + encodeURIComponent(query)
  const data = await fetchJSON(url)
  const out = []
  for (const f of data.foods || []) {
    if (!f.description) continue
    const per = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    let seen = false
    for (const n of f.foodNutrients || []) {
      const key = USDA_KEYS.get(num(n.nutrientId)) || USDA_KEYS.get(String(n.nutrientNumber ?? n.nutrient?.number ?? ''))
      if (!key) continue
      const v = num(n.value)
      if (v != null) { per[key] = round1(v); if (key === 'kcal') seen = true }
    }
    if (!seen && !per.protein) continue   // a description with no nutrition at all is noise
    out.push({ source: 'usda', name: f.description, per100g: per })
  }
  return out
}

export async function searchOFF(query) {
  const url = 'https://world.openfoodfacts.org/cgi/search.pl?json=1&action=process&page_size=8'
    + '&search_simple=1&fields=product_name,generic_name,nutriments'
    + '&search_terms=' + encodeURIComponent(query)
  const data = await fetchJSON(url)
  const out = []
  for (const p of data.products || []) {
    const name = (p.product_name || p.generic_name || '').trim()
    if (!name) continue
    const n = p.nutriments || {}
    const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy_100g']) != null ? round1(n['energy_100g'] / 4.184) : null)
    if (kcal == null && num(n['proteins_100g']) == null) continue
    out.push({
      source: 'off',
      name,
      per100g: {
        kcal: kcal ?? 0,
        protein: num(n['proteins_100g']) ?? 0,
        carbs: num(n['carbohydrates_100g']) ?? 0,
        fat: num(n['fat_100g']) ?? 0,
      },
    })
  }
  return out
}

export const nutritionixProxy = () => {
  try { return import.meta.env?.VITE_NUTRITION_PROXY_URL || '' } catch { return '' }
}

export async function searchNutritionix(query) {
  const base = nutritionixProxy()
  if (!base) return []   // key arrives later — no proxy configured, nothing to call
  const data = await fetchJSON(base, { method: 'POST', body: JSON.stringify({ query }) })
  const foods = data.foods || data?.result?.foods || []
  const out = []
  for (const fd of foods) {
    if (!fd.food_name) continue
    // Nutritionix natural endpoints report per serving; the serving weight converts to
    // per 100 g. Without a weight there is nothing to scale by, so the serving is used as-is.
    const weight = num(fd.serving_weight_grams)
    const f = weight && weight > 0 ? 100 / weight : 1
    out.push({
      source: 'nutritionix',
      name: fd.food_name,
      per100g: {
        kcal: round1((num(fd.nf_calories) ?? 0) * f),
        protein: round1((num(fd.nf_protein) ?? 0) * f),
        carbs: round1((num(fd.nf_total_carbohydrate) ?? 0) * f),
        fat: round1((num(fd.nf_total_fat) ?? 0) * f),
      },
    })
  }
  return out
}

// Run every available source in parallel, each in its own try/catch (a failing source
// must not sink the others), then de-duplicate by accent-folded name — the same product
// usually exists in both USDA and OFF. Order: local rank isn't involved here; USDA first
// (most authoritative per-100 g), then OFF, then Nutritionix. If every source threw the
// rejection propagates — never a silent [].
export async function searchExternal(query) {
  const q = String(query || '').trim()
  if (!q) return []
  const sources = [['usda', searchUSDA], ['off', searchOFF]]
  if (nutritionixProxy()) sources.push(['nutritionix', searchNutritionix])
  const failed = []
  const groups = await Promise.all(sources.map(async ([name, fn]) => {
    try { return await fn(q) } catch { failed.push(name); return [] }
  }))
  if (failed.length === sources.length) throw new Error('All external food sources failed: ' + failed.join(', '))
  const seen = new Set()
  const out = []
  for (const item of groups.flat()) {
    const key = item.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
