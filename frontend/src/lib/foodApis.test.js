// External food search — normalised mapping for each source, plus `searchExternal`'s
// error-propagation contract (plan todo 28): a rejected fetch must surface as a
// distinguishable rejection — never a silent [] that the caller would render as "no
// results" — while a single failing source still fails soft against the survivors.
// Network is fully stubbed (vi.stubGlobal('fetch', ...) — the pattern from coach-local.test.js).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { searchUSDA, searchOFF, searchNutritionix, searchExternal, nutritionixProxy } from './foodApis.js'

const jsonRes = data => ({ ok: true, json: async () => data })

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  // Deterministic: never let a local .env pull Nutritionix into these tests.
  vi.stubEnv('VITE_NUTRITION_PROXY_URL', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('searchUSDA', () => {
  it('maps USDA rows onto the shared per-100 g shape, skipping rows with no usable nutrition', async () => {
    fetchMock.mockResolvedValue(jsonRes({
      foods: [
        { description: 'Banana, raw', foodNutrients: [
          { nutrientId: 1008, value: 89 },
          { nutrientId: 1003, value: 1.09 },
          { nutrientId: 1005, value: 22.84 },
          { nutrientId: 1004, value: 0.33 },
        ] },
        // Present-but-partial macros: missing ones stay 0, values round to 1 decimal.
        { description: 'Partial macros', foodNutrients: [
          { nutrientId: 208, value: 52 },
          { nutrientId: 203, value: 0.26 },
        ] },
        { description: 'Empty plate', foodNutrients: [] },                          // no kcal/protein → dropped
        { foodNutrients: [{ nutrientId: 1008, value: 10 }] },                       // no description → dropped
      ],
    }))

    const out = await searchUSDA('açúcar')

    // Input formatting: the query travels URL-encoded exactly once.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('query=a%C3%A7%C3%BAcar')

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      source: 'usda',
      name: 'Banana, raw',
      per100g: { kcal: 89, protein: 1.1, carbs: 22.8, fat: 0.3 },
    })
    expect(out[1].per100g).toEqual({ kcal: 52, protein: 0.3, carbs: 0, fat: 0 })
  })
})

describe('searchOFF', () => {
  it('reads Open Food Facts names and macros, with the kJ→kcal fallback', async () => {
    fetchMock.mockResolvedValue(jsonRes({
      products: [
        { product_name: 'Pão Integral', nutriments: {
          'energy-kcal_100g': 247, proteins_100g: 8, carbohydrates_100g: 44, fat_100g: 3.5,
        } },
        // No energy-kcal_100g → energy_100g (kJ) divided by 4.184; name from generic_name.
        { generic_name: 'Suco de Laranja', nutriments: { energy_100g: 418.4, proteins_100g: 5 } },
        { product_name: 'Sem Macros', nutriments: {} },   // no kcal, no protein → dropped
        { nutriments: { proteins_100g: 1 } },             // no name at all → dropped
      ],
    }))

    const out = await searchOFF('pão')

    expect(fetchMock.mock.calls[0][0]).toContain('search_terms=p%C3%A3o')

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      source: 'off',
      name: 'Pão Integral',
      per100g: { kcal: 247, protein: 8, carbs: 44, fat: 3.5 },
    })
    expect(out[1]).toEqual({
      source: 'off',
      name: 'Suco de Laranja',
      per100g: { kcal: 100, protein: 5, carbs: 0, fat: 0 },
    })
  })
})

describe('searchNutritionix', () => {
  it('stays silent without a proxy: empty result, zero requests', async () => {
    expect(nutritionixProxy()).toBe('')
    expect(await searchNutritionix('whey')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('searchExternal', () => {
  it('treats blank input as a no-op — nothing is fetched for "", whitespace, or null', async () => {
    expect(await searchExternal('')).toEqual([])
    expect(await searchExternal('   ')).toEqual([])
    expect(await searchExternal(null)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a single entry when both sources return the same food with different accents/case', async () => {
    fetchMock.mockImplementation(url => Promise.resolve(
      String(url).includes('nal.usda.gov')
        ? jsonRes({ foods: [{ description: 'Feijão carioca cozido', foodNutrients: [{ nutrientId: 1008, value: 76 }] }] })
        : jsonRes({ products: [{ product_name: 'FEIJÃO CARIOCA COZIDO', nutriments: { 'energy-kcal_100g': 76 } }] }),
    ))

    const out = await searchExternal('feijao')

    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('usda')   // USDA runs first, so its row wins the dedup
    expect(out[0].name).toBe('Feijão carioca cozido')
  })

  it('propagates a distinguishable rejection when every source fails — never a silent []', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))

    // Nutrition.jsx maps a rejection to its explicit "Could not search online" state;
    // resolving [] here would render it as "no results" instead (plan todo 28, audit #13).
    await expect(searchExternal('banana')).rejects.toThrow(/All external food sources failed/)
  })

  it('still fails soft per source: one rejecting source keeps the other one’s results', async () => {
    fetchMock.mockImplementation(url => Promise.resolve(
      String(url).includes('nal.usda.gov')
        ? Promise.reject(new Error('HTTP 429'))   // DEMO_KEY pool exhausted
        : jsonRes({ products: [{ product_name: 'Pão Integral', nutriments: { 'energy-kcal_100g': 247 } }] }),
    ))

    const out = await searchExternal('pao')

    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('off')
  })
})
