import { describe, it, expect, vi, beforeEach } from 'vitest'

// The 1D fallback wiring (lib/scan-web.js decode1D) with the zxing module mocked: which formats
// are asked for, which symbol wins, what happens when the WASM refuses to load or throws. The
// real library's decode quality is its own; a smoke test with the real module lives in
// scan-web.test.js.
const readBarcodes = vi.fn()
vi.mock('@sec-ant/zxing-wasm', () => ({
  readBarcodes: (...args) => readBarcodes(...args),
}))

const { decode1D } = await import('./scan-web.js')

const px = (v = 255) => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(v), width: 64, height: 64 })

beforeEach(() => {
  readBarcodes.mockReset()
  readBarcodes.mockResolvedValue([])
})

describe('decode1D', () => {
  it('returns the requested 1D symbol as { value, fmt } in the shared token space', async () => {
    readBarcodes.mockResolvedValue([
      { text: '7891000315507', format: 'EAN-13' },
      { text: 'x', format: 'QRCode' },
    ])
    const hit = await decode1D(px(), ['qr_code', 'ean_13', 'ean_8'])
    expect(hit).toEqual({ value: '7891000315507', fmt: 'ean13' })
    expect(readBarcodes).toHaveBeenCalledWith(px(255), expect.objectContaining({ formats: ['EAN-13', 'EAN-8'] }))
  })

  it('ignores a symbology the caller did not ask for', async () => {
    // zxing honours its options, but the wiring must not trust that: a stray EAN in the answer
    // of a Code128 request is not the code the caller asked to read
    readBarcodes.mockResolvedValue([{ text: '7891000315507', format: 'EAN-13' }])
    expect(await decode1D(px(), ['code_128'])).toBeNull()
  })

  it('answers null — never downloads the WASM — for a QR-only caller', async () => {
    expect(await decode1D(px(), ['qr_code'])).toBeNull()
    expect(await decode1D(px())).toBeNull()
    expect(readBarcodes).not.toHaveBeenCalled()
  })

  it('null-guards its pixels', async () => {
    expect(await decode1D(null, ['ean_13'])).toBeNull()
    expect(await decode1D({ data: null, width: 4, height: 4 }, ['ean_13'])).toBeNull()
  })

  it('answers null instead of throwing when the WASM throws', async () => {
    readBarcodes.mockRejectedValue(new Error('wasm died'))
    expect(await decode1D(px(), ['ean_13'])).toBeNull()
  })
})
