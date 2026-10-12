// The PWA install prompt the browser hands us (Chrome/Edge/Samsung Internet; iOS Safari has
// no beforeinstallprompt — there the user installs from the share sheet, and the banner stays
// hidden because `installed` never becomes true from an event: standalone detection covers
// it). The event is captured and prevented so the browser's own mini-infobar does not fire;
// the app asks when the user taps the banner instead.
const listeners = new Set()
let deferred = null

const emit = () => {
  for (const fn of listeners) fn()
}
const standalone = () => {
  if (typeof window === 'undefined') return true
  if (window.matchMedia) {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) return true
    } catch {
      /* an old matchMedia — the navigator check below still decides */
    }
  }
  return typeof navigator !== 'undefined' && navigator.standalone === true
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferred = e
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

/** True while the browser lets us prompt: an event is parked and the app is not installed. */
export const installAvailable = () => !!deferred && !standalone()

/** Shows the browser's install dialog. Resolves true when the user accepted. */
export const promptInstall = async () => {
  if (!deferred) return false
  try {
    deferred.prompt()
    const choice = await deferred.userChoice
    const accepted = !!choice && choice.outcome === 'accepted'
    deferred = null
    emit()
    return accepted
  } catch {
    deferred = null
    emit()
    return false
  }
}

export const subscribeInstall = fn => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
