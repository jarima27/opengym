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
  FRIEND_DAYS, MAX_FRIEND_REWARDS, FEEDBACK_KEEP, whoOf, ledgerAdd, ledgerMonths, creatorReport, creatorReportByMonth, codeForOffer
} from '../growth.js';
import { accessOf, billingConfig, campaignAttributes, revenueCatCreatorFacts, stripeRefundOf } from '../billing.js';

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

/* ------------------------------ the creator program ------------------------------ */

test('the creator ledger: each milestone once per profile and code, refunds each time, retries once', () => {
  const who = whoOf('u1', 'k')
  assert.equal(who, whoOf('u1', 'k'));
  assert.notEqual(who, whoOf('u2', 'k'));
  assert.ok(!who.includes('u1'), 'the profile is a keyed hash, not its id');
  let l = [];
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'signup', at: '2026-09-20T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'signup', at: '2026-09-21T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'trial', at: '2026-09-21T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'paid', at: '2026-10-01T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'paid', at: '2026-11-01T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'refund', at: '2026-10-03T10:00:00Z', id: 'evt_1' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'refund', at: '2026-10-03T10:00:00Z', id: 'evt_1' });
  l = ledgerAdd(l, { code: 'LUCIA', who: whoOf('u2', 'k'), kind: 'signup', at: '2026-10-02T10:00:00Z' });
  l = ledgerAdd(l, { code: 'LUCIA', who, kind: 'bogus' });
  assert.deepEqual(l.map(e => e.kind), ['signup', 'trial', 'paid', 'refund', 'signup']);
  assert.deepEqual(ledgerMonths(l), ['2026-10', '2026-09']);
  const codes = [{ code: 'LUCIA', label: 'Lucía (IG)', days: 14, appleOffer: 'LUCIA30' }, { code: 'PACO', days: 7 }, { code: 'BETA', kind: 'tester' }, { code: 'ANA-7K3P', kind: 'friend' }];
  const all = creatorReport(l, codes);
  assert.deepEqual(all.map(r => r.code), ['LUCIA', 'PACO'], 'creators only; one who brought nobody is listed at zero');
  assert.deepEqual(all[0], { code: 'LUCIA', label: 'Lucía (IG)', days: 14, appleOffer: 'LUCIA30', revoked: false, signups: 2, trials: 1, paying: 1, refunds: 1 });
  const oct = creatorReport(l, codes, { month: '2026-10' })[0];
  assert.deepEqual([oct.signups, oct.trials, oct.paying, oct.refunds], [1, 0, 1, 1]);
  const sep = creatorReport(l, codes, { month: '2026-09' })[0];
  assert.deepEqual([sep.signups, sep.trials, sep.paying, sep.refunds], [1, 1, 0, 0]);
  // Every month at once: only the months a code had anything in.
  assert.deepEqual(creatorReportByMonth(l, codes).map(r => [r.month, r.code, r.signups, r.paying]), [['2026-10', 'LUCIA', 1, 1], ['2026-09', 'LUCIA', 1, 0]]);
});

test('an Apple offer code stands for its creator, and gives nothing here — Apple gives it', () => {
  const codes = [{ code: 'LUCIA', days: 14, appleOffer: 'LUCIA30' }, { code: 'OLD', appleOffer: 'OLD1', revoked: true }, { code: 'BETA', kind: 'tester' }];
  assert.equal(codeForOffer(codes, 'lucia30').code, 'LUCIA');
  assert.equal(codeForOffer(codes, 'LUCIA').code, 'LUCIA', 'or the creator’s own code, made the same in App Store Connect');
  assert.equal(codeForOffer(codes, 'OLD1'), null);
  assert.equal(codeForOffer(codes, 'BETA'), null);
  assert.equal(codeForOffer(codes, ''), null);
  const u = { id: 'u', created: iso(NOW) };
  applyCode(codes[0], u, { apple: true });
  assert.deepEqual([u.src.ref, u.bonusDays], ['LUCIA', undefined]);
});

