// Where the user's own API key is kept: this browser's localStorage — never in S (which syncs
// and exports), never in the Coach device entry next to it.
//
// localStorage can be unavailable or full (private mode, a storage quota, a test without a
// DOM), so every call falls back to a process-local map that forgets on reload, which is the
// honest behaviour for a place that cannot keep a secret.
const KEY = 'coach.apiKey'
const memory = new Map()

const store = () => {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch (e) { return null }
}

export async function getApiKey() {
  try { const v = store() && store().getItem(KEY); if (typeof v === 'string' && v) return v } catch (e) { /* fall through */ }
  return memory.get(KEY) || null
}
export async function setApiKey(value) {
  const v = String(value || '').trim()
  if (!v) return clearApiKey()
  try { const s = store(); if (s) { s.setItem(KEY, v); memory.delete(KEY); return } } catch (e) { /* fall through */ }
  memory.set(KEY, v)
}
export async function clearApiKey() {
  try { const s = store(); if (s) s.removeItem(KEY) } catch (e) { /* nothing to clear */ }
  memory.delete(KEY)
}
