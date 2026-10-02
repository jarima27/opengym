// Where this person came from: the creator code (?ref=LUCIA) and campaign tags (?utm_*) of the
// link that brought them, remembered on this device until they sign up and then sent once with
// the sign-up (api/server.js adoptSource). A creator code that exists gives its bonus days.
//
// The link may carry them before the hash (https://app/?ref=X#/) or after it
// (https://app/#/?ref=X) — the app uses a hash router, and a link someone types by hand ends up
// either way. The last link with anything on it wins: that is the one they acted on.
import { MOBILE } from './mobile.js'
import { getLang } from './i18n-core.js'

const KEY = 'gym_src'
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
// Anything else in the link is not ours to keep.
const clean = v => String(v || '').trim().slice(0, 64)

export function readAttribution(href) {
  let url
  try { url = new URL(href) } catch { return null }
  const params = [url.searchParams]
  const q = url.hash.indexOf('?')
  if (q >= 0) params.push(new URLSearchParams(url.hash.slice(q + 1)))
  const out = {}
  for (const p of params) {
    const ref = clean(p.get('ref') || p.get('code')).toUpperCase()
    if (/^[A-Z0-9_-]{2,24}$/.test(ref)) out.ref = ref
    for (const k of UTM) if (clean(p.get(k))) out[k] = clean(p.get(k))
  }
  return Object.keys(out).length ? out : null
}

const storage = () => { try { return globalThis.localStorage || null } catch { return null } }

export function captureAttribution(href = globalThis.location?.href) {
  const got = href && readAttribution(href)
  if (!got) return
  try { storage()?.setItem(KEY, JSON.stringify({ ...got, at: Date.now() })) } catch { /* private mode */ }
}

export const platform = () => (MOBILE ? (/Android/.test(globalThis.navigator?.userAgent || '') ? 'android' : 'ios') : 'web')

/** What goes with a sign-up: the remembered link, which app it happened in, and its language. */
export function attribution() {
  let saved = null
  try { saved = JSON.parse(storage()?.getItem(KEY) || 'null') } catch { /* unreadable: nothing */ }
  // The app's language goes too: what the server writes before the app has said more (emails).
  const out = { platform: platform(), lang: getLang() }
  if (saved && typeof saved === 'object') for (const k of ['ref', ...UTM]) if (saved[k]) out[k] = saved[k]
  // The id the first run's screens were reported under before the sign-up (lib/track.js).
  try { const anon = storage()?.getItem('tiza_anon'); if (anon) out.anon = anon } catch { /* none */ }
  return out
}
export const pendingCode = () => attribution().ref || null
export function clearAttribution() { try { storage()?.removeItem(KEY) } catch { /* nothing to clear */ } }
