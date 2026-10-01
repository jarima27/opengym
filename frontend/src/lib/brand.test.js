import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OFFER, SIGNUP } from './brand.js'

// The demo's paywall states Tiza Pro's offer without a server to ask (lib/paywall.js demoPaywall):
// it has to be the one the website states, or the demo promises a price the sign-up does not keep.
describe('brand', () => {
  it('the offer is the website’s', () => {
    const site = JSON.parse(readFileSync(new URL('../../../landing/site.config.json', import.meta.url), 'utf8'))
    expect(OFFER).toEqual({
      currency: site.prices.currency,
      monthly: Math.round(site.prices.monthly * 100),
      annual: Math.round(site.prices.annual * 100),
      trialDays: site.prices.trialDays
    })
    // and the sign-up address is the website's own "Start free"
    expect(SIGNUP).toBe(site.appUrl + site.appSignupPath)
  })
})
