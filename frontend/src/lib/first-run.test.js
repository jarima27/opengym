import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import { isBw } from './history.js'
import {
  trainingDays, recommendPlan, buildFirstPlan, mainLifts, startingWeight, coachProfile,
  firstRunState, firstSteps, tipDue, shiftWeekPast, postponeWeek, DEFAULT_DAYS, FIRST_WEEK_DAYS,
  FLOW, QUESTION_STEPS, nextStep, stepShown, feelsGood
} from './first-run.js'

const DAY = 86400000

describe('trainingDays', () => {
  it('the days picked, Monday first and Sunday last', () => {
    expect(trainingDays({ days: [0, 5, 3] })).toEqual([3, 5, 0])
  })
  it('without a pick, the count spread over the week', () => {
    expect(trainingDays({ count: 3 })).toEqual([1, 3, 5])
    expect(trainingDays({ count: 9 })).toEqual(DEFAULT_DAYS[6])
    expect(trainingDays({})).toEqual(DEFAULT_DAYS[3])
  })
})

describe('recommendPlan', () => {
  const at = (n, extra = {}) => recommendPlan({ count: n, goal: 'muscle', experience: 'starting', place: 'gym', ...extra })
  it('two days: full body', () => expect(at(2)).toEqual({ plan: 'full-body', reason: 'two-days' }))
  it('three days, a beginner: full body — or 5×5 when after strength with a bar to load', () => {
    expect(at(3).plan).toBe('full-body')
    expect(at(3, { goal: 'strength' })).toEqual({ plan: '5x5', reason: 'three-strength' })
    expect(at(3, { goal: 'strength', place: 'basic' }).plan).toBe('5x5')
    expect(at(3, { goal: 'strength', place: 'dumbbells' }).plan).toBe('full-body')
  })
  it('three days for someone who already trains: push/pull/legs', () => {
    expect(at(3, { experience: '1to3' })).toEqual({ plan: 'ppl', reason: 'three-trained' })
  })
  it('four days: upper/lower; five or six: push/pull/legs', () => {
    expect(at(4).plan).toBe('upper-lower')
    expect(at(5).plan).toBe('ppl')
    expect(at(6).plan).toBe('ppl')
  })
})

describe('buildFirstPlan', () => {
  const ids = plan => plan.routines.flatMap(r => r.ex.map(e => e.id))
  it('puts its routines on the picked days, in turn, and keeps only the ones the week uses', () => {
    const p = buildFirstPlan({ days: [2, 6], experience: 'starting', goal: 'general', place: 'gym' })
    expect(p.plan).toBe('full-body')
    expect(p.schedule.map(s => s.day)).toEqual([2, 6])
    expect(p.routines).toHaveLength(2)
    expect(p.schedule.map(s => s.routineId)).toEqual(p.routines.map(r => r.id))
    const ppl = buildFirstPlan({ count: 5, experience: 'gt3', place: 'gym' })
    expect(ppl.routines).toHaveLength(3)
    expect(ppl.schedule.map(s => ppl.routines.findIndex(r => r.id === s.routineId))).toEqual([0, 1, 2, 0, 1])
  })
  it('every exercise exists, once per routine, and none starts with a weight', () => {
    for (const place of ['gym', 'basic', 'dumbbells', 'bodyweight']) {
      for (const count of [2, 3, 4, 5, 6]) {
        const p = buildFirstPlan({ count, place, experience: 'starting', goal: 'strength', sessionMin: 90 })
        for (const r of p.routines) {
          expect(r.ex.length).toBeGreaterThan(1)
          expect(new Set(r.ex.map(e => e.id)).size).toBe(r.ex.length)
          for (const e of r.ex) { expect(EXIDX[e.id]).toBeTruthy(); expect(e.weight).toBe(0) }
        }
      }
    }
  })
  it('fits the equipment: no machine or cable in a basic gym, dumbbells at home, nothing at all without', () => {
    const eqs = place => new Set(ids(buildFirstPlan({ count: 4, place, sessionMin: 90 })).map(id => EXIDX[id].eq))
    expect([...eqs('basic')].filter(e => /cable|machine/.test(e))).toEqual([])
    expect([...eqs('dumbbells')].every(e => e === 'dumbbell' || e === 'body weight')).toBe(true)
    const bw = buildFirstPlan({ count: 3, place: 'bodyweight', sessionMin: 90 })
    expect(ids(bw).every(id => isBw({ id }))).toBe(true)
    // the full gym keeps the plan as it is
    expect(ids(buildFirstPlan({ count: 4, place: 'gym', sessionMin: 90 }))).toContain('2330')
  })
  it('fits the time: three exercises for half an hour, the main lifts first', () => {
    const p = buildFirstPlan({ count: 3, place: 'gym', experience: 'starting', sessionMin: 30 })
    expect(p.routines.every(r => r.ex.length <= 3)).toBe(true)
    expect(p.routines[0].ex[0].id).toBe('0043')
    expect(buildFirstPlan({ count: 3, place: 'gym', sessionMin: 45 }).routines[0].ex.length).toBe(4)
  })
  it('opens with its first session on the first training day from today, the rest following it', () => {
    const a = { count: 3, place: 'gym', experience: 'starting', goal: 'strength' }
    const week = p => Object.fromEntries(p.schedule.map(x => [x.day, p.routines.find(r => r.id === x.routineId).name]))
    // Monday, a training day: A on Monday as always.
    expect(week(buildFirstPlan(a, { weekday: 1 }))).toEqual({ 1: '5×5 A', 3: '5×5 B', 5: '5×5 C' })
    // Thursday: Friday comes first, so it takes A, and Monday and Wednesday carry on.
    expect(week(buildFirstPlan(a, { weekday: 4 }))).toEqual({ 5: '5×5 A', 1: '5×5 B', 3: '5×5 C' })
    // Sunday (0) is the week's last day: the plan starts on Monday.
    expect(week(buildFirstPlan(a, { weekday: 0 }))).toEqual({ 1: '5×5 A', 3: '5×5 B', 5: '5×5 C' })
    // Four days on a Wednesday: upper and lower still alternate, from Thursday on.
    expect(week(buildFirstPlan({ count: 4, place: 'gym', experience: '1to3' }, { weekday: 3 })))
      .toEqual({ 4: 'Upper A', 5: 'Lower A', 1: 'Upper B', 2: 'Lower B' })
  })
})

