import { describe, it, expect } from 'vitest'
import { generate } from 'lean-qr'
import { decodeImageData, decode1D } from './scan-web.js'

// Round trip through the two libraries the browser path relies on: lean-qr draws a code (the
// same renderer the card view uses), jsQR reads it back. Pixels are built by hand from
// code.get(x, y) — no canvas in this environment — scaled 4× with a 4-module quiet zone, which
// is what a phone camera would roughly see.
function rasterize(code, scale = 4, quiet = 4) {
  const n = code.size + quiet * 2
  const w = n * scale
  const data = new Uint8ClampedArray(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet,
        my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my)
      const v = dark ? 0 : 255
      const i = (y * w + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: w }
}

describe('decodeImageData', () => {
  it('reads back a code lean-qr generated', async () => {
    const value = 'MEMBER-0042-FITZONE'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit).toEqual({ value, fmt: 'qrcode' })
  })

  it('reads a URL-shaped code, the other common gym format', async () => {
    const value = 'https://checkin.example.com/m/8f3a1c?v=2'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit?.value).toBe(value)
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeImageData(blank)).toBeNull()
    expect(await decodeImageData(null)).toBeNull()
    expect(await decodeImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})

// Smoke test with the REAL zxing-wasm: the module must load and scan under vitest at all —
// a WASM packaging regression (import specifier, bundler config) fails here, not on a phone.
describe('decode1D against the real zxing-wasm', () => {
  it('scans a blank buffer and answers null (no symbol, no throw)', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decode1D(blank, ['ean_13'])).toBeNull()
  })

  it('never loads the WASM for a QR-only caller', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decode1D(blank, ['qr_code'])).toBeNull()
  })
})

// EAN-13, drawn by hand: the retail code the food scanner reads on a phone with no
// BarcodeDetector (iOS Safari). A mocked zxing would green-light a broken pipeline — this
// round trip runs the real WASM over real bars, so the iOS path is covered, not assumed.
const EAN_L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
]
const EAN_G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
]
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
const EAN_R = EAN_L.map(b => b.replace(/1/g, 'x').replace(/0/g, '1').replace(/x/g, '0'))

/** 13-digit EAN (with checksum) → 95-module bit string: guard 101, six digits in the first
 *  digit's L/G parity, centre 01010, six digits in R (complement of L), guard 101. */
function ean13Bits(code) {
  const d = String(code).split('').map(Number)
  const parity = EAN_PARITY[d[0]]
  let bits = '101'
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]]
  bits += '01010'
  for (let i = 7; i <= 12; i++) bits += EAN_R[d[i]]
  return bits + '101'
}

function rasterizeBars(bits, scale = 3, quiet = 10, modules = 30) {
  const w = (bits.length + quiet * 2) * scale
  const h = modules * scale
  const data = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let x = 0; x < bits.length; x++) {
    if (bits[x] !== '1') continue
    for (let sx = 0; sx < scale; sx++) {
      const px = (x + quiet) * scale + sx
      for (let y = 0; y < h; y++) {
        const i = (y * w + px) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
      }
    }
  }
  return { data, width: w, height: h }
}

describe('decode1D round trip — a real EAN-13 through the real WASM', () => {
  it('decodes bars rasterized by hand and names the format the same way BarcodeDetector does', async () => {
    const value = '7891000315507'
    const hit = await decode1D(rasterizeBars(ean13Bits(value)), ['qr_code', 'ean_13'])
    expect(hit).toEqual({ value, fmt: 'ean13' })
  })
})
