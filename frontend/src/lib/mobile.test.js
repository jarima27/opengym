import { describe, expect, it } from 'vitest'
import { isoOf } from './format.js'
import { buildReminderNotifications, NUDGE_WINDOW_DAYS } from './mobile.js'
import { buildNudgeNotifications } from './mobile-nudges.js'

const push = { id: 'push', name: 'Push' }
const pull = { id: 'pull', name: 'Pull' }
const legs = { id: 'legs', name: 'Legs' }
const state = (patch = {}) => ({
  routines: [push, pull, legs], week: {}, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00' }, ...patch,
})
const iso = d => isoOf(d)

describe('buildReminderNotifications', () => {
  it('expands the weekly baseline into future dated notifications', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push', 3: 'pull' } }), now)

    expect(notifications.slice(0, 2).map(n => iso(n.schedule.at))).toEqual([
      iso(now), iso(new Date(2026, 5, 3)),
    ])
    expect(notifications[0].body).toContain('Push')
    expect(notifications[0].schedule.allowWhileIdle).toBe(true)
  })

  it('uses rest today and a routine override tomorrow when rescheduling', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const today = iso(now), tomorrow = iso(new Date(2026, 5, 2))
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, dayPlan: { [today]: 'rest', [tomorrow]: 'pull' },
    }), now)

    expect(notifications.slice(0, 1).map(n => [iso(n.schedule.at), n.body])).toEqual([
      [tomorrow, expect.stringContaining('Pull')],
    ])
  })

  it('schedules a valid override on a weekly rest day', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const wednesday = new Date(2026, 5, 3)
    const notifications = buildReminderNotifications(state({ dayPlan: { [iso(wednesday)]: 'legs' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(wednesday) && n.body.includes('Legs'))).toBe(true)
  })

  it('suppresses dates that already have a completed workout', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const notifications = buildReminderNotifications(state({
      week: { 1: 'push' }, workouts: [{ d: iso(now) }],
    }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
  })

  it("skips today's reminder after the configured local time has passed", () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday
    const notifications = buildReminderNotifications(state({ week: { 1: 'push' } }), now)

    expect(notifications.some(n => iso(n.schedule.at) === iso(now))).toBe(false)
    expect(notifications.some(n => iso(n.schedule.at) === iso(new Date(2026, 5, 8)))).toBe(true)
  })

  it('names both routines of a combined day, and reads a legacy scalar day the same', () => {
    const now = new Date(2026, 5, 1, 7, 0) // Monday
    const combined = buildReminderNotifications(state({ week: { 1: ['push', 'pull'] } }), now)[0]
    expect(combined.body).toContain('Push + Pull')

    const legacy = buildReminderNotifications(state({ week: { 1: 'push' } }), now)[0]
    expect(legacy.body).toContain('Push')
  })

  it('falls back to a count for three or more routines on one day', () => {
    const now = new Date(2026, 5, 1, 7, 0)
    const n = buildReminderNotifications(state({ week: { 1: ['push', 'pull', 'legs'] } }), now)[0]
    expect(n.body).toContain('3 routines')
  })
})
// The phone's half of the smart reminders: the same planner as the server (api/coach/core/
// nudges.js), a week ahead, as local notifications at the person's own clock.
describe('buildNudgeNotifications', () => {
  const withEx = r => ({ ...r, ex: [{ id: 'bench' }] })
  const nudgeState = (patch = {}) => ({
    routines: [withEx(push), withEx(pull)], week: { 1: 'push', 3: 'pull' }, dayPlan: {},
    workouts: [{ d: '2026-05-31', vol: 1000 }], reminder: { on: false, time: '08:00' }, ...patch,
  })

  it('plans the week: "trained today?" on planned evenings, a comeback in between, opening its screen', () => {
    const now = new Date(2026, 5, 1, 9, 0) // Monday 09:00; last workout Sunday
    const ns = buildNudgeNotifications(nudgeState(), now, { lang: 'es' })
    expect(ns.map(n => [iso(n.schedule.at), n.schedule.at.getHours(), n.schedule.at.getMinutes()])).toEqual([
      ['2026-06-01', 20, 0], ['2026-06-03', 20, 0], ['2026-06-04', 18, 30], ['2026-06-07', 18, 30],
    ])
    // one of the two wordings, alternating by day, both naming what is planned
    expect(['¿Has entrenado hoy?', '¿Hoy toca Push?']).toContain(ns[0].title)
    expect(ns[0].title + ns[0].body).toContain('Push')
    expect(ns[0].extra.url).toBe('/home?n=today')
    expect(ns[0].schedule.allowWhileIdle).toBe(true)
    // ids stay inside the window the next sync cancels
    expect(ns.every(n => n.id >= 3000 && n.id < 3000 + NUDGE_WINDOW_DAYS)).toBe(true)
    expect(new Set(ns.map(n => n.id)).size).toBe(ns.length)
  })

  it('leaves out what is already past, what was trained, and what was switched off', () => {
    const evening = new Date(2026, 5, 1, 21, 0)
    expect(buildNudgeNotifications(nudgeState(), evening).some(n => iso(n.schedule.at) === '2026-06-01')).toBe(false)
    const trained = nudgeState({ workouts: [{ d: '2026-06-01', vol: 1000 }] })
    expect(buildNudgeNotifications(trained, new Date(2026, 5, 1, 9, 0)).some(n => iso(n.schedule.at) === '2026-06-01')).toBe(false)
    const off = nudgeState({ nudges: { today: false, comeback: false, weekly: false } })
    expect(buildNudgeNotifications(off, new Date(2026, 5, 1, 9, 0))).toEqual([])
  })

  it('counts "since you joined" from the first-run day before the first workout', () => {
    const now = new Date(2026, 5, 2, 9, 0)
    const ns = buildNudgeNotifications(nudgeState({ week: {}, workouts: [] }), now, { startedOn: '2026-06-01', lang: 'en' })
    expect(ns.map(n => [iso(n.schedule.at), n.title])).toEqual([
      ['2026-06-02', 'Your first workout is waiting'], ['2026-06-04', 'Start today?'], ['2026-06-08', 'One week with Tiza'],
    ])
  })
})
