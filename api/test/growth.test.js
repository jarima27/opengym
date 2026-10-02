/* Codes and what they give (growth.js), and the feedback people send — the pure rules, then the
   routes against a real server.js with a fake Stripe behind STRIPE_API_BASE.

   The promises checked: a tester code makes a profile Pro for good, counts its uses and stops at
   its cap; a friend's invite gives 30 days to both sides — on the trial, after a store's paid-up
   period, or as a Stripe charge moved back — and no more than twelve times; a creator's or a
   friend's code can still be typed in during the first week, and never one's own; feedback lands
   in the admin's list with where it came from, and goes with the profile. */
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
import {
  kindOf, codeDays, redeemCheck, applyCode, rewardOwner, makeFriendCode, cleanFeedback, addFeedback,
  FRIEND_DAYS, MAX_FRIEND_REWARDS, FEEDBACK_KEEP
} from '../growth.js';
import { accessOf, billingConfig } from '../billing.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-05T12:00:00Z');
const iso = ms => new Date(ms).toISOString();

/* ------------------------------ the rules ------------------------------ */

test('three kinds of code, and what each gives a new profile', () => {
  assert.equal(kindOf({ code: 'LUCIA', days: 30 }), 'creator');
  assert.equal(kindOf({ kind: 'tester' }), 'tester');
  assert.equal(kindOf({ kind: 'friend' }), 'friend');
  assert.equal(codeDays({ days: 14 }), 14);
  assert.equal(codeDays({ kind: 'friend', days: 99 }), FRIEND_DAYS);
  assert.equal(codeDays({ kind: 'tester', days: 30 }), 0);
});

test('a tester code: Pro for good, at any time, counted, and stopped at its cap', () => {
  const row = { code: 'BETA', kind: 'tester', uses: 0, max: 2 };
  const old = { id: 'u1', created: iso(NOW - 300 * DAY) };
  assert.equal(redeemCheck(row, old, { now: NOW }), null, 'a year after signing up is fine');
  applyCode(row, old);
  assert.deepEqual([old.comp, old.compCode, row.uses], [true, 'BETA', 1]);
  assert.equal(redeemCheck(row, old, { now: NOW }), 'already');
  applyCode(row, { id: 'u2' });
  assert.equal(redeemCheck(row, { id: 'u3', created: iso(NOW) }, { now: NOW }), 'full');
  assert.equal(redeemCheck({ ...row, max: 0, uses: 999 }, { id: 'u3' }, { now: NOW }), null, 'no cap');
  assert.equal(redeemCheck({ ...row, revoked: true }, { id: 'u3' }, { now: NOW }), 'revoked');
  assert.equal(redeemCheck(null, { id: 'u3' }), 'unknown');
  // Billing reads it as the operator's own: never charged, the Coach on.
  const cfg = billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'p' });
  assert.deepEqual([accessOf(old, cfg, { now: NOW }).plan, accessOf(old, cfg, { now: NOW }).ai], ['free', true]);
});

test('a creator’s or a friend’s code after signing up: the first week only, once, and never one’s own', () => {
  const friend = { code: 'ANA-7K3P', kind: 'friend', owner: 'ana', days: 30 };
  const fresh = { id: 'bea', created: iso(NOW - 3 * DAY) };
  assert.equal(redeemCheck(friend, fresh, { now: NOW }), null);
  assert.equal(redeemCheck(friend, { id: 'ana', created: iso(NOW) }, { now: NOW }), 'own');
  assert.equal(redeemCheck(friend, { ...fresh, src: { ref: 'LUCIA' } }, { now: NOW }), 'used');
  assert.equal(redeemCheck(friend, { id: 'old', created: iso(NOW - 8 * DAY) }, { now: NOW }), 'late');
  assert.equal(applyCode(friend, fresh), 'ana', 'the owner to reward');
  assert.deepEqual([fresh.src.ref, fresh.bonusDays], ['ANA-7K3P', 30]);
  const creator = { code: 'LUCIA', days: 14 };
  const other = { id: 'c', created: iso(NOW) };
  assert.equal(applyCode(creator, other), null);
  assert.deepEqual([other.src.ref, other.bonusDays], ['LUCIA', 14]);
});

