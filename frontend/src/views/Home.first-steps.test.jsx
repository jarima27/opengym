// @vitest-environment happy-dom
// F11's "First steps" on Home, the first week of someone who came through the guided first run:
// the first workout, three in the week, the history import (only for someone coming from another
// app), the body weight. Each one a tap away, gone once all are done — reported once — or closed.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { firstRunState } from '../lib/first-run.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))
const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]) }))

const routines = [{ id: 'r1', name: 'Full Body A', emoji: null, ex: [{ id: '0025', sets: 3, reps: 5, weight: 40 }] }]
const NOW = new Date('2026-10-07T10:00:00')   // a Wednesday
const workout = (d, i) => ({ id: 'w' + i, d, start: new Date(d + 'T08:00:00').getTime(), end: new Date(d + 'T09:00:00').getTime(), routineIds: ['r1'], entries: [] })

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW)
  nav.mockClear(); tracked.length = 0
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const setS = (over = {}) => useStore.setState(s => ({
  S: { ...s.S, routines, dayPlan: {}, workouts: [], bodyweight: [], active: null, weighIn: false, week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, ...over },
  user: null,
}))
const mount = () => act(() => root.render(<Home />))
const text = () => host.textContent

describe('Home — first steps', () => {
  it('lists what is left in the first week, the import only for someone coming from another app', () => {
    setS({ firstRun: firstRunState(NOW.getTime() - 2 * 86400000, 'strong'), workouts: [workout('2026-10-06', 1)] })
    mount()
    expect(text()).toContain('First steps')
    expect(text()).toContain('3 workouts in your first week (1/3)')
    expect(text()).toContain('Bring your history from your old app')
    expect(text()).toContain('3 left')
    act(() => root.unmount()); root = createRoot(host)
    setS({ firstRun: firstRunState(NOW.getTime()), workouts: [] })
    mount()
    expect(text()).not.toContain('Bring your history from your old app')
  })

  it('goes once everything is done, and says so once', () => {
    setS({
      firstRun: firstRunState(new Date('2026-10-05T07:00:00').getTime()),
      workouts: ['2026-10-05', '2026-10-06', '2026-10-07'].map(workout),
      bodyweight: [{ d: '2026-10-07', w: 80 }],
    })
    mount()
    expect(text()).not.toContain('First steps')
    expect(tracked.filter(([n]) => n === 'checklist_done').length).toBe(1)
    expect(useStore.getState().S.firstRun.checklistDone).toBeGreaterThan(0)
  })

  it('can be closed, and is not there for someone who never had the first run', () => {
    setS({ firstRun: firstRunState(NOW.getTime()) })
    mount()
    act(() => host.querySelector('button[aria-label="Close"]').click())
    expect(text()).not.toContain('First steps')
    act(() => root.unmount()); root = createRoot(host)
    setS({ firstRun: undefined })
    mount()
    expect(text()).not.toContain('First steps')
  })
})
