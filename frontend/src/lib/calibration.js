// F11 — "I don't know how much I lift": the first session of a lift finds its working weight
// instead of asking for a number nobody should have to guess.
//
// The exercise opens with one light set (the empty bar, a pair of light dumbbells, the top of a
// stack) marked as a calibration row. After each one the person says how it went:
//   easy        another calibration row, one jump heavier;
//   about right that is the weight;
//   hard        the one before it (or this one, when there is nothing lighter to go back to).
// The plan's own sets then take the weight found, and the routine keeps it for next time.
//
// A calibration row is a warm-up as far as everything else is concerned (phase 'warmup'):
// progression reads only the plan's sets (lib/progression.js readSession), and records and volume
// leave warm-ups out — so finding the weight can never become the first "stall" or a fake PR.
import { EXIDX } from './exercises.js'
import { isBw, modeOf } from './history.js'
import { weightIncrement, snapWeight } from './progression.js'

export const RATINGS = ['easy', 'good', 'hard']
// Past this many light sets the next jump is simply the weight: a first session is not a max test.
export const MAX_CAL_ROWS = 6

// Where the first set starts, and how far "easy" jumps, by equipment.
const START = {
  kg: { barbell: 20, 'ez barbell': 10, 'smith machine': 20, dumbbell: 4, kettlebell: 8, cable: 10, 'leverage machine': 20, 'sled machine': 40, weighted: 5 },
  lb: { barbell: 45, 'ez barbell': 25, 'smith machine': 45, dumbbell: 10, kettlebell: 18, cable: 20, 'leverage machine': 45, 'sled machine': 90, weighted: 10 }
}
const JUMP = {
  kg: { barbell: w => (w < 60 ? 10 : 5), 'ez barbell': () => 5, 'smith machine': w => (w < 60 ? 10 : 5), dumbbell: w => (w < 12 ? 2 : 4), kettlebell: () => 4, cable: () => 5, 'leverage machine': () => 10, 'sled machine': () => 20, weighted: () => 5 },
  lb: { barbell: w => (w < 135 ? 20 : 10), 'ez barbell': () => 10, 'smith machine': w => (w < 135 ? 20 : 10), dumbbell: () => 5, kettlebell: () => 9, cable: () => 10, 'leverage machine': () => 20, 'sled machine': () => 40, weighted: () => 10 }
}
// A bar is as light as it gets: "too hard" on the empty bar stays on the empty bar.
const FLOOR = new Set(['barbell', 'ez barbell', 'smith machine'])

const unitOf = unit => (unit === 'lb' ? 'lb' : 'kg')
const eqOf = cfg => EXIDX[cfg?.id]?.eq || ''

/** Whether a lift can be calibrated this way: loaded rep work. */
export function calibrates(cfg) {
  if (!cfg?.id || !EXIDX[cfg.id]) return false
  return modeOf(cfg) === 'reps' && !isBw(cfg)
}

/** The first calibration weight for a lift, on its own increment. */
export function calibrationStart(cfg, unit) {
  const u = unitOf(unit)
  const w = START[u][eqOf(cfg)] ?? (u === 'lb' ? 20 : 10)
  // A bar weighs what it weighs (45 lb is not on a 10 lb grid); anything else lands on the grid.
  return FLOOR.has(eqOf(cfg)) ? w : snapWeight(w, weightIncrement(cfg, u))
}

/** How much heavier the next set goes after an easy one. */
export function calibrationJump(cfg, unit, weight) {
  const u = unitOf(unit)
  const f = JUMP[u][eqOf(cfg)] || (() => (u === 'lb' ? 10 : 5))
  const inc = weightIncrement(cfg, u)
  return Math.max(inc, snapWeight(f(weight), inc))
}

/** A calibration row at `w` for `reps` — the plan's reps, so "about right" means it. */
export const calibrationRow = (w, reps) => ({ w, r: Math.max(1, Math.round(reps) || 8), done: false, phase: 'warmup', cal: true })

export const isCalibrationRow = s => !!s?.cal

/**
 * After the calibration row at `index` is done and rated: the rows that follow and the weight
 * found, if this rating found it. Returns { sets, found } — `found` null while calibrating goes on.
 * The work sets not yet done take the weight found; done ones are never rewritten.
 */
export function rateCalibration(sets, index, rating, cfg, unit) {
  const rows = (sets || []).map(s => ({ ...s }))
  const row = rows[index]
  if (!row || !row.cal || !RATINGS.includes(rating)) return { sets: rows, found: null }
  row.calRating = rating
  const cal = rows.filter(s => s.cal)
  const at = cal.indexOf(row)
  const before = at > 0 ? cal[at - 1] : null
  let found = null
  if (rating === 'good') found = row.w
  else if (rating === 'hard') {
    const inc = weightIncrement(cfg, unitOf(unit))
    found = before ? before.w
      : FLOOR.has(eqOf(cfg)) ? row.w
        : Math.max(inc, snapWeight(row.w - calibrationJump(cfg, unit, row.w), inc))
  } else {
    const next = snapWeight(row.w + calibrationJump(cfg, unit, row.w), weightIncrement(cfg, unitOf(unit)))
    if (cal.length >= MAX_CAL_ROWS) found = next
    else {
      // The new light set goes after the last calibration row, before the plan's sets.
      const lastCal = rows.lastIndexOf(cal[cal.length - 1])
      rows.splice(lastCal + 1, 0, calibrationRow(next, row.r))
      return { sets: rows, found: null }
    }
  }
  const out = rows
    // Calibration rows not yet done are not needed once the weight is found.
    .filter(s => !(s.cal && !s.done))
    .map(s => (s.cal || s.done || s.phase === 'warmup' ? s : { ...s, w: found }))
  return { sets: out, found }
}

/** The calibration row waiting for a rating: the last done one without one. */
export function awaitingRating(sets) {
  const i = (sets || []).findIndex(s => s.cal && s.done && !s.calRating)
  return i
}

/**
 * A new plan's lifts with a load to find and nothing to start from — no weight, no history
 * (`known(id)`) — are marked to find it in their first session: not only the main lifts the
 * first run asks about, so no first session opens at 0 with nothing to go on. Returns how many.
 */
export function markUnknownLifts(routines = [], known = () => false) {
  let n = 0
  for (const r of routines) for (const e of (r.ex || [])) {
    if (e.calibrate || e.weight > 0 || !calibrates(e) || known(e.id)) continue
    e.calibrate = true
    n++
  }
  return n
}
