import { describe, expect, it, vi, beforeEach } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('./api.js', () => ({ api: apiMock }))

import { billingStatus, billingView } from './billing.js'

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
    const renews = billingView({ ...base, plan: 'active', status: 'active', periodEnd: '2026-11-15T10:00:00.000Z', portal: true })
    expect(renews.title).toBe('Subscription active')
    expect(renews.subtitle).toMatch(/^Renews on .*15/)
    expect(renews.action).toBe('portal')
    const ends = billingView({ ...base, plan: 'active', status: 'active', periodEnd: '2026-11-15T10:00:00.000Z', endsAt: '2026-11-15T10:00:00.000Z', portal: true })
    expect(ends.subtitle).toMatch(/^Ends on /)
  })

  it('a failed payment asks for a new card', () => {
    const v = billingView({ ...base, plan: 'past_due', status: 'past_due', portal: true })
    expect(v.title).toBe('Payment failed')
    expect(v.action).toBe('portal')
  })
})