describe('postponeWeek', () => {
  const week = { 4: ['UA'], 5: ['LA'], 1: ['UB'], 2: ['LB'] }   // opening on a Thursday
  it('not training on Thursday: Friday opens with Upper A, and the order after it holds', () => {
    expect(postponeWeek(week, 4)).toEqual({ 5: ['UA'], 1: ['LA'], 2: ['UB'], 4: ['LB'] })
  })
  it('a day without a session leaves the week alone', () => {
    expect(postponeWeek(week, 3)).toBe(week)
  })
})

describe('shiftWeekPast', () => {
  const week = { 5: ['A'], 1: ['B'], 3: ['C'] }   // as buildFirstPlan leaves it on a Thursday
  it('training A early on Thursday moves the week along: Friday B, Monday C, Wednesday A', () => {
    expect(shiftWeekPast(week, 4, 'A')).toEqual({ 5: ['B'], 1: ['C'], 3: ['A'] })
  })
  it('leaves the week alone when the next session is not the one trained', () => {
    expect(shiftWeekPast(week, 4, 'B')).toBe(week)
    expect(shiftWeekPast({ 1: ['A'] }, 4, 'A')).toEqual({ 1: ['A'] })
  })
})

describe('mainLifts', () => {
  it('the first two loaded lifts of each routine, at most four, no bodyweight work', () => {
    const p = buildFirstPlan({ count: 3, place: 'gym', experience: 'starting', goal: 'muscle' })
    const lifts = mainLifts(p.routines)
    expect(lifts.length).toBeLessThanOrEqual(4)
    expect(lifts[0]).toBe('0043')
    expect(lifts.every(id => !isBw({ id }))).toBe(true)
    expect(mainLifts(buildFirstPlan({ count: 3, place: 'bodyweight' }).routines)).toEqual([])
  })
})

describe('startingWeight', () => {
  it('carries a known set to the plan’s reps (Epley), rounded down to the step', () => {
    expect(startingWeight(60, 5, 10, 2.5)).toBe(52.5)
    expect(startingWeight(60, 8, 8, 2.5)).toBe(60)
    expect(startingWeight(100, 10, 5, 2.5)).toBe(112.5)   // 114.3 by Epley, rounded down
  })
  it('nothing usable, nothing', () => {
    expect(startingWeight(0, 5, 8)).toBe(null)
    expect(startingWeight(60, 0, 8)).toBe(null)
  })
})

describe('coachProfile', () => {
  it('the same answers in the Coach’s words', () => {
    const p = coachProfile({ goal: 'fatloss', experience: '1to3', days: [1, 3, 5], sessionMin: 45, place: 'dumbbells', limits: ' bad knee ' })
    expect(p).toMatchObject({ goal: 'fatloss', experience: 'regular', daysPerWeek: 3, preferredDays: [1, 3, 5], sessionMin: 45, equipment: ['dumbbell', 'body weight'], limitations: 'bad knee' })
    expect(p.notes).toMatch(/1 to 3 years/)
    expect(coachProfile({ experience: 'starting', place: 'gym' })).toMatchObject({ experience: 'new', equipment: [] })
  })
  it('F12’s questions reach the Coach, which is where they matter: they do not change the plan by rule', () => {
    const a = { goal: 'muscle', experience: 'lt1', place: 'gym', holdback: 'time', focus: ['chest', 'arms', 'nope'], bw: 82, bwGoal: 78, unit: 'kg', sleep: '6to7', feeling: 'stuck', when: '8w' }
    const p = coachProfile(a)
    expect(p.likes).toBe('Wants to prioritise: chest, arms.')
    expect(p.notes).toBe('Training for less than a year. Finding the time has been the problem so far. Body weight 82 kg, aiming for 78 kg. Sleeps 6 to 7 hours a night. Feels stuck. Wants to notice a change within 8 weeks.')
    expect(p.notes.length).toBeLessThanOrEqual(600)
    expect(buildFirstPlan(a, { weekday: 1 }).plan).toBe(buildFirstPlan({ goal: 'muscle', experience: 'lt1', place: 'gym' }, { weekday: 1 }).plan)
  })
})

