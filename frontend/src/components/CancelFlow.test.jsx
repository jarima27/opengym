// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI } from '../store/useUI.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ track: null, cancel: null, pause: null, annual: null, resume: null }))
vi.mock('../lib/track.js', () => ({ track: (...a) => mocks.track(...a) }))
vi.mock('../lib/billing.js', async orig => ({
  ...(await orig()),
  billingCancel: (...a) => mocks.cancel(...a),
  billingPause: (...a) => mocks.pause(...a),
  billingAnnual: (...a) => mocks.annual(...a),
  billingResume: (...a) => mocks.resume(...a)
}))

const { openCancelFlow } = await import('./CancelFlow.jsx')

const STRIPE = {
  on: true, plan: 'active', ai: true, via: 'stripe', status: 'active', cardTrial: false, endsAt: null,
  periodEnd: '2026-10-21T10:00:00.000Z',
  offers: { pause: true, annual: { price: { amount: 3499, currency: 'EUR', interval: 'year' }, discount: false } }
}

let host, root, done
beforeEach(() => {
  Object.assign(mocks, {
    track: vi.fn(),
    cancel: vi.fn(() => Promise.resolve({ ...STRIPE, endsAt: '2026-10-21T10:00:00.000Z' })),
    pause: vi.fn(() => Promise.resolve({ ...STRIPE, plan: 'paused', ai: false, pausedUntil: '2026-10-31T10:00:00.000Z' })),
    annual: vi.fn(() => Promise.resolve(STRIPE)),
    resume: vi.fn(() => Promise.resolve(STRIPE))
  })
  done = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.render(null)); useUI.setState({ sheet: null }); host.remove() })

// The sheet the flow opened, drawn on its own.
const open = a => {
  let render
  const spy = vi.spyOn(useUI.getState(), 'openSheet').mockImplementation(r => { render = r })
  openCancelFlow(a, done)
  spy.mockRestore()
  const close = vi.fn()
  act(() => root.render(<Sheet render={render} close={close} />))
  return close
}
const Sheet = ({ render, close }) => render(close)
const button = text => [...host.querySelectorAll('button, .lrow')].find(b => b.textContent.includes(text))
const tap = async text => { await act(async () => { button(text).click() }) }

describe('CancelFlow', () => {
  it('asks why, offers the pause and the annual plan, and cancels on the same screen', async () => {
    open(STRIPE)
    expect(host.textContent).toContain('Why are you cancelling? It helps us improve.')
    for (const r of ['It’s too expensive', 'I don’t use it', 'The Coach doesn’t convince me', 'I’m switching apps', 'Something else']) expect(button(r)).toBeTruthy()
    await tap('It’s too expensive')
    expect(mocks.track).toHaveBeenCalledWith('cancel_reason', { reason: 'price', via: 'stripe' })

    expect(host.textContent).toContain('Pause for a month')
    expect(host.textContent).toContain('Switch to the annual plan')
    expect(host.textContent).toContain('€34.99 a year — €2.92 a month.')
    expect(host.textContent).not.toContain('With a discount for staying.')
    expect(button('Cancel subscription')).toBeTruthy()

    await tap('Cancel subscription')
    expect(mocks.cancel).toHaveBeenCalledWith('price')
    expect(host.textContent).toMatch(/Cancelled\. The Coach stays with you until .+; nothing more will be charged\./)
    expect(done).toHaveBeenCalled()
    // And taken back from there.
    await tap('Keep my subscription')
    expect(mocks.resume).toHaveBeenCalled()
  })

  it('a pause says until when', async () => {
    open(STRIPE)
    await tap('Something else')
    await tap('Pause for a month')
    expect(mocks.pause).toHaveBeenCalled()
    expect(host.textContent).toMatch(/^.*Paused\. Nothing is charged until .+; then it carries on by itself\./)
  })

  it('with nothing to offer (a card trial), the answer cancels at once and says nothing is charged', async () => {
    open({ ...STRIPE, status: 'trialing', cardTrial: true, offers: { pause: false, annual: null } })
    await tap('I don’t use it')
    expect(mocks.cancel).toHaveBeenCalledWith('unused')
    expect(host.textContent).toMatch(/Your trial ends on .+ and nothing will be charged\./)
  })

  it('a store subscription: the answer opens the store’s own page', async () => {
    const win = vi.spyOn(window, 'open').mockImplementation(() => null)
    const close = open({ ...STRIPE, via: 'play_store', offers: null })
    expect(host.textContent).toContain('You subscribed in the store')
    await tap('I’m switching apps')
    expect(win).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions?package=fit.tiza.app', '_blank', 'noopener')
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalled()
    win.mockRestore()
  })
})
