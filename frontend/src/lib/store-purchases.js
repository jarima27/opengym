// Buying Tiza Pro in the store app: the App Store and Google Play, through RevenueCat.
//
// RevenueCat knows each person by their Tiza profile id (appUserID), the same id the server's
// RevenueCat webhook and read-back use (api/billing.js), so a purchase made here unlocks the
// Coach on the account — on the phone, the website, everywhere. After a purchase or a restore the
// app asks the server to read RevenueCat back (POST /api/billing/sync) so the Coach opens without
// waiting for the webhook.
//
// The public SDK keys are build-time (VITE_RC_IOS_KEY, VITE_RC_ANDROID_KEY): they are meant to
// ship in the app. The plugin is imported on demand, behind MOBILE, so it never reaches the web.
import { api } from './api.js'
import { forgetCoachAccess } from './billing.js'

const ENV = import.meta.env || {}
const keyFor = platform => (platform === 'ios' ? ENV.VITE_RC_IOS_KEY : platform === 'android' ? ENV.VITE_RC_ANDROID_KEY : '') || ''

let plugin = null        // { Purchases, platform }, once loaded
let configuredFor = null // the appUserID the SDK is set up with

async function load(deps) {
  if (deps) return deps
  if (!plugin) {
    const [{ Purchases }, { Capacitor }] = await Promise.all([import('@revenuecat/purchases-capacitor'), import('@capacitor/core')])
    plugin = { Purchases, platform: Capacitor.getPlatform() }
  }
  return plugin
}

/** Whether this build can sell in its store at all. */
export async function storeSells(deps) {
  const { platform } = await load(deps)
  return !!keyFor(platform)
}

/** The SDK, set up for this profile. */
async function ready(userId, deps) {
  const p = await load(deps)
  if (!userId) throw Object.assign(new Error('no account'), { code: 'no-account' })
  if (configuredFor === null) {
    if (!keyFor(p.platform)) throw Object.assign(new Error('this build sells nothing'), { code: 'not-configured' })
    await p.Purchases.configure({ apiKey: keyFor(p.platform), appUserID: userId })
    configuredFor = userId
  } else if (configuredFor !== userId) {
    await p.Purchases.logIn({ appUserID: userId })
    configuredFor = userId
  }
  return p
}

const PERIOD_DAYS = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 }
/** Free days at the start of a product, when its introductory offer is a free one. */
export function freeDays(product) {
  const i = product?.introPrice
  if (!i || i.price !== 0) return 0
  return (PERIOD_DAYS[i.periodUnit] || 0) * (Number(i.periodNumberOfUnits) || 0)
}
// The way GET /api/paywall prices a plan (minor units, ISO currency), so Paywall.jsx draws a
// store's price exactly like Stripe's — the store's own price, in the store's currency.
const priceOf = (product, interval) => ({ amount: Math.round(Number(product.price) * 100), currency: String(product.currencyCode || '').toUpperCase(), interval })

/**
 * { plans: { annual?, monthly? }, packages, trialDays } from the operator's offering for this
 * paywall variant (GET /api/paywall `offering`), or the current one.
 */
export async function storeOffer(userId, offeringId, deps) {
  const { Purchases, platform } = await ready(userId, deps)
  const all = await Purchases.getOfferings()
  const o = (offeringId && all?.all?.[offeringId]) || all?.current
  if (!o) return { plans: {}, packages: {}, trialDays: 0 }
  const packages = {}, plans = {}
  if (o.annual) { packages.annual = o.annual; plans.annual = priceOf(o.annual.product, 'year') }
  if (o.monthly) { packages.monthly = o.monthly; plans.monthly = priceOf(o.monthly.product, 'month') }
  // The free trial the store will actually give: on iOS only to someone eligible, which the
  // store answers; on Android Google Play offers it only to the eligible in the first place.
  let trialDays = Math.max(0, ...Object.values(packages).map(p => freeDays(p.product)))
  if (trialDays && platform === 'ios') {
    try {
      const ids = Object.values(packages).map(p => p.product.identifier)
      const el = await Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ids })
      // 2 = INTRO_ELIGIBILITY_STATUS_ELIGIBLE
      if (!ids.some(id => el?.[id]?.status === 2)) trialDays = 0
    } catch { trialDays = 0 }
  }
  return { plans, packages, trialDays }
}

