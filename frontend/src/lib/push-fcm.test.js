// @vitest-environment happy-dom
// @vitest-environment-options { "url": "https://gym.test/" }
import { describe, it, expect, vi, beforeEach } from 'vitest'

// firebaseConfigured must flip per test, so the mock exposes it through a live getter.
const state = vi.hoisted(() => ({ configured: true, vapidKey: 'test-vapid-key' }))
const fcm = vi.hoisted(() => {
  const messaging = { id: 'fcm-messaging-instance' }
  return {
    messaging,
    isSupported: vi.fn(async () => true),
    getMessaging: vi.fn(() => messaging),
    getToken: vi.fn(async () => 'fcm-registration-token'),
    subscribeToTopic: vi.fn(async () => {}),
    unsubscribeFromTopic: vi.fn(async () => {}),
    deleteToken: vi.fn(async () => {})
  }
})
const server = vi.hoisted(() => ({ calls: [] }))

vi.mock('firebase/messaging', () => fcm)
vi.mock('./firebase.js', () => ({
  get firebaseConfigured() { return state.configured },
  app: { name: '[DEFAULT]' },
  auth: null,
  db: null
}))
vi.mock('./api.js', () => ({
  api: vi.fn(async (path, opts) => {
    server.calls.push([path, opts?.method || 'GET', opts?.body ? JSON.parse(opts.body) : null])
    if (path === '/api/push/public-key') return { key: 'BPqx2m6xQ6pQK5hQtMz6d3kM2s7gq4yHqQvWzZ1sK1c' }
    return { ok: true }
  })
}))

const KEY = 'BPqx2m6xQ6pQK5hQtMz6d3kM2s7gq4yHqQvWzZ1sK1c'
const keyBytes = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0)).buffer
}
let sub = null
const makeSub = key => ({
  endpoint: 'https://push.example/e1', options: { applicationServerKey: keyBytes(key) },
  toJSON: () => ({ endpoint: 'https://push.example/e1', keys: { p256dh: 'p', auth: 'a' } }),
  unsubscribe: vi.fn(async () => { sub = null; return true })
})
const reg = {
  pushManager: {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async ({ applicationServerKey }) => { sub = makeSub(KEY); sub.options.applicationServerKey = applicationServerKey; return sub })
  }
}

beforeEach(() => {
  server.calls.length = 0
  sub = null
  state.configured = true
  for (const v of Object.values(fcm)) if (typeof v?.mockClear === 'function') v.mockClear()
  localStorage.clear()
  Object.defineProperty(navigator, 'serviceWorker', { value: { ready: Promise.resolve(reg) }, configurable: true })
  globalThis.PushManager = function () {}
  globalThis.Notification = { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
  import.meta.env.VITE_FIREBASE_VAPID_KEY = state.vapidKey
})

describe('FCM daily-reminder topic (gytask-daily)', () => {
  it('subscribes this device to the topic when notifications are enabled', async () => {
    const { enablePush } = await import('./push.js')
    await enablePush()
    expect(fcm.isSupported).toHaveBeenCalled()
    expect(fcm.getMessaging).toHaveBeenCalledWith({ name: '[DEFAULT]' })
    expect(fcm.getToken).toHaveBeenCalledWith(fcm.messaging, { vapidKey: state.vapidKey })
    expect(fcm.subscribeToTopic).toHaveBeenCalledTimes(1)
    expect(fcm.subscribeToTopic).toHaveBeenCalledWith(fcm.messaging, 'gytask-daily')
  })

  it('unsubscribes from the topic and deletes the token when notifications are disabled', async () => {
    const { enablePush, disablePush } = await import('./push.js')
    await enablePush()
    await disablePush()
    expect(fcm.unsubscribeFromTopic).toHaveBeenCalledTimes(1)
    expect(fcm.unsubscribeFromTopic).toHaveBeenCalledWith(fcm.messaging, 'gytask-daily')
    expect(fcm.deleteToken).toHaveBeenCalledWith(fcm.messaging)
  })

  it('never prompts for permission when Firebase is unconfigured (local/demo mode)', async () => {
    state.configured = false
    const { subscribeDailyTopic, unsubscribeDailyTopic, DAILY_TOPIC } = await import('./push.js')
    expect(DAILY_TOPIC).toBe('gytask-daily')
    expect(await subscribeDailyTopic()).toBe(false)
    await unsubscribeDailyTopic()
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(fcm.isSupported).not.toHaveBeenCalled()
    expect(fcm.getMessaging).not.toHaveBeenCalled()
    expect(fcm.getToken).not.toHaveBeenCalled()
    expect(fcm.subscribeToTopic).not.toHaveBeenCalled()
    expect(fcm.unsubscribeFromTopic).not.toHaveBeenCalled()
    expect(fcm.deleteToken).not.toHaveBeenCalled()
  })

  it('does not subscribe when permission is denied', async () => {
    Notification.requestPermission = vi.fn(async () => 'denied')
    const { subscribeDailyTopic } = await import('./push.js')
    expect(await subscribeDailyTopic()).toBe(false)
    expect(fcm.getToken).not.toHaveBeenCalled()
    expect(fcm.subscribeToTopic).not.toHaveBeenCalled()
  })

  it('does not subscribe when Firebase is unsupported in this browser', async () => {
    fcm.isSupported.mockImplementationOnce(async () => false)
    const { subscribeDailyTopic } = await import('./push.js')
    expect(await subscribeDailyTopic()).toBe(false)
    expect(Notification.requestPermission).not.toHaveBeenCalled()
    expect(fcm.subscribeToTopic).not.toHaveBeenCalled()
  })
})
