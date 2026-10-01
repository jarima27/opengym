import { describe, it, expect } from 'vitest'
import { trialRecap, recapHasNews, recapLines, recapContext } from './trial-recap.js'

const SQ = '0043'
const at = d => new Date(d + 'T18:00:00').getTime()
const w = (d, kg) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [{ id: SQ, sets: [{ done: true, w: kg, r: 5 }] }] })
const S = {
  workouts: [w('2026-08-20', 90), w('2026-09-05', 95), w('2026-09-15', 100), w('2026-09-28', 105)],
  coach: { log: [
    { kind: 'create', at: at('2026-09-02') },
    { kind: 'review', at: at('2026-09-09'), decisions: [{ status: 'accepted' }, { status: 'accepted' }, { status: 'rejected' }] },
    { kind: 'review', at: at('2026-09-16'), dismissed: true, decisions: [{ status: 'rejected' }] },
    { kind: 'debrief', at: at('2026-09-05') }, { kind: 'debrief', at: at('2026-09-15') },
    { kind: 'debrief', at: at('2026-08-21') }
  ] }
}

describe('trialRecap', () => {
  it('counts what the Coach did inside the trial, and the clearest rise, from the log and the numbers', () => {
    const r = trialRecap(S, { from: '2026-09-01', to: '2026-09-30' })
    expect(r.adjustments).toBe(3)      // the plan it built + two accepted changes
    expect(r.analysed).toBe(2)         // the August debrief is outside the trial
    expect(r.gain.exercise).toBe(SQ)
    expect(r.gain.delta).toBeGreaterThan(0)
    expect(recapHasNews(r)).toBe(true)
  })
  it('nothing done, nothing to say', () => {
    const r = trialRecap({ workouts: [], coach: { log: [] } }, { from: '2026-09-01', to: '2026-09-30' })
    expect(r).toEqual({ adjustments: 0, analysed: 0, gain: null })
    expect(recapHasNews(r)).toBe(false)
  })
})

describe('recapLines and recapContext', () => {
  it('say only what there is', () => {
    const r = { adjustments: 3, analysed: 1, gain: { exercise: '0043', name: 'barbell full squat', delta: 15 } }
    expect(recapLines(r, { unit: 'kg' })).toEqual(['3 changes to your plan', '1 session analysed', '+15 kg on barbell full squat'])
    expect(recapLines({ adjustments: 1, analysed: 0, gain: null })).toEqual(['1 change to your plan'])
    expect(recapContext(r, { unit: 'kg' })).toEqual({ adjustments: 3, gainKg: '15 kg', exercise: 'barbell full squat' })
    expect(recapContext({ adjustments: 0, analysed: 2, gain: null })).toEqual({})
  })
})
