// Where the Coach keeps the little it needs between runs, and where the key goes.
//
// Deliberately NOT part of S. S is the training log — it syncs, travels in the JSON export, and
// is what "back up your data" means. Which provider this device talks to, the pseudonym it uses,
// today's run count and a proposal waiting to be looked at are device facts, so they live in
// their own localStorage entry next to the rest of the profile's local keys. The API key itself
// is not even here: see coach-secrets.js.
//
// This module is intentionally light. The setup screen imports it before the user has chosen
// anything, and the promise there is that nothing AI-shaped loads until they do.
const KEY = 'gym_coach_device_v1'

export const COACH_MODES = ['off', 'server', 'byok']

const DEFAULTS = { mode: 'off', provider: null, model: null, baseUrl: null, handle: null, daily: null, pending: null }

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) } catch (e) { return null }
}
const write = data => {
  try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (e) { /* storage full/blocked — the in-memory copy stands */ }
}

let cache = null
export async function loadCoachDevice() {
  if (cache) return cache
  const saved = read()
  cache = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  if (!COACH_MODES.includes(cache.mode)) cache.mode = 'off'
  return cache
}
export async function saveCoachDevice(patch) {
  const next = { ...(await loadCoachDevice()), ...patch }
  cache = next
  write(next)
  return next
}
/** The part of it a UI may show: never the pending proposal, never the handle. */
export const coachDeviceSettings = d => d ? { mode: d.mode, provider: d.provider, model: d.model, baseUrl: d.baseUrl } : null

// Test seam.
export function _resetCoachDevice() { cache = null }
