// Capturing a gym check-in code (see views/CheckIn.jsx). Three ways in:
//   1. type it            — no plugin, handled entirely in the view
//   2. import a photo      — importCodeFromImage(file): decode a picture the user already has
//   3. scan with camera    — a browser opens components/CameraScan.jsx instead (lib/scan-web.js
//                            does the decoding: BarcodeDetector where the browser has one, jsQR
//                            otherwise); scanCode() is the old native-only path and refuses here
//
// What comes back is a normalized { value, fmt } (or null when the user cancels / nothing was
// found). `value` is the code's machine-readable content; `fmt` is a lower-cased symbology token
// matching lib/qr.js's normalizeFmt. The caller checks canRenderFmt(fmt) before saving — we can
// read many barcode kinds but only redraw QR, so a non-QR code is reported and refused there, not
// silently stored.
export async function scanCode() {
  throw new Error('Scanning is only available in the app')
}

// Decode a barcode out of an image the user picked — BarcodeDetector/jsQR in lib/scan-web.js.
// `formats` picks which symbologies the native detector may read (default QR only).
export async function importCodeFromImage(file, formats) {
  if (!file) return null
  return (await import('./scan-web.js')).importCodeFromImageWeb(file, formats)
}
