// Adaptive TDEE — an intake-balance maintenance estimate built from the user's OWN
// history: paired days (a date with both a weigh-in in `S.bodyweight` and food in the
// nutrition log), the body-weight trend across them, and the mean intake on those days.
// Energy balance then says maintenance = mean intake − trend (kg/day) × 7700 kcal/kg:
// weight sliding down on a steady intake means true maintenance sits above that intake,
// and the other way around.
//
// Pure function over state passed as args (coach-insights.js convention) — nothing is
// persisted and NOTHING is auto-applied: the Nutrition screen shows the number and the
// user decides whether to adopt it, one tap, through the store's existing setProfile.
// Below MIN_PAIRED_DAYS of paired data there is no honest estimate, so callers render
// an informational state rather than a number (or an error).
//
// An estimate for training guidance, not medical advice — the view says so too.
import { LB_TO_KG } from './recovery.js'

// 14 paired days ≈ two weeks — the floor below which day-to-day water noise swamps a
// real trend (plan decision: "needs ~14 days of paired weight + food data").
export const MIN_PAIRED_DAYS = 14
// Only the most recent WINDOW_DAYS days behind the newest day in scope feed the
// estimate, so a stale cluster from months ago can never resurrect an old number.
export const WINDOW_DAYS = 60
// Energy density of changed body tissue — the ~7700 kcal/kg convention (±1 lb of
// tissue ≈ 3500 kcal). Good enough for a trend-sized correction of tens of kcal/day.
export const KCAL_PER_KG = 7700

const DAY_MS = 86400000
const dayNumber = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY_MS)
const isoOfDay = n => new Date(n * DAY_MS).toISOString().slice(0, 10)

// `S` = { bodyweight: [{d, w, t}], unit } — `w` is stored in S.unit (lb when the
// profile uses pounds, converted through LB_TO_KG like Stats.jsx). `log` is the
// nutrition diary `{[iso]: [entries]}`; a day counts as food logged when it holds at
// least one entry. `win` optionally bounds the window ({from, to} ISO, either side).
export function adaptiveTDEE(S = {}, log = {}, win = {}) {
  const inPounds = /^(?:lb|lbs|pound|pounds)$/i.test(String(S.unit ?? '').trim())
  const toKg = inPounds ? LB_TO_KG : 1

  const weights = new Map()
  for (const b of S.bodyweight || []) {
    const w = Number(b?.w)
    if (!b?.d || !Number.isFinite(w) || w <= 0) continue // a blank weigh-in is missing, not 0 kg
    weights.set(b.d, w * toKg)
  }

  const paired = []
  for (const [d, entries] of Object.entries(log || {})) {
    if (!weights.has(d) || !Array.isArray(entries) || !entries.length) continue
    const kcal = entries.reduce((n, e) => n + (Number(e?.kcal) || 0), 0)
    paired.push({ d, kg: weights.get(d), kcal })
  }
  if (!paired.length) return { ok: false, reason: 'insufficient-data' }
  paired.sort((a, b) => (a.d < b.d ? -1 : 1))

  // Rolling window: default the ends to the data, then keep only days inside
  // WINDOW_DAYS behind the newest day in scope and inside any explicit bound.
  const to = win.to || paired[paired.length - 1].d
  const cutoff = isoOfDay(dayNumber(to) - (WINDOW_DAYS - 1))
  const from = win.from && win.from > cutoff ? win.from : cutoff
  const days = paired.filter(p => p.d >= from && p.d <= to)
  if (days.length < MIN_PAIRED_DAYS) return { ok: false, reason: 'insufficient-data' }

  // Least-squares trend of weight over CALENDAR days, so a gap between weigh-ins is
  // weighted by the time that actually passed, not by sample index.
  const n = days.length
  const x0 = dayNumber(days[0].d)
  const xs = days.map(p => dayNumber(p.d) - x0)
  const ys = days.map(p => p.kg)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY)
    sxx += (xs[i] - meanX) * (xs[i] - meanX)
  }
  const slope = sxx > 0 ? sxy / sxx : 0 // kg/day

  const intake = days.reduce((a, p) => a + p.kcal, 0) / n
  return {
    ok: true,
    kcal: Math.round(intake - slope * KCAL_PER_KG),
    days: n,
    window: { from: days[0].d, to: days[n - 1].d },
  }
}
