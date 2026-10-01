import { describe, it, expect } from 'vitest'
import { pillsFor, stallOf, reportView, addDays, logPills, recentPills, MIN_HISTORY_DAYS } from './coach-pills.js'

// 2026-10-05 is a Monday: the report day, with the week before it Mon 28 Sep – Sun 4 Oct.
const TODAY = '2026-10-05'
const SQ = '0043', BP = '0025', ROW = '0027', CURL = '0031', PULL = '0652'

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

  it('no false stall: more reps at the same weight is progress — past the rep cap too', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15))
    // A double progression on the squat: 100 kg for 8, 9, 10, 11 — then 13, 14, 15, where the
    // estimate formula stops counting.
    const reps = [8, 9, 10, 11, 13, 14, 15]
    ;['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02', '2026-10-04']
      .forEach((d, i) => ws.push(sess(d, { [SQ]: [100, reps[i]], [BP]: [70 + i, 5], [ROW]: [70 + i, 5] })))
    expect(stallOf(state(ws), SQ, TODAY)).toBe(null)
  })

  it('no false stall on a deload, on a bodyweight lift, on one dropped weeks ago, or on a timed hold', () => {
    expect(stallOf(state(steady()), SQ, TODAY)).toBe(null)
    // Best 120 on 21 Sep, then 100 (a deload) and rebuilding: the plan working, not a stall.
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15))
    ;[['2026-09-21', 120], ['2026-09-23', 120], ['2026-09-25', 100], ['2026-09-28', 105], ['2026-10-02', 110]]
      .forEach(([d, w], i) => ws.push(sess(d, { [SQ]: [w, 5], [BP]: [70 + i, 5], [ROW]: [70 + i, 5] })))
    expect(stallOf(state(ws), SQ, TODAY)).toBe(null)
    // The same flat run on a pull-up — bodyweight, with or without a belt — says nothing.
    const flat = steady(addDays(TODAY, -35), addDays(TODAY, -15))
    ;['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-10-02'].forEach((d, i) => flat.push(sess(d, { [PULL]: [10, 6], [BP]: [70 + i, 5] })))
    expect(stallOf(state(flat, { routines: [routine([PULL, BP])] }), PULL, TODAY)).toBe(null)
    const old = steady(addDays(TODAY, -70), addDays(TODAY, -30)).map(w => ({ ...w, entries: w.entries.map(e => e.id === SQ ? { ...e, sets: e.sets.map(x => ({ ...x, w: 100 })) } : e) }))
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

  it('neglected: measured against the plan’s own rhythm — arms once a week is not neglect on day 9', () => {
    // A split: arms only on Mondays (routine B), the rest on Wednesdays and Fridays (routine A).
    const split = { routines: [routine(), { id: 'B', name: 'B', ex: [{ id: CURL, sets: 3, reps: 8 }] }], week: { 1: 'B', 3: 'A', 5: 'A' } }
    const ws = steady()
    const curlOn = d => ws.find(w => w.d === d).entries.push({ id: CURL, sets: [{ done: true, w: 30, r: 8 }] })
    curlOn('2026-09-25')
    // Ten days since the last curl, and the plan itself leaves seven between arm days: not yet.
    expect(pill(state(ws, split), 'neglected')).toBeUndefined()
    // Twelve days: past the plan's week plus four days of grace.
    const ws2 = steady()
    ws2.find(w => w.d === '2026-09-23').entries.push({ id: CURL, sets: [{ done: true, w: 30, r: 8 }] })
    expect(pill(state(ws2, split), 'neglected')).toMatchObject({ muscle: 'biceps' })
  })

  it('imbalance: the weakest link of the chosen balance, only when clearly behind its anchor', () => {
    const tpl = { balanceTemplate: 'thibaudeauPowerlifting' }
    const weak = state(steady(undefined, undefined, { [SQ]: 140, [BP]: 60, [ROW]: 60 }), tpl)
    const p = pill(weak, 'imbalance')
    expect(p).toMatchObject({ kind: 'imbalance', exercise: BP })
    expect(p.body).toBe('Your barbell bench press is lagging behind your barbell full squat. It is your weakest link right now.')
    const close = state(steady(undefined, undefined, { [SQ]: 140, [BP]: 103, [ROW]: 60 }), tpl)
    expect(pill(close, 'imbalance')).toBeUndefined()
    // Two bench sessions in two months are not enough to call anything a weak link.
    const thin = steady(undefined, undefined, { [SQ]: 140, [ROW]: 60 })
    thin.slice(-2).forEach(w => w.entries.push({ id: BP, rid: 'A', sets: [{ done: true, w: 60, r: 5 }] }))
    expect(pill(state(thin, tpl), 'imbalance')).toBeUndefined()
  })

  it('missed: planned days of last week, against the days trained — a moved session is not missed', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -8))
    ws.push(sess('2026-09-28', { [SQ]: [110, 5], [BP]: [70, 5], [ROW]: [70, 5] }))
    const p = pill(state(ws), 'missed')
    // What fitted and what the Coach can do — never a tally of what was skipped.
    expect(p.title).toBe('The Coach can rework your week')
    expect(p.body).toBe('Last week 1 of 3 planned sessions fitted in. The Coach can fit the plan to your real week.')
    expect(p.window).toEqual({ from: '2026-09-28', to: '2026-10-04' })
    expect(p.context).toEqual({ missed: 2 })
    ws.push(sess('2026-09-29', { [SQ]: [110, 5], [BP]: [70, 5], [ROW]: [70, 5] }))
    expect(pill(state(ws), 'missed').body).toBe('Last week 2 of 3 planned sessions fitted in. The Coach can fit the plan to your real week.')
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

