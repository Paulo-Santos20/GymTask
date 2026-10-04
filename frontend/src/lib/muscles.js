// Which muscles an exercise trains, and how hard — the data behind every muscle map.
//
// The exercise dataset names muscles in free text and is not consistent about it:
// "shoulders", "deltoids" and "delts" are the same thing, so are "quads" and
// "quadriceps", "lats" and "latissimus dorsi", "core" and "abdominals". Nineteen
// primary and forty secondary spellings collapse onto the eighteen muscles the body
// map can actually draw, via ALIAS below. Anything genuinely undrawable (hands,
// ankles, "cardiovascular system") maps to null and is dropped rather than guessed at.

import { isWarmupRow } from './workout-model.js'
import { EXIDX, smOf } from './exercises.js'
import { todayISO, weekKey, weekStartOf, startOfWeek, isoOf, MONDAY } from './format.js'
import { effectiveRoutines } from './history.js'

// The muscles a map can shade, in head-to-toe order — also the order of any list
// built from them, so "what am I neglecting" reads top-down like a body.
export const MUSCLES = [
  'trapezius',
  'deltoids',
  'chest',
  'upper-back',
  'serratus',
  'biceps',
  'triceps',
  'forearm',
  'abs',
  'obliques',
  'lower-back',
  'gluteal',
  'quadriceps',
  'hamstring',
  'adductors',
  'hip-flexors',
  'calves',
  'tibialis',
]

// A picked list in the map's own order rather than the order the chips were tapped in — two
// people building the same exercise get the same exercise. Unknown names keep their place at the end.
export const inMuscleOrder = list => {
  const at = m => {
    const i = MUSCLES.indexOf(m)
    return i < 0 ? MUSCLES.length : i
  }
  return [...(list || [])].sort((a, b) => at(a) - at(b))
}

// Drawn as the silhouette, never shaded: they carry no training load.
export const INERT = ['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles']

// English display names; these strings are the i18n keys (see lib/i18n.js). The packs know
// the cardio pseudo-muscle only under the dataset's own lowercase spelling, and every place
// that shows it capitalises with CSS — a capitalised key here rendered English everywhere.
export const MUSCLE_NAME = {
  trapezius: 'Traps',
  deltoids: 'Shoulders',
  chest: 'Chest',
  'upper-back': 'Upper back',
  serratus: 'Serratus',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearm: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  'lower-back': 'Lower back',
  gluteal: 'Glutes',
  quadriceps: 'Quads',
  hamstring: 'Hamstrings',
  adductors: 'Adductors',
  'hip-flexors': 'Hip flexors',
  calves: 'Calves',
  tibialis: 'Shins',
  'cardiovascular system': 'cardiovascular system',
}

// Every spelling that occurs in the dataset's `tg` and `sm` fields. null = not drawable.
const ALIAS = {
  // primaries
  abs: 'abs',
  pectorals: 'chest',
  biceps: 'biceps',
  glutes: 'gluteal',
  delts: 'deltoids',
  triceps: 'triceps',
  'upper back': 'upper-back',
  lats: 'upper-back',
  calves: 'calves',
  quads: 'quadriceps',
  forearms: 'forearm',
  hamstrings: 'hamstring',
  spine: 'lower-back',
  traps: 'trapezius',
  adductors: 'adductors',
  'serratus anterior': 'serratus',
  abductors: 'gluteal',
  'levator scapulae': 'trapezius',
  'cardiovascular system': 'cardiovascular system',
  // secondaries
  shoulders: 'deltoids',
  deltoids: 'deltoids',
  'rear deltoids': 'deltoids',
  'rotator cuff': 'deltoids',
  quadriceps: 'quadriceps',
  core: 'abs',
  abdominals: 'abs',
  'lower abs': 'abs',
  chest: 'chest',
  'upper chest': 'chest',
  'hip flexors': 'hip-flexors',
  obliques: 'obliques',
  'lower back': 'lower-back',
  rhomboids: 'upper-back',
  trapezius: 'trapezius',
  back: 'upper-back',
  'latissimus dorsi': 'upper-back',
  brachialis: 'biceps',
  soleus: 'calves',
  shins: 'tibialis',
  wrists: 'forearm',
  'wrist flexors': 'forearm',
  'wrist extensors': 'forearm',
  'grip muscles': 'forearm',
  groin: 'adductors',
  'inner thighs': 'adductors',
  ankles: null,
  feet: null,
  hands: null,
  'ankle stabilizers': null,
  sternocleidomastoid: null,
}

