// @vitest-environment happy-dom
// VITE_COACH_FUNCTION_URL dispatch (plan todo 26): the var is optional — set, the server
// branch of coach-api resolves every /api/coach/* call against it; unset, the request is
// byte-identical to the one api() has always made. DEMO and BYOK-local answer earlier in
// the ternary and never reach the server branch, so neither ever sees the var.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coachStatus, cohortStats, requestReview } from './coach-api.js'
import { useStore } from '../store/useStore.js'

const SENTINEL = 'https://sentinel.example.test'

describe('coach-api VITE_COACH_FUNCTION_URL dispatch', () => {
  let fetchMock

  beforeEach(() => {
    vi.unstubAllEnvs()
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    useStore.setState({ coachLocal: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    useStore.setState({ coachLocal: null })
  })

  it('env set → coach requests go to the sentinel base', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', SENTINEL)
    await coachStatus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(SENTINEL + '/api/coach/status')
  })

  it('env unset → legacy relative path, unchanged', async () => {
    await coachStatus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/coach/status')
  })

  it('env set with a trailing slash → normalized, no double slash', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', SENTINEL + '/')
    await coachStatus()
    expect(fetchMock.mock.calls[0][0]).toBe(SENTINEL + '/api/coach/status')
  })

  it('env set → POST shape (method, body, headers) identical to api()', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', SENTINEL)
    await requestReview('oi')
    expect(fetchMock.mock.calls[0][0]).toBe(SENTINEL + '/api/coach/review')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ note: 'oi' }),
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('env unset → POST still the legacy relative request', async () => {
    await requestReview('oi')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/coach/review')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ note: 'oi' }) })
  })

  it('env set → a failed call throws the same {message, status, data} api() throws', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', SENTINEL)
    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: 'provider' }),
    }))
    await expect(coachStatus()).rejects.toMatchObject({
      message: 'provider',
      status: 502,
      data: { error: 'provider' },
    })
  })

  it('env set but BYOK-local mode → local answers, sentinel never called', async () => {
    vi.stubEnv('VITE_COACH_FUNCTION_URL', SENTINEL)
    useStore.setState({ coachLocal: { mode: 'byok', provider: 'xai' } })
    const out = await cohortStats()
    expect(out).toEqual({ ok: false, enabled: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
