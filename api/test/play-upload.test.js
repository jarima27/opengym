/* The release workflow's Google Play upload (scripts/play-upload.mjs — release tooling, tested
   here because this is the node:test suite CI already runs): it signs in as the service account
   with a JWT Google can verify, makes exactly one edit — bundle, track, commit — and on any
   failure deletes that edit and says what to do. Against a fake Play API, with a key made here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readServiceAccount, assertion, uploadToPlay, PlayError, SCOPE } from '../../scripts/play-upload.mjs';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  type: 'service_account', client_email: 'tiza-release@tiza-play.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), private_key_id: 'abc123',
  token_uri: 'https://oauth2.googleapis.com/token'
};
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const BUNDLE = Buffer.from('PK\u0003\u0004 not really a bundle');

// A fake Play API: records every call, answers each step, and can be told to fail one.
function fakePlay({ failAt = null, failWith = 'Internal error' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const call = { method: init.method || 'GET', path: u.pathname, query: u.search, headers: init.headers || {}, body: init.body };
    calls.push(call);
    const step = u.host === 'oauth2.googleapis.com' ? 'token'
      : call.method === 'DELETE' ? 'delete'
      : /\/bundles$/.test(u.pathname) ? 'upload'
      : /\/tracks\//.test(u.pathname) ? 'track'
      : /:commit$/.test(u.pathname) ? 'commit'
      : /\/edits$/.test(u.pathname) ? 'edit' : 'unknown';
    call.step = step;
    if (step === failAt) return new Response(JSON.stringify({ error: { code: 400, message: failWith, status: 'INVALID_ARGUMENT' } }), { status: 400 });
    switch (step) {
      case 'token': return Response.json({ access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' });
      case 'edit': return Response.json({ id: 'edit-1', expiryTimeSeconds: '1759999999' });
      case 'upload': return Response.json({ versionCode: 10400, sha1: 'x', sha256: 'y' });
      case 'track': return Response.json(JSON.parse(init.body));
      case 'commit': return Response.json({ id: 'edit-1' });
      case 'delete': return new Response(null, { status: 204 });
      default: return new Response('{}', { status: 404 });
    }
  };
  return { calls, fetchImpl };
}

test('the JWT is RS256, signed by the service account key, for the androidpublisher scope, for an hour', () => {
  const jwt = assertion(SA, NOW);
  const [h, b, s] = jwt.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')));
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: 'abc123' });
  const claims = JSON.parse(Buffer.from(b, 'base64url'));
  assert.equal(claims.iss, SA.client_email);
  assert.equal(claims.scope, SCOPE);
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(claims.iat, NOW / 1000);
});

test('one edit: token, open, upload the bundle, release it on the track, commit', async () => {
  const { calls, fetchImpl } = fakePlay();
  const lines = [];
  const r = await uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', releaseName: '1.4.0 (10400)', fetchImpl, now: NOW, log: l => lines.push(l) });
  assert.deepEqual(r, { versionCode: '10400', track: 'alpha', status: 'completed' });
  assert.deepEqual(calls.map(c => c.step), ['token', 'edit', 'upload', 'track', 'commit']);

  const token = new URLSearchParams(calls[0].body);
  assert.equal(token.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(token.get('assertion').split('.').length, 3);

  for (const c of calls.slice(1)) assert.equal(c.headers.Authorization, 'Bearer ya29.test');
  assert.equal(calls[1].path, '/androidpublisher/v3/applications/fit.tiza.app/edits');
  assert.equal(calls[2].path, '/upload/androidpublisher/v3/applications/fit.tiza.app/edits/edit-1/bundles');
  assert.equal(calls[2].query, '?uploadType=media');
  assert.equal(calls[2].headers['Content-Type'], 'application/octet-stream');
  assert.equal(calls[2].body, BUNDLE);
  assert.equal(calls[3].method, 'PUT');
  assert.equal(calls[3].path, '/androidpublisher/v3/applications/fit.tiza.app/edits/edit-1/tracks/alpha');
  // versionCodes are int64 in the API, spelled as strings
  assert.deepEqual(JSON.parse(calls[3].body), { track: 'alpha', releases: [{ versionCodes: ['10400'], status: 'completed', name: '1.4.0 (10400)' }] });
  assert.equal(calls[4].path, '/androidpublisher/v3/applications/fit.tiza.app/edits/edit-1:commit');
  assert.deepEqual(lines, ["edit edit-1 open for fit.tiza.app", "bundle uploaded: version code 10400", "release on \"alpha\" (completed)", "committed"]);
});

test('a draft release, for an app Play still holds as a draft', async () => {
  const { calls, fetchImpl } = fakePlay();
  await uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'closed-testers', status: 'draft', fetchImpl, now: NOW });
  const track = calls.find(c => c.step === 'track');
  assert.match(track.path, /\/tracks\/closed-testers$/);
  assert.deepEqual(JSON.parse(track.body).releases, [{ versionCodes: ['10400'], status: 'draft' }]);
});

test('any step that fails deletes the edit, and the error says what Play said and what to do', async () => {
  const cases = [
    ['upload', 'APK specifies a version code that has already been used. Version code 10400 has already been used.', /Play never takes the same version code twice/],
    ['track', 'Only releases with status draft may be created on draft app.', /PLAY_RELEASE_STATUS=draft/],
    ['commit', 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.', /sent for review from Play Console/]
  ];
  for (const [failAt, message, advice] of cases) {
    const { calls, fetchImpl } = fakePlay({ failAt, failWith: message });
    await assert.rejects(
      uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', fetchImpl, now: NOW }),
      e => e instanceof PlayError && e.message.includes(message) && advice.test(e.message), failAt);
    const last = calls.at(-1);
    assert.equal(last.step, 'delete', failAt);
    assert.equal(last.path, '/androidpublisher/v3/applications/fit.tiza.app/edits/edit-1');
    if (failAt !== 'commit') assert.ok(!calls.some(c => c.step === 'commit'), failAt);
  }
});

test('an app that does not exist in Play yet, or an account without rights: no edit to delete, a pointer to the fix', async () => {
  let r = fakePlay({ failAt: 'edit', failWith: 'Package not found: fit.tiza.app.' });
  await assert.rejects(uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', fetchImpl: r.fetchImpl, now: NOW }), /uploaded by hand/);
  assert.ok(!r.calls.some(c => c.step === 'delete'));
  r = fakePlay({ failAt: 'token', failWith: 'invalid_grant' });
  await assert.rejects(uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', fetchImpl: r.fetchImpl, now: NOW }), /signing in as the service account: 400/);
  r = fakePlay({ failAt: 'edit', failWith: 'The caller does not have permission' });
  await assert.rejects(uploadToPlay({ sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', fetchImpl: r.fetchImpl, now: NOW }), /Users and permissions/);
});

test('bad input is refused before anything is sent', async () => {
  const { calls, fetchImpl } = fakePlay();
  const base = { sa: SA, packageName: 'fit.tiza.app', bundle: BUNDLE, track: 'alpha', fetchImpl, now: NOW };
  await assert.rejects(uploadToPlay({ ...base, packageName: 'not a package' }), PlayError);
  await assert.rejects(uploadToPlay({ ...base, status: 'inProgress' }), /completed or draft/);
  await assert.rejects(uploadToPlay({ ...base, bundle: Buffer.alloc(0) }), /empty/);
  await assert.rejects(uploadToPlay({ ...base, track: '' }), /no track/);
  assert.equal(calls.length, 0);
});

test('the key file must be a service account key', () => {
  assert.equal(readServiceAccount(JSON.stringify(SA)).client_email, SA.client_email);
  assert.throws(() => readServiceAccount('not json'), /not JSON/);
  assert.throws(() => readServiceAccount(JSON.stringify({ type: 'authorized_user', client_id: 'x' })), /not a service account key/);
});
