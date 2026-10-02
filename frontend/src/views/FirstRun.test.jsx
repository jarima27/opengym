// @vitest-environment happy-dom
// F11/F12, the guided first run, signed in already on an instance without the Coach: the questions
// that make the plan (and the body weight), the starting weights (or a calibration), a few
// seconds putting the plan together, the plan with its reason — and, from a weight they gave, the
// main lift's estimated strength in eight weeks as the progression engine works it out — then
// the plan applied, the import question, and today or the next training day. Every screen and
// every answer reported, the plan in the store, the first week started.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]), trackStep: props => tracked.push(['onboarding_step', props]) }))
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
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
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

// The few seconds while the plan is put together.
const built = async () => { await act(async () => { vi.advanceTimersByTime(4000) }) }
const type = async (el, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const answers = () => tracked.filter(([n, p]) => n === 'onboarding_step' && 'answer' in p).map(([, p]) => p.step)

async function answerQuestions() {
  expect(text()).toContain('1 of 8')
  await tap('Get stronger')
  expect(text()).toContain('2 of 8')
  await tap('I’m just starting')
  expect(text()).toContain('What do you weigh')
  await tap('Continue')                       // no body weight
  await tap('Continue')                       // 3 days: Monday, Wednesday, Friday
  await tap('A full gym')
  await tap('60 min')
  await tap('Continue')                       // no limitation
  expect(text()).toContain('8 of 8')
  expect(text()).toContain('Do you know how much you lift?')
}

describe('the first run, without the Coach', () => {
  it('goes from the questions to a plan chosen by rule, with its reason and first session', async () => {
    await answerQuestions()
    await tap('Continue')                     // weights: all "I don't know"
    expect(text()).toContain('Putting your plan together…')
    await built()
    expect(text()).toContain('5×5')
    expect(text()).toContain('the classic way to get stronger')
    expect(text()).toContain('First session:')
    expect(text()).toContain('You can change it whenever you like.')
    // No weight given: no projection — never one from an average.
    expect(text()).not.toContain('Estimate')
    await tap('Continue')
    await act(async () => {})
    const S = useStore.getState().S
    expect(S.routines.length).toBe(3)
    expect(Object.keys(S.week).map(Number).sort()).toEqual([1, 3, 5])
    expect(S.firstRun?.startedAt).toBeGreaterThan(0)
    expect(text()).toContain('Coming from another app?')
  })

  it('a known set: the starting weight, and the projection the engine works out from it', async () => {
    await answerQuestions()
    // Type a known squat: 100 kg × 5, for the plan's 5 × 5.
    const first = host.querySelector('.ob-lift')
    expect(first.textContent.toLowerCase()).toContain('squat')
    const [w, r] = first.querySelectorAll('input')
    await type(w, '100'); await type(r, '5')
    await tap('Continue')
    await built()
    // Once a week in 5×5 A, 5 kg at a time: 100 → 135 kg by week 8, every session completed.
    expect(text()).toContain('Estimate')
    expect(text()).toContain('Estimated 1RM')
    expect(text()).toMatch(/Today\s*116\.7 kg/)
    expect(text()).toMatch(/Week 8\s*157\.5 kg/)
    expect(text()).toContain('as if you complete every set of every session')
    await tap('Continue')
    await act(async () => {})
    const S = useStore.getState().S
    const squat = S.routines.flatMap(x => x.ex).filter(e => e.id === '0043')
    expect(squat.every(e => e.weight === 100 && !e.calibrate)).toBe(true)
    const others = S.routines.flatMap(x => x.ex).filter(e => e.calibrate)
    expect(others.length).toBeGreaterThan(0)
    expect(tracked.some(([n]) => n === 'calibration_used')).toBe(true)
  })

  it('a body weight given starts the log', async () => {
    await tap('Get stronger')
    await tap('I’m just starting')
    const [now] = host.querySelectorAll('.ob-lift input')
    await type(now, '82')
    await tap('Continue')
    await tap('Continue')
    await tap('A full gym')
    await tap('60 min')
    await tap('Continue')
    await tap('Continue')
    await built()
    await tap('Continue')
    await act(async () => {})
    expect(useStore.getState().S.bodyweight).toEqual([expect.objectContaining({ d: '2026-10-05', w: 82 })])
  })

  it('not today: says when the next session is, and lands on Home; every screen and answer reported', async () => {
    await answerQuestions()
    await tap('Continue')                     // weights: all "I don't know"
    await built()
    await tap('Continue')
    await act(async () => {})
    await tap('Start from scratch')
    await act(async () => {})                  // no push in this browser: the reminder question is skipped
    expect(text()).toContain('Are you training today?')
    await tap('Not today')
    // Monday was a training day: it rests, and the plan still opens with its first session.
    expect(text()).toContain('Your next session: Wednesday')
    expect(text()).toContain('5×5 A')
    expect(useStore.getState().S.dayPlan['2026-10-05']).toBe('rest')
    await tap('Done')
    expect(text()).toContain('HOME')
    expect(answers()).toEqual(['goal', 'experience', 'body', 'days', 'place', 'length', 'limits', 'weights', 'code', 'paywall', 'plan', 'today'])
    const views = tracked.filter(([n, p]) => n === 'onboarding_step' && 'index' in p).map(([, p]) => p.step)
    expect(views).toEqual(['goal', 'experience', 'body', 'days', 'place', 'length', 'limits', 'lifts', 'building', 'plan', 'code', 'paywall', 'coach', 'import', 'notify', 'today'])
    expect(tracked.some(([n]) => n === 'onboarding_done')).toBe(true)
    expect(sessionStorage.getItem('tiza_first_run')).toBe(null)
  })

  it('always has a way back, past the few seconds of putting the plan together', async () => {
    await tap('Get stronger')
    expect(text()).toContain('2 of 8')
    await act(async () => { host.querySelector('[aria-label="Back"]').click() })
    expect(text()).toContain('1 of 8')
    await tap('Get stronger')
    await tap('I’m just starting')
    for (const b of ['Continue', 'Continue', 'A full gym', '60 min', 'Continue', 'Continue']) await tap(b)
    await built()
    expect(text()).toContain('First session:')
    await act(async () => { host.querySelector('[aria-label="Back"]').click() })
    expect(text()).toContain('Do you know how much you lift?')
  })

  it('at home with dumbbells, the plan uses dumbbells', async () => {
    await tap('Build muscle')
    await tap('Less than a year')
    await tap('Continue')
    await tap('Continue')
    await tap('At home, with dumbbells')
    await tap('45 min')
    await tap('Continue')
    if (text().includes('Do you know how much you lift?')) await tap('Continue')
    await built()
    await tap('Continue')
    await act(async () => {})
    const { EXIDX } = await import('../lib/exercises.js')
    const eqs = new Set(useStore.getState().S.routines.flatMap(r => r.ex.map(e => EXIDX[e.id].eq)))
    expect([...eqs].every(e => e === 'dumbbell' || e === 'body weight')).toBe(true)
  })
})
