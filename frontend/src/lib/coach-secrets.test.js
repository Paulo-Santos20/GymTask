// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The key lives in this browser's localStorage; the in-memory map behind it is for storage that
// is missing or refuses the write (see coach-secrets.js).
const secrets = await import('./coach-secrets.js')

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`hung for ${ms} ms`)), ms))])

describe('coach-secrets', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* no storage */ } })

  it('a round trip settles', async () => {
    await within(secrets.setApiKey('sk-live-1'), 1000)
    expect(await within(secrets.getApiKey(), 1000)).toBe('sk-live-1')
    await within(secrets.clearApiKey(), 1000)
    expect(await within(secrets.getApiKey(), 1000)).toBe(null)
  })

  it('the key lands in localStorage, so it survives a reload — and clear takes it out', async () => {
    await secrets.setApiKey('sk-live-2')
    expect(localStorage.getItem('coach.apiKey')).toBe('sk-live-2')
    await secrets.clearApiKey()
    expect(localStorage.getItem('coach.apiKey')).toBe(null)
  })

  it('blank and missing values read as no key', async () => {
    expect(await secrets.getApiKey()).toBe(null)
    await secrets.setApiKey('   ')
    expect(await secrets.getApiKey()).toBe(null)
  })
})
