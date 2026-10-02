// The record card's words (lib/pr-card.js): which weight, for how many reps, against what it beat
// — and the name and the number fitted to the card.
import { describe, expect, it } from 'vitest'
import { prCardData, wrapLines, fitSize } from './pr-card.js'

const SQUAT = '0043'
const w = (id, d, sets) => ({ id, d, entries: [{ id: SQUAT, sets: sets.map(([kg, r, warm]) => ({ w: kg, r, done: true, ...(warm ? { phase: 'warmup' } : {}) })) }] })

describe('prCardData', () => {
  const before = w('w1', '2026-09-28', [[95, 5]])
  const today = w('w2', '2026-10-05', [[60, 5, true], [100, 3], [100, 5], [90, 8]])
  const S = { unit: 'kg', workouts: [before, today] }

  it('the heaviest work set, its best reps, and the best before this workout', () => {
    expect(prCardData(S, today, SQUAT)).toEqual({
      exId: SQUAT, kind: 'weight', weight: 100, unit: 'kg', reps: 5, from: null,
      previous: 95, better: true, delta: 5, date: '2026-10-05'
    })
  })
  it('a first ever record has nothing to beat', () => {
    const d = prCardData({ unit: 'lb', workouts: [today] }, today, SQUAT)
    expect([d.previous, d.delta, d.unit]).toEqual([null, null, 'lb'])
  })
  it('an estimated one-rep max, from the set it came from', () => {
    const d = prCardData(S, today, SQUAT, { kind: 'e1rm', est: 116.666 })
    expect([d.kind, d.weight, d.from, d.previous]).toEqual(['e1rm', 116.7, { w: 100, r: 5 }, null])
  })
  it('nothing for an exercise the workout does not have', () => {
    expect(prCardData(S, today, '0025')).toBe(null)
  })
})

describe('fitting the words', () => {
  const measure = s => s.length * 10   // ten pixels a character
  it('wraps a long name over lines, the last cut with an ellipsis', () => {
    expect(wrapLines(measure, 'Barbell full squat', 100)).toEqual(['Barbell', 'full squat'])
    expect(wrapLines(measure, 'one two three four five six seven', 90, 2)).toEqual(['one two', 'three fo…'])
    expect(wrapLines(measure, 'Supercalifragilistic', 50)).toEqual(['Supercalifragilistic'])
  })
  it('takes the biggest size the number fits at', () => {
    const at = (px, s) => px * s.length * 0.5
    expect(fitSize(at, '100 kg', 900)).toBe(300)
    expect(fitSize(at, '1,102.5 lb', 900)).toBe(160)
    expect(fitSize(at, 'x'.repeat(40), 900)).toBe(130)
  })
})