/** The first year's price of a yearly product whose introductory offer is one paid year — the
    offer made once as the paywall after the plan is closed (spec F12) — or null. Google Play
    keeps it as a discounted phase of the subscription option (after its free one, if any); the
    App Store as the product's paid introductory price. */
export function introYear(product) {
  const ph = product?.defaultOption?.introPhase
  const bp = ph?.billingPeriod
  if (ph?.price?.amountMicros > 0 && bp?.unit === 'YEAR' && Number(bp.value) === 1 && (Number(ph.billingCycleCount) || 1) === 1) {
    return { amount: Math.round(ph.price.amountMicros / 10000), currency: String(ph.price.currencyCode || product.currencyCode || '').toUpperCase() }
  }
  const i = product?.introPrice
  if (i && i.price > 0 && i.periodUnit === 'YEAR' && Number(i.periodNumberOfUnits) === 1 && (Number(i.cycles) || 1) === 1) {
    return { amount: Math.round(Number(i.price) * 100), currency: String(product.currencyCode || '').toUpperCase() }
  }
  return null
}

/** Free days before a product's first charge: Google Play's free phase, else a free intro price. */
export function trialDaysOf(product) {
  const bp = product?.defaultOption?.freePhase?.billingPeriod
  if (bp) return (PERIOD_DAYS[bp.unit] || 0) * (Number(bp.value) || 0)
  return freeDays(product)
}

/**
 * The exit offer from the operator's offering for it (GET /api/paywall `exitOffering`): its
 * yearly package, the first year's price and the full one as the store has them, and its free
 * days. null when the offering has no yearly product with a one-year introductory price.
 */
export async function storeExitOffer(userId, offeringId, deps) {
  if (!offeringId) return null
  const { Purchases } = await ready(userId, deps)
  const all = await Purchases.getOfferings()
  const pkg = all?.all?.[offeringId]?.annual
  const first = pkg && introYear(pkg.product)
  if (!first) return null
  return { pkg, first: { ...first, interval: 'year' }, full: priceOf(pkg.product, 'year'), trialDays: trialDaysOf(pkg.product) }
}

async function synced() {
  forgetCoachAccess()
  try { return await api('/api/billing/sync', { method: 'POST', body: '{}' }) } catch { return null }
}

/** Buys one package. { cancelled: true } when the person backed out of the store's sheet. */
export async function buy(userId, pkg, deps) {
  const { Purchases } = await ready(userId, deps)
  try {
    await Purchases.purchasePackage({ aPackage: pkg })
  } catch (e) {
    if (e?.userCancelled || e?.code === '1' || e?.code === 1) return { cancelled: true }
    throw e
  }
  return { access: await synced() }
}

/** Restores what this store account bought before (a new phone, a reinstall). */
export async function restore(userId, deps) {
  const { Purchases } = await ready(userId, deps)
  const r = await Purchases.restorePurchases()
  const active = Object.keys(r?.customerInfo?.entitlements?.active || {}).length > 0
  return { active, access: await synced() }
}

/** Apple's own sheet for redeeming an offer code, where it is typed in (iPhone). */
export async function presentCodeRedemption(userId, deps) {
  const { Purchases } = await ready(userId, deps)
  await Purchases.presentCodeRedemptionSheet()
}

/** Signing out: the next person on this phone is somebody else to RevenueCat too. */
export async function forgetStoreUser(deps) {
  if (configuredFor === null) return
  try { const { Purchases } = await load(deps); await Purchases.logOut() } catch { /* already anonymous */ }
  configuredFor = null
}

/** Tests only. */
export function _resetStorePurchases() { plugin = null; configuredFor = null }
