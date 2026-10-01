// @vitest-environment happy-dom
// F11 in the first workout itself: a lift whose weight nobody knew opens with a light set and
// asks how it felt — easy adds a heavier one, about right is the weight, which the plan's sets and
// the routine then take — and the first workout's hints show one at a time and go with a tap.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { buildCombinedEntries } from '../lib/session-merge.js'
import { firstRunState } from '../lib/first-run.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const SQUAT = '0043'
const BENCH = '0025'
let root, container

function mount(squat = { calibrate: true }) {
  const S = { ...clone(DEF), unit: 'kg' }
  S.routines = [{ id: 'A', name: 'A', ex: [{ id: SQUAT, sets: 3, reps: 5, weight: 0, ...squat }, { id: BENCH, sets: 3, reps: 5, weight: 40 }] }]
  S.workouts = []
  S.firstRun = firstRunState(Date.now())
  const { entries } = buildCombinedEntries(S, ['A'])
  S.active = { id: 'cal-test', d: '2026-10-05', start: Date.now(), routineIds: ['A'], routineId: 'A', name: 'A', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

const text = () => container.textContent
const squatBlock = () => container.querySelector('.calib').parentElement
const tick = i => act(() => squatBlock().querySelectorAll('[role="checkbox"]')[i].click())
const tap = label => act(() => [...container.querySelectorAll('.calib button')].find(b => b.textContent.trim() === label).click())
const squat = () => useStore.getState().S.active.entries[0]

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

describe('calibrating a lift in the first workout', () => {
  it('starts on the empty bar, goes up while it is easy, and keeps the weight that felt right', () => {
    mount()
    expect(text()).toContain('First time: let’s find your weight')
    expect(text()).toContain('Do 5 reps with 20 kg, then tick the set.')
    tick(0)
    expect(text()).toContain('How did 20 kg feel?')
    tap('Easy')
    // One more calibration set, heavier, and the question waits for it.
    const cal = squat().sets.filter(s => s.cal)
    expect(cal.length).toBe(2)
    expect(cal[1].w).toBeGreaterThan(20)
    const next = cal[1].w
    expect(text()).toContain(`Do 5 reps with ${next} kg`)
    tick(1)
    tap('About right')

    const e = squat()
    expect(e.calFound).toBe(next)
    expect(e.sets.filter(s => !s.cal).map(s => s.w)).toEqual([next, next, next])
    expect(text()).toContain(`Your weight: ${next} kg`)
    expect(text()).toContain('Do your 3 sets with it.')
    // Next time is built from it, and nobody is asked again.
    const cfg = useStore.getState().S.routines[0].ex[0]
    expect(cfg.weight).toBe(next)
    expect(cfg.calibrate).toBeUndefined()
  })

  it('too hard on a heavier set goes back to the one before', () => {
    mount()
    tick(0); tap('Easy')
    tick(1); tap('Too hard')
    expect(squat().calFound).toBe(20)
    expect(squat().sets.filter(s => !s.cal).every(s => s.w === 20)).toBe(true)
  })
})

describe('the first workout’s hints', () => {
  it('come one at a time: the set hint goes with the first tick, the weight hint waits for it', () => {
    mount({ weight: 60 })   // a known weight: nothing to calibrate
    expect(container.querySelector('.calib')).toBe(null)
    expect(text()).toContain('Tap here when you finish the set.')
    expect(text()).not.toContain('Tiza works this weight out.')
    act(() => container.querySelector('[role="checkbox"]').click())
    expect(text()).not.toContain('Tap here when you finish the set.')
    expect(useStore.getState().S.firstRun.tips.set).toBe(true)
    // The rest hint lives on the timer; once it is closed too, the weight one shows.
    act(() => useStore.getState().update(s => { s.firstRun.tips.rest = true }))
    expect(text()).toContain('Tiza works this weight out.')
    act(() => [...container.querySelectorAll('.tip button')].find(b => b.textContent === 'Got it').click())
    expect(text()).not.toContain('Tiza works this weight out.')
  })

  it('never show for someone with workouts behind them', () => {
    mount({ weight: 60 })
    act(() => useStore.getState().update(s => { s.workouts = [{ id: 'w0', d: '2026-10-01', entries: [] }] }))
    expect(container.querySelector('.tip')).toBe(null)
  })
})
