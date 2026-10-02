import { describe, expect, it, vi } from 'vitest'
import { appleRedeemUrl, openAppleRedemption } from './redeem.js'

describe('an Apple offer code, redeemed from the app', () => {
  it('the App Store’s own redemption, with the creator’s offer code filled in', () => {
    expect(appleRedeemUrl('LUCIA30', '6470000000')).toBe('https://apps.apple.com/redeem?ctx=offercodes&id=6470000000&code=LUCIA30')
    expect(appleRedeemUrl('LUCIA30', '')).toBe(null)
    expect(appleRedeemUrl('', '6470000000')).toBe(null)
  })
  it('without the app’s App Store id, Apple’s sheet, where the code is typed', async () => {
    const store = { presentCodeRedemption: vi.fn(async () => {}) }
    expect(await openAppleRedemption('LUCIA30', 'u1', { store })).toBe('sheet')
    expect(store.presentCodeRedemption).toHaveBeenCalledWith('u1')
    expect(await openAppleRedemption('LUCIA30', 'u1', { store: { presentCodeRedemption: async () => { throw new Error('no store') } } })).toBe(null)
  })
})