// Custom exercises carry only a body part, so they fall back to it. Weights inside a
// group sum to 1 — "upper legs" spreads over three muscles rather than counting triple.
const BY_BODYPART = {
  chest: { chest: 1 },
  back: { 'upper-back': 0.75, 'lower-back': 0.25 },
  shoulders: { deltoids: 1 },
  'upper arms': { biceps: 0.5, triceps: 0.5 },
  'lower arms': { forearm: 1 },
  waist: { abs: 0.7, obliques: 0.3 },
  'upper legs': { quadriceps: 0.4, hamstring: 0.35, gluteal: 0.25 },
  'lower legs': { calves: 0.8, tibialis: 0.2 },
  neck: { trapezius: 1 },
  'full body': { chest: 0.2, 'upper-back': 0.2, gluteal: 0.2, quadriceps: 0.2, hamstring: 0.1, abs: 0.1 },
  cardio: {},
}

const SECONDARY = 0.4 // a supporting muscle counts this much against a primary

const arrayOf = value => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])

function firstPresent(object, keys) {
  if (!object || typeof object !== 'object') return null
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key]
  }
  return null
}

// Completed history entries may retain a nested snapshot after their custom exercise is
// deleted from the profile catalogue. Prefer that snapshot when the outer entry has no muscle
// metadata of its own, while keeping direct/legacy entry fields authoritative when present.
function metadataOf(ex) {
  if (!ex || typeof ex !== 'object') return ex
  const DIRECT_KEYS = [
    'muscleGroups',
    'muscles',
    'targetMuscles',
    'muscleWeights',
    'primaries',
    'primaryMuscles',
    'primary',
    'secondaries',
    'secondaryMuscles',
    'secondary',
  ]
  const hasDirect =
    DIRECT_KEYS.some(key => Object.prototype.hasOwnProperty.call(ex, key)) ||
    [ex.tg, ex.mg, ...arrayOf(ex.sm)].some(value => value != null && value !== '')
  return !hasDirect && ex.muscleSnapshot && typeof ex.muscleSnapshot === 'object' && !Array.isArray(ex.muscleSnapshot)
    ? ex.muscleSnapshot
    : ex
}

function explicitPartsOf(ex) {
  if (!ex || typeof ex !== 'object') return null
  const primary = firstPresent(ex, ['primaries', 'primaryMuscles', 'primary'])
  const secondary = firstPresent(ex, ['secondaries', 'secondaryMuscles', 'secondary'])
  if (primary !== null || secondary !== null)
    return {
      primary: arrayOf(primary),
      secondary: arrayOf(secondary),
    }
  return null
}

function explicitGroupsOf(ex) {
  if (!ex || typeof ex !== 'object') return null
  if (Object.prototype.hasOwnProperty.call(ex, 'muscleGroups')) {
    const groups = arrayOf(ex.muscleGroups)
    return groups.length ? groups : null
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'muscles')) {
    const groups = arrayOf(ex.muscles)
    return groups.length ? groups : null
  }
  if (Object.prototype.hasOwnProperty.call(ex, 'targetMuscles')) {
    const groups = arrayOf(ex.targetMuscles)
    return groups.length ? groups : null
  }
  return null
}

/** True only when the catalogue explicitly supplied muscle groups, not a body-part fallback. */
export function hasExplicitMuscleMetadata(entry) {
  const ex = metadataOf(entry)
  if (!ex || typeof ex !== 'object') return false
  const parts = explicitPartsOf(ex)
  if (parts && [...parts.primary, ...parts.secondary].some(value => canonicalMuscle(value))) return true
  const groups = explicitGroupsOf(ex)
  if (groups && groups.some(value => canonicalMuscle(value))) return true
  return [ex.tg, ex.mg, ...arrayOf(smOf(ex))].some(value => canonicalMuscle(value))
}

function canonicalMuscle(value) {
  const name = String(value || '')
    .toLowerCase()
    .trim()
  if (MUSCLES.includes(name)) return name
  return ALIAS[name] || null
}

function canonicalUnique(values) {
  const out = []
  for (const value of values || []) {
    const slug = canonicalMuscle(value)
    if (slug && !out.includes(slug)) out.push(slug)
  }
  return out
}

