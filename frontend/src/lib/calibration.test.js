import { describe, expect, it } from 'vitest'
import {
  calibrates, calibrationStart, calibrationJump, calibrationRow, rateCalibration, awaitingRating, markUnknownLifts, MAX_CAL_ROWS
} from './calibration.js'
import { nextPrescription, readSession } from './progression.js'

const SQUAT = { id: '0043', sets: 3, reps: 8, weight: 0 }          // barbell
const CURL = { id: '0294', sets: 3, reps: 10, weight: 0 }          // dumbbell
const PUSHUP = { id: '0662', sets: 3, reps: 10, weight: 0 }        // body weight
const work = n => Array.from({ length: n }, () => ({ w: 0, r: 8, done: false }))
const done = row => ({ ...row, done: true })

describe('where a calibration starts', () => {
  it('only loaded rep work is calibrated', () => {
    expect(calibrates(SQUAT)).toBe(true)
    expect(calibrates(CURL)).toBe(true)
    expect(calibrates(PUSHUP)).toBe(false)
    expect(calibrates({ id: '0043', mode: 'time', sec: 30 })).toBe(false)
    expect(calibrates({ id: 'nope' })).toBe(false)
  })
  it('the empty bar, light dumbbells — in the profile’s unit', () => {
    expect(calibrationStart(SQUAT, 'kg')).toBe(20)
    expect(calibrationStart(SQUAT, 'lb')).toBe(45)
    expect(calibrationStart(CURL, 'kg')).toBe(5)        // 4 kg on a 2.5 kg increment
    expect(calibrationStart(CURL, 'lb')).toBe(10)
  })
  it('jumps big while the bar is light, smaller once it is not', () => {
    expect(calibrationJump(SQUAT, 'kg', 20)).toBe(10)
    expect(calibrationJump(SQUAT, 'kg', 80)).toBe(5)
    expect(calibrationJump(CURL, 'kg', 5)).toBe(2.5)
  })
})

describe('rating a calibration set', () => {
  const start = () => [calibrationRow(20, 8), ...work(3)]
  it('easy: one more light set, heavier, before the plan’s sets', () => {
    const s = start(); s[0] = done(s[0])
    const r = rateCalibration(s, 0, 'easy', SQUAT, 'kg')
    expect(r.found).toBe(null)
    expect(r.sets.map(x => [x.w, !!x.cal])).toEqual([[20, true], [30, true], [0, false], [0, false], [0, false]])
    expect(r.sets[0].calRating).toBe('easy')
    expect(awaitingRating(r.sets)).toBe(-1)
  })
  it('about right: that is the weight, and the plan’s sets take it', () => {
    let s = start(); s[0] = done(s[0])
    s = rateCalibration(s, 0, 'easy', SQUAT, 'kg').sets
    s[1] = done(s[1])
    expect(awaitingRating(s)).toBe(1)
    const r = rateCalibration(s, 1, 'good', SQUAT, 'kg')
    expect(r.found).toBe(30)
    expect(r.sets.filter(x => !x.cal).map(x => x.w)).toEqual([30, 30, 30])
  })
  it('hard: the one before — or, on the empty bar, the empty bar', () => {
    let s = start(); s[0] = done(s[0])
    s = rateCalibration(s, 0, 'easy', SQUAT, 'kg').sets
    s[1] = done(s[1])
    expect(rateCalibration(s, 1, 'hard', SQUAT, 'kg').found).toBe(20)
    const first = start(); first[0] = done(first[0])
    expect(rateCalibration(first, 0, 'hard', SQUAT, 'kg').found).toBe(20)
    const db = [done(calibrationRow(10, 10)), ...work(3)]
    expect(rateCalibration(db, 0, 'hard', CURL, 'kg').found).toBe(7.5)   // one jump lighter
  })
  it('never rewrites a plan set already done, and drops a light set left undone', () => {
    let s = start(); s[0] = done(s[0])
    s = rateCalibration(s, 0, 'easy', SQUAT, 'kg').sets   // a pending 30 kg row
    s[2] = { ...s[2], w: 25, done: true }                  // a plan set done by hand meanwhile
    s[0] = { ...s[0] }
    const r = rateCalibration([...s.slice(0, 1), ...s.slice(1)], 0, 'good', SQUAT, 'kg')
    expect(r.found).toBe(20)
    expect(r.sets.some(x => x.cal && !x.done)).toBe(false)
    expect(r.sets.filter(x => !x.cal).map(x => x.w)).toEqual([25, 20, 20])
  })
  it('stops climbing after a handful of light sets', () => {
    let s = [done(calibrationRow(20, 8)), ...work(3)]
    for (let i = 0; i < MAX_CAL_ROWS - 1; i++) {
      s = rateCalibration(s, i, 'easy', SQUAT, 'kg').sets
      s[i + 1] = done(s[i + 1])
    }
    const r = rateCalibration(s, MAX_CAL_ROWS - 1, 'easy', SQUAT, 'kg')
    expect(r.found).toBeGreaterThan(s[MAX_CAL_ROWS - 1].w)
  })
  it('an unknown rating or a row that is not a calibration row changes nothing', () => {
    const s = start()
    expect(rateCalibration(s, 0, 'meh', SQUAT, 'kg').found).toBe(null)
    expect(rateCalibration(s, 1, 'good', SQUAT, 'kg').found).toBe(null)
  })
})

describe('what progression makes of a calibration session', () => {
  it('reads only the plan’s sets, and the next session goes up from the weight found', () => {
    let sets = [done(calibrationRow(20, 8)), ...work(3)]
    sets = rateCalibration(sets, 0, 'easy', SQUAT, 'kg').sets
    sets[1] = done(sets[1])
    sets = rateCalibration(sets, 1, 'easy', SQUAT, 'kg').sets      // 40 next
    sets[2] = done(sets[2])
    sets = rateCalibration(sets, 2, 'hard', SQUAT, 'kg').sets      // back to 30
    sets = sets.map(x => (x.cal ? x : { ...x, r: 8, done: true }))
    const entry = { id: '0043', rid: 'A', target: { ...SQUAT, weight: 30 }, sets }
    expect(readSession(entry).weight).toBe(30)                    // the 40 kg light set is not the session
    const S = { unit: 'kg', routines: [{ id: 'A', ex: [{ ...SQUAT, weight: 30 }] }], workouts: [{ id: 'w1', d: '2026-10-05', start: 1, end: 2, entries: [entry] }] }
    const p = nextPrescription(S, S.routines[0].ex[0], S.routines[0])
    expect(p).toMatchObject({ kind: 'up', weight: 35 })
  })
})

describe('markUnknownLifts', () => {
  it('marks every loaded lift with no weight and no history, and nothing else', () => {
    const routines = [
      { id: 'A', ex: [{ ...SQUAT }, { ...CURL, weight: 12 }, { ...PUSHUP }] },
      { id: 'B', ex: [{ id: '0739', sets: 3, reps: 10, weight: 0 }, { id: '0025', sets: 3, reps: 5, weight: 0 }] },
    ]
    const n = markUnknownLifts(routines, id => id === '0025')   // bench has history
    expect(n).toBe(2)
    expect(routines.flatMap(r => r.ex).filter(e => e.calibrate).map(e => e.id)).toEqual(['0043', '0739'])
  })
})
