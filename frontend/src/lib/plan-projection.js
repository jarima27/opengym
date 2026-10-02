// F12 — the first plan's projection: the main lift's estimated strength today and over the next
// eight weeks, worked out by the progression engine itself (lib/progression.js nextPrescription),
// not by a curve drawn to look good. The engine is run session by session on the plan as it is —
// its sets, reps, increments and the days the lift comes round — as if every set of every session
// were completed, and each week's last session is turned into an estimated one-rep max
// (lib/onerm.js). That "as if" is the estimate, and the screen says so.
//
// Only from a weight the person gave (or lifted before): without a starting point there is no
// projection, never one made up from an average.
import { nextPrescription, weightIncrement } from './progression.js'
import { estimate1RM } from './onerm.js'
import { startingWeight } from './first-run.js'

export const PROJECTION_WEEKS = 8

/** How many times a week the plan's schedule comes round to the lift `exId`. */
export function sessionsPerWeek(plan, exId) {
  return (plan?.schedule || []).filter(({ routineId }) => plan.routines.find(r => r.id === routineId)?.ex.some(e => e.id === exId)).length
}

/**
 * The projection for the lift `exId` of `plan` ({ routines, schedule }, lib/first-run.js
 * buildFirstPlan), from a set the person knows they can do (`known`: { w, r }).
 * Returns { exId, start, end, points: [{ week, weight, e1rm }], perWeek, unit } or null when the
 * plan does not train it, or there is no usable set to start from.
 */
export function projectLift(plan, exId, known, { unit = 'kg', weeks = PROJECTION_WEEKS } = {}) {
  const cfg0 = plan?.routines?.flatMap(r => r.ex).find(e => e.id === exId)
  const perWeek = sessionsPerWeek(plan, exId)
  if (!cfg0 || !perWeek || !(known?.w > 0) || !(known?.r > 0)) return null
  const reps = cfg0.reps || known.r
  const start = startingWeight(known.w, known.r, reps, weightIncrement(cfg0, unit))
  if (!start) return null
  const cfg = { ...cfg0, weight: start }
  const S = { unit, workouts: [] }
  const e1rm = w => estimate1RM(w, reps)
  const points = [{ week: 0, weight: start, e1rm: e1rm(start) }]
  let weight = start
  let day = Date.parse('2024-01-01T12:00:00Z')
  for (let week = 1; week <= weeks; week++) {
    for (let i = 0; i < perWeek; i++) {
      const p = nextPrescription(S, cfg, null)
      if (p.kind !== 'first' && p.weight > 0) weight = p.weight
      const r = p.reps || reps
      S.workouts.push({
        d: new Date(day).toISOString().slice(0, 10), end: day,
        entries: [{ id: exId, target: { sets: cfg.sets, reps: r, weight }, sets: Array.from({ length: cfg.sets || 1 }, () => ({ w: weight, r, done: true })) }]
      })
      day += Math.round(7 / perWeek) * 86400000
    }
    points.push({ week, weight, e1rm: e1rm(weight) })
  }
  if (points.some(p => !(p.e1rm > 0))) return null
  return { exId, start: points[0], end: points[points.length - 1], points, perWeek, unit }
}

/**
 * The projection the plan screen shows: the first of the plan's main lifts (lib/first-run.js
 * mainLifts) the person gave a weight for, or null.
 */
export function planProjection(plan, lifts, known = {}, opts) {
  for (const id of lifts || []) {
    const p = projectLift(plan, id, known[id], opts)
    if (p) return p
  }
  return null
}