describe('close to a record', () => {
  it('the last top weight a step under the best, the next session prescribed at or past it: names the day', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15), { [BP]: 60, [ROW]: 60 })
    ;[['2026-09-21', 100], ['2026-09-25', 95], ['2026-10-02', 97.5]].forEach(([d, w], i) => ws.push(sess(d, { [SQ]: [w, 5], [BP]: [70 + i, 5], [ROW]: [70 + i, 5] })))
    const S = state(ws)
    const p = pill(S, 'near_pr')
    expect(p).toMatchObject({ kind: 'near_pr', exercise: SQ })
    expect(p.title).toBe('Close to a record: barbell full squat')
    // Monday is a planned day and nothing is logged yet: today.
    expect(p.body).toBe('You are 2.5 kg from your barbell full squat record. It could fall today.')
    // Trained today already: the next planned day, by name.
    const later = state([...ws, sess(TODAY, { [BP]: [80, 5], [ROW]: [80, 5] })])
    expect(pill(later, 'near_pr').body).toBe('You are 2.5 kg from your barbell full squat record. It could fall on Wednesday.')
    // Good news is never held back.
    expect(reportView([{ ...p, kind: 'stall', id: 'x' }, p], false).shown).toContain(p)
  })
  it('not when the record is far, or the lift is not going up next time', () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15), { [BP]: 60, [ROW]: 60 })
    ;[['2026-09-21', 110], ['2026-09-25', 95], ['2026-10-02', 97.5]].forEach(([d, w], i) => ws.push(sess(d, { [SQ]: [w, 5], [BP]: [70 + i, 5], [ROW]: [70 + i, 5] })))
    expect(pill(state(ws), 'near_pr')).toBeUndefined()
    const missed = steady(addDays(TODAY, -35), addDays(TODAY, -15), { [BP]: 60, [ROW]: 60 })
    ;[['2026-09-21', 100], ['2026-09-25', 95], ['2026-10-02', 97.5]].forEach(([d, w], i) => missed.push(sess(d, { [SQ]: [w, i === 2 ? 3 : 5], [BP]: [70 + i, 5], [ROW]: [70 + i, 5] })))
    expect(pill(state(missed), 'near_pr')).toBeUndefined()
  })
})

describe('no repeats, and a different lead each week', () => {
  // A stall on the squat and last week's planned days half done: two pills competing.
  const busy = () => {
    const ws = steady(addDays(TODAY, -35), addDays(TODAY, -15))
    for (const d of ['2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28']) ws.push(sess(d, { [SQ]: [120, 5], [BP]: [70 + ws.length, 5], [ROW]: [70 + ws.length, 5] }))
    return ws
  }
  it('a pill shown in the last three weeks stays away; one from four weeks ago may come back', () => {
    const S = state(busy())
    expect(pillsFor(S, TODAY)[0].id).toBe('stall:' + SQ)
    for (const back of [1, 2, 3]) {
      const log = { [addDays(TODAY, -7 * back)]: ['stall:' + SQ] }
      expect(pillsFor({ ...S, pillLog: log }, TODAY).map(p => p.id)).not.toContain('stall:' + SQ)
    }
    expect(pillsFor({ ...S, pillLog: { [addDays(TODAY, -28)]: ['stall:' + SQ] } }, TODAY)[0].id).toBe('stall:' + SQ)
    // Shown this very week: it stays — the card does not change under someone's eyes.
    expect(pillsFor({ ...S, pillLog: { [TODAY]: ['stall:' + SQ] } }, TODAY)[0].id).toBe('stall:' + SQ)
  })
  it('the kind that led last week does not lead again when another can', () => {
    const S = state(busy())
    const kinds = pillsFor(S, TODAY).map(p => p.kind)
    expect(kinds[0]).toBe('stall')
    expect(kinds).toContain('missed')
    const rotated = pillsFor({ ...S, pillLog: { [addDays(TODAY, -7)]: ['stall:' + BP] } }, TODAY)
    expect(rotated[0].kind).not.toBe('stall')
    expect(rotated.map(p => p.kind)).toContain('stall')
  })
  it('the log: a week’s ids joined (the first keeps the lead) or replaced, old weeks dropped', () => {
    expect(logPills({}, TODAY, ['a', 'b'])).toEqual({ [TODAY]: ['a', 'b'] })
    expect(logPills({ [TODAY]: ['a'] }, TODAY, ['b', 'a'])).toEqual({ [TODAY]: ['a', 'b'] })
    expect(logPills({ [TODAY]: ['a'] }, TODAY, ['c'], { replace: true })).toEqual({ [TODAY]: ['c'] })
    expect(logPills({ '2026-08-03': ['old'], [addDays(TODAY, -21)]: ['kept'] }, TODAY, ['x'])).toEqual({ [addDays(TODAY, -21)]: ['kept'], [TODAY]: ['x'] })
    expect(recentPills({ pillLog: { [addDays(TODAY, -7)]: ['missed', 'stall:1'] }, weekStart: 1 }, TODAY)).toEqual({ ids: new Set(['missed', 'stall:1']), lead: 'missed' })
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
