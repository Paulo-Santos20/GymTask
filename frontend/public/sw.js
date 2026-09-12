/* openGym service worker — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
const CACHE = 'opengym-rt-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})
// Every push shows a notification, whatever the payload: a push that shows nothing counts
// against the site (Chrome revokes the subscription after a few), and a payload that fails to
// parse used to throw before waitUntil was ever reached — exactly such a silent push.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}
    try { data = e.data ? e.data.json() : {} } catch { data = { body: (() => { try { return e.data.text() } catch { return '' } })() } }
    // One alert per kind: a new rest-timer push replaces the last one instead of stacking
    // up in the tray (issue #172). `tag` alone should do that, but iOS keeps every one, so
    // the previous notification with the same tag is closed by hand first.
    const tag = data.tag || 'opengym'
    try { for (const n of await self.registration.getNotifications({ tag })) n.close() } catch {}
    await self.registration.showNotification(data.title || 'openGym', {
      body: data.body || '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      tag,
      renotify: true
    })
  })())
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})

// The push service rotated the subscription (it does, unannounced, every few months on some
// platforms). Without this the server keeps sending to the old endpoint until it 410s, and the
// browser holds a new one nobody registered — "notifications just stopped". Re-subscribe with
// the same application server key and hand the new endpoint to the API; the session cookie
// travels with the same-origin fetch. Signed out, the API answers 401 and the next signed-in
// boot (lib/push.js syncPushSubscription) registers it instead.
const b64ToBytes = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    let key = e.oldSubscription?.options?.applicationServerKey
    if (!key) {
      const r = await fetch(new URL('api/push/public-key', self.registration.scope))
      key = b64ToBytes((await r.json()).key)
    }
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await fetch(new URL('api/push/subscribe', self.registration.scope), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    })
  })().catch(() => {}))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
