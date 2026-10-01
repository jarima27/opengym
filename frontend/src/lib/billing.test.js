import { describe, expect, it, vi, beforeEach } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('./api.js', () => ({ api: apiMock }))

import { billingStatus, billingView, storeManageUrl } from './billing.js'

const fail = (status, message = 'HTTP ' + status) => Object.assign(new Error(message), { status, data: {} })

describe('billingStatus', () => {
  beforeEach(() => { apiMock.mockReset() })

  it('reads a 404 as an instance that does not charge', async () => {
    apiMock.mockRejectedValue(fail(404))
    expect(await billingStatus()).toBe(null)
  })

  it('passes any other failure on', async () => {
    apiMock.mockRejectedValue(fail(0, 'offline'))
    await expect(billingStatus()).rejects.toThrow('offline')
  })
})

describe('billingView', () => {
  const base = { on: true, ai: true, trialEnds: '2026-10-31T09:00:00.000Z', trialDaysLeft: 12, status: null, periodEnd: null, endsAt: null, portal: false }

  it('draws nothing where nobody is charged', () => {
    expect(billingView(null)).toBe(null)
    expect(billingView({ on: false, ai: true })).toBe(null)
    expect(billingView({ ...base, plan: 'free' })).toBe(null)
  })

  it('counts the trial down, and offers to subscribe', () => {
    const v = billingView({ ...base, plan: 'trial' })
    expect(v.title).toBe('Free trial — 12 days left')
    expect(v.action).toBe('checkout')
    expect(billingView({ ...base, plan: 'trial', trialDaysLeft: 1 }).title).toBe('Free trial — 1 day left')
  })

  it('an expired trial offers to subscribe', () => {
    const v = billingView({ ...base, plan: 'expired', ai: false, trialDaysLeft: 0 })
    expect(v.title).toBe('Your free trial has ended')
    expect(v.action).toBe('checkout')
  })

  it('a subscription says when it renews, or when it ends if cancelled, and opens the portal', () => {
    const renews = billingView({ ...base, plan: 'active', via: 'stripe', status: 'active', periodEnd: '2026-11-15T10:00:00.000Z', portal: true })
    expect(renews.title).toBe('Subscription active')
    expect(renews.subtitle).toMatch(/^Renews on .*15/)
    expect(renews.action).toBe('portal')
    const ends = billingView({ ...base, plan: 'active', via: 'stripe', status: 'active', periodEnd: '2026-11-15T10:00:00.000Z', endsAt: '2026-11-15T10:00:00.000Z', portal: true })
    expect(ends.subtitle).toMatch(/^Ends on /)
  })

  it('a failed payment asks for a new card', () => {
    const v = billingView({ ...base, plan: 'past_due', via: 'stripe', status: 'past_due', portal: true })
    expect(v.title).toBe('Payment failed')
    expect(v.action).toBe('portal')
  })
})

describe('billingView, v2', () => {
  const base = { on: true, ai: true, trialEnds: '2026-10-31T09:00:00.000Z', trialDaysLeft: 0, status: null, periodEnd: null, endsAt: null, portal: false, via: null, cardTrial: false, cardTrialDays: 30 }

  it('a profile that never had a trial is offered the card trial', () => {
    const v = billingView({ ...base, plan: 'none', ai: false })
    expect(v.title).toBe('Try the AI Coach free for 30 days')
    expect(v.action).toBe('checkout')
    expect(billingView({ ...base, plan: 'none', ai: false, cardTrialDays: 0 }).title).toBe('The AI Coach comes with the subscription')
  })

  it('inside a card trial it says when the first charge comes', () => {
    const v = billingView({ ...base, plan: 'active', via: 'stripe', status: 'trialing', cardTrial: true, periodEnd: '2026-11-15T10:00:00.000Z', portal: true })
    expect(v.title).toBe('Free trial active')
    expect(v.subtitle).toMatch(/^First charge on /)
    expect(v.action).toBe('portal')
  })

  it('a store subscription says where to manage it, and offers no web portal', () => {
    const v = billingView({ ...base, plan: 'active', via: 'app_store', periodEnd: '2026-11-15T10:00:00.000Z', portal: true })
    expect(v.subtitle).toMatch(/· Managed in the App Store$/)
    expect(v.action).toBe(null)
    expect(billingView({ ...base, plan: 'active', via: 'play_store' }).subtitle).toBe('Managed in Google Play')
  })

  it('a paused subscription says when it comes back, and offers to resume it now', () => {
    const v = billingView({ ...base, plan: 'paused', ai: false, via: 'stripe', status: 'active', pausedUntil: '2026-11-15T10:00:00.000Z', portal: true })
    expect(v.title).toBe('Subscription paused')
    expect(v.subtitle).toMatch(/^Nothing is charged until .+, when it resumes by itself\.$/)
    expect(v.action).toBe('resume')
  })
})

describe('storeManageUrl', () => {
  it('sends a store subscription to the store’s own page, and nothing else anywhere', () => {
    expect(storeManageUrl('app_store')).toBe('https://apps.apple.com/account/subscriptions')
    expect(storeManageUrl('mac_app_store')).toBe('https://apps.apple.com/account/subscriptions')
    expect(storeManageUrl('play_store')).toBe('https://play.google.com/store/account/subscriptions?package=fit.tiza.app')
    expect(storeManageUrl('stripe')).toBe(null)
    expect(storeManageUrl(null)).toBe(null)
  })
})
