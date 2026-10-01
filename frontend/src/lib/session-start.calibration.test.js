// F11: a lift whose starting weight the person did not know (`calibrate` on its routine entry)
// opens its first session with one light calibration set, the plan's sets waiting at 0 — built
// the way beginWorkout builds it — and is an ordinary planned exercise once anything is logged.
import { describe, it, expect } from 'vitest'
import { buildCombinedEntries } from './session-merge.js'
import { isWarmupRow } from './workout-model.js'

const SQUAT = '0043'
const state = (cfg, workouts = []) => ({ unit: 'kg', exWeights: {}, routines: [{ id: 'A', name: 'A', ex: [{ id: SQUAT, sets: 3, reps: 8, weight: 0, ...cfg }] }], workouts, week: {}, dayPlan: {} })
const entryOf = st => buildCombinedEntries(st, ['A']).entries[0]

describe('a calibrating lift', () => {
  it('opens with a light calibration set on the empty bar, the plan’s sets at 0', () => {
    const e = entryOf(state({ calibrate: true }))
    expect(e.calibrating).toBe(true)
    expect(e.sets[0]).toMatchObject({ w: 20, r: 8, cal: true, done: false })
    expect(isWarmupRow(e.sets[0])).toBe(true)
    expect(e.sets.slice(1).map(s => s.w)).toEqual([0, 0, 0])
  })
  it('in pounds, the 45 lb bar', () => {
    expect(entryOf({ ...state({ calibrate: true }), unit: 'lb' }).sets[0].w).toBe(45)
  })
  it('without the mark, or with history to start from, is built as always', () => {
    expect(entryOf(state({})).sets.some(s => s.cal)).toBe(false)
    const logged = [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, routineIds: ['A'], entries: [{ id: SQUAT, rid: 'A', sets: [1, 2, 3].map(() => ({ w: 60, r: 8, done: true })) }] }]
    const e = entryOf(state({ calibrate: true }, logged))
    expect(e.calibrating).toBeUndefined()
    expect(e.sets.some(s => s.cal)).toBe(false)
    expect(e.sets.every(s => s.w > 0)).toBe(true)
  })
})
