import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: vi.fn(async () => ({ plan: 'active', ai: true })) }))
vi.mock('./api.js', () => ({ api: (...a) => mocks.api(...a) }))
const sp = await import('./store-purchases.js')

const product = (id, price, unit, intro) => ({ identifier: id, price, currencyCode: 'eur', introPrice: intro || null })
const pkg = (id, price, intro) => ({ identifier: id, product: product(id, price, null, intro) })
const FREE_MONTH = { price: 0, periodUnit: 'MONTH', periodNumberOfUnits: 1 }
function fakePurchases({ eligible = 2 } = {}) {
  const offering = id => ({ identifier: id, annual: pkg('tiza_annual', 34.99, FREE_MONTH), monthly: pkg('tiza_monthly', 4.99) })
  return {
    configure: vi.fn(async () => {}),
    logIn: vi.fn(async () => {}),
    logOut: vi.fn(async () => {}),
    getOfferings: vi.fn(async () => ({ current: offering('default'), all: { default: offering('default'), b: { ...offering('b'), monthly: null } } })),
    checkTrialOrIntroductoryPriceEligibility: vi.fn(async ({ productIdentifiers }) => Object.fromEntries(productIdentifiers.map(id => [id, { status: eligible }]))),
    purchasePackage: vi.fn(async () => ({ customerInfo: {} })),
    restorePurchases: vi.fn(async () => ({ customerInfo: { entitlements: { active: { pro: {} } } } }))
  }
}

beforeEach(() => { sp._resetStorePurchases(); mocks.api.mockClear(); vi.stubEnv('VITE_RC_IOS_KEY', 'appl_pub'); vi.stubEnv('VITE_RC_ANDROID_KEY', 'goog_pub') })
afterEach(() => vi.unstubAllEnvs())

describe('store purchases', () => {
  it('free days of an introductory offer, and none for a paid one', () => {
    expect(sp.freeDays(product('x', 1, null, FREE_MONTH))).toBe(30)
    expect(sp.freeDays(product('x', 1, null, { price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 2 }))).toBe(14)
    expect(sp.freeDays(product('x', 1, null, { price: 0.99, periodUnit: 'MONTH', periodNumberOfUnits: 1 }))).toBe(0)
    expect(sp.freeDays(product('x', 1))).toBe(0)
  })

  it('the operator’s offering, priced by the store the way the paywall draws Stripe’s', async () => {
    const Purchases = fakePurchases()
    const o = await sp.storeOffer('u1', 'b', { Purchases, platform: 'ios' })
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'appl_pub', appUserID: 'u1' })
    expect(o.plans).toEqual({ annual: { amount: 3499, currency: 'EUR', interval: 'year' } })
    expect(o.trialDays).toBe(30)
    const cur = await sp.storeOffer('u1', 'missing', { Purchases, platform: 'ios' })
    expect(Object.keys(cur.plans).sort()).toEqual(['annual', 'monthly'])
    expect(Purchases.configure).toHaveBeenCalledTimes(1)
  })

  it('no free trial promised to someone the store will not give one to', async () => {
    const o = await sp.storeOffer('u1', null, { Purchases: fakePurchases({ eligible: 1 }), platform: 'ios' })
    expect(o.trialDays).toBe(0)
  })

  it('another person signs in on the same phone: the store is told', async () => {
    const Purchases = fakePurchases()
    await sp.storeOffer('u1', null, { Purchases, platform: 'android' })
    expect(Purchases.configure).toHaveBeenCalledWith({ apiKey: 'goog_pub', appUserID: 'u1' })
    await sp.storeOffer('u2', null, { Purchases, platform: 'android' })
    expect(Purchases.logIn).toHaveBeenCalledWith({ appUserID: 'u2' })
    await sp.forgetStoreUser({ Purchases, platform: 'android' })
    expect(Purchases.logOut).toHaveBeenCalled()
  })

  it('a purchase is read back by the server at once; backing out is not an error', async () => {
    const Purchases = fakePurchases()
    const deps = { Purchases, platform: 'ios' }
    const { packages } = await sp.storeOffer('u1', null, deps)
    expect(await sp.buy('u1', packages.annual, deps)).toEqual({ access: { plan: 'active', ai: true } })
    expect(mocks.api).toHaveBeenCalledWith('/api/billing/sync', { method: 'POST', body: '{}' })
    Purchases.purchasePackage.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { userCancelled: true }))
    expect(await sp.buy('u1', packages.annual, deps)).toEqual({ cancelled: true })
    Purchases.purchasePackage.mockRejectedValueOnce(new Error('store down'))
    await expect(sp.buy('u1', packages.annual, deps)).rejects.toThrow('store down')
    expect(await sp.restore('u1', deps)).toMatchObject({ active: true })
  })

  it('a build without the store key sells nothing, and without an account nothing is set up', async () => {
    vi.stubEnv('VITE_RC_IOS_KEY', '')
    expect(await sp.storeSells({ Purchases: fakePurchases(), platform: 'ios' })).toBe(false)
    await expect(sp.storeOffer('u1', null, { Purchases: fakePurchases(), platform: 'ios' })).rejects.toMatchObject({ code: 'not-configured' })
    await expect(sp.storeOffer(null, null, { Purchases: fakePurchases(), platform: 'android' })).rejects.toMatchObject({ code: 'no-account' })
  })
})