describe('the guided first run’s screens (F12)', () => {
  it('before an account: the video first, the sign-up last before the paywall', () => {
    const pre = { pre: true, lifts: 2 }
    const seen = []
    for (let s = 'intro'; s; s = nextStep(s, pre)) seen.push(s)
    expect(seen).toEqual(FLOW)
    expect(seen.indexOf('account')).toBe(seen.indexOf('paywall') - 1)
    expect(seen.length).toBeGreaterThanOrEqual(20)
  })
  it('signed up already: no video, no sign-up; no weights to ask, no weights screen', () => {
    const post = { pre: false, lifts: 0 }
    expect(stepShown('intro', post)).toBe(false)
    expect(nextStep('limits', post)).toBe('building')
    expect(nextStep('plan', post)).toBe('paywall')
    // A first run picked up after signing up, on the sign-up screen it left: on to the paywall.
    expect(nextStep('account', post)).toBe('paywall')
    expect(nextStep('today', post)).toBe(null)
    // No Coach to read them: only the questions that make the plan, and the body weight.
    const bare = { pre: false, lifts: 2, coach: false }
    const asked = []
    for (let s = 'goal'; s !== 'building'; s = nextStep(s, bare)) asked.push(s)
    expect(asked).toEqual(['goal', 'experience', 'body', 'days', 'place', 'length', 'limits', 'lifts'])
    expect(QUESTION_STEPS[0]).toBe('goal')
    expect(QUESTION_STEPS.at(-1)).toBe('lifts')
  })
  it('a review is asked after a good answer about their progress, never after a bad one', () => {
    expect(['great', 'ok', 'stuck', 'new'].map(feelsGood)).toEqual([true, true, false, false])
  })
})

describe('the first week', () => {
  const t0 = Date.UTC(2026, 9, 5, 9)
  const w = (n, start = t0 + n * DAY) => ({ id: 'w' + n, d: '2026-10-0' + (5 + n), start, end: start + 3600000, entries: [] })
  it('the checklist: a first workout, three in the first week, the import when it came from an app, a weight', () => {
    const S = { firstRun: firstRunState(t0, 'strong'), workouts: [], bodyweight: [] }
    expect(firstSteps(S, t0).items.map(i => [i.key, i.done])).toEqual([['first', false], ['three', false], ['import', false], ['weight', false]])
    S.workouts = [w(0), w(2), w(4)]
    S.bodyweight = [{ d: '2026-10-05', w: 80 }]
    S.firstRun.imported = true
    const s = firstSteps(S, t0 + 5 * DAY)
    expect(s.done).toBe(true)
    expect(s.visible).toBe(false)
  })
  it('no import step for someone starting from scratch; workouts after the first week do not count for it', () => {
    const S = { firstRun: firstRunState(t0), workouts: [w(0), w(1), w(9)], bodyweight: [] }
    const s = firstSteps(S, t0 + 10 * DAY)
    expect(s.items.map(i => i.key)).toEqual(['first', 'three', 'weight'])
    expect(s.items[1]).toMatchObject({ done: false, count: 2 })
    expect(s.visible).toBe(true)
  })
  it('goes away after two weeks, or when closed', () => {
    const S = { firstRun: firstRunState(t0), workouts: [], bodyweight: [] }
    expect(firstSteps(S, t0 + FIRST_WEEK_DAYS * DAY + 1).visible).toBe(false)
    expect(firstSteps({ ...S, firstRun: { ...S.firstRun, stepsClosed: true } }, t0).visible).toBe(false)
    expect(firstSteps({ workouts: [] }, t0)).toBe(null)
  })
  it('a hint of the first workout shows once, and only before the first workout is saved', () => {
    const S = { firstRun: firstRunState(t0), workouts: [] }
    expect(tipDue(S, 'set')).toBe(true)
    expect(tipDue({ ...S, firstRun: { ...S.firstRun, tips: { set: true } } }, 'set')).toBe(false)
    expect(tipDue({ ...S, workouts: [w(0)] }, 'set')).toBe(false)
    expect(tipDue({ workouts: [] }, 'set')).toBe(false)
  })
})
