// @vitest-environment happy-dom
// F12, the funnel the hosted app opens with: the guided first run before there is an account —
// the video's screen first, the questions, the plan — then the account just before the paywall;
// and, once signed up, the paywall after the plan: the price a week, the trial's timeline, the
// discreet "continue with the free version", and the offer made once as it is closed. Every
// screen reported, before the account under the device's own id.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => [])
vi.mock('../lib/track.js', () => ({ track: (name, props) => tracked.push([name, props]), trackStep: props => tracked.push(['onboarding_step', props]) }))
const answers = vi.hoisted(() => ({}))
const calls = vi.hoisted(() => [])
vi.mock('../lib/api.js', async io => ({
  ...(await io()),
  api: vi.fn(async (path, opts = {}) => {
    calls.push([path, opts.body ? JSON.parse(opts.body) : null])
    const key = Object.keys(answers).find(k => path.startsWith(k))
    if (!key) throw new Error('no server here: ' + path)
    return typeof answers[key] === 'function' ? answers[key]() : answers[key]
  })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { DEF, useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { forgetCoachAccess } = await import('../lib/billing.js')
const { DEFAULT_COPY } = await import('../../../api/coach/core/paywall-copy.js')
const { default: FirstRun } = await import('./FirstRun.jsx')

let host, root
const text = () => host.textContent
const tap = async label => {
  const b = [...host.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(label))
  if (!b) throw new Error(`no button "${label}" in: ${text().slice(0, 400)}`)
  await act(async () => { b.click() })
  await act(async () => {})
}
const paywall = (over = {}) => ({
  experiment: 'launch', variant: 'a', highlight: 'annual', offering: null, copy: DEFAULT_COPY.en,
  plans: { monthly: { amount: 799, currency: 'EUR', interval: 'month' }, annual: { amount: 3999, currency: 'EUR', interval: 'year' } },
  cardTrialDays: 7, showFree: true, exit: { plan: 'annual', first: { amount: 2999, currency: 'EUR', interval: 'year' } }, exitOffering: null, ...over
})
const render = el => act(async () => {
  root.render(<MemoryRouter initialEntries={['/welcome']}><Routes>
    <Route path="/welcome" element={el} />
    <Route path="/home" element={<div>HOME</div>} />
  </Routes></MemoryRouter>)
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-10-05T10:00:00'))   // a Monday
  sessionStorage.clear(); localStorage.clear(); tracked.length = 0; calls.length = 0
  for (const k of Object.keys(answers)) delete answers[k]
  forgetCoachAccess()
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.render(null)); host.remove(); vi.useRealTimers() })

describe('before the account', () => {
  it('the video’s screen, every question, the plan — and the account last, nothing stored before it', async () => {
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null, guest: false, config: { billing: { trial_days: 0, card_trial_days: 7, web: true }, analytics: true } })
    const signIn = vi.fn()
    await render(<FirstRun pre onSignIn={signIn} />)
    expect(text()).toContain('Your personal AI Coach. It knows what to lift today.')
    expect(host.querySelector('video')).not.toBe(null)
    await tap('Get started')
    for (const b of ['Get fit', 'I’m just starting', 'Not having the time', 'All of them equally', 'Continue', 'Continue', 'Continue', 'A full gym', '60 min', '7–8 hours', 'Great — I want more']) await tap(b)
    expect(text()).toContain('Let’s keep it going')
    for (const b of ['Continue', 'In 4 weeks', 'Continue', 'Continue']) await tap(b)
    await act(async () => { vi.advanceTimersByTime(4000) })
    expect(text()).toContain('Full Body')
    await tap('Save my plan')
    expect(text()).toContain('Save your plan')
    // Nothing is anyone's yet: no plan, no first week in the store.
    expect(useStore.getState().S.routines).toEqual([])
    expect(useStore.getState().S.firstRun).toBe(undefined)
    await tap('Create account')
    expect(useUI.getState().sheets.length).toBe(1)
    await tap('I already have an account')
    expect(signIn).toHaveBeenCalled()
    const views = tracked.filter(([n, p]) => n === 'onboarding_step' && 'index' in p).map(([, p]) => p.step)
    expect(views).toEqual(['intro', 'goal', 'experience', 'holdback', 'focus', 'boost1', 'body', 'days', 'place', 'length', 'sleep', 'feeling', 'boost2', 'when', 'limits', 'lifts', 'building', 'plan', 'account'])
    expect(views.length).toBeGreaterThanOrEqual(15)
    expect(tracked.every(([n, p]) => n !== 'onboarding_step' || !('index' in p) || p.pre === true)).toBe(true)
  })
})

describe('after the account: the paywall after the plan', () => {
  const signedUp = async (pw = paywall()) => {
    answers['/api/billing'] = { on: true, plan: 'none', ai: false, cardTrialDays: 7, freePlan: false }
    answers['/api/paywall'] = pw
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: { id: 'u1', name: 'Ana' }, guest: false, config: { billing: { trial_days: 0, card_trial_days: 7, web: true } } })
    // Where the first run was when the account was made.
    sessionStorage.setItem('tiza_first_run', JSON.stringify({ step: 'account', answers: { goal: 'general', experience: 'starting', place: 'gym', sessionMin: 60, count: 3, days: [1, 3, 5] }, history: [] }))
    await render(<FirstRun />)
    await act(async () => {}); await act(async () => {})
  }

  it('the year by the week, the saving, the trial’s timeline; the free version, then the offer once', async () => {
    await signedUp()
    expect(text()).toContain('€0.77/week')
    expect(text()).toContain('€39.99/year')
    expect(text()).toContain('€1.84/week')
    expect(text()).toContain('Save 58%')
    expect(text()).toContain('Day 5: we remind you · Day 7: billing starts')
    expect(text()).toContain('Start 7 days free')
    await tap('Continue with the free version')
    expect(text()).toContain('Before you go: €29.99 for the first year')
    expect(text()).toContain('With the same 7-day free trial. Then €29.99 for the first year, and €39.99 from the second.')
    expect(tracked.some(([n]) => n === 'exit_offer_viewed')).toBe(true)
    await tap('No thanks')
    expect(tracked.some(([n]) => n === 'continued_free')).toBe(true)
    // On with the first run: the plan applied, the history question.
    expect(text()).toContain('Coming from another app?')
    expect(useStore.getState().S.routines.length).toBe(3)
    expect(tracked.find(([n, p]) => n === 'onboarding_step' && p.step === 'paywall' && p.answer)[1].answer).toBe('free')
  })

  it('the offer is made once: closed a second time, straight on to the free version', async () => {
    localStorage.setItem('tiza_offers_seen', JSON.stringify(['exit']))
    await signedUp()
    await act(async () => { host.querySelector('.pw-x').click() })
    await act(async () => {})
    expect(text()).not.toContain('Before you go')
    expect(text()).toContain('Coming from another app?')
  })

  it('a variant can hide the free link; the X still closes it', async () => {
    await signedUp(paywall({ showFree: false, exit: null }))
    expect(text()).toContain('Start 7 days free')
    expect(text()).not.toContain('Continue with the free version')
    await act(async () => { host.querySelector('.pw-x').click() })
    await act(async () => {})
    expect(text()).toContain('Coming from another app?')
  })

  it('taking the offer checks out the year with its coupon, and comes back to the first run', async () => {
    answers['/api/billing/checkout'] = { url: 'https://checkout.stripe.test/x' }
    const assign = vi.fn()
    const loc = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...loc, assign, href: loc.href } })
    try {
      await signedUp()
      await tap('Continue with the free version')
      await tap('Start 7 days free')
      expect(calls.find(([p]) => p === '/api/billing/checkout')[1]).toEqual({ plan: 'annual', offer: 'exit', back: 'welcome' })
      expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/x')
      expect(tracked.some(([n]) => n === 'exit_offer_accepted')).toBe(true)
      // Back from Stripe, the first run goes on from the screen after the paywall.
      expect(JSON.parse(sessionStorage.getItem('tiza_first_run')).step).toBe('coach')
    } finally { Object.defineProperty(window, 'location', { configurable: true, value: loc }) }
  })
})
