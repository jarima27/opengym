// @vitest-environment happy-dom
// F11, the end of the first workout: a celebration, the numbers, and what next time asks of each
// lift — "Squat: next time 65 kg (+5)", from the engine that will build it — then the next
// training day. Through the real store: beginWorkout → tick every row → finishWorkout.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginWorkout, finishWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

vi.mock('./lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), unlock: vi.fn() }))
vi.mock('./lib/api.js', async io => ({ ...(await io()), api: vi.fn(() => Promise.resolve({})) }))
const tracked = vi.hoisted(() => [])
vi.mock('./lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const SQUAT = '0043'
const BENCH = '0025'
const clone = v => JSON.parse(JSON.stringify(v))
let root, host

function install(workouts = []) {
  const st = clone(DEF)
  Object.assign(st, {
    unit: 'kg', weighIn: false, active: null, workouts,
    routines: [{ id: 'A', name: 'Full Body A', ex: [{ id: SQUAT, sets: 3, reps: 5, weight: 60 }, { id: BENCH, sets: 3, reps: 5, weight: 40 }] }],
    week: { 1: ['A'], 3: ['A'] },
    reminder: { on: true, time: '18:00' },
  })
  useStore.setState({ S: st, user: null })
}

function trainAndFinish() {
  vi.setSystemTime(new Date('2026-10-05T17:00:00'))   // a Monday
  act(() => beginWorkout(['A'], null))
  vi.setSystemTime(new Date('2026-10-05T18:00:00'))
  act(() => useStore.getState().update(s => s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true }))))
  act(() => finishWorkout())
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter>{sheet.render(() => {})}</MemoryRouter>))
  return host.textContent
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  localStorage.clear(); tracked.length = 0
  useUI.setState({ sheets: [] })
})
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = null; host = null; vi.useRealTimers() })

describe('finishing the first workout', () => {
  it('celebrates it, and says what next time asks of each lift and when that is', () => {
    install()
    const text = trainAndFinish()
    expect(text).toContain('Your first workout is done!')
    expect(text).toContain('Next time')
    const rows = [...host.querySelectorAll('.nexttime-row')].map(r => r.textContent)
    expect(rows.some(r => /squat/i.test(r) && r.includes('65 kg (+5)'))).toBe(true)
    expect(rows.some(r => /bench/i.test(r) && r.includes('42.5 kg (+2.5)'))).toBe(true)
    expect(text).toContain('Complete every rep and Tiza raises it for you.')
    expect(text).toContain('Next session: Wednesday, Full Body A · we’ll remind you at 18:00')
    expect(tracked.some(([n]) => n === 'first_workout_started')).toBe(true)
    expect(tracked.some(([n]) => n === 'first_workout_done')).toBe(true)
  })

  it('later workouts keep the plain title and leave out the first-time hint', () => {
    install([{ id: 'w0', d: '2026-10-01', start: 1, end: 2, routineIds: ['A'], entries: [] }])
    const text = trainAndFinish()
    expect(text).toContain('Workout complete!')
    expect(text).not.toContain('Complete every rep and Tiza raises it for you.')
    expect(text).toContain('Next time')
    expect(tracked.some(([n]) => n === 'first_workout_done')).toBe(false)
  })
})
