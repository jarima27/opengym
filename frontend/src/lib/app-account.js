// The store app's own account (mobile build with VITE_DEFAULT_SERVER — the hosted Tiza): signing
// up or in from inside the app, with Apple, Google or an e-mail and a password, instead of pairing
// with a code from a browser (lib/remote.js), which stays for anyone with a server of their own.
//
// These calls go over native HTTP (Capacitor's CapacitorHttp), not the WebView's fetch. The
// sign-in routes refuse a request a browser sent from another origin — that is what stops a page
// elsewhere from signing a visitor in to an account of its choosing (login CSRF, api/server.js
// csrfOk) — and the WebView's origin is never the server's. A native request carries no Origin,
// so it is not a browser's, and the server answers it with the session as a bearer token
// (`token: true`), which api.js then sends the way it does for a paired phone.
//
// Everything native is imported on demand, behind MOBILE, so none of it reaches the web bundle.
import { normalizeServerUrl } from './remote.js'
import { t } from './i18n-core.js'

const ENV = import.meta.env || {}
/** The server the store app belongs to (https://app.tiza.fit), or null in any other build. */
export const DEFAULT_SERVER = normalizeServerUrl(ENV.VITE_DEFAULT_SERVER || '')
// The OAuth client ids the app signs in with (the server accepts them in APPLE_/GOOGLE_CLIENT_IDS).
const GOOGLE_WEB_CLIENT_ID = ENV.VITE_GOOGLE_WEB_CLIENT_ID || ''
const GOOGLE_IOS_CLIENT_ID = ENV.VITE_GOOGLE_IOS_CLIENT_ID || ''
const TIMEOUT_MS = 20000

const failure = (message, code, status, data) => Object.assign(new Error(message), { code, status, data: data || {} })

/** One POST over native HTTP. Answers the parsed body, or throws like api.js does. */
export async function nativePost(base, path, body, { http } = {}) {
  const Http = http || (await import('@capacitor/core')).CapacitorHttp
  let r
  try {
    r = await Http.post({ url: base + path, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, data: body, connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS })
  } catch (e) {
    throw failure(t('Could not reach the server. Check your connection.'), 'offline', 0)
  }
  let data = r.data
  if (typeof data === 'string') { try { data = JSON.parse(data) } catch { data = null } }
  if (r.status >= 200 && r.status < 300 && data && typeof data === 'object') return data
  throw failure((data && data.error) || 'HTTP ' + r.status, (data && data.code) || 'http', r.status, data)
}

// A session the server handed over: what remote.js keeps and api.js sends from now on.
function session(base, data) {
  if (!data?.token || !data?.user?.id) throw failure(t('The server answered with something other than Tiza data.'), 'bad-response', 200)
  return { base, token: data.token, user: data.user, created: !!data.created }
}

/** Sign in with a name or e-mail and a password. */
export async function passwordSignIn(base, { identifier, password }, opts) {
  return session(base, await nativePost(base, '/api/login/password', { identifier, password, token: true }, opts))
}

/** A new account with a name, an optional e-mail and a password. `src`: attribution. */
export async function passwordSignUp(base, { name, email, password, src }, opts) {
  const body = { name, password, token: true, ...(email ? { email } : {}), ...(src ? { src } : {}) }
  return session(base, await nativePost(base, '/api/register/password', body, opts))
}

/**
 * Sign in with Apple or Google: the provider's own sheet, then its ID token to the server, which
 * checks it and opens (or creates) the profile. Throws { code: 'cancelled' } when the person
 * closed the provider's sheet — nothing to say then.
 */
export async function providerSignIn(base, provider, { social, src, ...opts } = {}) {
  const SocialLogin = social || (await import('@capgo/capacitor-social-login')).SocialLogin
  await SocialLogin.initialize(provider === 'google'
    ? { google: { webClientId: GOOGLE_WEB_CLIENT_ID, iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined, mode: 'online' } }
    // The authorization code too, for Apple: the server exchanges it for the token it revokes
    // if the account is ever deleted (api/social.js).
    : { apple: { clientId: ENV.VITE_APPLE_CLIENT_ID || undefined, redirectUrl: '', useProperTokenExchange: true } })
  let res
  try {
    res = await SocialLogin.login({ provider, options: provider === 'google' ? { scopes: ['email', 'profile'] } : { scopes: ['name', 'email'] } })
  } catch (e) {
    // Closing the sheet is not an error to show. The plugins word it differently per platform.
    if (/cancel|canceled|cancelled|1001|12501/i.test(String(e?.message || e?.code || ''))) throw failure('', 'cancelled', 0)
    throw failure(t('Could not sign in with {0}.', provider === 'apple' ? 'Apple' : 'Google'), 'provider', 0)
  }
  const r = res?.result || {}
  if (!r.idToken) throw failure(t('Could not sign in with {0}.', provider === 'apple' ? 'Apple' : 'Google'), 'provider', 0)
  // Apple gives the name to the app once, the first time; the server keeps it for the profile.
  const name = [r.profile?.givenName, r.profile?.familyName].filter(Boolean).join(' ').trim()
  const code = provider === 'apple' && typeof r.authorizationCode === 'string' ? r.authorizationCode : null
  const body = { provider, idToken: r.idToken, token: true, ...(name ? { name } : {}), ...(code ? { authorizationCode: code } : {}), ...(src ? { src } : {}) }
  return session(base, await nativePost(base, '/api/login/social', body, opts))
}

/** Which "continue with" buttons this phone shows: Apple only on iPhone, as Apple asks. */
export function providersFor(platform, offered = []) {
  const out = []
  if (platform === 'ios' && offered.includes('apple')) out.push('apple')
  if (offered.includes('google') && (platform === 'ios' ? GOOGLE_IOS_CLIENT_ID : GOOGLE_WEB_CLIENT_ID)) out.push('google')
  return out
}
