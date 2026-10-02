import { describe, expect, it } from 'vitest'
import { projectLift, planProjection, sessionsPerWeek } from './plan-projection.js'
import { buildFirstPlan, mainLifts } from './first-run.js'
import { estimate1RM } from './onerm.js'

// A plan written out by hand, so the numbers below can be checked with a pencil: a squat (lower
// body: 5 kg steps) three times a week and a bench press (2.5 kg) once.
const plan = {
  routines: [
    { id: 'a', ex: [{ id: '0043', sets: 3, reps: 5, weight: 0 }, { id: '0025', sets: 3, reps: 8, weight: 0 }] },
    { id: 'b', ex: [{ id: '0043', sets: 3, reps: 5, weight: 0 }] }
  ],
  schedule: [{ day: 1, routineId: 'a' }, { day: 3, routineId: 'b' }, { day: 5, routineId: 'b' }]
}

describe('the first plan’s projection, by the progression engine', () => {
  it('counts how often the week comes round to a lift', () => {
    expect(sessionsPerWeek(plan, '0043')).toBe(3)
    expect(sessionsPerWeek(plan, '0025')).toBe(1)
    expect(sessionsPerWeek(plan, '9999')).toBe(0)
  })

  it('every session completed: the engine adds its step each time, and the estimate follows', () => {
    // 60 kg × 5 known: the plan's 5 reps start there. 24 sessions in 8 weeks, the first sets the
    // baseline and each of the other 23 adds 5 kg — what the engine prescribes, not a curve.
    const p = projectLift(plan, '0043', { w: 60, r: 5 })
    expect(p.start.weight).toBe(60)
    expect(p.points).toHaveLength(9)
    expect(p.points.map(x => x.weight)).toEqual([60, 70, 85, 100, 115, 130, 145, 160, 175])
    expect(p.end.e1rm).toBe(estimate1RM(175, 5))
    // Once a week, 2.5 kg at a time: a gentler line from the same engine.
    const b = projectLift(plan, '0025', { w: 50, r: 8 })
    expect(b.points.map(x => x.weight)).toEqual([50, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5])
  })

  it('a weight known for other reps is carried to the plan’s reps first (Epley, rounded down)', () => {
    // 60 × 10 ≈ 80 kg for one; for five, 68.6 — 65 on the squat's 5 kg steps.
    const p = projectLift(plan, '0043', { w: 60, r: 10 })
    expect(p.start.weight).toBe(65)
  })

  it('nothing to project from, nothing shown', () => {
    expect(projectLift(plan, '0043', null)).toBe(null)
    expect(projectLift(plan, '0043', { w: 0, r: 5 })).toBe(null)
    expect(projectLift(plan, '9999', { w: 60, r: 5 })).toBe(null)
    expect(planProjection(plan, ['0043', '0025'], {})).toBe(null)
  })

  it('the plan screen projects the first main lift the person gave a weight for', () => {
    expect(planProjection(plan, ['0043', '0025'], { '0025': { w: 50, r: 8 } }).exId).toBe('0025')
    const real = buildFirstPlan({ goal: 'strength', experience: 'starting', count: 3, place: 'gym', sessionMin: 60 }, { weekday: 1 })
    const lifts = mainLifts(real.routines)
    const p = planProjection(real, lifts, { [lifts[0]]: { w: 40, r: 5 } })
    expect(p.exId).toBe(lifts[0])
    expect(p.end.e1rm).toBeGreaterThan(p.start.e1rm)
  })
})
