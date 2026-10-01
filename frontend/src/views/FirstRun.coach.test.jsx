// @vitest-environment happy-dom
// F11 with the Coach there (the demo's Coach, which needs no server): the plan is the Coach's
// free first plan — asked with the same answers, after its consent screen — and "Start my plan"
// imports it with its week, the way the Coach's own plan card does.
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
  it('asks the Coach for the free first plan with the answers, and imports it', async () => {
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
    await tap('I understand — let’s go')
    expect(text()).toContain('Your Coach is building your plan')
    const profile = useStore.getState().S.coach.profile
    expect(profile).toMatchObject({ goal: 'muscle', experience: 'regular', daysPerWeek: 4, preferredDays: [1, 2, 4, 5], sessionMin: 45 })
    await until(() => text().includes('Start my plan'))
    expect(text()).toContain('First session:')
    await tap('Start my plan')
    const S = useStore.getState().S
    expect(S.routines.length).toBeGreaterThan(0)
    expect(Object.values(S.week).filter(ids => ids?.length).length).toBeGreaterThan(0)
    expect(tracked.find(([n, p]) => n === 'onboarding_step' && p.step === 'plan')[1].answer).toBe('coach')
  }, 15000)

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
