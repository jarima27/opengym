// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ access: 'free', track: null, paywall: null }))
vi.mock('../lib/billing.js', async importOriginal => ({
  ...(await importOriginal()),
  billingCached: () => Promise.resolve({ on: true, ai: mocks.access === 'pro', plan: mocks.access === 'pro' ? 'trial' : 'none' })
}))
vi.mock('../lib/track.js', () => ({ track: (...a) => mocks.track(...a) }))
vi.mock('./Paywall.jsx', () => ({ openPaywall: (...a) => mocks.paywall(...a) }))

const { default: CoachReportCard } = await import('./CoachReport.jsx')

// Monday 5 Oct 2026. A squat stuck at 120 since 21 Sep, a bench going up, and last week only
// one of its three planned days trained: a stall, a missed week and progress.
const SQ = '0043', BP = '0025'
const at = d => new Date(d + 'T18:00:00').getTime()
const sess = (d, sq, bp) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [
  { id: SQ, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w: sq, r: 5 })) },
  { id: BP, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w: bp, r: 5 })) }] })
const days = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02']
const training = {
  unit: 'kg', weekStart: 1, dayPlan: {}, customEx: [],
  routines: [{ id: 'A', name: 'A', ex: [{ id: SQ, sets: 3, reps: 5 }, { id: BP, sets: 3, reps: 5 }] }],
  week: { 1: 'A', 3: 'A', 5: 'A' },
  workouts: days.map((d, i) => sess(d, Math.min(120, 100 + i * 7), 60 + i * 2.5))
}

let host, root, original
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00'))
  localStorage.clear()
  mocks.access = 'free'
  mocks.track = vi.fn()
  mocks.paywall = vi.fn()
  original = useStore.getState()
  useStore.setState({ S: { ...original.S, ...training }, user: { id: 'u1' }, config: { ...(original.config || {}), billing: { trial_days: 0, card_trial_days: 30, web: true } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useStore.setState({ S: original.S, user: original.user, config: original.config })
  host.remove()
  vi.useRealTimers()
})
const mount = async () => { await act(async () => { root.render(<MemoryRouter><CoachReportCard /></MemoryRouter>) }) }
const text = () => host.textContent

describe('CoachReportCard', () => {
  it('free: the first pill whole, progress whole, the rest by title only — a tap opens the plans', async () => {
    await mount()
    expect(text()).toContain('What your Coach would tell you this week')
    expect(text()).toContain('Stalled: barbell full squat')
    expect(text()).toContain('without going up')
    expect(text()).toContain('Going up: barbell bench press')
    expect(text()).toContain('1 more observation from the Coach about your week')
    const locked = host.querySelector('.pill-locked')
    expect(locked.textContent).toContain('The Coach can rework your week')
    expect(locked.querySelector('.blurred').getAttribute('aria-hidden')).toBe('true')
    act(() => locked.click())
    expect(mocks.paywall).toHaveBeenCalledWith('pill:missed', { missed: 2 })
    expect(mocks.track).toHaveBeenCalledWith('pill_locked_tapped', { kind: 'missed' })
    expect(mocks.track).toHaveBeenCalledWith('weekly_report_viewed', { kind: 'stall' })
    expect(mocks.track).toHaveBeenCalledWith('pill_shown', { kind: 'missed', locked: true })
    expect(text()).not.toContain('Open the Coach’s review')
  })

  it('records what the week showed, so the same pills stay away for three weeks', async () => {
    await mount()
    const log = useStore.getState().S.pillLog
    expect(Object.keys(log)).toEqual(['2026-10-05'])
    expect(log['2026-10-05'][0]).toBe('stall:0043')
    expect(log['2026-10-05']).toContain('missed')
  })

  it('counts each pill once a week, and stays put away once hidden', async () => {
    await mount()
    act(() => root.render(null))
    await mount()
    expect(mocks.track.mock.calls.filter(c => c[0] === 'weekly_report_viewed')).toHaveLength(1)
    act(() => host.querySelector('[aria-label="Hide until next week"]').click())
    expect(text()).toBe('')
    act(() => root.render(null))
    await mount()
    expect(text()).toBe('')
  })

  it('with the Coach: every pill whole, and the way to its review', async () => {
    mocks.access = 'pro'
    await mount()
    expect(host.querySelector('.pill-locked')).toBe(null)
    expect(text()).toContain('The Coach can rework your week')
    expect(text()).toContain('Open the Coach’s review')
  })

  it('a week with nothing to say draws nothing', async () => {
    useStore.setState({ S: { ...useStore.getState().S, workouts: [] } })
    await mount()
    expect(text()).toBe('')
  })
})
