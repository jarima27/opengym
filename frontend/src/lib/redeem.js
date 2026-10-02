// Redeeming a code in the app: "Have a code?" in Settings, and the guided first run just before
// the paywall. A tester's code makes the profile Pro for good; a creator's or a friend's gives
// extra days. On an iPhone, a creator's code that stands for an Apple offer code (made in App
// Store Connect, one per creator) is redeemed in the App Store instead: the server counts the
// profile under the creator, and the App Store's own redemption opens with that offer code
// filled in — or Apple's sheet, where it is typed, when the app does not know its App Store id.
import { api } from './api.js'
import { platform } from './attribution.js'
import { forgetCoachAccess } from './billing.js'

const ENV = import.meta.env || {}

/** The App Store's redemption of `offer`, with the code filled in — or null without the app's id. */
export const appleRedeemUrl = (offer, appId = ENV.VITE_APPLE_APP_ID || '') =>
  (appId && offer ? `https://apps.apple.com/redeem?ctx=offercodes&id=${encodeURIComponent(appId)}&code=${encodeURIComponent(offer)}` : null)

/** POST /api/redeem from this device: { kind, days, appleOffer?, access }; throws as api() does. */
export async function redeemCode(code) {
  const r = await api('/api/redeem', { method: 'POST', body: JSON.stringify({ code: String(code || '').trim(), platform: platform() }) })
  forgetCoachAccess()
  return r
}

/** Opens the redemption of an Apple offer code. 'url' or 'sheet' — or null when neither worked. */
export async function openAppleRedemption(offer, userId, { open = u => window.open(u, '_blank'), store } = {}) {
  const url = appleRedeemUrl(offer)
  if (url) { open(url); return 'url' }
  try {
    await (store || await import('./store-purchases.js')).presentCodeRedemption(userId)
    return 'sheet'
  } catch { return null }
}
