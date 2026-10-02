// Android: the creator's code a Google Play link carried (…&referrer=ref%3DLUCIA), read once, on
// the app's first start, through the install referrer (android/…/InstallReferrerPlugin.java).
// It is remembered like a link's (lib/attribution.js) and goes with the sign-up, so the code
// applies by itself — nobody types it. The plugin is imported on demand, behind MOBILE.
import { MOBILE } from './mobile.js'
import { readAttribution, captureAttribution } from './attribution.js'

const DONE = 'tiza_install_referrer'

/** What a referrer string ("ref=LUCIA&utm_source=instagram") says, as attribution — or null.
    Google Play's own for an install that came from no link ("utm_source=google-play&
    utm_medium=organic") says nothing worth keeping. */
export function referrerAttribution(referrer) {
  const r = String(referrer || '').trim().replace(/^\?/, '')
  if (!r) return null
  const got = readAttribution('https://play.google.com/?' + r)
  if (!got) return null
  if (!got.ref && got.utm_source === 'google-play' && got.utm_medium === 'organic') return null
  return got
}

/** Reads the install referrer once per install; what it carried is kept for the sign-up. */
export async function readInstallReferrer({ mobile = MOBILE, plugin, platform } = {}) {
  if (!mobile) return null
  try { if (localStorage.getItem(DONE)) return null } catch { return null }
  try {
    const core = plugin ? null : await import('@capacitor/core')
    if ((platform || core?.Capacitor.getPlatform()) !== 'android') return null
    const p = plugin || core.registerPlugin('InstallReferrer')
    const { referrer } = (await p.get()) || {}
    try { localStorage.setItem(DONE, new Date().toISOString()) } catch { /* read again next start */ }
    const got = referrerAttribution(referrer)
    if (got) captureAttribution('https://play.google.com/?' + String(referrer).replace(/^\?/, ''))
    return got
  } catch { return null }
}