test('the friend who shared: 30 days after whatever free time is left, up to twelve friends', () => {
  const ana = { id: 'ana' };
  assert.equal(rewardOwner(ana, { now: NOW, freeUntil: NOW + 10 * DAY }), true);
  assert.equal(ana.bonusUntil, NOW + 40 * DAY, 'after the trial’s last ten days');
  assert.equal(rewardOwner(ana, { now: NOW }), true);
  assert.equal(ana.bonusUntil, NOW + 70 * DAY, 'and on from the last reward');
  // Billing reads the days as more open trial — for a profile whose trial ended long ago, too.
  const cfg = billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'p' });
  const lapsed = { id: 'l', created: iso(NOW - 400 * DAY) };
  rewardOwner(lapsed, { now: NOW, freeUntil: NOW - 300 * DAY });
  const a = accessOf(lapsed, cfg, { now: NOW });
  assert.deepEqual([a.plan, a.ai, a.trialDaysLeft], ['trial', true, 30]);
  // Moved back on Stripe instead: counted, not banked.
  const payer = { id: 'p' };
  assert.equal(rewardOwner(payer, { now: NOW, bank: false }), true);
  assert.equal(payer.bonusUntil, undefined);
  // The cap.
  const many = { id: 'm', invites: { signups: MAX_FRIEND_REWARDS, rewarded: MAX_FRIEND_REWARDS } };
  assert.equal(rewardOwner(many, { now: NOW }), false);
  assert.deepEqual(many.invites, { signups: MAX_FRIEND_REWARDS + 1, rewarded: MAX_FRIEND_REWARDS });
  assert.equal(many.bonusUntil, undefined);
});

test('a friend code is the name’s first letters and four that cannot be misread', () => {
  const seq = [Buffer.from([0, 1, 2, 3]), Buffer.from([4, 5, 6, 7])];
  const taken = c => c === 'ANAMARIA-ABCD';
  assert.equal(makeFriendCode({ name: 'Ana María López' }, taken, () => seq.shift()), 'ANAMARIA-EFGH');
  assert.match(makeFriendCode({ name: '李雷' }, () => false), /^TIZA-[A-HJ-NP-Z2-9]{4}$/);
});

test('feedback: the text and where it came from, trimmed; nothing kept from an empty one', () => {
  const row = cleanFeedback({ text: '  The rest timer\r\nis too quiet  ', version: '1.4.0', platform: 'ios', screen: 'settings', lang: 'es', extra: 'x' }, { id: 'u1' }, { now: NOW, id: 'f1' });
  assert.deepEqual(row, { id: 'f1', at: iso(NOW), uid: 'u1', text: 'The rest timer\nis too quiet', version: '1.4.0', platform: 'ios', screen: 'settings', lang: 'es', done: false });
  assert.equal(cleanFeedback({ text: '   ' }, { id: 'u1' }), null);
  assert.equal(cleanFeedback({ text: 'x', platform: 'windows95' }, { id: 'u1' }).platform, '');
  assert.equal(cleanFeedback({ text: 'y'.repeat(5000) }, { id: 'u1' }).text.length, 2000);
  const full = Array.from({ length: FEEDBACK_KEEP }, (_, i) => ({ id: String(i) }));
  const next = addFeedback(full, { id: 'new' });
  assert.equal(next.length, FEEDBACK_KEEP);
  assert.deepEqual([next[0].id, next.at(-1).id], ['1', 'new']);
});

/* ------------------------------ against the server ------------------------------ */

