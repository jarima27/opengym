/* Sign in with Apple / Google for the store app (social.js): a provider's ID token is believed
   only once its signature, issuer, audience and expiry check out; a provider account opens the
   same profile every time and never one found by e-mail; and the app — over native HTTP, with
   no Origin — gets its session as a bearer token, while a browser never does. Against a fake
   key server, with tokens signed by a key made here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { socialConfig, createKeySet, verifyIdToken, SocialError, nameFor } from '../social.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const NOW = Date.parse('2026-10-01T12:00:00Z');
const sec = ms => Math.floor(ms / 1000);

function jwt(claims, { key = privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg, kid, typ: 'JWT' }) + '.' + enc(claims);
  return head + '.' + crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url');
}
const apple = (over = {}, now = NOW) => ({ iss: 'https://appleid.apple.com', aud: 'fit.tiza.app', sub: '001234.abcd', iat: sec(now), exp: sec(now) + 600, email: 'ada@privaterelay.appleid.com', ...over });
const google = (over = {}, now = NOW) => ({ iss: 'https://accounts.google.com', aud: 'web-client.apps.googleusercontent.com', sub: '1099', iat: sec(now), exp: sec(now) + 3600, email: 'ada@gmail.com', email_verified: true, given_name: 'Ada', ...over });

/* ------------------------------ verification ------------------------------ */

test('configured providers, from their client ids', () => {
  assert.deepEqual(socialConfig({}), {});
  assert.deepEqual(socialConfig({ APPLE_CLIENT_IDS: 'fit.tiza.app', GOOGLE_CLIENT_IDS: 'a, b' }), { apple: ['fit.tiza.app'], google: ['a', 'b'] });
});

test('an ID token is believed only when everything checks out', async () => {
  const key = async kid => { if (kid !== 'k1') throw new SocialError('bad-token'); return publicKey; };
  const check = (t, provider = 'apple', audiences = ['fit.tiza.app']) => verifyIdToken(t, { provider, audiences, key, now: () => NOW });

  assert.equal((await check(jwt(apple()))).sub, '001234.abcd');
  assert.equal((await check(jwt(google()), 'google', ['web-client.apps.googleusercontent.com'])).sub, '1099');
  assert.equal((await check(jwt(google({ iss: 'accounts.google.com' })), 'google', ['web-client.apps.googleusercontent.com'])).sub, '1099');

  const refused = async (t, why, ...rest) => assert.rejects(check(t, ...rest), e => e instanceof SocialError && e.code === 'bad-token', why);
  await refused(jwt(apple(), { key: other.privateKey }), 'signed by someone else');
  await refused(jwt(apple(), { kid: 'nope' }), 'an unknown key');
  await refused(jwt(apple({ aud: 'com.someone.else' })), 'for another app');
  await refused(jwt(apple({ iss: 'https://evil.example' })), 'from another issuer');
  await refused(jwt(google()), 'a Google token sent as Apple');
  await refused(jwt(apple({ exp: sec(NOW) - 600 })), 'expired');
  await refused(jwt(apple({ iat: sec(NOW) + 3600 })), 'from the future');
  await refused(jwt(apple({ sub: '' })), 'no subject');
  await refused(jwt(apple(), { alg: 'none' }), 'another algorithm');
  await refused('not.a.jwt', 'garbage');
  await refused(undefined, 'nothing');
  const [h, , sig] = jwt(apple()).split('.');
  await refused([h, Buffer.from(JSON.stringify(apple({ sub: 'someone-else' }))).toString('base64url'), sig].join('.'), 'claims changed after signing');
});

test('the provider’s keys are fetched once, again for a new key id at most every minute', async () => {
  let clock = NOW, calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ keys: [JWK] }) }; };
  const key = createKeySet('https://keys.test', { fetchImpl, now: () => clock });
  await key('k1'); await key('k1');
  assert.equal(calls, 1);
  await assert.rejects(key('rotated'), SocialError);
  assert.equal(calls, 1, 'just fetched: an unknown id is not a reason to ask again yet');
  clock += 61000;
  await assert.rejects(key('rotated'), SocialError);
  assert.equal(calls, 2);
  clock += 7 * 3600000;
  await key('k1');
  assert.equal(calls, 3, 'refreshed after a few hours');
});

