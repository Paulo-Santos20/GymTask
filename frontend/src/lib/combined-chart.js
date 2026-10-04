// The data half of Nutrition's combined chart (RF5): bodyweight, daily kcal intake and
// weekly training volume laid over ONE date axis, so the three curves are comparable
// day-for-day. Gaps are `y: null` — a day with no weigh-in, no food or a week with no
// training is missing data, not a zero, and a zero here would read as "you ate nothing".
//
// Weight is normalized to kg on the way in (the same rule Stats uses for its last
// weigh-in: stored in the profile unit, `lb` converted through LB_TO_KG), which keeps the
// series unit-free for the chart to re-label in whatever the profile currently shows.
// Everything else is read-only: intake is summed exactly the way the day's summary does
// (never written back), volume is loadOfWorkouts' own per-muscle set count summed over
// the week — no re-derivation of training data.
import { LB_TO_KG } from './recovery.js'
import { loadOfWorkouts } from './muscles.js'
import { isoOf, todayISO, weekKey, MONDAY } from './format.js'

export const COMBINED_DAYS = 14

const atNoon = iso => new Date(iso + 'T12:00:00').getTime()
const isLb = unit => unit === 'lb'

/**
 * @param {object} opts
 * @param {Array<{d: string, w: number, t?: number}>} opts.bodyweight  S.bodyweight (w in the profile unit)
 * @param {Record<string, Array<{kcal?: number}>>} opts.log           nutrition log, keyed by date
 * @param {Array<{d: string, entries?: Array}>} opts.workouts         S.workouts
 * @param {'kg'|'lb'} opts.unit   unit the weigh-ins were logged in (S.unit)
 * @param {number} opts.days      window length, ending on `today`
 * @param {string} opts.today     ISO date the window ends on
 * @param {number} opts.ws        first weekday (weekStartOf(S))
 * @returns {{dates: string[], weight: Array, intake: Array, volume: Array}} points `{t, y, d}`
 */
export function buildCombinedSeries({
  bodyweight = [],
  log = {},
  workouts = [],
  unit = 'kg',
  days = COMBINED_DAYS,
  today = todayISO(),
  ws = MONDAY,
} = {}) {
  const end = new Date(today + 'T12:00:00')
  const dates = []
  for (let i = Math.max(1, days) - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    dates.push(isoOf(d))
  }

  const weighIns = new Map()
  for (const b of bodyweight || []) if (b && b.d) weighIns.set(b.d, b)

  const weight = dates.map(iso => {
    const w = Number(weighIns.get(iso)?.w)
    return { t: atNoon(iso), y: Number.isFinite(w) && w > 0 ? (isLb(unit) ? w * LB_TO_KG : w) : null, d: iso }
  })

  const intake = dates.map(iso => {
    const day = log ? log[iso] : undefined
    if (!Array.isArray(day)) return { t: atNoon(iso), y: null, d: iso }
    let kcal = 0
    for (const e of day) kcal += Number(e?.kcal) || 0
    return { t: atNoon(iso), y: Math.round(kcal), d: iso }
  })

  // One point per week bucket touched by the window, dated at the first day the window has
  // in that week. A week whose workouts are all outside the window stays null.
  const buckets = new Map()
  for (const iso of dates) {
    const k = weekKey(iso, ws)
    if (!buckets.has(k)) buckets.set(k, { k, first: iso })
  }
  const inWindow = new Set(dates)
  const trained = new Map()
  for (const w of workouts || []) {
    if (!w?.d || !inWindow.has(w.d)) continue
    const k = weekKey(w.d, ws)
    if (!buckets.has(k)) continue
    if (!trained.has(k)) trained.set(k, [])
    trained.get(k).push(w)
  }
  const volume = [...buckets.values()].map(b => {
    const list = trained.get(b.k)
    const y = list ? Object.values(loadOfWorkouts(list)).reduce((a, n) => a + n, 0) : null
    return { t: atNoon(b.first), y, d: b.first }
  })

  return { dates, weight, intake, volume }
}
