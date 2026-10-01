import { describe, it, expect } from 'vitest'
import { pillsFor, stallOf, reportView, addDays, MIN_HISTORY_DAYS } from './coach-pills.js'

// 2026-10-05 is a Monday: the report day, with the week before it Mon 28 Sep – Sun 4 Oct.
const TODAY = '2026-10-05'
const SQ = '0043', BP = '0025', ROW = '0027', CURL = '0031'

const at = d => new Date(d + 'T18:00:00').getTime()
// One session: three sets of `[w, r]` for each exercise named.
const sess = (d, lifts) => ({
  id: 'w' + d, d, name: 'A', start: at(d), end: at(d) + 3600000,
  entries: Object.entries(lifts).map(([id, [w, r, n = 3]]) => ({ id, rid: 'A', sets: Array.from({ length: n }, () => ({ done: true, w, r })) }))
})
const routine = (ids = [SQ, BP, ROW]) => ({ id: 'A', name: 'A', prog: 'linear', ex: ids.map(id => ({ id, sets: 3, reps: 5, weight: 60 })) })
const state = (workouts, over = {}) => ({
  unit: 'kg', weekStart: 1, lang: 'en', customEx: [], bodyweight: [],
  routines: [routine()], week: { 1: 'A', 3: 'A', 5: 'A' }, dayPlan: {},
  workouts, ...over
})
// Healthy, varied training: every plan lift moving a little, three days a week, from five weeks
// back — the background each case below changes one thing in.
const steady = (from = addDays(TODAY, -35), to = addDays(TODAY, -1), lifts = { [SQ]: 100, [BP]: 60, [ROW]: 60 }, step = 0.5) => {
  const out = []
  let i = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay()
    if (![1, 3, 5].includes(wd)) continue
    out.push(sess(d, Object.fromEntries(Object.entries(lifts).map(([id, w]) => [id, [w + i * step, 5]]))))
    i++
  }
  return out
}
const kinds = pills => pills.map(p => p.kind)
const pill = (S, kind) => pillsFor(S, TODAY).find(p => p.kind === kind)