const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + DAY}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function fakeStripe(t) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, form: new URLSearchParams(body) });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url.startsWith('/v1/subscriptions/')) return res.end(JSON.stringify({ id: req.url.split('/').pop(), status: 'trialing' }));
      res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'no such route' } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${srv.address().port}`, calls };
}

async function startServer(t, { env = {}, users }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-growth-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  // Charging started long ago, so a trial runs from each profile's own sign-up.
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], billingSince: Date.now() - 500 * DAY }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', COACH_DISABLED: '1', MEDIA_UPLOADS: '0', STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const call = (p, { uid, method = 'GET', body } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body != null ? { 'Content-Type': 'application/json' } : {}) },
    ...(body != null ? { body: JSON.stringify(body) } : {})
  });
  const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return { call, stored };
}
const json = r => r.json();
const settle = async (cond, ms = 3000) => { for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); };

test('tester codes: made in Admin, redeemed in the app, counted, capped and revoked', async t => {
  const fake = await fakeStripe(t);
  const h = await startServer(t, {
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_ID: 'price_x', STRIPE_API_BASE: fake.base, ADMIN_UIDS: 'boss' },
    users: [{ id: 'boss', name: 'Boss', created: iso(Date.now() - 400 * DAY) },
      { id: 't1', name: 'Tess', created: iso(Date.now() - 400 * DAY) }, { id: 't2', name: 'Tom', created: iso(Date.now()) }, { id: 't3', name: 'Ty', created: iso(Date.now()) }]
  });
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'beta', kind: 'tester', label: 'Closed test', max: 2 } })).status, 200);
  assert.deepEqual(await json(await h.call('/api/code?c=BETA')), { code: 'BETA', days: 0, kind: 'tester' });
  assert.equal((await json(await h.call('/api/billing', { uid: 't1' }))).plan, 'expired');

  const redeem = (uid, code) => h.call('/api/redeem', { uid, method: 'POST', body: { code } });
  const r1 = await redeem('t1', ' beta ');
  assert.equal(r1.status, 200);
  const body = await json(r1);
  assert.deepEqual([body.kind, body.access.plan, body.access.ai], ['tester', 'free', true]);
  assert.equal((await json(await redeem('t1', 'BETA'))).code, 'already');
  assert.equal((await redeem('t2', 'BETA')).status, 200);
  const full = await redeem('t3', 'BETA');
  assert.deepEqual([full.status, (await json(full)).code], [409, 'full']);
  assert.equal((await h.call('/api/code?c=BETA')).status, 404, 'a full code reads as gone');
  assert.equal((await redeem('t3', 'NOPE')).status, 404);

  const codes = await json(await h.call('/api/admin/codes', { uid: 'boss' }));
  const row = codes.codes.find(c => c.code === 'BETA');
  assert.deepEqual([row.kind, row.uses, row.max, row.signups], ['tester', 2, 2, 2]);
  // Revoked: nobody new, nobody loses it.
  assert.equal((await h.call('/api/admin/codes/revoke', { uid: 'boss', method: 'POST', body: { code: 'BETA' } })).status, 200);
  assert.equal((await json(await redeem('t3', 'BETA'))).code, 'revoked');
  assert.equal((await json(await h.call('/api/billing', { uid: 't1' }))).plan, 'free');
  assert.equal((await redeem(null, 'BETA')).status, 401);
});

test('invite a friend: 30 days for the friend, 30 for whoever shared — a Stripe charge moved back for a payer', async t => {
  const fake = await fakeStripe(t);
  const periodEnd = Date.now() + 10 * DAY;
  const h = await startServer(t, {
    env: { STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_ID: 'price_x', STRIPE_API_BASE: fake.base, PASSWORD_LOGIN: '1', ADMIN_UIDS: 'boss' },
    users: [
      { id: 'boss', name: 'Boss', created: iso(Date.now() - 400 * DAY) },
      { id: 'ana', name: 'Ana María', created: iso(Date.now() - 20 * DAY) },
      { id: 'paz', name: 'Paz', created: iso(Date.now() - 400 * DAY), billing: { customer: 'cus_1', subscription: 'sub_9', status: 'active', periodEnd, at: Date.now() } }
    ]
  });
  const inv = await json(await h.call('/api/invite', { uid: 'ana' }));
  assert.match(inv.code, /^ANAMARIA-[A-Z2-9]{4}$/);
  assert.deepEqual([inv.days, inv.max, inv.signups, inv.rewarded, inv.active], [30, 12, 0, 0, true]);
  assert.equal((await json(await h.call('/api/invite', { uid: 'ana' }))).code, inv.code, 'one per person');
  assert.deepEqual(await json(await h.call('/api/code?c=' + inv.code)), { code: inv.code, days: 30, kind: 'friend' });

  // Bea signs up with Ana's link: 30 + 30 days of trial; Ana's ten days left become forty.
  const r = await h.call('/api/register/password', { method: 'POST', body: { name: 'Bea', password: 'correct horse battery staple', src: { ref: inv.code.toLowerCase() } } });
  assert.equal(r.status, 200);
  const bea = (await r.json()).user.id;
  assert.equal((await json(await h.call('/api/billing', { uid: bea }))).trialDaysLeft, 60);
  assert.equal((await json(await h.call('/api/billing', { uid: 'ana' }))).trialDaysLeft, 40);
  const after = await json(await h.call('/api/invite', { uid: 'ana' }));
  assert.deepEqual([after.signups, after.rewarded], [1, 1]);

  // Paz pays on Stripe: her next charge moves back 30 days instead.
  const paz = await json(await h.call('/api/invite', { uid: 'paz' }));
  const r2 = await h.call('/api/register/password', { method: 'POST', body: { name: 'Cris', password: 'correct horse battery staple', src: { ref: paz.code } } });
  assert.equal(r2.status, 200);
  await settle(() => fake.calls.some(c => c.url === '/v1/subscriptions/sub_9'));
  const moved = fake.calls.find(c => c.url === '/v1/subscriptions/sub_9');
  assert.equal(moved.method, 'POST');
  assert.equal(moved.form.get('trial_end'), String(Math.floor((periodEnd + 30 * DAY) / 1000)));
  assert.equal(moved.form.get('proration_behavior'), 'none');
  assert.equal(h.stored().users.find(u => u.id === 'paz').bonusUntil, undefined, 'not banked as well');

  // Typed in later, within the first week; never one's own.
  const r3 = await h.call('/api/register/password', { method: 'POST', body: { name: 'Dani', password: 'correct horse battery staple' } });
  const daniId = (await r3.json()).user.id;
  assert.equal((await json(await h.call('/api/redeem', { uid: 'ana', method: 'POST', body: { code: inv.code } }))).code, 'own');
  const red = await h.call('/api/redeem', { uid: daniId, method: 'POST', body: { code: inv.code } });
  assert.equal(red.status, 200);
  assert.equal((await json(await h.call('/api/billing', { uid: daniId }))).trialDaysLeft, 60);
  assert.equal((await json(await h.call('/api/invite', { uid: 'ana' }))).rewarded, 2);
  assert.equal((await json(await h.call('/api/redeem', { uid: daniId, method: 'POST', body: { code: paz.code } }))).code, 'used');

  // The admin sees the invites summed up, not a row per person.
  const codes = await json(await h.call('/api/admin/codes', { uid: 'boss' }));
  assert.equal(codes.codes.some(c => c.kind === 'friend'), false);
  assert.deepEqual([codes.friends.codes, codes.friends.signups, codes.friends.rewarded], [2, 3, 3]);
});

test('without billing there is nothing to redeem and nothing to invite to', async t => {
  const h = await startServer(t, { users: [{ id: 'u1', name: 'U', created: iso(Date.now()) }] });
  assert.equal((await h.call('/api/invite', { uid: 'u1' })).status, 404);
  assert.equal((await h.call('/api/redeem', { uid: 'u1', method: 'POST', body: { code: 'X' } })).status, 404);
});

test('feedback: sent from the app, read and closed in Admin, gone with the profile', async t => {
  const h = await startServer(t, {
    env: { ADMIN_UIDS: 'boss' },
    users: [{ id: 'boss', name: 'Boss', created: iso(Date.now()) }, { id: 'u1', name: 'Uma', created: iso(Date.now()), email: 'uma@example.com' }]
  });
  const send = body => h.call('/api/feedback', { uid: 'u1', method: 'POST', body });
  assert.equal((await h.call('/api/feedback', { method: 'POST', body: { text: 'hi' } })).status, 401);
  assert.equal((await json(await send({ text: '  ' }))).code, 'empty');
  assert.equal((await send({ text: 'Love the calibration', version: '1.4.0', platform: 'ios', screen: 'first-workout', lang: 'es' })).status, 200);
  assert.equal((await send({ text: 'Rest timer too quiet', version: '1.4.0', platform: 'web', screen: 'settings' })).status, 200);
  assert.equal((await h.call('/api/admin/feedback', { uid: 'u1' })).status, 403);

  const list = await json(await h.call('/api/admin/feedback', { uid: 'boss' }));
  assert.equal(list.open, 2);
  assert.deepEqual(list.feedback.map(f => f.text), ['Rest timer too quiet', 'Love the calibration'], 'newest first');
  assert.deepEqual([list.feedback[1].name, list.feedback[1].email, list.feedback[1].platform, list.feedback[1].screen, list.feedback[1].version],
    ['Uma', 'uma@example.com', 'ios', 'first-workout', '1.4.0']);
  assert.equal((await h.call('/api/admin/feedback/done', { uid: 'boss', method: 'POST', body: { id: list.feedback[0].id } })).status, 200);
  assert.equal((await json(await h.call('/api/admin/feedback', { uid: 'boss' }))).feedback.length, 1);
  assert.equal((await json(await h.call('/api/admin/feedback?all=1', { uid: 'boss' }))).feedback.length, 2);

  // Deleting the account takes what they wrote with it.
  assert.equal((await h.call('/api/account/delete', { uid: 'u1', method: 'POST', body: { confirm: 'Uma' } })).status, 200);
  assert.equal(h.stored().feedback.length, 0);
});
