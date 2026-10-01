// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { offerFor, offerAllowed, OFFER_EVERY_MS, lastOfferAt, offersSeen, markOffer } from './offers.js'

const TODAY = '2026-10-05'
const NOW = new Date('2026-10-05T10:00:00').getTime()
const SQ = '0043', BP = '0025'
const at = d => new Date(d + 'T18:00:00').getTime()
const sess = (d, sq, bp = 60, extra = {}) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [
  { id: SQ, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w: sq, r: 5 })) },
  { id: BP, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w: bp, r: 5 })) }], ...extra })
const S = workouts => ({ unit: 'kg', weekStart: 1, dayPlan: {}, customEx: [], routines: [{ id: 'A', name: 'A', ex: [{ id: SQ, sets: 3, reps: 5 }, { id: BP, sets: 3, reps: 5 }] }], week: { 1: 'A', 3: 'A', 5: 'A' }, workouts })
// Five weeks of steady work, then the squat stuck at 120 since 21 Sep.
const stalled = () => S(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02'].map((d, i) => sess(d, Math.min(120, 100 + i * 7), 60 + i * 2.5)))
const base = { today: TODAY, now: NOW, access: 'free' }

describe('offerFor', () => {
  it('only for someone without the Coach', () => {
    expect(offerFor({ ...base, S: stalled(), access: 'pro' })).toBe(null)
    expect(offerFor({ ...base, S: stalled(), access: 'open' })).toBe(null)
    expect(offerFor({ ...base, S: stalled() })).toMatchObject({ reason: 'stall', key: 'stall:0043:2026-09-21', context: { exercise: 'barbell full squat', weeks: 2 } })
  })
  it('a stall is offered once for that stall', () => {
    expect(offerFor({ ...base, S: stalled(), seen: ['stall:0043:2026-09-21'] })).toBe(null)
  })
  it('a week after the free first plan, with two workouts since: first of all', () => {
    expect(offerFor({ ...base, S: stalled(), freePlanAt: '2026-09-23T09:00:00.000Z' })).toMatchObject({ reason: 'day7', key: 'day7' })
    // Only one workout since the gift: not yet; six days: not yet.
    expect(offerFor({ ...base, S: stalled(), freePlanAt: '2026-09-28T09:00:00.000Z', seen: ['stall:0043:2026-09-21'] })).toBe(null)
    expect(offerFor({ ...base, S: stalled(), seen: ['day7', 'stall:0043:2026-09-21'], freePlanAt: '2026-09-23' })).toBe(null)
  })
  it('back after five days or more without training, once per absence', () => {
    const away = S(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((d, i) => sess(d, 100 + i * 5, 60 + i * 2.5)))
    expect(offerFor({ ...base, S: away, today: '2026-10-03' })).toMatchObject({ reason: 'comeback', key: 'comeback:2026-09-28' })
    expect(offerFor({ ...base, S: away, today: '2026-10-03', seen: ['comeback:2026-09-28'] })).toBe(null)
    expect(offerFor({ ...base, S: away, today: '2026-10-02' })).toBe(null)
  })
})

describe('the limits every offer obeys', () => {
  it('one every three days, whatever the reason', () => {
    expect(offerAllowed({ S: stalled(), now: NOW, lastOfferAt: NOW - OFFER_EVERY_MS + 60000 })).toBe(false)
    expect(offerAllowed({ S: stalled(), now: NOW, lastOfferAt: NOW - OFFER_EVERY_MS })).toBe(true)
    expect(offerFor({ ...base, S: stalled(), lastOfferAt: NOW - 86400000 })).toBe(null)
  })
  it('never with a workout running, never right after a record', () => {
    expect(offerFor({ ...base, S: { ...stalled(), active: { start: NOW } } })).toBe(null)
    const s = stalled()
    s.workouts.push({ id: 'pr', d: TODAY, start: NOW - 7200000, end: NOW - 3600000, prs: [BP], entries: [] })
    expect(offerFor({ ...base, S: s })).toBe(null)
    s.workouts[s.workouts.length - 1].end = NOW - 13 * 3600000
    expect(offerFor({ ...base, S: s })).toMatchObject({ reason: 'stall' })
  })
})

describe('what the device remembers', () => {
  beforeEach(() => { localStorage.clear() })
  it('the last offer’s time — the end-of-trial screen’s old clock included — and the keys offered', () => {
    expect(lastOfferAt()).toBe(0)
    localStorage.setItem('gym_trial_end_seen', '500')
    expect(lastOfferAt()).toBe(500)
    markOffer('stall:x', 1000)
    expect(lastOfferAt()).toBe(1000)
    markOffer('day7', 2000)
    markOffer('stall:x', 3000)
    expect(offersSeen()).toEqual(['day7', 'stall:x'])
  })
})
