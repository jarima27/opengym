/* Paid access (billing.js): who has the AI, what a Stripe event changes, and the four routes
   against a real server.js with a fake Stripe behind STRIPE_API_BASE.

   The promises checked here are the ones a person paying (or not) would notice: a trial that
   counts from the day charging started rather than from an old sign-up, a subscription taken out
   mid-trial that does not charge before the trial ends, a late webhook that cannot undo a newer
   one, a signature that has to verify, a deleted profile that stops being charged — and an
   instance without Stripe keys that behaves exactly as it always has. */
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
import { billingConfig, accessOf, checkoutForm, verifyWebhook, applyEvent, TOLERANCE_S } from '../billing.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const ON = billingConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
const iso = ms => new Date(ms).toISOString();

const sign = (body, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

/* ------------------------------ config ------------------------------ */

test('billing is off unless both the key and the price are set', () => {
  assert.equal(billingConfig({}).on, false);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk' }).on, false);
  assert.equal(billingConfig({ STRIPE_PRICE_ID: 'price' }).on, false);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' }).on, true);
  assert.equal(billingConfig({}).trialDays, 30);
  assert.equal(billingConfig({ TRIAL_DAYS: '14' }).trialDays, 14);
  assert.equal(billingConfig({ TRIAL_DAYS: 'nonsense' }).trialDays, 30);
  assert.equal(billingConfig({ TRIAL_DAYS: '-3' }).trialDays, 30);
});

/* ------------------------------ access ------------------------------ */

test('off: everybody has the AI and nothing else is said', () => {
  assert.deepEqual(accessOf({ id: 'u', created: iso(0) }, billingConfig({}), { now: NOW }), { on: false, ai: true });
});

test('the trial runs from sign-up, or from the day charging started if that is later', () => {
  const fresh = { id: 'u', created: iso(NOW - 10 * DAY) };
  const a = accessOf(fresh, ON, { now: NOW, since: 0 });
  assert.equal(a.plan, 'trial');
  assert.equal(a.ai, true);
  assert.equal(a.trialDaysLeft, 20);
  assert.equal(a.trialEnds, iso(NOW + 20 * DAY));

  // Signed up a year ago, before the operator switched charging on five days ago.
  const old = { id: 'u', created: iso(NOW - 365 * DAY) };
  assert.equal(accessOf(old, ON, { now: NOW, since: NOW - 5 * DAY }).trialDaysLeft, 25);
  assert.equal(accessOf(old, ON, { now: NOW, since: 0 }).plan, 'expired');
  assert.equal(accessOf(old, ON, { now: NOW, since: 0 }).ai, false);
});

test('a paying status keeps the AI on after the trial; a dead one does not', () => {
  const old = s => ({ id: 'u', created: iso(0), billing: { customer: 'cus_1', subscription: 'sub_1', status: s } });
  for (const s of ['active', 'trialing']) assert.deepEqual([accessOf(old(s), ON, { now: NOW }).plan, accessOf(old(s), ON, { now: NOW }).ai], ['active', true], s);
  // Stripe is retrying the card: still on, and said so.
  assert.deepEqual([accessOf(old('past_due'), ON, { now: NOW }).plan, accessOf(old('past_due'), ON, { now: NOW }).ai], ['past_due', true]);
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    assert.deepEqual([accessOf(old(s), ON, { now: NOW }).plan, accessOf(old(s), ON, { now: NOW }).ai], ['expired', false], s);
  }
  assert.equal(accessOf(old('canceled'), ON, { now: NOW }).portal, true, 'a customer can still reach the portal');
});

test('admins and profiles marked comp are never charged', () => {
  const old = { id: 'u', created: iso(0) };
  assert.equal(accessOf(old, ON, { now: NOW, staff: true }).plan, 'free');
  assert.equal(accessOf({ ...old, comp: true }, ON, { now: NOW }).ai, true);
});

/* ------------------------------ checkout ------------------------------ */

