// @vitest-environment happy-dom
// F11: the Coach's first plan comes in on its own, but never mid-workout or over an open sheet;
// a Coach that fails says nothing and leaves the plan by rule as it is; a plan a day late is not
// swapped in any more.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const status = vi.hoisted(() => ({ value: null }))
vi.mock('../lib/coach-api.js', () => ({
  coachStatus: vi.fn(async () => status.value),
  resolvePending: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: true, DEMO_SEEDED: 'gym_demo_seeded_v2', REPO: '' }))
const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { DEF, useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { CONSENT_VERSION } = await import('../lib/coach.js')
const { ADOPT_WITHIN_MS } = await import('../lib/coach-first-plan.js')
const { default: CoachPlanWatcher } = await import('./CoachPlanWatcher.jsx')

const proposal = {
  id: 'p1', kind: 'create',
  bundle: {
    opengym_plan: 1, name: 'Coach plan', summary: 'Better.', week: { 2: 'x1' },
    routines: [{ id: 'x1', name: 'Day 1', ex: [{ id: '0043', sets: 3, reps: 8, mode: 'reps' }] }], customEx: [],
  },
}

let host, root
const coach = () => useStore.getState().S.firstRun.coach
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(2000) })
function mount(over = {}, askedAt = Date.now()) {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'ra', name: 'Full Body A', ex: [{ id: '0043', sets: 3, reps: 8, weight: 60 }] }]
  S.week = { 1: ['ra'] }
  S.coach = { consent: { agreedAt: '2026-10-01T00:00:00Z', version: CONSENT_VERSION }, log: [], snapshots: [], chat: [] }
  S.firstRun = { startedAt: askedAt, tips: {}, routineIds: ['ra'], coach: { state: 'asked', askedAt } }
  Object.assign(S, over)
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/home']}><CoachPlanWatcher /></MemoryRouter>))
}

beforeEach(() => {
  vi.useFakeTimers()
  tracked.length = 0
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('the Coach’s first plan, in the background', () => {
  it('waits for the workout to end, then adopts the plan and says so', async () => {
    status.value = { job: null, pending: proposal }
    mount({ active: { id: 'a1', d: '2026-10-02', start: Date.now(), entries: [] } })
    await settle()
    expect(coach().state).toBe('asked')
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Full Body A'])
    act(() => useStore.getState().update(s => { s.active = null }))
    await settle()
    expect(coach().state).toBe('applied')
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Day 1'])
    expect(useUI.getState().toastMsg).toBe('Your Coach has improved your plan')
  })

  it('keeps polling while the Coach is still thinking', async () => {
    status.value = { job: { id: 'j1', kind: 'create', state: 'running' }, pending: null }
    mount()
    await settle()
    expect(coach().state).toBe('asked')
    status.value = { job: null, pending: proposal }
    await settle()
    expect(coach().state).toBe('applied')
  })

  it('a Coach that fails leaves the plan by rule as it is, without a word', async () => {
    status.value = { job: null, pending: null, lastError: { errorClass: 'provider' } }
    mount()
    await settle()
    expect(coach().state).toBe('failed')
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Full Body A'])
    expect(useUI.getState().toastMsg).toBe('')
  })

  it('a plan more than a day late is left in the Coach’s chat', async () => {
    status.value = { job: null, pending: proposal }
    mount({}, Date.now() - ADOPT_WITHIN_MS - 1000)
    await settle()
    expect(coach().state).toBe('stale')
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Full Body A'])
  })
})
