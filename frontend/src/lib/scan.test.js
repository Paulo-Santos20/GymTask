import { describe, it, expect } from 'vitest'
import { scanCode, importCodeFromImage } from './scan.js'

// scanCode() is the leftover native-only path: it must refuse rather than reach for a plugin
// that is not there, and the view opens the browser camera sheet instead. (On-device decoding
// is exercised by hand; the browser decoder has its own round-trip test in scan-web.test.js.)

describe('scan off mobile', () => {
  it('scanCode rejects — the native scanner is app-only', async () => {
    await expect(scanCode()).rejects.toThrow(/only available in the app/)
  })

  it('importCodeFromImage takes the browser path and is a no-op without a file', async () => {
    expect(await importCodeFromImage(null)).toBeNull()
  })
})