/** Canonical unique muscle groups, accepting new primary/secondary arrays and legacy fields. */
export function muscleGroupsOf(entry) {
  const ex = metadataOf(entry)
  const parts = explicitPartsOf(ex)
  const explicit = explicitGroupsOf(ex)
  const useParts = parts && [...parts.primary, ...parts.secondary].some(value => canonicalMuscle(value))
  const source = useParts ? [...parts.primary, ...parts.secondary] : explicit || [ex?.tg, ex?.mg, ...arrayOf(smOf(ex))]
  const out = canonicalUnique(source)
  if (!out.length && !useParts) {
    canonicalUnique(Object.keys(BY_BODYPART[ex?.bp] || {})).forEach(slug => out.push(slug))
  }
  return out
}

export const normalizeMuscleGroups = muscleGroupsOf

/** True when any requested group matches; an empty request is an intentionally unfiltered query. */
export function matchesMuscleGroups(ex, requested) {
  const wanted = arrayOf(requested).map(canonicalMuscle).filter(Boolean)
  if (!wanted.length) return true
  const groups = new Set(muscleGroupsOf(ex))
  return wanted.some(group => groups.has(group))
}

/** Muscles one exercise trains: { slug: 0…1 }. Duplicate metadata never adds load twice. */
export function musclesOf(ex) {
  if (!ex) return {}
  const sourceEx = metadataOf(ex)
  if (sourceEx !== ex) return musclesOf(sourceEx)
  if (ex.muscleWeights && typeof ex.muscleWeights === 'object' && !Array.isArray(ex.muscleWeights)) {
    const snapshot = {}
    MUSCLES.forEach(slug => {
      const weight = Number(ex.muscleWeights[slug])
      if (Number.isFinite(weight) && weight > 0) snapshot[slug] = weight
    })
    if (Object.keys(snapshot).length) return snapshot
  }
  const out = {}
  const add = (name, w) => {
    const slug = canonicalMuscle(name)
    if (slug) out[slug] = Math.max(out[slug] || 0, w)
  }
  const parts = explicitPartsOf(ex)
  const explicit = explicitGroupsOf(ex)
  const useParts = parts && [...parts.primary, ...parts.secondary].some(value => canonicalMuscle(value))
  if (useParts) {
    parts.primary.forEach(m => add(m, 1))
    parts.secondary.forEach(m => add(m, SECONDARY))
  } else if (explicit) explicit.forEach(m => add(m, 1))
  else {
    add(ex.tg, 1)
    add(ex.mg, SECONDARY)
    arrayOf(smOf(ex)).forEach(m => add(m, SECONDARY))
  }
  // Nothing recognised (custom exercises, or a target we don't draw) — use the body part.
  if (!Object.keys(out).length) Object.assign(out, BY_BODYPART[ex.bp] || {})
  return out
}

/** Snapshot display and weighted muscle metadata into a completed history entry. */
export function exerciseMuscleSnapshot(ex) {
  if (!ex || typeof ex !== 'object') return {}
  const out = {}
  if (ex.n != null) out.n = ex.n
  if (ex.bp != null) out.bp = ex.bp
  const weights = musclesOf(ex)
  if (Object.keys(weights).length) out.muscleWeights = { ...weights }
  const parts = explicitPartsOf(ex)
  if (parts) {
    const primaries = canonicalUnique(parts.primary)
    const secondaries = canonicalUnique(parts.secondary).filter(slug => !primaries.includes(slug))
    if (primaries.length) out.primaries = primaries
    if (secondaries.length) out.secondaries = secondaries
  }
  if (hasExplicitMuscleMetadata(ex)) out.muscleGroups = [...muscleGroupsOf(ex)]
  return out
}

/**
 * Training load per muscle, in "effective sets".
 * `items` is [{ id, sets }] — sets being a count, so a 4×8 bench press weighs four
 * times a single set. Volume in kg is deliberately not used: 100 kg of leg press
 * against 12 kg of lateral raise says nothing about which muscle worked harder.
 */
export function loadOf(items) {
  const load = {}
  items.forEach(item => {
    const { id, sets } = item || {}
    if (!sets) return
    const historical = item.ex || item.exercise
    const source = historical?.muscleWeights ? historical : EXIDX[id] || historical || item
    const m = musclesOf(source)
    for (const slug in m) load[slug] = (load[slug] || 0) + m[slug] * sets
  })
  return load
}

/**
 * Load for finished workouts (only sets actually ticked off count). `pick` narrows that
 * further — the map can then answer "where did the *hard* sets go", which is a different
 * question from where the sets went: a muscle can lead on volume and still never be trained
 * near failure.
 */
