#!/usr/bin/env node
// Uploads an Android app bundle to a Google Play track — the release workflow's last Android step
// (.github/workflows/release.yml, docs/RELEASING.md). No dependency: the Google Play Developer API
// over fetch, signed in as a service account with a JWT made by node:crypto.
//
//   PLAY_SERVICE_ACCOUNT_JSON='{…}' node scripts/play-upload.mjs \
//     --package fit.tiza.app --aab app-release.aab --track alpha --name "1.4.0 (10400)" [--status completed]
//
// One edit: upload the bundle, put it on the track as one release, commit. "alpha" is Play's own
// closed testing track; a closed track you made yourself goes by the name you gave it. --status
// draft leaves the release for you to roll out in Play Console (and is the only status Play
// accepts while the app itself is still a draft). Any failure deletes the edit, so nothing is
// left half-made in Play Console.

import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'
const STATUSES = ['completed', 'draft']

export class PlayError extends Error {}

const b64url = buf => Buffer.from(buf).toString('base64url')

/** The service account's key file, as Play Console's Google Cloud project hands it out. */
export function readServiceAccount(json) {
  let sa
  try { sa = JSON.parse(json) } catch { throw new PlayError('PLAY_SERVICE_ACCOUNT_JSON is not JSON — paste the whole key file') }
  if (!sa || sa.type !== 'service_account' || !sa.client_email || !sa.private_key) {
    throw new PlayError('PLAY_SERVICE_ACCOUNT_JSON is not a service account key (type, client_email, private_key)')
  }
  return sa
}

/** A signed JWT asking Google for an access token with the androidpublisher scope. */
export function assertion(sa, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) }))
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key)
  return `${head}.${body}.${b64url(sig)}`
}

// Google's errors are {error: {code, message, status}}; the message is the useful part.
async function check(res, what) {
  if (res.ok) return res.status === 204 ? null : res.json()
  let msg = ''
  try { const j = await res.json(); msg = j?.error?.message || j?.error_description || j?.error || '' } catch {}
  throw new PlayError(`${what}: ${res.status}${msg ? ` — ${msg}` : ''}${hint(msg)}`)
}
function hint(msg) {
  if (/Package not found/i.test(msg)) return '\n  The app has to exist in Play Console, with its first bundle uploaded by hand (docs/RELEASING.md).'
  if (/status draft may be created on draft app/i.test(msg)) return '\n  The app is still a draft in Play Console: set PLAY_RELEASE_STATUS=draft until its first release is out.'
  if (/changesNotSentForReview/i.test(msg)) return '\n  Play wants these changes sent for review from Play Console (Publishing overview).'
  if (/caller does not have permission|insufficient permission/i.test(msg)) return '\n  Invite the service account in Play Console → Users and permissions, with release rights for this app.'
  if (/Version code \d+ has already been used/i.test(msg)) return '\n  Every upload needs a new version (frontend/package.json): Play never takes the same version code twice.'
  return ''
}

export async function accessToken(sa, { fetchImpl = fetch, now = Date.now() } = {}) {
  const res = await fetchImpl(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion(sa, now) })
  })
  const j = await check(res, 'signing in as the service account')
  if (!j?.access_token) throw new PlayError('signing in as the service account: no access token in the answer')
  return j.access_token
}

/**
 * Uploads `bundle` (bytes) and releases it on `track`. Returns {versionCode, track, status}.
 * `log` gets one line per step.
 */
export async function uploadToPlay({ sa, packageName, bundle, track, releaseName, status = 'completed', fetchImpl = fetch, now = Date.now(), log = () => {} }) {
  if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(packageName || '')) throw new PlayError(`not a package name: ${packageName}`)
  if (!track) throw new PlayError('no track given')
  if (!STATUSES.includes(status)) throw new PlayError(`status must be ${STATUSES.join(' or ')}, not ${status}`)
  if (!bundle?.length) throw new PlayError('the bundle is empty')

  const token = await accessToken(sa, { fetchImpl, now })
  const auth = { Authorization: `Bearer ${token}` }
  const app = `${API}/${encodeURIComponent(packageName)}`

  const edit = await check(await fetchImpl(`${app}/edits`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' }), 'opening an edit')
  const editUrl = `${app}/edits/${encodeURIComponent(edit.id)}`
  log(`edit ${edit.id} open for ${packageName}`)
  try {
    const up = await check(await fetchImpl(`${UPLOAD}/${encodeURIComponent(packageName)}/edits/${encodeURIComponent(edit.id)}/bundles?uploadType=media`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: bundle
    }), 'uploading the bundle')
    const versionCode = String(up.versionCode)
    log(`bundle uploaded: version code ${versionCode}`)

    // versionCodes are int64, which the API spells as strings.
    const release = { versionCodes: [versionCode], status, ...(releaseName ? { name: releaseName } : {}) }
    await check(await fetchImpl(`${editUrl}/tracks/${encodeURIComponent(track)}`, {
      method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ track, releases: [release] })
    }), `putting it on the "${track}" track`)
    log(`release on "${track}" (${status})`)

    await check(await fetchImpl(`${editUrl}:commit`, { method: 'POST', headers: auth }), 'committing the edit')
    log('committed')
    return { versionCode, track, status }
  } catch (e) {
    // Best effort: an edit left open blocks nothing, but it is clutter and holds the upload.
    await fetchImpl(editUrl, { method: 'DELETE', headers: auth }).catch(() => {})
    throw e
  }
}

function args(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i])
    if (!m || argv[i + 1] === undefined) throw new PlayError(`unexpected argument: ${argv[i]}`)
    out[m[1]] = argv[++i]
  }
  return out
}

async function main() {
  const a = args(process.argv.slice(2))
  if (!a.package || !a.aab || !a.track) throw new PlayError('usage: play-upload.mjs --package <id> --aab <file> --track <track> [--name <release name>] [--status completed|draft]')
  if (!process.env.PLAY_SERVICE_ACCOUNT_JSON) throw new PlayError('PLAY_SERVICE_ACCOUNT_JSON is not set')
  const sa = readServiceAccount(process.env.PLAY_SERVICE_ACCOUNT_JSON)
  const bundle = await readFile(a.aab)
  const r = await uploadToPlay({ sa, packageName: a.package, bundle, track: a.track, releaseName: a.name, status: a.status || 'completed', log: m => console.log(m) })
  console.log(`Google Play: ${a.package} version code ${r.versionCode} is on the "${r.track}" track (${r.status}).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => {
    console.error(e instanceof PlayError ? `::error::${e.message.replace(/\n/g, '%0A')}` : e)
    process.exit(1)
  })
}
