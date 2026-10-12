import { describe, it, expect, vi } from 'vitest'

// The other side of decode1D's contract: a missing/broken WASM build (offline install, blocked
// asset) must answer "no code", never throw into the camera loop. The module factory throws,
// which is what a failed dynamic import looks like to the caller.
vi.mock('@sec-ant/zxing-wasm/reader', () => {
  throw new Error('wasm gone')
})

const { decode1D } = await import('./scan-web.js')

describe('decode1D with the WASM broken', () => {
  it('answers null instead of throwing', async () => {
    const img = { data: new Uint8ClampedArray(64 * 64 * 4), width: 64, height: 64 }
    expect(await decode1D(img, ['ean_13'])).toBeNull()
  })
})