export const loadOfWorkouts = (workouts, pick) =>
  loadOf(
    (workouts || []).flatMap(w =>
      (w.entries || []).map(e => ({
        id: e.id,
        ex: e.exercise || e,
        sets: (e.sets || []).filter(s => s.done && !isWarmupRow(s) && (!pick || pick(s))).length,
      })),
    ),
  )

/**
 * Workouts in one existing Muscle balance range, with time injected for deterministic tests.
 *
 * The 7-day range is "this week", not "the last seven days", so it moves with the profile's
 * first weekday — the caller passes it since this takes workouts rather than the whole state.
 */
export function muscleBalanceWindow(workouts, win, now = Date.now(), today = todayISO(), ws = MONDAY) {
  return (workouts || []).filter(workout =>
    win === 0
      ? true
      : win === 7
        ? weekKey(workout.d, ws) === weekKey(today, ws)
        : (workout.start || new Date(workout.d).getTime()) > now - win * 86400000,
  )
}

/** Load a routine *would* produce, from its planned set counts. */
export const loadOfRoutine = routine => loadOf((routine?.ex || []).map(c => ({ id: c.id, ex: c, sets: c.sets || 1 })))

/** Load for a workout still in progress — the sets ticked so far. */
export const loadOfActive = active =>
  loadOf(
    (active?.entries || []).map(e => ({
      id: e.id,
      ex: e.exercise || e,
      sets: (e.sets || []).filter(s => s.done && !isWarmupRow(s)).length,
    })),
  )

/**
 * Working sets per muscle, per calendar week: what each week actually delivered (`done` —
 * finished workouts, warm-ups excluded) and what the routine schedules for it (`planned` —
 * the seven days' effective routines, `dayPlan` overrides included). The two sides stay
 * separate: a week can be planned and untouched, or improvised far past its plan.
 *
 * Buckets are `weekKey`s, so a week that crosses a month — or the profile's first weekday —
 * groups exactly like every other week calculation in the app (effortWeeks, the Stats week
 * window). Oldest week first; `weeks` counts back from the week `today` falls in (1 = this
 * week only). `today` is injected because this takes the clock as an argument, never reads it.
 *
 * The volume-landmark rows (Stats "12/18 sets", Settings editing) read this: `done` against
 * the muscle's MAV/MEV tells the user whether the week under- or over-shot its target.
 */
export function weeklyMuscleSeries(S, { weeks = 1, today = todayISO() } = {}) {
  const ws = weekStartOf(S)
  const plan = { routines: S?.routines || [], week: S?.week || {}, dayPlan: S?.dayPlan || {} }
  const buckets = []
  const byKey = new Map()
  const last = startOfWeek(today, ws)
  for (let i = Math.max(1, weeks) - 1; i >= 0; i--) {
    const start = new Date(last)
    start.setDate(start.getDate() - i * 7)
    const bucket = { k: isoOf(start), t: start.getTime(), done: {}, planned: {} }
    buckets.push(bucket)
    byKey.set(bucket.k, bucket)
  }
  ;(S?.workouts || []).forEach(w => {
    const bucket = byKey.get(weekKey(w.d, ws))
    if (!bucket) return
    const load = loadOfWorkouts([w])
    for (const slug in load) bucket.done[slug] = (bucket.done[slug] || 0) + load[slug]
  })
  buckets.forEach(bucket => {
    for (let i = 0; i < 7; i++) {
      const day = new Date(bucket.t) // noon local (format.js startOfWeek), so DST cannot skip a date
      day.setDate(day.getDate() + i)
      effectiveRoutines(plan, isoOf(day)).forEach(routine => {
        const load = loadOfRoutine(routine)
        for (const slug in load) bucket.planned[slug] = (bucket.planned[slug] || 0) + load[slug]
      })
    }
  })
  return buckets
}

/**
 * Shade buckets 0–4 per muscle.
 *
 * With no `thresholds`, levels remain relative to the hardest-worked muscle in the same
 * window. This is the original balance-map behavior. When `thresholds` is supplied, levels
 * use an absolute scale instead: it is an ordered array of `{ at, level, exclusive? }` rules,
 * and the last matching rule wins. An exclusive rule matches values strictly greater than
 * `at`; otherwise the boundary is inclusive. Values below the first matching rule are l0.
 * Absolute rules let recovery views keep fixed semantic bands instead of renormalizing to the
 * strongest muscle on screen.
 */