test('subscribing mid-trial does not charge before the trial would have ended', () => {
  const u = { id: 'uid1', created: iso(NOW - 10 * DAY), email: 'a@b.c' };
  const f = checkoutForm(u, ON, { origin: 'https://gym.example/', now: NOW });
  assert.equal(f.get('mode'), 'subscription');
  assert.equal(f.get('line_items[0][price]'), 'price_x');
  assert.equal(f.get('client_reference_id'), 'uid1');
  assert.equal(f.get('subscription_data[metadata][uid]'), 'uid1');
  assert.equal(f.get('customer_email'), 'a@b.c');
  assert.equal(f.get('success_url'), 'https://gym.example/#/settings');
  assert.equal(f.get('subscription_data[trial_end]'), String(Math.floor((NOW + 20 * DAY) / 1000)));

  // Under 48 hours left is under Stripe's minimum: no trial_end, the charge is today.
  const late = checkoutForm({ id: 'u2', created: iso(NOW - 29 * DAY) }, ON, { origin: 'https://gym.example', now: NOW });
  assert.equal(late.has('subscription_data[trial_end]'), false);

  // A returning customer is reused rather than duplicated, and the e-mail is then not sent.
  const back = checkoutForm({ id: 'u3', created: iso(0), email: 'a@b.c', billing: { customer: 'cus_9', status: 'canceled' } }, ON, { origin: 'x', now: NOW });
  assert.equal(back.get('customer'), 'cus_9');
  assert.equal(back.has('customer_email'), false);
});

/* ------------------------------ webhook signature ------------------------------ */

test('a webhook verifies only with the right secret, the exact bytes and a fresh timestamp', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } });
  const now = Date.now();
  const t = Math.floor(now / 1000);
  assert.equal(verifyWebhook(Buffer.from(body), sign(body, 'whsec_x', t), 'whsec_x', now).id, 'evt_1');
  assert.equal(verifyWebhook(Buffer.from(body), sign(body, 'whsec_other', t), 'whsec_x', now), null, 'wrong secret');
  assert.equal(verifyWebhook(Buffer.from(body + ' '), sign(body, 'whsec_x', t), 'whsec_x', now), null, 'bytes changed');
  assert.equal(verifyWebhook(Buffer.from(body), sign(body, 'whsec_x', t - TOLERANCE_S - 1), 'whsec_x', now), null, 'replayed');
  assert.equal(verifyWebhook(Buffer.from(body), sign(body, 'whsec_x', t), '', now), null, 'no secret configured');
  assert.equal(verifyWebhook(Buffer.from(body), 'garbage', 'whsec_x', now), null);
  // Stripe sends one v1 per active secret while one is being rolled: any of them may match.
  const both = `t=${t},v1=${'0'.repeat(64)},` + sign(body, 'whsec_x', t).split(',')[1];
  assert.equal(verifyWebhook(Buffer.from(body), both, 'whsec_x', now).id, 'evt_1');
});

/* ------------------------------ events ------------------------------ */

const subEvent = (type, created, o) => ({ type, created, data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { uid: 'u1' }, ...o } } });

