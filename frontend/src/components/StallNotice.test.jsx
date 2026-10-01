// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ access: 'free', paywall: null, review: null, nav: null, track: null }))
vi.mock('./useCoachAccess.js', () => ({ useCoachAccess: () => mocks.access }))
vi.mock('./Paywall.jsx', () => ({ openPaywall: (...a) => mocks.paywall(...a) }))
vi.mock('../lib/coach-api.js', () => ({ requestReview: (...a) => mocks.review(...a) }))
vi.mock('../lib/nav.js', () => ({ nav: (...a) => mocks.nav(...a), setNav: () => {} }))
vi.mock('../lib/track.js', () => ({ track: (...a) => mocks.track(...a) }))

const { default: StallNotice } = await import('./StallNotice.jsx')

// Monday 5 Oct 2026; the squat stuck at 120 since 21 Sep.
const SQ = '0043'
const at = d => new Date(d + 'T18:00:00').getTime()
const sess = (d, w) => ({ id: 'w' + d, d, start: at(d), end: at(d) + 3600000, entries: [{ id: SQ, rid: 'A', sets: [1, 2, 3].map(() => ({ done: true, w, r: 5 })) }] })
const training = {
  unit: 'kg', weekStart: 1, dayPlan: {}, customEx: [], routines: [{ id: 'A', name: 'A', ex: [{ id: SQ, sets: 3, reps: 5 }] }], week: { 1: 'A' },
  workouts: ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-23', '2026-09-25', '2026-10-02'].map((d, i) => sess(d, Math.min(120, 100 + i * 7))),
  coach: { consent: { agreedAt: '2026-09-01', version: 1 } }
}

let host, root, original
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00'))
  Object.assign(mocks, { access: 'free', paywall: vi.fn(), review: vi.fn(() => Promise.resolve()), nav: vi.fn(), track: vi.fn() })
  original = useStore.getState()
  useStore.setState({ S: { ...original.S, ...training }, user: { id: 'u1' }, config: { ...(original.config || {}), coach: { enabled: true } } })
  useUI.setState({ timer: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useStore.setState({ S: original.S, user: original.user, config: original.config })
  host.remove(); vi.useRealTimers()
})
const mount = el => act(() => root.render(el))

describe('StallNotice', () => {
  it('on a stalled lift without the Coach: says so, and a tap opens the plans on that lift', () => {
    mount(<StallNotice exId={SQ} />)
    expect(host.textContent).toContain('The Coach has a proposal for this exercise')
    expect(host.textContent).toContain('3 sessions without going up.')
    act(() => host.querySelector('button').click())
    expect(mocks.paywall).toHaveBeenCalledWith('stall', { exercise: 'barbell full squat', weeks: 2 })
    expect(mocks.track).toHaveBeenCalledWith('pill_locked_tapped', { kind: 'stall', where: 'history' })
  })
  it('with the Coach: asks it about the lift and opens the chat', () => {
    mocks.access = 'pro'
    mount(<StallNotice exId={SQ} />)
    act(() => host.querySelector('button').click())
    expect(mocks.review).toHaveBeenCalledWith('My barbell full squat has stalled: 3 sessions without going up. What do you propose?')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
    expect(mocks.paywall).not.toHaveBeenCalled()
  })
  it('in a workout: only once a set of it is done, and never during the rest', () => {
    mount(<StallNotice exId={SQ} inWorkout doneSets={0} />)
    expect(host.textContent).toBe('')
    act(() => useUI.setState({ timer: { left: 60, total: 90 } }))
    mount(<StallNotice exId={SQ} inWorkout doneSets={1} />)
    expect(host.textContent).toBe('')
    act(() => useUI.setState({ timer: null }))
    expect(host.textContent).toContain('The Coach has a proposal for this exercise')
  })
  it('nothing on a lift that is moving, or where the Coach is not set up', () => {
    useStore.setState({ S: { ...useStore.getState().S, workouts: training.workouts.slice(0, 3) } })
    mount(<StallNotice exId={SQ} />)
    expect(host.textContent).toBe('')
    useStore.setState({ S: { ...useStore.getState().S, workouts: training.workouts }, config: { coach: { enabled: false } } })
    mount(<StallNotice exId={SQ} />)
    expect(host.textContent).toBe('')
  })
})
