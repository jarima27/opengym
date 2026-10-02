// @vitest-environment happy-dom
// The demo is the paid product as a free account sees it: the Coach's weekly card shows its first
// pill whole and the rest by title only, and a locked one opens the paywall — the real offer, whose
// button opens the sign-up for an account (there is no server to sell from). Before, the demo read
// the Coach as 'open' and showed every pill whole.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/demo.js', () => ({ DEMO: true, DEMO_SEEDED: 'gym_demo_seeded_v2' }))
const api = vi.hoisted(() => vi.fn(() => Promise.reject(new Error('the demo has no server'))))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api }))
vi.mock('../lib/track.js', () => ({ track: () => {} }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { default: CoachReportCard } = await import('./CoachReport.jsx')
const { SIGNUP } = await import('../lib/brand.js')

// The same week as CoachReport.test.jsx: a stalled squat, a bench going up, a missed week.
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
  original = useStore.getState()
  // The demo: a guest with no server, so no config and no billing block at all.
  useStore.setState({ S: { ...original.S, ...training }, user: null, guest: true, config: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null))
  useUI.setState({ sheets: [] })
  useStore.setState({ S: original.S, user: original.user, guest: original.guest, config: original.config })
  host.remove()
  vi.useRealTimers()
})

describe('the Coach card in the demo', () => {
  it('shows the free view: the first pill whole, the rest locked by title', async () => {
    await act(async () => { root.render(<MemoryRouter><CoachReportCard /></MemoryRouter>) })
    expect(host.textContent).toContain('Stalled: barbell full squat')
    expect(host.textContent).toContain('without going up')
    const locked = host.querySelectorAll('.pill-locked')
    expect(locked.length).toBeGreaterThan(0)
    expect(locked[0].querySelector('.blurred').getAttribute('aria-hidden')).toBe('true')
    expect(host.textContent).toContain('more observation')
  })

  it('a locked pill opens the real offer, and its button the sign-up — nothing asked of a server', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await act(async () => { root.render(<MemoryRouter><CoachReportCard /></MemoryRouter>) })
    await act(async () => { host.querySelector('.pill-locked').click() })
    const sheets = useUI.getState().sheets
    expect(sheets.length).toBe(1)
    const sheetHost = document.createElement('div')
    const sheetRoot = createRoot(sheetHost)
    await act(async () => { sheetRoot.render(<MemoryRouter>{sheets[0].render(() => {})}</MemoryRouter>) })
    await act(async () => {})
    const txt = sheetHost.textContent
    expect(txt).toContain('€7.99/month')
    expect(txt).toContain('€39.99/year')
    expect(txt).toContain('€0.77/week')
    expect(txt).toContain('Save 58%')
    expect(txt).toContain('Start 7 days free')
    expect(txt).toContain('This is the demo')
    const cta = [...sheetHost.querySelectorAll('button')].find(b => b.textContent.includes('Start 7 days free'))
    await act(async () => { cta.click() })
    expect(open).toHaveBeenCalledWith(SIGNUP, '_blank', 'noopener')
    expect(api).not.toHaveBeenCalled()
    act(() => sheetRoot.render(null))
    open.mockRestore()
  })
})