test('what a store says for the program: a refund, the offer code; RevenueCat’s campaign attribute', () => {
  const users = [{ id: 'u1', billing: { customer: 'cus_1' } }];
  const f = revenueCatCreatorFacts(users, { event: { id: 'e1', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: 'u1', event_timestamp_ms: NOW } });
  assert.deepEqual([f.user.id, f.refund, f.offer, f.id, f.at], ['u1', true, null, 'e1', NOW]);
  assert.equal(revenueCatCreatorFacts(users, { event: { type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE', app_user_id: 'u1' } }).refund, false);
  assert.equal(revenueCatCreatorFacts(users, { event: { type: 'INITIAL_PURCHASE', offer_code: ' LUCIA30 ', app_user_id: 'u1' } }).offer, 'LUCIA30');
  assert.equal(revenueCatCreatorFacts(users, { event: { type: 'INITIAL_PURCHASE', app_user_id: 'nobody' } }), null);
  assert.equal(stripeRefundOf(users, { id: 'evt_9', type: 'charge.refunded', created: NOW / 1000, data: { object: { customer: 'cus_1' } } }).user.id, 'u1');
  assert.equal(stripeRefundOf(users, { type: 'charge.succeeded', data: { object: { customer: 'cus_1' } } }), null);
  assert.deepEqual(campaignAttributes('LUCIA', NOW), { attributes: { $campaign: { value: 'LUCIA', updated_at_ms: NOW }, $mediaSource: { value: 'creator', updated_at_ms: NOW } } });
});

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
  return { call, stored, base: `http://127.0.0.1:${port}` };
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

test('the creator program: counted at sign-up, typed in or redeemed at Apple; trials, payments and refunds by month', async t => {
  // RevenueCat's API: what the server tells it about each profile's campaign.
  const rc = [];
  const rcApi = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      rc.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.setHeader('Content-Type', 'application/json'); res.end('{}');
    });
  });
  await new Promise(r => rcApi.listen(0, '127.0.0.1', r));
  t.after(() => rcApi.close());
  const h = await startServer(t, {
    env: {
      ADMIN_UIDS: 'boss', PASSWORD_LOGIN: '1', REVENUECAT_WEBHOOK_AUTH: 'Bearer hook', REVENUECAT_SECRET_KEY: 'sk_rc',
      REVENUECAT_API_BASE: `http://127.0.0.1:${rcApi.address().port}`
    },
    users: [{ id: 'boss', name: 'Boss', created: iso(Date.now() - 400 * DAY) }, { id: 'old', name: 'Olga', created: iso(Date.now() - 40 * DAY) },
      { id: 'ios1', name: 'Iris', created: iso(Date.now()) }]
  });
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'lucia', label: 'Lucía', days: 14, appleOffer: 'lucia30' } })).status, 200);
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'PACO', days: 7, appleOffer: 'no spaces' } })).status, 400);
  assert.equal((await h.call('/api/admin/codes/apple', { uid: 'boss', method: 'POST', body: { code: 'LUCIA', appleOffer: 'LUCIA30' } })).status, 200);

  // 1. A sign-up through her link (or the Play Store's install referrer): counted, and her code
  //    goes to RevenueCat as the profile's campaign.
  const r = await h.call('/api/register/password', { method: 'POST', body: { name: 'Carla', password: 'correct horse battery staple', src: { ref: 'LUCIA', platform: 'android' } } });
  assert.equal(r.status, 200);
  const carla = h.stored().users.find(u => u.name === 'Carla');
  assert.deepEqual([carla.src.ref, carla.bonusDays], ['LUCIA', 14]);
  await settle(() => rc.length > 0);
  assert.deepEqual(rc[0], { method: 'POST', url: `/v1/subscribers/${carla.id}/attributes`, auth: 'Bearer sk_rc', body: { attributes: { $campaign: { value: 'LUCIA', updated_at_ms: rc[0].body.attributes.$campaign.updated_at_ms }, $mediaSource: { value: 'creator', updated_at_ms: rc[0].body.attributes.$campaign.updated_at_ms } } } });

  // 2. Her trial in the store, its first paid period, and a refund (a retried webhook once).
  const hook = event => fetch(h.base + '/api/billing/revenuecat', { method: 'POST', headers: { Authorization: 'Bearer hook', 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
  const at = Date.now();
  const base = { app_user_id: carla.id, entitlement_ids: ['pro'], store: 'PLAY_STORE', product_id: 'tiza_annual' };
  assert.equal((await hook({ ...base, id: 'e1', type: 'INITIAL_PURCHASE', period_type: 'TRIAL', expiration_at_ms: at + 7 * DAY, event_timestamp_ms: at })).status, 200);
  await hook({ ...base, id: 'e2', type: 'RENEWAL', period_type: 'NORMAL', expiration_at_ms: at + 372 * DAY, event_timestamp_ms: at + 1000 });
  await hook({ ...base, id: 'e3', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', period_type: 'NORMAL', expiration_at_ms: at + 2000, event_timestamp_ms: at + 2000 });
  await hook({ ...base, id: 'e3', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', period_type: 'NORMAL', expiration_at_ms: at + 2000, event_timestamp_ms: at + 2000 });

  // 3. Her Apple offer code, redeemed straight in the App Store by someone already signed up.
  await hook({ app_user_id: 'old', entitlement_ids: ['pro'], store: 'APP_STORE', id: 'e4', type: 'INITIAL_PURCHASE', period_type: 'TRIAL', offer_code: 'LUCIA30', expiration_at_ms: at + 30 * DAY, event_timestamp_ms: at });
  const olga = h.stored().users.find(u => u.id === 'old');
  assert.deepEqual([olga.src?.ref, olga.bonusDays], ['LUCIA', undefined], 'Apple gave the free time; here she is only counted');

  // 4. Her code typed in on an iPhone: redeemed at Apple, counted here, no days here.
  const red = await json(await h.call('/api/redeem', { uid: 'ios1', method: 'POST', body: { code: 'lucia', platform: 'ios' } }));
  assert.deepEqual([red.kind, red.days, red.appleOffer], ['creator', 0, 'LUCIA30']);
  assert.equal((await json(await h.call('/api/billing', { uid: 'ios1' }))).ref, 'LUCIA');
  assert.equal(h.stored().users.find(u => u.id === 'ios1').bonusDays, undefined);

  // The report: three people under her code, one trial (Olga's came with the code), one payer, one refund.
  const month = new Date().toISOString().slice(0, 7);
  const rep = await json(await h.call('/api/admin/creators?month=' + month, { uid: 'boss' }));
  assert.deepEqual(rep.months, [month]);
  const row = rep.rows.find(x => x.code === 'LUCIA');
  assert.deepEqual([row.signups, row.trials, row.paying, row.refunds, row.appleOffer], [3, 2, 1, 1, 'LUCIA30']);
  assert.deepEqual((await json(await h.call('/api/admin/creators?month=1999-01', { uid: 'boss' }))).rows.find(x => x.code === 'LUCIA').signups, 0);
  assert.equal((await h.call('/api/admin/creators', { uid: 'ios1' })).status, 403);
  assert.ok(!JSON.stringify(h.stored().creatorEvents).includes(carla.id), 'the ledger knows people only by a keyed hash');
});
