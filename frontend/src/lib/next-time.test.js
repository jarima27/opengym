import { describe, expect, it } from 'vitest'
import { nextTimeLines } from './next-time.js'

const set = (w, r, done = true) => ({ w, r, done })
const routine = { id: 'A', name: 'A', ex: [{ id: '0043', sets: 3, reps: 5, weight: 60 }, { id: '0025', sets: 3, reps: 5, weight: 50 }, { id: '0662', sets: 3, reps: 10, weight: 0 }] }
const workout = entries => ({ id: 'w1', d: '2026-10-05', start: 1, end: 2, routineIds: ['A'], entries })
const stateWith = w => ({ unit: 'kg', routines: [routine], workouts: [w] })

describe('nextTimeLines', () => {
  it('every rep done: next time one step up, and by how much', () => {
    const w = workout([{ id: '0043', rid: 'A', target: routine.ex[0], sets: [set(60, 5), set(60, 5), set(60, 5)] }])
    expect(nextTimeLines(stateWith(w), w)).toEqual([{ id: '0043', kind: 'up', weight: 65, delta: 5 }])   // legs move 5 kg at a time
  })
  it('reps missed: the same weight again, no change', () => {
    const w = workout([{ id: '0025', rid: 'A', target: routine.ex[1], sets: [set(50, 5), set(50, 4), set(50, 3)] }])
    expect(nextTimeLines(stateWith(w), w)).toEqual([{ id: '0025', kind: 'hold', weight: 50, delta: 0 }])
  })
  it('bodyweight work: the reps it climbs to', () => {
    const w = workout([{ id: '0662', rid: 'A', target: routine.ex[2], sets: [set(0, 10), set(0, 10), set(0, 10)] }])
    expect(nextTimeLines(stateWith(w), w)).toEqual([{ id: '0662', kind: 'up', reps: 11, delta: 1 }])
  })
  it('lifts going up first; nothing for an exercise outside the plan or not done', () => {
    const w = workout([
      { id: '0025', rid: 'A', target: routine.ex[1], sets: [set(50, 5), set(50, 4), set(50, 3)] },
      { id: '0043', rid: 'A', target: routine.ex[0], sets: [set(60, 5), set(60, 5), set(60, 5)] },
      { id: '0031', sets: [set(30, 10)] },
      { id: '0662', rid: 'A', target: routine.ex[2], sets: [set(0, 10, false)] }
    ])
    expect(nextTimeLines(stateWith(w), w).map(l => l.id)).toEqual(['0043', '0025'])
    expect(nextTimeLines(stateWith(w), w, 1)).toHaveLength(1)
  })
  it('a light calibration set is not the heaviest set of the day', () => {
    const w = workout([{ id: '0043', rid: 'A', target: routine.ex[0], sets: [{ w: 80, r: 5, done: true, phase: 'warmup', cal: true }, set(60, 5), set(60, 5), set(60, 5)] }])
    expect(nextTimeLines(stateWith(w), w)[0]).toMatchObject({ weight: 65, delta: 5 })
  })
})
