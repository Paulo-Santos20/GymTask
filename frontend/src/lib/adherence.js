// Weekly adherence: this week's sessions against the days the plan actually has.
//
// The denominator is the *effective* plan — `S.dayPlan` over the `S.week` template, through
// `history.effectiveRoutineIds` — because a day moved or cleared with the day planner changes
// what the week was supposed to be, and the old count read the template alone. The numerator is
// plain sessions, exactly what Home's line always showed, so only the denominator moved.
//
// Home's "x / y this week" and the Stats tile both read this one function, so the two numbers
// on the two screens cannot disagree. `pct` is a ratio rather than a cap — two sessions on one
// planned day is 2 of 1, and the pair printed beside it says so — and it is null when nothing is
// planned, since a rest week has nothing to adhere to.

import { effectiveRoutineIds } from './history.js'
import { isoOf, startOfWeek, weekKey, weekStartOf } from './format.js'

export function weeklyAdherence(S, iso) {
  const ws = weekStartOf(S)
  const key = weekKey(iso, ws)
  const done = (S.workouts || []).filter(w => weekKey(w.d, ws) === key).length
  // The three keys a real profile always carries (store DEF) are defaulted here so the helper is
  // total on a partial state instead of throwing inside `effectiveRoutineIds`.
  const plan = { week: S.week || {}, dayPlan: S.dayPlan || {}, routines: S.routines || [] }
  const start = startOfWeek(iso, ws)
  let planned = 0
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (effectiveRoutineIds(plan, isoOf(d)).length) planned++
  }
  return { done, planned, pct: planned ? Math.round((done / planned) * 100) : null }
}
