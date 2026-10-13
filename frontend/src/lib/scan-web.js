// Browser-side QR decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Three decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists; asked for whatever formats the caller listed.
//   2. jsQR (Apache-2.0, see NOTICE.md) — pure JS, works everywhere including iOS Safari, which
//      has no BarcodeDetector. Loaded with a dynamic import so it only ships when someone scans.
//   3. zxing-wasm (MIT, see NOTICE.md) — the 1D side jsQR cannot do: retail product codes
//      (EAN/UPC/Code128/39/93/ITF) on iOS Safari and Firefox. Also a dynamic import, and only
//      reached when jsQR found nothing AND the caller asked for a 1D format, so the check-in
//      path (QR only) never downloads the WASM.
//
// decodeImageData is the pure QR core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need.
import { normalizeFmt } from './qr.js'

let _jsqr = null
async function loadJsQr() {
  if (!_jsqr) _jsqr = (await import('jsqr')).default
  return _jsqr
}

// One detector per requested format set: the check-in path reads QR only, the food scanner
// (views/Nutrition.jsx) additionally asks for retail 1D symbologies. A browser that doesn't
// support a requested format throws in the constructor — cached as false → jsQR fallback.
const _formats = new Map()
function nativeDetector(formats) {
  const wanted = formats && formats.length ? formats : ['qr_code']
  const key = wanted.join(',')
  if (!_formats.has(key)) {
    let det = false
    try {
      det = typeof BarcodeDetector === 'function' ? new BarcodeDetector({ formats: wanted }) : false
    } catch (e) {
      det = false
    }
    _formats.set(key, det)
  }
  return _formats.get(key)
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// jsQR only; the native detector wants a drawable, not raw pixels, so it lives in decodeSource.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const jsQR = await loadJsQr()
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return hit && hit.data ? { value: hit.data, fmt: 'qrcode' } : null
}

// The 1D retail symbologies zxing reads, keyed by the token normalizeFmt produces (the same
// token the BarcodeDetector path stores), with zxing-wasm's format name as the value.
const ZXING_FORMATS = {
  ean13: 'EAN-13',
  ean8: 'EAN-8',
  upca: 'UPC-A',
  upce: 'UPC-E',
  code128: 'Code128',
  code39: 'Code39',
  code93: 'Code93',
  itf: 'ITF',
}

// Same pixels in, { value, fmt } out for a 1D symbol. Null when the caller asked for no 1D
// format (the check-in contract is QR-only — jsQR owns it), when the WASM fails to load or
// throws, or when nothing is found. A stateless call per frame: no scanner to keep alive, and
// the library's own tryHarder does the stability work a cache would. readBarcodesFromImageData
// is the name in the pinned 2.2.0 (the /reader subpath — the package root ships the full
// reader+writer build and does not export it).
export async function decode1D(img, formats) {
  if (!img || !img.data || !img.width || !img.height) return null
  const wanted = (formats && formats.length ? formats : ['qr_code']).map(normalizeFmt)
  const zx = wanted.map(f => ZXING_FORMATS[f]).filter(Boolean)
  if (!zx.length) return null
  let mod
  try {
    mod = await import('@sec-ant/zxing-wasm/reader')
  } catch {
    return null
  }
  try {
    const results = (await mod.readBarcodesFromImageData(img, { formats: zx, tryHarder: true })) || []
    const hit = results.find(r => zx.includes(r.format))
    return hit ? { value: hit.text, fmt: normalizeFmt(hit.format) } : null
  } catch {
    return null
  }
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR, and it keeps jsQR fast enough
// to run on every few video frames on a phone. Reuses one canvas across calls. `formats` picks
// what the native detector may read (default QR only — the check-in contract); underneath it
// jsQR covers QR everywhere and zxing-wasm covers the 1D formats the caller asked for.
const MAX = 800
let _canvas = null
export async function decodeSource(source, formats) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0
  const sh = source.videoHeight || source.naturalHeight || source.height || 0
  if (!sw || !sh) return null
  const k = Math.min(1, MAX / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)),
    h = Math.max(1, Math.round(sh * k))
  if (!_canvas) _canvas = document.createElement('canvas')
  _canvas.width = w
  _canvas.height = h
  const ctx = _canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)

  const det = nativeDetector(formats)
  if (det) {
    try {
      const found = await det.detect(_canvas)
      const b = found && found.find(x => x.rawValue)
      if (b) return { value: b.rawValue, fmt: normalizeFmt(b.format) || 'qrcode' }
    } catch (e) {
      /* fall through to jsQR */
    }
  }
  const pixels = ctx.getImageData(0, 0, w, h)
  const viaQr = await decodeImageData(pixels)
  if (viaQr) return viaQr
  return decode1D(pixels, formats)
}

// A picked File → { value, fmt } | null. createImageBitmap honours EXIF orientation where the
// browser supports it, which matters for photos of a card taken in portrait. `formats` is passed
// through to decodeSource (see above).
export async function importCodeFromImageWeb(file, formats) {
  if (!file) return null
  let bmp
  if (typeof createImageBitmap === 'function') {
    bmp = await createImageBitmap(file)
  } else {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('bad image'))
      img.src = URL.createObjectURL(file)
    })
  }
  try {
    return await decodeSource(bmp, formats)
  } finally {
    if (bmp.close) bmp.close()
  }
}