test('a new profile’s name: what the person gave, else the provider’s, else a placeholder', () => {
  assert.equal(nameFor({ name: '  Ada   Lovelace ' }, {}), 'Ada Lovelace');
  assert.equal(nameFor({}, { given_name: 'Ada' }), 'Ada');
  assert.equal(nameFor({}, {}), 'Tiza');
});

/* ------------------------------ against server.js ------------------------------ */

async function keyServer(t) {
  const srv = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [JWK] })); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return `http://127.0.0.1:${srv.address().port}/keys`;
}

async function startServer(t, env, users = []) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-social-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0', APPLE_CLIENT_IDS: '', GOOGLE_CLIENT_IDS: '', PASSWORD_LOGIN: '', INVITE_ONLY: '', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const post = (p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = (p, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, { headers });
  return { post, get, dataDir };
}

test('signing in with Apple from the app: a profile, the same one next time, and a bearer token', async t => {
  const keys = await keyServer(t);
  // Real tokens are minted now; the server checks them against its own clock.
  const now = Date.now();
  const h = await startServer(t, {
    APPLE_CLIENT_IDS: 'fit.tiza.app', GOOGLE_CLIENT_IDS: 'web-client.apps.googleusercontent.com', APPLE_JWKS_URL: keys, GOOGLE_JWKS_URL: keys,
    PASSWORD_LOGIN: '1'
  }, [{ id: 'victim', name: 'Ada', created: new Date().toISOString(), email: 'ada@gmail.com' }]);

  assert.deepEqual((await (await h.get('/api/config')).json()).social, ['apple', 'google']);

  // The app, over native HTTP: no Origin, no Sec-Fetch-Site.
  const first = await h.post('/api/login/social', { provider: 'apple', idToken: jwt(apple({}, now)), name: 'Ada L', token: true });
  assert.equal(first.status, 200);
  const a = await first.json();
  assert.equal(a.created, true);
  assert.equal(a.user.name, 'Ada L');
  assert.ok(a.token, 'the app gets its session as a token');
  // The token works as a bearer session.
  const me = await (await h.get('/api/me', { Authorization: 'Bearer ' + a.token })).json();
  assert.equal(me.user.id, a.user.id);

  const again = await (await h.post('/api/login/social', { provider: 'apple', idToken: jwt(apple({}, now)), token: true })).json();
  assert.equal(again.created, false);
  assert.equal(again.user.id, a.user.id);

  // Google, with the address of an existing profile on it: a profile of its own, never that one.
  const g = await (await h.post('/api/login/social', { provider: 'google', idToken: jwt(google({}, now)), token: true })).json();
  assert.equal(g.created, true);
  assert.notEqual(g.user.id, 'victim');
  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  const stored = db.users.find(u => u.id === g.user.id);
  assert.deepEqual(stored.oauth, { google: '1099' });
  assert.equal(stored.email, undefined, 'the provider’s address is not kept');

  // Refused: a forged token, a provider not configured, a cross-site page.
  assert.equal((await h.post('/api/login/social', { provider: 'apple', idToken: jwt(apple({}, now), { key: other.privateKey }) })).status, 401);
  assert.equal((await h.post('/api/login/social', { provider: 'facebook', idToken: 'x' })).status, 400);
  assert.equal((await h.post('/api/login/social', { provider: 'apple', idToken: jwt(apple({}, now)) }, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('a browser never gets the token, even asking for it; the app does, for passwords too', async t => {
  const h = await startServer(t, { PASSWORD_LOGIN: '1' });
  const body = { name: 'Grace', password: 'correct horse battery staple', token: true };
  const fromApp = await (await h.post('/api/register/password', body)).json();
  assert.ok(fromApp.token);
  const login = await (await h.post('/api/login/password', { identifier: 'Grace', password: body.password, token: true })).json();
  assert.ok(login.token);
  const fromBrowser = await h.post('/api/login/password', { identifier: 'Grace', password: body.password, token: true }, { Origin: 'http://localhost:8080', 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(fromBrowser.status, 200);
  assert.equal((await fromBrowser.json()).token, undefined);
  assert.match(fromBrowser.headers.get('set-cookie') || '', /gymsid=/);
});

test('without client ids the route does not exist', async t => {
  const h = await startServer(t, {});
  assert.equal((await h.post('/api/login/social', { provider: 'apple', idToken: 'x' })).status, 404);
  assert.equal('social' in await (await h.get('/api/config')).json(), false);
});
