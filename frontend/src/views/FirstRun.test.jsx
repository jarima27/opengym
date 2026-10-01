// @vitest-environment happy-dom
// F11, the guided first run, on an instance without the Coach: six one-tap questions, the import
// question, a plan chosen by rule with its reason, starting weights (or a calibration), and then
// today or the next training day — every answer reported, the plan in the store, the first week
// started.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]) }))
vi.mock('../lib/api.js', async io => ({ ...(await io()), api: vi.fn(() => Promise.reject(new Error('no server here'))) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { DEF, useStore } = await import('../store/useStore.js')
const { default: FirstRun } = await import('./FirstRun.jsx')

let host, root
const clone = v => JSON.parse(JSON.stringify(v))
const text = () => host.textContent
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(label))
const tap = async label => {
  const b = button(label)
  if (!b) throw new Error(`no button "${label}" in: ${text().slice(0, 300)}`)
  await act(async () => { b.click() })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00'))   // a Monday
  sessionStorage.clear(); localStorage.clear(); tracked.length = 0
  useStore.setState({ S: { ...clone(DEF), unit: 'kg' }, user: null, guest: true, config: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/welcome']}><Routes>
      <Route path="/welcome" element={<FirstRun />} />
      <Route path="/home" element={<div>HOME</div>} />
    </Routes></MemoryRouter>)
  })
})
afterEach(() => { act(() => root.render(null)); host.remove(); vi.useRealTimers() })

async function answerQuestions() {
  expect(text()).toContain('1 of 6')
  await tap('Get stronger')
  expect(text()).toContain('2 of 6')
  await tap('I’m just starting')
  await tap('Continue')                       // 3 days: Monday, Wednesday, Friday
  await tap('A full gym')
  await tap('60 min')
  expect(text()).toContain('6 of 6')
  await tap('Continue')                       // no limitation
}

describe('the first run, without the Coach', () => {
  it('goes from the questions to a plan chosen by rule, with its reason and first session', async () => {
    await answerQuestions()
    expect(text()).toContain('Coming from another app?')
    await tap('Start from scratch')
    expect(text()).toContain('5×5')
    expect(text()).toContain('the classic way to get stronger')
    expect(text()).toContain('First session:')
    expect(text()).toContain('You can change it whenever you like.')
    await tap('Start my plan')

    const S = useStore.getState().S
    expect(S.routines.length).toBe(3)
    expect(Object.keys(S.week).map(Number).sort()).toEqual([1, 3, 5])
    expect(S.firstRun?.startedAt).toBeGreaterThan(0)
    expect(text()).toContain('Do you know how much you lift?')
  })

  it('"I don’t know" marks the main lifts for calibration; a known set becomes the starting weight', async () => {
    await answerQuestions()
    await tap('Start from scratch')
    await tap('Start my plan')
    // Type a known squat: 100 kg × 5, for the plan's 5 × 5.
    const first = host.querySelector('.ob-lift')
    expect(first.textContent.toLowerCase()).toContain('squat')
    const [w, r] = first.querySelectorAll('input')
    await act(async () => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      set(w, '100'); set(r, '5')
    })
    await tap('Continue')
    const S = useStore.getState().S
    const squat = S.routines.flatMap(x => x.ex).filter(e => e.id === '0043')
    expect(squat.every(e => e.weight === 100 && !e.calibrate)).toBe(true)
    const others = S.routines.flatMap(x => x.ex).filter(e => e.calibrate)
    expect(others.length).toBeGreaterThan(0)
    expect(tracked.some(([n]) => n === 'calibration_used')).toBe(true)
  })

  it('not today: says when the next session is, and lands on Home; every step reported', async () => {
    await answerQuestions()
    await tap('Start from scratch')
    await tap('Start my plan')
    await tap('Continue')                       // weights: all "I don't know"
    await act(async () => {})                    // no push in this browser: the reminder question is skipped
    expect(text()).toContain('Are you training today?')
    await tap('Not today')
    // Monday was a training day: it rests, and the plan still opens with its first session.
    expect(text()).toContain('Your next session: Wednesday')
    expect(text()).toContain('5×5 A')
    expect(useStore.getState().S.dayPlan['2026-10-05']).toBe('rest')
    await tap('Done')
    expect(text()).toContain('HOME')
    const steps = tracked.filter(([n]) => n === 'onboarding_step').map(([, p]) => p.step)
    expect(steps).toEqual(['goal', 'experience', 'days', 'place', 'length', 'limits', 'plan', 'weights', 'today'])
    expect(tracked.some(([n]) => n === 'onboarding_done')).toBe(true)
    expect(sessionStorage.getItem('tiza_first_run')).toBe(null)
  })

  it('always has a way back', async () => {
    await tap('Get stronger')
    expect(text()).toContain('2 of 6')
    await act(async () => { host.querySelector('[aria-label="Back"]').click() })
    expect(text()).toContain('1 of 6')
  })

  it('at home with dumbbells, the plan uses dumbbells', async () => {
    await tap('Build muscle')
    await tap('Less than a year')
    await tap('Continue')
    await tap('At home, with dumbbells')
    await tap('45 min')
    await tap('Continue')
    await tap('Start from scratch')
    await tap('Start my plan')
    const { EXIDX } = await import('../lib/exercises.js')
    const eqs = new Set(useStore.getState().S.routines.flatMap(r => r.ex.map(e => EXIDX[e.id].eq)))
    expect([...eqs].every(e => e === 'dumbbell' || e === 'body weight')).toBe(true)
  })
})
