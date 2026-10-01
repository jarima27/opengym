import { describe, it, expect } from 'vitest'
import { reportDay, coachReportFor, sameReport, logReport } from './coach-report.js'
import { pillsFor, addDays } from './coach-pills.js'

const MON = '2026-10-05'
const SQ = '0043'
const at = d => new Date(d + 'T18:00:00').getTime()
const sess = (d, w) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [{ id: SQ, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w, r: 5 })) }] })
const S = over => ({
  unit: 'kg', weekStart: 1, customEx: [], bodyweight: [], dayPlan: {},
  routines: [{ id: 'A', name: 'A', ex: [{ id: SQ, sets: 3, reps: 5 }] }], week: { 1: 'A', 3: 'A', 5: 'A' },
  // Five weeks of a squat stuck at 120 since 21 Sep: a stall the report will lead with.
  workouts: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02']
    .map((d, i) => sess(d, Math.min(120, 100 + i * 7))),
  ...over
})

describe('reportDay', () => {
  it('is today on the week’s first day, else the next week’s first day — Sunday-first weeks too', () => {
    expect(reportDay(S(), MON)).toBe(MON)
    expect(reportDay(S(), addDays(MON, 3))).toBe(addDays(MON, 7))
    expect(reportDay(S(), addDays(MON, -1))).toBe(MON)
    expect(reportDay(S({ weekStart: 0 }), addDays(MON, 2))).toBe(addDays(MON, 6))
  })
})

describe('coachReportFor', () => {
  it('is the report the coming report day would show: its pills, as of that morning', () => {
    const wed = addDays(MON, -5)
    const r = coachReportFor(S(), wed)
    expect(r.on).toBe(MON)
    expect(r.kind).toBe(pillsFor(S(), MON)[0].kind)
    expect(r.body).toBe(pillsFor(S(), MON)[0].body)
    expect(r.title).toBe('What your Coach would tell you this week')
    expect(r.push).toBe(true)
    expect(coachReportFor(S(), wed, { push: false }).push).toBe(false)
  })
  it('a week with nothing to say has no report', () => {
    expect(coachReportFor(S({ workouts: [] }), MON)).toBe(null)
  })
  it('compares by value', () => {
    expect(sameReport(coachReportFor(S(), MON), coachReportFor(S(), MON))).toBe(true)
    expect(sameReport(null, undefined)).toBe(true)
    expect(sameReport(coachReportFor(S(), MON), null)).toBe(false)
  })
})

describe('logReport', () => {
  it('a report for a week to come is that week’s lead, replaced while it is recomputed; on its own day the card records', () => {
    const r = coachReportFor(S(), addDays(MON, -5))
    expect(r.id).toBe(pillsFor(S(), MON)[0].id)
    expect(logReport({}, r, addDays(MON, -5))).toEqual({ [MON]: [r.id] })
    expect(logReport({ [MON]: ['old'] }, r, addDays(MON, -5))).toEqual({ [MON]: [r.id] })
    expect(logReport({ x: 1 }, r, MON)).toEqual({ x: 1 })
    expect(logReport(undefined, null, MON)).toEqual({})
  })
})