export function levelsOf(load, thresholds) {
  if (thresholds) {
    const lv = {}
    MUSCLES.forEach(m => {
      const value = Number(load[m] || 0)
      let level = 0
      for (const rule of thresholds) {
        const matches = rule.exclusive ? value > rule.at : value >= rule.at
        if (matches) level = Math.max(0, Math.min(4, rule.level))
      }
      lv[m] = level
    })
    return lv
  }

  const max = Math.max(0, ...MUSCLES.map(m => load[m] || 0))
  const lv = {}
  MUSCLES.forEach(m => {
    const v = load[m] || 0
    lv[m] = !v ? 0 : max <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((v / max) * 4)))
  })
  return lv
}

/** Muscles sorted hardest-worked first; untrained ones last, in body order. */
export function rankOf(load) {
  const worked = MUSCLES.filter(m => (load[m] || 0) > 0).sort(
    (a, b) => load[b] - load[a] || MUSCLES.indexOf(a) - MUSCLES.indexOf(b),
  )
  const missed = MUSCLES.filter(m => !(load[m] > 0))
  return { worked, missed }
}

// ----------------------------------------------------------------- volume landmarks --
//
// Weekly working-set ranges per muscle: MEV (the least that still maintains/grows the muscle)
// and MAV (the most before recovery starts losing). The numbers below are the plan's starting
// preset — deliberately editable per profile (Settings writes DEF.muscleTargets in useStore.js,
// and `landmarksFor(slug, overrides)` layers that map over these), not a verdict about anyone's
// programming. Rows are named the way the plan names them, which is not the way the app's slugs
// are named, so LANDMARK_ROW documents every rename: trapezius is the "traps" row, deltoids the
// "shoulders" row, quadriceps "quads", hamstring "hamstrings", gluteal "glutes", forearm
// "forearms". Slugs with no row of their own take the closest one — upper- and lower-back share
// "back", obliques and hip-flexors share "abs" (the core row), tibialis shares "calves", adductors
// are trained on the posterior-chain days that hit "hamstrings", serratus rides the "shoulders"
// row it works with on every press. Anything else (a future slug, a typo, the cardiovascular
// pseudo-muscle the dataset can produce) resolves through the fallback rather than to nothing.
export const SET_LANDMARKS = {
  chest: { mev: 10, mav: 20 },
  back: { mev: 10, mav: 22 },
  shoulders: { mev: 8, mav: 16 },
  quads: { mev: 8, mav: 18 },
  hamstrings: { mev: 6, mav: 16 },
  glutes: { mev: 8, mav: 16 },
  biceps: { mev: 6, mav: 14 },
  triceps: { mev: 6, mav: 14 },
  calves: { mev: 8, mav: 16 },
  abs: { mev: 6, mav: 12 },
  traps: { mev: 6, mav: 14 },
  forearms: { mev: 4, mav: 10 },
}
/** What a muscle with no row of its own is held to — the plan's "unmapped slug" rule. */
export const LANDMARK_FALLBACK = { mev: 8, mav: 16 }
/** Muscle slug → SET_LANDMARKS row. Every drawable slug (MUSCLES) has an entry. */
export const LANDMARK_ROW = {
  trapezius: 'traps',
  deltoids: 'shoulders',
  chest: 'chest',
  'upper-back': 'back',
  'lower-back': 'back',
  serratus: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearm: 'forearms',
  abs: 'abs',
  obliques: 'abs',
  gluteal: 'glutes',
  quadriceps: 'quads',
  hamstring: 'hamstrings',
  adductors: 'hamstrings',
  'hip-flexors': 'abs',
  calves: 'calves',
  tibialis: 'calves',
}

// A stored override may carry a value JSON round-tripped as text, or a cleared one as null;
// neither may replace a real bound with `null`/NaN — an unreadable landmark is worse than the
// preset it was meant to change.
const landmarkNum = (value, fallback) =>
  value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : fallback

/**
 * Weekly working-set landmarks for one muscle: the preset row it maps to, with the profile's
 * own edits (DEF.muscleTargets, `null` until the user edits one) layered over it per bound —
 * an override of only MEV keeps the preset MAV, and vice versa.
 */
export function landmarksFor(slug, overrides = null) {
  const row = SET_LANDMARKS[LANDMARK_ROW[slug]] || LANDMARK_FALLBACK
  const own = overrides?.[slug]
  if (!own) return { mev: row.mev, mav: row.mav }
  return { mev: landmarkNum(own.mev, row.mev), mav: landmarkNum(own.mav, row.mav) }
}
