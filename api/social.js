/* Sign in with Apple and with Google, for the store app (and only where configured).

   The phone does the provider's own sign-in natively and hands the server the ID token it got:
   a JWT the provider signed, naming our app as its audience. The server checks it — signature
   against the provider's published keys, issuer, audience, expiry — and signs the person in to
   the profile that provider account opened, or opens one. No dependency: RS256 is node:crypto.

   A provider account is found by its subject (`sub`), never by e-mail address. Addresses on this
   server are identifiers nobody has proven (see "e-mail as a sign-in name" in server.js), so
   letting a provider's verified address open the profile that happens to carry it would let
   anyone who typed someone else's address on a profile of theirs take over that person's first
   sign-in with Google. The address is not kept at all.

   APPLE_CLIENT_IDS / GOOGLE_CLIENT_IDS: the audiences accepted, comma-separated — the app's
   bundle id for Apple; the OAuth client ids (web, iOS, Android) for Google. */
import crypto from 'node:crypto';

export const PROVIDERS = {
  apple: { issuers: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys' },
  google: { issuers: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs' }
};
const SKEW_S = 120;
const KEYS_TTL_MS = 6 * 3600000;
// An unknown key id makes the keys be fetched again — at most this often, so a stream of made-up
// key ids cannot turn into a stream of requests to the provider.
const REFETCH_MIN_MS = 60000;

export function socialConfig(env = process.env) {
  const list = k => String(env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  const apple = list('APPLE_CLIENT_IDS'), google = list('GOOGLE_CLIENT_IDS');
  if (apple.length) out.apple = apple;
  if (google.length) out.google = google;
  return out;
}

export class SocialError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const b64json = s => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; } };

/** A provider's signing keys, fetched when needed and kept for a few hours. */
export function createKeySet(url, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let keys = null, at = 0, tried = 0, inflight = null;
  async function load() {
    if (!inflight) {
      inflight = (async () => {
        tried = now();
        const r = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new SocialError('keys', `${url} answered ${r.status}`);
        const body = await r.json();
        keys = new Map((body.keys || []).filter(k => k.kty === 'RSA' && k.kid).map(k => [k.kid, k]));
        at = now();
      })().finally(() => { inflight = null; });
    }
    return inflight;
  }
  return async function key(kid) {
    if (!keys || now() - at > KEYS_TTL_MS) await load();
    if (!keys.has(kid) && now() - tried > REFETCH_MIN_MS) await load();
    const jwk = keys.get(kid);
    if (!jwk) throw new SocialError('bad-token', 'unknown signing key');
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  };
}

/**
 * The claims of a provider's ID token, once it is proven: signed by the provider (RS256), issued
 * by it, for one of `audiences`, and not expired. Throws SocialError('bad-token') otherwise.
 */
export async function verifyIdToken(idToken, { provider, audiences, key, now = Date.now }) {
  const p = PROVIDERS[provider];
  if (!p) throw new SocialError('provider', 'unknown provider');
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length !== 3 || idToken.length > 8192) throw new SocialError('bad-token', 'not a JWT');
  const header = b64json(parts[0]), claims = b64json(parts[1]);
  if (!header || !claims) throw new SocialError('bad-token', 'not a JWT');
  if (header.alg !== 'RS256') throw new SocialError('bad-token', 'unexpected algorithm');
  const pub = await key(header.kid);
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), pub, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new SocialError('bad-token', 'signature does not verify');
  const t = Math.floor(now() / 1000);
  if (!p.issuers.includes(claims.iss)) throw new SocialError('bad-token', 'wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some(a => audiences.includes(a))) throw new SocialError('bad-token', 'wrong audience');
  if (!(Number(claims.exp) > t - SKEW_S)) throw new SocialError('bad-token', 'expired');
  if (Number(claims.iat) > t + SKEW_S) throw new SocialError('bad-token', 'issued in the future');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new SocialError('bad-token', 'no subject');
  return claims;
}

/** A display name for a new profile: what the person gave, else their given name, else none. */
export function nameFor(body, claims) {
  const given = String(body?.name || claims?.given_name || claims?.name || '').replace(/\s+/g, ' ').trim();
  return given.slice(0, 40) || 'Tiza';
}

/* ---------- Apple: revoking the account's tokens when it is deleted ----------
   Apple asks apps that offer Sign in with Apple to revoke the user's tokens through its REST API
   when the account is deleted. That takes a refresh token, which only the authorization code the
   app got at sign-in can be exchanged for, and a client secret: a short JWT signed (ES256) with
   the team's Sign in with Apple key. APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY (the .p8,
   PEM; "\n" may be written as \\n in .env) switch it on; without them nothing is exchanged and a
   deleted account's Apple sign-in simply stops opening anything. */
export function appleKeysConfig(env = process.env) {
  const str = k => String(env[k] || '').trim();
  const pem = str('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!str('APPLE_TEAM_ID') || !str('APPLE_KEY_ID') || !pem) return null;
  return { teamId: str('APPLE_TEAM_ID'), keyId: str('APPLE_KEY_ID'), privateKey: pem, apiBase: (str('APPLE_API_BASE') || 'https://appleid.apple.com').replace(/\/+$/, '') };
}

/** The client secret Apple's token endpoints take: an ES256 JWT, valid for five minutes. */
export function appleClientSecret(cfg, clientId, now = Date.now()) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(now / 1000);
  const head = enc({ alg: 'ES256', kid: cfg.keyId }) + '.' + enc({ iss: cfg.teamId, iat: t, exp: t + 300, aud: 'https://appleid.apple.com', sub: clientId });
  const sig = crypto.sign('sha256', Buffer.from(head), { key: cfg.privateKey, dsaEncoding: 'ieee-p1363' });
  return head + '.' + sig.toString('base64url');
}

async function appleForm(cfg, path, fields, fetchImpl) {
  const r = await fetchImpl(cfg.apiBase + path, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000)
  });
  let body = null;
  try { body = await r.json(); } catch { /* revoke answers an empty 200 */ }
  if (!r.ok) throw new SocialError('apple', `${path} answered ${r.status}${body?.error ? ' ' + body.error : ''}`);
  return body || {};
}

/** The authorization code from the app → a refresh token to revoke later. */
export async function appleRefreshToken(cfg, clientId, code, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const body = await appleForm(cfg, '/auth/token', { client_id: clientId, client_secret: appleClientSecret(cfg, clientId, now()), code, grant_type: 'authorization_code' }, fetchImpl);
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) throw new SocialError('apple', 'no refresh token in the answer');
  return body.refresh_token;
}

/** Revokes a refresh token: the person's Apple ID no longer lists the app. */
export async function appleRevoke(cfg, clientId, token, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  await appleForm(cfg, '/auth/revoke', { client_id: clientId, client_secret: appleClientSecret(cfg, clientId, now()), token, token_type_hint: 'refresh_token' }, fetchImpl);
}
