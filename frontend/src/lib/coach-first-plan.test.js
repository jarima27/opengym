// F11: the Coach's first plan, adopted in the background in place of the plan by rule the first
// run started on — its week, the starting weights already given, a "not today" that stands, and
// an undo that brings the plan by rule back.
import { describe, expect, it } from 'vitest'
import { adoptCoachPlan, coachAsk, ADOPT_WITHIN_MS } from './coach-first-plan.js'
import { revertLast, CONSENT_VERSION } from './coach.js'

const NOW = new Date('2026-10-05T10:00:00').getTime()   // a Monday
const TODAY = '2026-10-05'
const SQUAT = '0043', BENCH = '0025', ROW = '0027', PRESS = '0426'

const state = (over = {}) => JSON.parse(JSON.stringify({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {}, dayPlan: {},
  routines: [
    { id: 'ra', name: '5×5 A', ex: [{ id: SQUAT, sets: 5, reps: 5, weight: 100 }, { id: BENCH, sets: 5, reps: 5, weight: 0, calibrate: true }] },
    { id: 'rb', name: '5×5 B', ex: [{ id: PRESS, sets: 5, reps: 5, weight: 0, calibrate: true }] },
    { id: 'mine', name: 'My own', ex: [{ id: ROW, sets: 3, reps: 10, weight: 40 }] },
  ],
  week: { 1: ['ra'], 3: ['rb'], 5: ['ra'], 6: ['mine'] },
  coach: { consent: { agreedAt: '2026-10-01T00:00:00Z', version: CONSENT_VERSION }, log: [], snapshots: [], chat: [] },
  firstRun: {
    startedAt: NOW - 60000, tips: {}, routineIds: ['ra', 'rb'],
    known: { [SQUAT]: { w: 100, r: 5 } },
    coach: { state: 'asked', askedAt: NOW - 30000 },
  },
  ...over,
}))

const proposal = () => ({
  id: 'p1', kind: 'create',
  bundle: {
    opengym_plan: 1, name: 'Strength base', summary: 'Two days a week, squat and bench first.',
    week: { 2: 'x1', 4: 'x2' },
    routines: [
      { id: 'x1', name: 'Day 1', ex: [{ id: SQUAT, sets: 3, reps: 8, mode: 'reps' }, { id: ROW, sets: 3, reps: 10, mode: 'reps' }] },
      { id: 'x2', name: 'Day 2', ex: [{ id: BENCH, sets: 3, reps: 8, mode: 'reps' }, { id: PRESS, sets: 3, reps: 10, mode: 'reps', weight: 20 }] },
    ],
    customEx: [],
  },
})

describe('coachAsk', () => {
  it('waits for a plan asked less than a day ago, and lets one go after that', () => {
    expect(coachAsk(state(), NOW)).toBe('wait')
    expect(coachAsk(state(), NOW + ADOPT_WITHIN_MS)).toBe('stale')
    expect(coachAsk(state({ firstRun: { coach: { state: 'applied' } } }), NOW)).toBe(null)
    expect(coachAsk(state({ firstRun: null }), NOW)).toBe(null)
  })
})

describe('adoptCoachPlan', () => {
  it('puts the Coach’s plan and week in place of the plan by rule, and keeps the person’s own routines', () => {
    const s = state()
    const ids = adoptCoachPlan(s, proposal(), { now: NOW, today: TODAY })
    expect(ids.length).toBe(2)
    const names = s.routines.map(r => r.name)
    expect(names).toEqual(expect.arrayContaining(['Day 1', 'Day 2', 'My own']))
    expect(names).not.toContain('5×5 A')
    expect(names).not.toContain('5×5 B')
    // The Coach's week, whole, as when its plan is imported from the chat; the person's own
    // routine is still there to put back on a day.
    const named = d => [].concat(s.week[d] ?? []).map(id => s.routines.find(r => r.id === id)?.name)
    expect(named(2)).toEqual(['Day 1'])
    expect(named(4)).toEqual(['Day 2'])
    expect(s.week[1]).toBeUndefined()
    expect(s.week[5]).toBeUndefined()
    expect(s.week[6]).toBeUndefined()
    expect(s.firstRun.routineIds).toEqual(ids)
    expect(s.firstRun.coach).toMatchObject({ state: 'applied', appliedAt: NOW, name: 'Strength base', summary: 'Two days a week, squat and bench first.' })
    expect(s.coach.chat.at(-1)).toMatchObject({ role: 'coach', kind: 'applied' })
  })

  it('starts a lift from the set the person gave, at the Coach’s reps; finds the rest in the first session', () => {
    const s = state()
    adoptCoachPlan(s, proposal(), { now: NOW, today: TODAY })
    const ex = id => s.routines.filter(r => r.name.startsWith('Day')).flatMap(r => r.ex).find(e => e.id === id)
    // 100 kg × 5 → an Epley estimate of ~116.7, so ~92 kg for 8 reps: 90 on the squat's 5 kg step.
    expect(ex(SQUAT)).toMatchObject({ weight: 90 })
    expect(ex(SQUAT).calibrate).toBeUndefined()
    expect(ex(BENCH).calibrate).toBe(true)
    expect(ex(ROW).calibrate).toBe(true)
    // A weight the Coach set itself stands.
    expect(ex(PRESS)).toMatchObject({ weight: 20 })
    expect(ex(PRESS).calibrate).toBeUndefined()
  })

  it('a lift with history starts from it, not from a calibration', () => {
    const s = state({ workouts: [{ id: 'w1', d: '2026-10-04', start: NOW - 864e5, end: NOW - 860e5, routineIds: ['ra'],
      entries: [{ id: BENCH, rid: 'ra', sets: [{ w: 60, r: 5, done: true }] }] }] })
    adoptCoachPlan(s, proposal(), { now: NOW, today: TODAY })
    const bench = s.routines.find(r => r.name === 'Day 2').ex.find(e => e.id === BENCH)
    expect(bench.calibrate).toBeUndefined()
  })

  it('a "not today" from the first run stands under the new week', () => {
    const s = state({ dayPlan: { [TODAY]: 'rest' } })
    adoptCoachPlan(s, proposal(), { now: NOW, today: TODAY })
    expect(s.dayPlan[TODAY]).toBe('rest')
  })

  it('"undo the last Coach changes" brings the plan by rule back', () => {
    const s = state()
    adoptCoachPlan(s, proposal(), { now: NOW, today: TODAY })
    expect(revertLast(s)).toBe(true)
    expect(s.routines.map(r => r.name)).toEqual(['5×5 A', '5×5 B', 'My own'])
    expect(s.week).toEqual({ 1: ['ra'], 3: ['rb'], 5: ['ra'], 6: ['mine'] })
  })
})
