// Apple Health, through the Shortcuts bridge (plan decision 1 = option A).
//
// Nothing here talks to HealthKit: the app builds a `shortcuts://run-shortcut` deep link and
// hands it to the Shortcuts app, which runs the one Shortcut the user installs once and writes
// the sample. That keeps the whole feature to a URL string — no native dependency, no webview,
// no third-party fitness integration, and nothing that can hold up a save — the send buttons
// are additive, so the two save paths never call any of this).
//
// The payload is the Shortcut's contract and is documented in
// `.omo/evidence/task-11-roadmap-features.md`: {"type","value","unit","date"}, percent-encoded
// into `input`. Read those four keys, in that order.

// The Shortcut must carry this exact name — the Settings instructions render it from here so
// the copy the user follows and the name the link runs cannot drift apart.
export const SHORTCUT_NAME = 'GymTask Log'

/** The sample the Shortcut receives as its JSON input: exactly {type, value, unit, date}. */
export const healthPayload = ({ type, value, unit, date }) => JSON.stringify({ type, value, unit, date })

/** A saved weigh-in ({d, w, t}) in the profile's own unit — stored weights are never converted. */
export const bodyweightPayload = (entry, unit) =>
  healthPayload({
    type: 'bodyweight',
    value: entry.w,
    unit,
    date: new Date(entry.t || Date.parse(entry.d + 'T12:00:00Z')).toISOString(),
  })

/** A finished session as duration in whole minutes, dated when it ended. */
export const workoutPayload = w =>
  healthPayload({
    type: 'workout',
    value: Math.round((w.end - w.start) / 60000),
    unit: 'min',
    date: new Date(w.end).toISOString(),
  })

export const healthLink = payload =>
  `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=${encodeURIComponent(payload)}`

/** Fires the link on a throwaway anchor: the page itself never navigates, and this never throws. */
export function openHealth(payload) {
  try {
    const a = document.createElement('a')
    a.href = healthLink(payload)
    a.rel = 'noopener'
    a.click()
    return true
  } catch {
    return false
  }
}

// The `shortcuts://` scheme exists on iOS/iPadOS and nowhere else, so a button pointing at it on
// Android or a desktop browser is a dead tap — the Settings section and both send buttons are
// rendered only where it resolves. Same UA read as lib/sound.js:103: iPadOS claims to be a Mac
// with a touch screen, a real desktop Mac does not.
export function appleHealthSupported() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
