// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

describe('api()', () => {
  it('a failed request throws with the status and the parsed body attached', async () => {
    const { api } = await import('./api.js')
    const original = globalThis.fetch
    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', rev: 3, state: { _rev: 3 } }),
    })
    try {
      await expect(api('/api/data', { method: 'PUT', body: '{}' })).rejects.toMatchObject({
        message: 'conflict',
        status: 409,
        data: { error: 'conflict', rev: 3, state: { _rev: 3 } },
      })
    } finally {
      globalThis.fetch = original
    }
  })
})
