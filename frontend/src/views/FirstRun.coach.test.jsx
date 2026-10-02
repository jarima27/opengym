// @vitest-environment happy-dom
// F11 with the Coach there (the demo's Coach, which needs no server). Nobody waits for it: after
// its consent screen the plan by rule is there at once, "Start my plan" starts it and asks the
// Coach with the same answers in the background, and when the Coach's plan arrives the watcher
// (components/CoachPlanWatcher.jsx) puts it in the plan by rule's place and says so.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/demo.js', () => ({ DEMO: true, DEMO_SEEDED: 'gym_demo_seeded_v2', REPO: '' }))
const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { DEF, useStore } = await import('../store/useStore.js')
const { default: FirstRun } = await import('./FirstRun.jsx')
const { default: CoachPlanWatcher } = await import('../components/CoachPlanWatcher.jsx')
const { useUI } = await import('../store/useUI.js')

let host, root
const text = () => host.textContent
const tap = async label => {
  const b = [...host.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(label))
  if (!b) throw new Error(`no button "${label}" in: ${text().slice(0, 300)}`)
  await act(async () => { b.click() })
}
const until = async (check, ms = 6000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (check()) return; await act(async () => { await new Promise(r => setTimeout(r, 100)) }) }
  throw new Error('timed out; on screen: ' + text().slice(0, 300))
}

beforeEach(async () => {
  sessionStorage.clear(); localStorage.clear(); tracked.length = 0
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null, guest: true, config: null })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter initialEntries={['/welcome']}><FirstRun /></MemoryRouter>) })
})
afterEach(() => { act(() => root.render(null)); host.remove() })

describe('the first run, with the Coach', () => {
  it('starts the plan by rule at once, asks the Coach in the background, and adopts its plan', async () => {
    await tap('Build muscle')
    await tap('1–3 years')
    await tap('4')                       // four days
    await tap('Continue')
    await tap('A full gym')
    await tap('45 min')
    await tap('Continue')
    await tap('Start from scratch')
    // What leaves for the Coach, before anything does.
    expect(text()).toContain('Meet the Coach')
    expect(text()).toContain('Routines, exercises, sets and reps')
    await tap('I understand — let’s go')
    // No wait: the plan by rule, and a word that the Coach is on it.
    expect(text()).toContain('Upper / Lower')
    expect(text()).toContain('Your Coach is fine-tuning this plan')
    await tap('Start my plan')
    const rules = useStore.getState().S.firstRun.routineIds
    expect(rules.length).toBe(4)
    const profile = useStore.getState().S.coach.profile
    expect(profile).toMatchObject({ goal: 'muscle', experience: 'regular', daysPerWeek: 4, preferredDays: [1, 2, 4, 5], sessionMin: 45 })
    await until(() => useStore.getState().S.firstRun.coach?.state === 'asked')
    expect(tracked.find(([n, p]) => n === 'onboarding_step' && p.step === 'plan')[1]).toMatchObject({ answer: 'upper-lower', coach: true })

    // The rest of the first run, at Home: the watcher swaps the Coach's plan in when it is ready.
    act(() => root.render(<MemoryRouter key="home" initialEntries={['/home']}><CoachPlanWatcher /></MemoryRouter>))
    await until(() => useStore.getState().S.firstRun.coach?.state === 'applied', 8000)
    const S = useStore.getState().S
    expect(S.routines.some(r => rules.includes(r.id))).toBe(false)
    expect(S.firstRun.routineIds.length).toBeGreaterThan(0)
    expect(Object.values(S.week).flat().every(id => S.firstRun.routineIds.includes(id))).toBe(true)
    expect(useUI.getState().toastMsg).toBe('Your Coach has improved your plan')
    expect(tracked.some(([n, p]) => n === 'coach_first_plan' && p.result === 'adopted')).toBe(true)
  }, 20000)

  it('declining the Coach gives the plan by rule instead', async () => {
    await tap('Get fit')
    await tap('I’m just starting')
    await tap('Continue')
    await tap('Bodyweight only')
    await tap('30 min')
    await tap('Continue')
    await tap('Start from scratch')
    await tap('Not now')
    expect(text()).toContain('Full Body')
    expect(text()).toContain('Start my plan')
  })
})