test('checkout links the customer; subscription events carry the status', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  const r = applyEvent(users, { type: 'checkout.session.completed', created: 1, data: { object: { mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1' } } });
  assert.equal(r.user.id, 'u1');
  assert.deepEqual(users[0].billing, { customer: 'cus_1', subscription: 'sub_1' });

  applyEvent(users, subEvent('customer.subscription.created', 2, { status: 'trialing', current_period_end: 2000 }));
  assert.equal(users[0].billing.status, 'trialing');
  assert.equal(users[0].billing.periodEnd, 2000 * 1000);
  // Newer API versions put the period on the item instead.
  applyEvent(users, subEvent('customer.subscription.updated', 3, { status: 'active', items: { data: [{ current_period_end: 3000 }] } }));
  assert.equal(users[0].billing.periodEnd, 3000 * 1000);
});

test('an event older than the one applied is ignored', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  applyEvent(users, subEvent('customer.subscription.updated', 100, { status: 'canceled' }));
  assert.equal(applyEvent(users, subEvent('customer.subscription.updated', 50, { status: 'active' })), null);
  assert.equal(users[0].billing.status, 'canceled');
});

test('a profile is found by customer when the subscription carries no uid', () => {
  const users = [{ id: 'u1', created: iso(0), billing: { customer: 'cus_1' } }];
  const r = applyEvent(users, { type: 'customer.subscription.updated', created: 1, data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active' } } });
  assert.equal(r.user.id, 'u1');
  assert.equal(r.was, null);
  assert.equal(users[0].billing.status, 'active');
});

test('deleted means canceled; a scheduled cancellation is shown as its end date', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  applyEvent(users, subEvent('customer.subscription.updated', 1, { status: 'active', current_period_end: 5000, cancel_at_period_end: true }));
  assert.equal(users[0].billing.endsAt, 5000 * 1000);
  const r = applyEvent(users, subEvent('customer.subscription.deleted', 2, { status: 'active' }));
  assert.equal(r.was, 'active');
  assert.equal(users[0].billing.status, 'canceled');
});

test('a second, dead subscription does not overwrite the live one', () => {
  const users = [{ id: 'u1', created: iso(0), billing: { customer: 'cus_1', subscription: 'sub_1', status: 'active', at: 5 } }];
  assert.equal(applyEvent(users, subEvent('customer.subscription.updated', 9, { id: 'sub_2', status: 'incomplete_expired' })), null);
  assert.equal(users[0].billing.subscription, 'sub_1');
});

test('events for nobody on this instance, and other event types, change nothing', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  assert.equal(applyEvent(users, subEvent('customer.subscription.updated', 1, { metadata: { uid: 'someone-else' }, customer: 'cus_x' })), null);
  assert.equal(applyEvent(users, { type: 'invoice.paid', created: 1, data: { object: { customer: 'cus_1' } } }), null);
  assert.equal(applyEvent(users, { type: 'checkout.session.completed', created: 1, data: { object: { mode: 'payment', client_reference_id: 'u1' } } }), null);
  assert.equal(users[0].billing, undefined);
});

/* ------------------------------ the routes, against a real server ------------------------------ */

const SECRET = crypto.randomBytes(32).toString('hex');
const WHSEC = 'whsec_test_' + crypto.randomBytes(8).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + DAY}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

/** A stand-in for api.stripe.com that records what it was asked. */
async function fakeStripe(t) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, form: new URLSearchParams(body) });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
      if (req.url === '/v1/billing_portal/sessions') return res.end(JSON.stringify({ id: 'bps_1', url: 'https://billing.stripe.test/p_1' }));
      if (req.method === 'DELETE' && req.url.startsWith('/v1/subscriptions/')) return res.end(JSON.stringify({ id: req.url.split('/').pop(), status: 'canceled' }));
      res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'no such route' } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${srv.address().port}`, calls };
}

async function startServer(t, { env = {}, users, db = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-billing-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], ...db }));
  fs.writeFileSync(path.join(dataDir, 'coach.json'), JSON.stringify({ enabled: true, provider: 'fixture' }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      COACH_DISABLED: '', MEDIA_UPLOADS: '0', STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', STRIPE_WEBHOOK_SECRET: '', ...env
    }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const api = `http://127.0.0.1:${port}`;
  const call = (p, { uid, method = 'GET', body, headers = {} } = {}) => fetch(api + p, {
    method,
    headers: { ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}), ...(body != null ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body != null ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
  return { api, call, dataDir, log: () => log };
}

const stripeEnv = base => ({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_ID: 'price_fake', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: base });
const LONG_AGO = iso(Date.now() - 400 * DAY);

test('without Stripe keys none of it exists and the Coach is not gated', async t => {
  const h = await startServer(t, { users: [{ id: 'old', name: 'O', created: LONG_AGO }] });
  assert.equal((await h.call('/api/billing', { uid: 'old' })).status, 404);
  assert.equal((await h.call('/api/billing/webhook', { method: 'POST', body: '{}' })).status, 404);
  assert.equal('billing' in await (await h.call('/api/config')).json(), false);
  // Whatever the Coach says (it has no consent from this profile), it is not "pay first".
  assert.notEqual((await h.call('/api/coach/review', { uid: 'old', method: 'POST', body: {} })).status, 402);
});

test('trial, expiry, checkout, webhook and portal, end to end', async t => {
  const stripeApi = await fakeStripe(t);
  const h = await startServer(t, {
    env: stripeEnv(stripeApi.base),
    users: [{ id: 'new', name: 'N', created: iso(Date.now()) }, { id: 'old', name: 'O', created: LONG_AGO, email: 'o@example.com' }],
    db: { billingSince: Date.now() - 200 * DAY }
  });

  assert.deepEqual((await (await h.call('/api/config')).json()).billing, { trial_days: 30 });
  assert.equal((await h.call('/api/billing')).status, 401);

  const fresh = await (await h.call('/api/billing', { uid: 'new' })).json();
  assert.equal(fresh.plan, 'trial');
  assert.equal(fresh.trialDaysLeft, 30);
  const old = await (await h.call('/api/billing', { uid: 'old' })).json();
  assert.equal(old.plan, 'expired');
  assert.equal(old.ai, false);

  // The Coach: an expired profile is told to subscribe; one in its trial is not.
  const refused = await h.call('/api/coach/review', { uid: 'old', method: 'POST', body: {} });
  assert.equal(refused.status, 402);
  assert.equal((await refused.json()).code, 'billing');
  assert.notEqual((await h.call('/api/coach/review', { uid: 'new', method: 'POST', body: {} })).status, 402);
  // Reading status is not a job, and stays open.
  assert.equal((await h.call('/api/coach/status', { uid: 'old' })).status, 200);

  // Checkout: the key goes to Stripe, the URL comes back to the app.
  const co = await h.call('/api/billing/checkout', { uid: 'old', method: 'POST', body: {} });
  assert.equal(co.status, 200);
  assert.equal((await co.json()).url, 'https://checkout.stripe.test/cs_1');
  const sent = stripeApi.calls.at(-1);
  assert.equal(sent.auth, 'Bearer sk_test_fake');
  assert.equal(sent.form.get('client_reference_id'), 'old');
  assert.equal(sent.form.get('customer_email'), 'o@example.com');
  assert.equal(sent.form.get('success_url'), 'http://localhost:8080/#/settings');

  // No customer yet, so no portal.
  assert.equal((await h.call('/api/billing/portal', { uid: 'old', method: 'POST', body: {} })).status, 409);

  // An unsigned or badly signed webhook changes nothing.
  const evt = (type, created, object) => JSON.stringify({ id: 'evt_' + created, type, created, data: { object } });
  const done = evt('checkout.session.completed', 1, { mode: 'subscription', client_reference_id: 'old', customer: 'cus_old', subscription: 'sub_old' });
  assert.equal((await h.call('/api/billing/webhook', { method: 'POST', body: done })).status, 400);
  assert.equal((await h.call('/api/billing/webhook', { method: 'POST', body: done, headers: { 'Stripe-Signature': sign(done, 'whsec_wrong') } })).status, 400);

  // Signed: the customer is linked, then the subscription turns the AI back on.
  assert.equal((await h.call('/api/billing/webhook', { method: 'POST', body: done, headers: { 'Stripe-Signature': sign(done, WHSEC) } })).status, 200);
  const active = evt('customer.subscription.created', 2, { id: 'sub_old', customer: 'cus_old', status: 'active', metadata: { uid: 'old' }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 });
  assert.equal((await h.call('/api/billing/webhook', { method: 'POST', body: active, headers: { 'Stripe-Signature': sign(active, WHSEC) } })).status, 200);
  const paid = await (await h.call('/api/billing', { uid: 'old' })).json();
  assert.equal(paid.plan, 'active');
  assert.equal(paid.ai, true);
  assert.equal(paid.portal, true);
  assert.notEqual((await h.call('/api/coach/review', { uid: 'old', method: 'POST', body: {} })).status, 402);
  // Stored where the operator's backups already are.
  const stored = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find(u => u.id === 'old');
  assert.equal(stored.billing.status, 'active');

  // A second checkout for a live subscription is refused; the portal is where it is managed.
  assert.equal((await h.call('/api/billing/checkout', { uid: 'old', method: 'POST', body: {} })).status, 409);
  const portal = await h.call('/api/billing/portal', { uid: 'old', method: 'POST', body: {} });
  assert.equal((await portal.json()).url, 'https://billing.stripe.test/p_1');
  assert.equal(stripeApi.calls.at(-1).form.get('customer'), 'cus_old');
});

test('deleting a paying profile cancels its subscription at Stripe', async t => {
  const stripeApi = await fakeStripe(t);
  const h = await startServer(t, {
    env: { ...stripeEnv(stripeApi.base), ADMIN_UIDS: 'boss' },
    users: [
      { id: 'boss', name: 'B', created: LONG_AGO },
      { id: 'payer', name: 'P', created: LONG_AGO, billing: { customer: 'cus_p', subscription: 'sub_p', status: 'active', at: 1 } }
    ]
  });
  // The admin is never charged, and sees who is.
  assert.equal((await (await h.call('/api/billing', { uid: 'boss' })).json()).plan, 'free');
  const list = await (await h.call('/api/admin/users', { uid: 'boss' })).json();
  assert.equal(list.users.find(u => u.id === 'payer').plan, 'active');

  const del = await h.call('/api/admin/user/delete', { uid: 'boss', method: 'POST', body: { id: 'payer' } });
  assert.equal(del.status, 200);
  for (let i = 0; i < 50 && !stripeApi.calls.some(c => c.method === 'DELETE'); i++) await new Promise(r => setTimeout(r, 20));
  const cancel = stripeApi.calls.find(c => c.method === 'DELETE');
  assert.ok(cancel, 'Stripe was asked to cancel');
  assert.equal(cancel.url, '/v1/subscriptions/sub_p');
});