describe('pillsFor', () => {
  it('says nothing with less than two weeks of history, or none at all', () => {
    expect(pillsFor(state([]), TODAY)).toEqual([])
    const recent = steady(addDays(TODAY, -MIN_HISTORY_DAYS + 2))
    expect(recent.length).toBeGreaterThan(3)
    expect(pillsFor(state(recent), TODAY)).toEqual([])
    expect(pillsFor(null, TODAY)).toEqual([])
    expect(pillsFor(state(steady()), 'monday')).toEqual([])
  })

  it('is the same for the same state and day; steady linear progress is only good news', () => {
    const S = state(steady())
    expect(pillsFor(S, TODAY)).toEqual(pillsFor(S, TODAY))
    expect(kinds(pillsFor(S, TODAY))).toEqual(['progress'])
    // Barely moving, but moving: nothing to say at all.
    expect(kinds(pillsFor(state(steady(undefined, undefined, undefined, 0.05)), TODAY))).toEqual([])
  })

  it('stall: the best estimate not beaten for three sessions', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15))
    for (const d of ['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-10-02']) ws.push(sess(d, { [SQ]: [120, 5], [BP]: [70 + ws.length, 5], [ROW]: [70 + ws.length, 5] }))
    const p = pill(state(ws), 'stall')
    expect(p).toBeTruthy()
    expect(p.exercise).toBe(SQ)
    expect(p.title).toBe('Stalled: barbell full squat')
    expect(p.body).toBe('Barbell full squat: 4 sessions in 2 weeks without going up. The Coach has a plan to get it moving.')
    expect(p.window).toEqual({ from: '2026-09-21', to: '2026-10-02' })
    expect(pillsFor(state(ws), TODAY)[0].kind).toBe('stall')
  })

  it('stall: reps missed twice running, even while the estimate crept up', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -10))
    ws.push(sess('2026-09-28', { [SQ]: [130, 4], [BP]: [75, 5], [ROW]: [75, 5] }))
    ws.push(sess('2026-10-02', { [SQ]: [130, 4], [BP]: [76, 5], [ROW]: [76, 5] }))
    const s = stallOf(state(ws), SQ, TODAY)
    expect(s).toMatchObject({ exercise: SQ, misses: 2, flat: false })
    expect(pill(state(ws), 'stall').body).toBe('Barbell full squat: 2 sessions in a row short of the target reps. The Coach has a plan to get it moving.')
  })

  it('no stall for a lift still going up, one dropped weeks ago, or a timed hold', () => {
    expect(stallOf(state(steady()), SQ, TODAY)).toBe(null)
    const old = steady(addDays(TODAY, -70), addDays(TODAY, -30)).map(w => ({ ...w, entries: w.entries.map(e => e.id === SQ ? { ...e, sets: e.sets.map(s => ({ ...s, w: 100 })) } : e) }))
    expect(stallOf(state(old), SQ, TODAY)).toBe(null)
    const plank = state(steady(), { routines: [{ ...routine(), ex: [{ id: SQ, mode: 'time', sec: 60 }] }] })
    expect(stallOf(plank, SQ, TODAY)).toBe(null)
  })

  it('neglected: a muscle the plan trains directly, not trained for eight days by someone who is training', () => {
    const plan = { routines: [routine([SQ, BP, ROW, CURL])] }
    const ws = steady()
    ws.forEach(w => { if (w.d <= '2026-09-25') w.entries.push({ id: CURL, sets: [{ done: true, w: 30, r: 8 }] }) })
    const p = pill(state(ws, plan), 'neglected')
    expect(p).toMatchObject({ kind: 'neglected', muscle: 'biceps', exercise: CURL })
    expect(p.body).toBe('Biceps: 10 days without direct work. Add barbell curl to your next session.')
    // Curled three days ago: nothing to say.
    ws.find(w => w.d === '2026-10-02').entries.push({ id: CURL, sets: [{ done: true, w: 30, r: 8 }] })
    expect(pill(state(ws, plan), 'neglected')).toBeUndefined()
    // Nobody trained this week at all: that is not a neglected muscle.
    expect(pill(state(steady(addDays(TODAY, -40), addDays(TODAY, -9)), plan), 'neglected')).toBeUndefined()
  })

  it('imbalance: the weakest link of the chosen balance, only when clearly behind its anchor', () => {
    const tpl = { balanceTemplate: 'thibaudeauPowerlifting' }
    const weak = state(steady(undefined, undefined, { [SQ]: 140, [BP]: 60, [ROW]: 60 }), tpl)
    const p = pill(weak, 'imbalance')
    expect(p).toMatchObject({ kind: 'imbalance', exercise: BP })
    expect(p.body).toBe('Your barbell bench press is lagging behind your barbell full squat. It is your weakest link right now.')
    const close = state(steady(undefined, undefined, { [SQ]: 140, [BP]: 103, [ROW]: 60 }), tpl)
    expect(pill(close, 'imbalance')).toBeUndefined()
  })

  it('missed: planned days of last week, against the days trained — a moved session is not missed', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -8))
    ws.push(sess('2026-09-28', { [SQ]: [110, 5], [BP]: [70, 5], [ROW]: [70, 5] }))
    const p = pill(state(ws), 'missed')
    expect(p.body).toBe('Last week you missed 2 planned sessions. The Coach can rework your week.')
    expect(p.window).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    ws.push(sess('2026-09-29', { [SQ]: [110, 5], [BP]: [70, 5], [ROW]: [70, 5] }))
    expect(pill(state(ws), 'missed').body).toBe('Last week you missed 1 planned session. The Coach can rework your week.')
    ws.push(sess('2026-10-03', { [SQ]: [110, 5], [BP]: [70, 5], [ROW]: [70, 5] }))
    expect(pill(state(ws), 'missed')).toBeUndefined()
    expect(pill(state(ws, { week: {} }), 'missed')).toBeUndefined()
  })

  it('progress: a clear rise in estimated 1RM over four weeks, in the profile’s unit', () => {
    const ws = steady(undefined, undefined, { [SQ]: 100, [BP]: 60, [ROW]: 60 })
    ws.find(w => w.d === '2026-10-02').entries.find(e => e.id === SQ).sets.forEach(s => { s.w = 115 })
    const p = pill(state(ws), 'progress')
    expect(p).toMatchObject({ kind: 'progress', exercise: SQ })
    expect(p.body).toMatch(/^Barbell full squat: \+\d+(\.5)? kg estimated 1RM in the last 4 weeks\. Keep it up\.$/)
    expect(pill(state(ws, { unit: 'lb' }), 'progress').body).toMatch(/ lb estimated 1RM/)
    // A twentieth of a kilo a session is not "a clear rise".
    expect(pill(state(steady(undefined, undefined, undefined, 0.05)), 'progress')).toBeUndefined()
  })
})

describe('reportView', () => {
  const P = (kind, priority) => ({ id: kind, kind, priority, title: kind, body: kind })
  const pills = [P('stall', 95), P('imbalance', 75), P('neglected', 65), P('missed', 55), P('progress', 20)]
  it('without the Coach: the first whole, progress whole, up to three more held back by title', () => {
    const v = reportView(pills, false)
    expect(v.shown.map(p => p.kind)).toEqual(['stall', 'progress'])
    expect(v.locked.map(p => p.kind)).toEqual(['imbalance', 'neglected', 'missed'])
  })
  it('with the Coach: everything whole; nothing at all without pills', () => {
    expect(reportView(pills, true)).toEqual({ shown: pills, locked: [] })
    expect(reportView([], false)).toEqual({ shown: [], locked: [] })
  })
})
