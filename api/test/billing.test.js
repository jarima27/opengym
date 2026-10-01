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
import { billingConfig, accessOf, checkoutForm, verifyWebhook, applyEvent, TOLERANCE_S, snapshot, transitions, applyRevenueCat, storeFromSubscriber, revenueCatAuthOk, freePlanOpen, claimFreePlan, releaseFreePlan, retentionOffers, pauseForm, annualForm, applySubscription, PAUSE_DAYS } from '../billing.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-01T12:00:00Z');
const ON = billingConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' });
const iso = ms => new Date(ms).toISOString();

const sign = (body, secret, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

/* ------------------------------ config ------------------------------ */

test('billing is off unless Stripe (key and a price) or RevenueCat is set', () => {
  assert.equal(billingConfig({}).on, false);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk' }).on, false);
  assert.equal(billingConfig({ STRIPE_PRICE_ID: 'price' }).on, false);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' }).on, true);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'price' }).stripe.prices.monthly, 'price', 'the first spelling is the monthly price');
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ANNUAL: 'y' }).stripe.on, true);
  const store = billingConfig({ REVENUECAT_WEBHOOK_AUTH: 'Bearer x' });
  assert.deepEqual([store.on, store.stripe.on, store.rc.on, store.rc.entitlement], [true, false, true, 'pro']);
  assert.equal(billingConfig({}).cardTrialDays, 0);
  assert.equal(billingConfig({ STRIPE_TRIAL_DAYS: '30' }).cardTrialDays, 30);
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
  const f = checkoutForm(u, ON, { origin: 'https://gym.example/', price: 'price_x', now: NOW });
  assert.equal(f.get('mode'), 'subscription');
  assert.equal(f.get('line_items[0][price]'), 'price_x');
  assert.equal(f.get('client_reference_id'), 'uid1');
  assert.equal(f.get('subscription_data[metadata][uid]'), 'uid1');
  assert.equal(f.get('customer_email'), 'a@b.c');
  assert.equal(f.get('success_url'), 'https://gym.example/#/settings');
  assert.equal(f.get('subscription_data[trial_end]'), String(Math.floor((NOW + 20 * DAY) / 1000)));

  // Under 48 hours left is under Stripe's minimum: no trial_end, the charge is today.
  const late = checkoutForm({ id: 'u2', created: iso(NOW - 29 * DAY) }, ON, { origin: 'https://gym.example', price: 'price_x', now: NOW });
  assert.equal(late.has('subscription_data[trial_end]'), false);

  // A returning customer is reused rather than duplicated, and the e-mail is then not sent.
  const back = checkoutForm({ id: 'u3', created: iso(0), email: 'a@b.c', billing: { customer: 'cus_9', status: 'canceled' } }, ON, { origin: 'x', price: 'price_x', now: NOW });
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
  assert.equal(r.id, 'u1');
  assert.deepEqual(users[0].billing, { customer: 'cus_1', subscription: 'sub_1' });

  applyEvent(users, subEvent('customer.subscription.created', 2, { status: 'trialing', current_period_end: 2000 }));
  assert.equal(users[0].billing.status, 'trialing');
  assert.equal(users[0].billing.periodEnd, 2000 * 1000);
  // Newer API versions put the period on the item instead.
  applyEvent(users, subEvent('customer.subscription.updated', 3, { status: 'active', items: { data: [{ current_period_end: 3000 }] } }));
  assert.equal(users[0].billing.periodEnd, 3000 * 1000);
  // The price the subscription charges, for the trial's reminder; kept when an event lacks it.
  applyEvent(users, subEvent('customer.subscription.updated', 4, { status: 'trialing', items: { data: [{ current_period_end: 4000, price: { unit_amount: 3499, currency: 'eur', recurring: { interval: 'year' } } }] } }));
  assert.deepEqual(users[0].billing.price, { amount: 3499, currency: 'EUR', interval: 'year' });
  applyEvent(users, subEvent('customer.subscription.updated', 5, { status: 'trialing', current_period_end: 4000 }));
  assert.deepEqual(users[0].billing.price, { amount: 3499, currency: 'EUR', interval: 'year' });
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
  assert.equal(r.id, 'u1');
  assert.equal(users[0].billing.status, 'active');
});

test('deleted means canceled; a scheduled cancellation is shown as its end date', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  applyEvent(users, subEvent('customer.subscription.updated', 1, { status: 'active', current_period_end: 5000, cancel_at_period_end: true }));
  assert.equal(users[0].billing.endsAt, 5000 * 1000);
  applyEvent(users, subEvent('customer.subscription.deleted', 2, { status: 'active' }));
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
async function fakeStripe(t, subs = {}) {
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
      // A subscription that changes the way Stripe would for the four fields the cancel flow sets.
      const sub = req.url.startsWith('/v1/subscriptions/') && subs[decodeURIComponent(req.url.split('/').pop())];
      if (sub && req.method === 'GET') return res.end(JSON.stringify(sub));
      if (sub && req.method === 'POST') {
        const f = new URLSearchParams(body);
        if (f.has('cancel_at_period_end')) sub.cancel_at_period_end = f.get('cancel_at_period_end') === 'true';
        if (f.get('pause_collection') === '') sub.pause_collection = null;
        if (f.has('pause_collection[behavior]')) sub.pause_collection = { behavior: f.get('pause_collection[behavior]'), resumes_at: +f.get('pause_collection[resumes_at]') };
        if (f.has('items[0][price]')) sub.items.data[0].price = { id: f.get('items[0][price]'), unit_amount: 3499, currency: 'eur', recurring: { interval: 'year' } };
        return res.end(JSON.stringify(sub));
      }
      if (req.url.startsWith('/v1/prices/')) return res.end(JSON.stringify({ id: req.url.split('/').pop(), unit_amount: 3499, currency: 'eur', recurring: { interval: 'year' } }));
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

  assert.deepEqual((await (await h.call('/api/config')).json()).billing, { trial_days: 30, card_trial_days: 0, web: true });
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

/* ------------------------------ v2: card trials, bonus days, stores ------------------------------ */

const CARD = billingConfig({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_MONTHLY: 'p_m', STRIPE_PRICE_ANNUAL: 'p_y', TRIAL_DAYS: '0', STRIPE_TRIAL_DAYS: '30', REVENUECAT_WEBHOOK_AUTH: 'Bearer rc' });

test('with no open trial, a new profile has nothing yet — not an expired trial', () => {
  const fresh = { id: 'u', created: iso(NOW) };
  const a = accessOf(fresh, CARD, { now: NOW });
  assert.deepEqual([a.plan, a.ai, a.cardTrialDays], ['none', false, 30]);
  // Once a subscription has come and gone, it is expired.
  assert.equal(accessOf({ ...fresh, billing: { status: 'canceled', trialUsed: true } }, CARD, { now: NOW }).plan, 'expired');
  assert.equal(accessOf({ ...fresh, billing: { status: 'canceled', trialUsed: true } }, CARD, { now: NOW }).cardTrialDays, 0);
});

test('a creator code’s bonus days come first, and the card trial starts after them', () => {
  const coded = { id: 'u', created: iso(NOW), bonusDays: 30 };
  const a = accessOf(coded, CARD, { now: NOW });
  assert.deepEqual([a.plan, a.trialDaysLeft], ['trial', 30]);
  // Subscribing on day one: 30 bonus days, then the 30-day card trial.
  const f = checkoutForm(coded, CARD, { origin: 'x', price: 'p_y', now: NOW });
  assert.equal(f.get('line_items[0][price]'), 'p_y');
  assert.equal(f.get('subscription_data[trial_end]'), String(Math.floor((NOW + 60 * DAY) / 1000)));
  // Without a code: the card trial starts today.
  assert.equal(checkoutForm({ id: 'v', created: iso(NOW) }, CARD, { origin: 'x', price: 'p_m', now: NOW }).get('subscription_data[trial_end]'), String(Math.floor((NOW + 30 * DAY) / 1000)));
  // A second card trial is not given: the charge is today.
  assert.equal(checkoutForm({ id: 'w', created: iso(NOW), billing: { customer: 'c', status: 'canceled', trialUsed: true } }, CARD, { origin: 'x', price: 'p_m', now: NOW }).has('subscription_data[trial_end]'), false);
  assert.equal(checkoutForm({ id: 'w', created: iso(NOW), store: { active: false, trialUsed: true } }, CARD, { origin: 'x', price: 'p_m', now: NOW }).has('subscription_data[trial_end]'), false);
});

test('a Stripe card trial marks the trial as used', () => {
  const users = [{ id: 'u1', created: iso(0) }];
  applyEvent(users, subEvent('customer.subscription.created', 1, { status: 'trialing', trial_end: 5000 }));
  assert.equal(users[0].billing.trialUsed, true);
  assert.equal(accessOf(users[0], CARD, { now: NOW }).cardTrial, true);
});

test('transitions: trial started, then subscribed, then one cancellation', () => {
  const none = snapshot(null);
  const trialing = snapshot({ billing: { status: 'trialing' } });
  const active = snapshot({ billing: { status: 'active' } });
  const cancelling = snapshot({ billing: { status: 'active', endsAt: 1 } });
  const gone = snapshot({ billing: { status: 'canceled' } });
  assert.deepEqual(transitions(none, trialing), ['trial_started']);
  assert.deepEqual(transitions(trialing, active), ['subscribed']);
  assert.deepEqual(transitions(none, active), ['subscribed'], 'bought without a trial');
  assert.deepEqual(transitions(active, active), []);
  assert.deepEqual(transitions(active, cancelling), ['cancelled']);
  assert.deepEqual(transitions(cancelling, gone), [], 'counted when it was scheduled, not again when it ends');
  assert.deepEqual(transitions(active, gone), ['cancelled'], 'an end nobody scheduled (refund, unpaid) is counted');
  // The same through a store.
  const storeTrial = snapshot({ store: { active: true, expiresAt: Date.now() + DAY, periodType: 'TRIAL', willRenew: true, store: 'app_store' } });
  assert.deepEqual(transitions(none, storeTrial), ['trial_started']);
  assert.equal(storeTrial.via, 'app_store');
});

const rc = (type, o = {}) => ({ api_version: '1.0', event: { type, app_user_id: 'u1', entitlement_ids: ['pro'], store: 'APP_STORE', product_id: 'annual', period_type: 'NORMAL', event_timestamp_ms: 1000, expiration_at_ms: NOW + 30 * DAY, ...o } });

test('RevenueCat: the header must match exactly', () => {
  assert.equal(revenueCatAuthOk('Bearer rc', CARD), true);
  assert.equal(revenueCatAuthOk('Bearer rc ', CARD), false);
  assert.equal(revenueCatAuthOk('', CARD), false);
  assert.equal(revenueCatAuthOk('Bearer rc', billingConfig({})), false, 'unset never matches');
});

test('RevenueCat: a store trial, a cancellation that keeps access until it ends, an expiration', () => {
  const users = [{ id: 'u1', created: iso(NOW) }];
  applyRevenueCat(users, rc('INITIAL_PURCHASE', { period_type: 'TRIAL' }), CARD);
  assert.deepEqual([users[0].store.active, users[0].store.store, users[0].store.trialUsed], [true, 'app_store', true]);
  let a = accessOf(users[0], CARD, { now: NOW });
  assert.deepEqual([a.plan, a.ai, a.via, a.cardTrial], ['active', true, 'app_store', true]);

  applyRevenueCat(users, rc('CANCELLATION', { period_type: 'TRIAL', event_timestamp_ms: 2000 }), CARD);
  a = accessOf(users[0], CARD, { now: NOW });
  assert.equal(a.ai, true, 'still on until the period ends');
  assert.equal(a.endsAt, iso(NOW + 30 * DAY));

  applyRevenueCat(users, rc('BILLING_ISSUE', { event_timestamp_ms: 2500 }), CARD);
  assert.equal(accessOf(users[0], CARD, { now: NOW }).plan, 'past_due');

  applyRevenueCat(users, rc('EXPIRATION', { event_timestamp_ms: 3000 }), CARD);
  assert.equal(accessOf(users[0], CARD, { now: NOW }).plan, 'expired');
  // A late RENEWAL from before the expiration does not bring it back.
  assert.deepEqual(applyRevenueCat(users, rc('RENEWAL', { event_timestamp_ms: 2900 }), CARD).changed, []);
  // And an expiry date that has passed is not access, whatever the last event said.
  assert.equal(accessOf({ id: 'x', created: iso(0), store: { active: true, expiresAt: NOW - 1 } }, CARD, { now: NOW }).ai, false);
});

test('RevenueCat: another entitlement, an unknown user, an alias, a transfer', () => {
  const users = [{ id: 'u1', created: iso(0) }, { id: 'u2', created: iso(0) }];
  assert.deepEqual(applyRevenueCat(users, rc('INITIAL_PURCHASE', { entitlement_ids: ['other'] }), CARD).changed, []);
  assert.deepEqual(applyRevenueCat(users, rc('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc', aliases: ['nobody'] }), CARD).changed, []);
  const r = applyRevenueCat(users, rc('INITIAL_PURCHASE', { app_user_id: '$RCAnonymousID:abc', aliases: ['$RCAnonymousID:abc', 'u2'] }), CARD);
  assert.equal(r.changed[0].id, 'u2');
  const t = applyRevenueCat(users, { event: { type: 'TRANSFER', transferred_from: ['u2'], transferred_to: ['u1'], event_timestamp_ms: 5000 } }, CARD);
  assert.equal(users[1].store.active, false);
  assert.deepEqual(t.refresh.map(u => u.id), ['u1'], 'the receiver is read back from RevenueCat');
});

test('RevenueCat read-back: what RevenueCat computes is what is stored', () => {
  const sub = {
    entitlements: { pro: { expires_date: iso(NOW + 10 * DAY), product_identifier: 'monthly', grace_period_expires_date: null } },
    subscriptions: { monthly: { store: 'play_store', period_type: 'trial', unsubscribe_detected_at: null, billing_issues_detected_at: null } }
  };
  const s = storeFromSubscriber(sub, CARD, { now: NOW });
  assert.deepEqual([s.active, s.store, s.periodType, s.trialUsed, s.willRenew], [true, 'play_store', 'TRIAL', true, true]);
  // In its grace period after a failed charge.
  const grace = storeFromSubscriber({ entitlements: { pro: { expires_date: iso(NOW - DAY), grace_period_expires_date: iso(NOW + 3 * DAY), product_identifier: 'm' } }, subscriptions: { m: { billing_issues_detected_at: iso(NOW - DAY) } } }, CARD, { now: NOW });
  assert.deepEqual([grace.active, grace.billingIssue], [true, true]);
  // The entitlement gone: inactive, and the trial it once had is remembered.
  assert.deepEqual(storeFromSubscriber({ entitlements: {} }, CARD, { now: NOW, prev: { active: true, trialUsed: true } }).active, false);
  assert.equal(storeFromSubscriber({ entitlements: {} }, CARD, { now: NOW }), null);
});

/* ------------------------------ v2 against a real server ------------------------------ */

/** A stand-in for RevenueCat's REST API and PostHog's /batch/, recording what they were sent. */
async function fakeServices(t, subscriber = {}) {
  const seen = { rc: [], posthog: [] };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/v1/subscribers/')) {
        seen.rc.push({ url: req.url, auth: req.headers.authorization });
        return res.end(JSON.stringify({ subscriber: subscriber[decodeURIComponent(req.url.split('/').pop())] || { entitlements: {}, subscriptions: {} } }));
      }
      if (req.url === '/batch/') { seen.posthog.push(...JSON.parse(body).batch.map(e => ({ ...e, api_key: JSON.parse(body).api_key }))); return res.end('{"status":1}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${srv.address().port}`, seen };
}
const settle = async (cond, ms = 3000) => { for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); };

test('store purchases: RevenueCat webhook and the app’s read-back', async t => {
  const fake = await fakeServices(t, {
    u2: { entitlements: { pro: { expires_date: iso(Date.now() + 30 * DAY), product_identifier: 'annual' } }, subscriptions: { annual: { store: 'play_store', period_type: 'trial' } } }
  });
  const h = await startServer(t, {
    env: { TRIAL_DAYS: '0', REVENUECAT_WEBHOOK_AUTH: 'Bearer rc-secret', REVENUECAT_SECRET_KEY: 'sk_rc', REVENUECAT_API_BASE: fake.base },
    users: [{ id: 'u1', name: 'A', created: iso(Date.now()) }, { id: 'u2', name: 'B', created: iso(Date.now()) }]
  });
  // No web checkout on an instance that only sells in the stores.
  assert.equal((await h.call('/api/billing/checkout', { uid: 'u1', method: 'POST', body: {} })).status, 404);
  assert.equal((await (await h.call('/api/billing', { uid: 'u1' })).json()).plan, 'none');

  const hook = (b, auth = 'Bearer rc-secret') => h.call('/api/billing/revenuecat', { method: 'POST', body: b, headers: { Authorization: auth } });
  assert.equal((await hook(rc('INITIAL_PURCHASE', { event_timestamp_ms: Date.now(), expiration_at_ms: Date.now() + 30 * DAY }), 'Bearer wrong')).status, 401);
  assert.equal((await hook(rc('INITIAL_PURCHASE', { period_type: 'TRIAL', event_timestamp_ms: Date.now(), expiration_at_ms: Date.now() + 30 * DAY }))).status, 200);
  const a = await (await h.call('/api/billing', { uid: 'u1' })).json();
  assert.deepEqual([a.plan, a.ai, a.via, a.cardTrial], ['active', true, 'app_store', true]);

  // Right after a purchase the app asks, and RevenueCat's own answer is taken.
  const synced = await (await h.call('/api/billing/sync', { uid: 'u2', method: 'POST', body: {} })).json();
  assert.deepEqual([synced.plan, synced.via], ['active', 'play_store']);
  assert.equal(fake.seen.rc[0].auth, 'Bearer sk_rc');
  assert.equal(fake.seen.rc[0].url, '/v1/subscribers/u2');
});

test('creator codes: the admin makes one, a sign-up with it gets the bonus, the admin sees who came', async t => {
  const fake = await fakeServices(t);
  const h = await startServer(t, {
    env: { ...stripeEnv('http://127.0.0.1:9'), ADMIN_UIDS: 'boss', PASSWORD_LOGIN: '1', POSTHOG_KEY: 'phc_test', POSTHOG_HOST: fake.base, POSTHOG_FLUSH_MS: '50' },
    users: [{ id: 'boss', name: 'Boss', created: LONG_AGO }]
  });
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'lucia', label: 'Lucía — PT', days: 30 } })).status, 200);
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'LUCIA', days: 30 } })).status, 409);
  assert.equal((await h.call('/api/admin/codes', { uid: 'boss', method: 'POST', body: { code: 'x', days: 30 } })).status, 400);
  assert.deepEqual(await (await h.call('/api/code?c=lucia')).json(), { code: 'LUCIA', days: 30 });
  assert.equal((await h.call('/api/code?c=NOPE')).status, 404);

  const signup = async (name, src) => {
    const r = await h.call('/api/register/password', { method: 'POST', body: { name, password: 'correct horse battery staple', src } });
    assert.equal(r.status, 200, name);
    return (await r.json()).user.id;
  };
  const coded = await signup('Carla', { ref: 'lucia', utm_source: 'instagram', utm_campaign: 'launch', platform: 'web', junk: { nested: 1 } });
  const typo = await signup('Dani', { ref: 'LUCIAA' });
  const stored = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users;
  const carla = stored.find(u => u.id === coded);
  assert.deepEqual(carla.src, { ref: 'LUCIA', utm_source: 'instagram', utm_campaign: 'launch', platform: 'web' });
  assert.equal(carla.bonusDays, 30);
  assert.equal(stored.find(u => u.id === typo).src, undefined, 'an unknown code is not recorded as one');
  assert.equal((await (await h.call('/api/billing', { uid: coded })).json()).trialDaysLeft, 60);

  const codes = (await (await h.call('/api/admin/codes', { uid: 'boss' })).json()).codes;
  assert.deepEqual(codes.map(c => [c.code, c.signups, c.paying]), [['LUCIA', 1, 0]]);
  // Revoked: no more days for new sign-ups, and the page says so.
  assert.equal((await h.call('/api/admin/codes/revoke', { uid: 'boss', method: 'POST', body: { code: 'LUCIA' } })).status, 200);
  assert.equal((await h.call('/api/code?c=LUCIA')).status, 404);

  // Analytics: the sign-ups arrived, with the creator on them and no name.
  await settle(() => fake.seen.posthog.filter(e => e.event === 'signup').length >= 2);
  const sign = fake.seen.posthog.find(e => e.event === 'signup' && e.properties.distinct_id === coded);
  assert.equal(sign.api_key, 'phc_test');
  assert.deepEqual([sign.properties.ref, sign.properties.utm_source, sign.properties.method], ['LUCIA', 'instagram', 'password']);
  assert.equal(JSON.stringify(fake.seen.posthog).includes('Carla'), false, 'names never leave');
  assert.ok(fake.seen.posthog.some(e => e.event === 'trial_started' && e.properties.distinct_id === coded && e.properties.days === 60));
});

test('the app’s own events: only the listed ones, forwarded with the profile’s attribution', async t => {
  const fake = await fakeServices(t);
  const h = await startServer(t, {
    env: { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: fake.base, POSTHOG_FLUSH_MS: '50' },
    users: [{ id: 'u1', name: 'A', created: LONG_AGO, src: { ref: 'LUCIA' } }]
  });
  assert.equal((await (await h.call('/api/config')).json()).analytics, true);
  assert.equal((await h.call('/api/track', { method: 'POST', body: { event: 'import_done' } })).status, 401);
  assert.equal((await h.call('/api/track', { uid: 'u1', method: 'POST', body: { event: 'subscribed' } })).status, 400, 'a client cannot claim a payment');
  assert.equal((await h.call('/api/track', { uid: 'u1', method: 'POST', body: { event: 'import_done', props: { source: 'strong', workouts: 212, deep: { x: 1 } } } })).status, 200);
  await settle(() => fake.seen.posthog.some(e => e.event === 'import_done'));
  const e = fake.seen.posthog.find(x => x.event === 'import_done');
  assert.deepEqual([e.properties.distinct_id, e.properties.ref, e.properties.source, e.properties.workouts, e.properties.deep], ['u1', 'LUCIA', 'strong', 212, undefined]);
});

test('without PostHog, no event route and nothing sent', async t => {
  const h = await startServer(t, { users: [{ id: 'u1', name: 'A', created: LONG_AGO }] });
  assert.equal((await h.call('/api/track', { uid: 'u1', method: 'POST', body: { event: 'import_done' } })).status, 404);
  assert.equal((await h.call('/api/code?c=ANY')).status, 404);
  assert.equal('analytics' in await (await h.call('/api/config')).json(), false);
});

/* The one Coach plan any profile may ask for without paying (spec F4). The mark is on the
   profile's row on the server, so a second attempt is refused from any device, with any local
   data; a job that fails gives it back. */
test('the free first Coach plan: once per account, kept by the server, given back when the job fails', async t => {
  const stripeApi = await fakeStripe(t);
  const h = await startServer(t, {
    env: stripeEnv(stripeApi.base),
    users: [
      { id: 'old', name: 'O', created: LONG_AGO },
      { id: 'used', name: 'U', created: LONG_AGO, freePlanUsedAt: iso(Date.now() - 9 * DAY) }
    ],
    db: { billingSince: Date.now() - 200 * DAY }
  });
  const status = async uid => (await h.call('/api/billing', { uid })).json();
  const row = uid => JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find(u => u.id === uid);

  assert.equal((await status('old')).ai, false);
  assert.equal((await status('old')).freePlan, true);
  // A refinement is a second request, not the gift; reviews and debriefs stay paid.
  assert.equal((await h.call('/api/coach/plan', { uid: 'old', method: 'POST', body: { refine: 'four days' } })).status, 402);
  assert.equal((await h.call('/api/coach/review', { uid: 'old', method: 'POST', body: {} })).status, 402);

  // Used once already: refused, whatever the device remembers, and the status says so.
  assert.equal((await status('used')).freePlan, false);
  assert.ok((await status('used')).freePlanAt);
  const again = await h.call('/api/coach/plan', { uid: 'used', method: 'POST', body: { intake: { goal: 'strength' } } });
  assert.equal(again.status, 402);
  assert.equal((await again.json()).code, 'billing');
});

test('the free plan’s mark: taken by one job, given back only by that job', () => {
  const cfg = { on: true };
  const user = { id: 'u' };
  assert.equal(freePlanOpen(user, cfg), true);
  assert.equal(freePlanOpen(user, { on: false }), false, 'an instance that does not charge has no gift to give: everything is open');
  claimFreePlan(user, 'job1', Date.UTC(2026, 9, 1));
  assert.equal(user.freePlanUsedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(freePlanOpen(user, cfg), false);
  assert.equal(releaseFreePlan(user, 'job2'), false, 'another job cannot give it back');
  assert.equal(freePlanOpen(user, cfg), false);
  assert.equal(releaseFreePlan(user, 'job1'), true);
  assert.equal(freePlanOpen(user, cfg), true);
  assert.equal(releaseFreePlan(undefined, 'job1'), false);
});

/* ------------------------------ cancelling (spec F8) ------------------------------ */

test('what can be offered instead of cancelling', () => {
  const monthly = { status: 'active', subscription: 'sub', price: { amount: 499, currency: 'EUR', interval: 'month' }, priceId: 'price_m' };
  const offers = (billing, annualPrice = 'price_y') => retentionOffers({ billing }, ON, { now: NOW, annualPrice });
  assert.deepEqual(offers(monthly), { pause: true, annual: true });
  assert.deepEqual(offers(monthly, null), { pause: true, annual: false }, 'no annual price sold, no annual offer');
  assert.deepEqual(offers({ ...monthly, price: { ...monthly.price, interval: 'year' } }), { pause: true, annual: false }, 'already annual');
  assert.deepEqual(offers({ ...monthly, status: 'trialing' }), { pause: false, annual: true }, 'a card trial has nothing to pause');
  assert.deepEqual(offers({ ...monthly, endsAt: NOW + DAY }), { pause: false, annual: false }, 'already cancelled');
  assert.deepEqual(offers({ ...monthly, paused: true, pausedUntil: NOW + DAY }), { pause: false, annual: false }, 'already paused');
  assert.deepEqual(offers({ ...monthly, status: 'canceled' }), { pause: false, annual: false });

  const f = pauseForm(NOW);
  assert.equal(f.get('pause_collection[behavior]'), 'void', 'nothing is charged while paused');
  assert.equal(+f.get('pause_collection[resumes_at]') * 1000, NOW + PAUSE_DAYS * DAY);
  assert.equal(annualForm('si_1', 'price_y', '').has('discounts[0][coupon]'), false);
  assert.equal(annualForm('si_1', 'price_y', 'SAVE20').get('discounts[0][coupon]'), 'SAVE20');
});

test('a paused subscription charges nothing and has no Coach until it resumes', () => {
  const user = { id: 'p', created: iso(NOW - 400 * DAY), billing: { customer: 'cus', subscription: 'sub', status: 'active', at: 1 } };
  const resumes = Math.floor((NOW + 30 * DAY) / 1000);
  applySubscription([user], { id: 'sub', customer: 'cus', status: 'active', pause_collection: { behavior: 'void', resumes_at: resumes }, current_period_end: resumes }, NOW);
  const a = accessOf(user, ON, { now: NOW });
  assert.equal(a.plan, 'paused');
  assert.equal(a.ai, false);
  assert.equal(a.pausedUntil, iso(resumes * 1000));
  assert.equal(accessOf(user, ON, { now: resumes * 1000 + 1 }).plan, 'active', 'and back by itself');
  // Stored and read back through JSON, as db.json does.
  assert.equal(accessOf(JSON.parse(JSON.stringify(user)), ON, { now: NOW }).plan, 'paused');
  // Indefinitely (paused from Stripe's dashboard, no date): paused until resumed.
  applySubscription([user], { id: 'sub', customer: 'cus', status: 'active', pause_collection: { behavior: 'void' } }, NOW + 1000);
  assert.equal(accessOf(user, ON, { now: NOW + 365 * DAY }).plan, 'paused');
  applySubscription([user], { id: 'sub', customer: 'cus', status: 'active', pause_collection: null }, NOW + 2000);
  assert.equal(accessOf(user, ON, { now: NOW }).plan, 'active');
});

test('cancel with a reason, take it back, pause, and switch to annual — against Stripe', async t => {
  const end = Math.floor(Date.now() / 1000) + 20 * 86400;
  const sub = () => ({ id: 'sub_m', customer: 'cus_m', status: 'active', metadata: {}, cancel_at_period_end: false, pause_collection: null,
    items: { data: [{ id: 'si_m', current_period_end: end, price: { id: 'price_m', unit_amount: 499, currency: 'eur', recurring: { interval: 'month' } } }] } });
  const subs = { sub_m: sub() };
  const stripeApi = await fakeStripe(t, subs);
  const billing = { customer: 'cus_m', subscription: 'sub_m', status: 'active', periodEnd: end * 1000, price: { amount: 499, currency: 'EUR', interval: 'month' }, priceId: 'price_m', at: 1 };
  const h = await startServer(t, {
    env: { ...stripeEnv(stripeApi.base), STRIPE_PRICE_ANNUAL: 'price_y', STRIPE_SAVE_COUPON: 'STAY20' },
    users: [{ id: 'm', name: 'M', created: LONG_AGO, billing }, { id: 'none', name: 'N', created: LONG_AGO }]
  });
  const status = async () => (await h.call('/api/billing', { uid: 'm' })).json();
  const post = (p, body = {}, uid = 'm') => h.call(p, { uid, method: 'POST', body });

  const before = await status();
  assert.equal(before.offers.pause, true);
  assert.deepEqual(before.offers.annual, { price: { amount: 3499, currency: 'EUR', interval: 'year' }, discount: true });
  assert.equal((await post('/api/billing/cancel', {}, 'none')).status, 409, 'nothing to cancel on the website');
  assert.equal((await h.call('/api/billing/cancel', { method: 'POST', body: {} })).status, 401);

  // Cancelled: it ends when the paid month ends, and the Coach stays until then.
  const c = await post('/api/billing/cancel', { reason: 'price' });
  assert.equal(c.status, 200);
  const cancelled = await c.json();
  assert.equal(cancelled.endsAt, iso(end * 1000));
  assert.equal(cancelled.ai, true);
  assert.equal(stripeApi.calls.at(-1).form.get('cancel_at_period_end'), 'true');
  assert.equal((await status()).offers.pause, false, 'nothing more to offer once cancelled');
  assert.match(fs.readFileSync(path.join(h.dataDir, 'audit.log'), 'utf8'), /billing\.cancel.*price/);

  // Taken back.
  assert.equal((await (await post('/api/billing/resume')).json()).endsAt, null);

  // Paused: nothing charged for a month, and no Coach meanwhile.
  const p = await (await post('/api/billing/pause')).json();
  assert.equal(p.plan, 'paused');
  assert.equal(p.ai, false);
  assert.equal(stripeApi.calls.at(-1).form.get('pause_collection[behavior]'), 'void');
  assert.equal((await post('/api/billing/pause')).status, 409, 'not twice');
  assert.equal((await (await post('/api/billing/resume')).json()).plan, 'active');

  // To the annual plan, with the operator's coupon.
  const y = await post('/api/billing/annual');
  assert.equal(y.status, 200);
  const sent = stripeApi.calls.at(-1).form;
  assert.equal(sent.get('items[0][id]'), 'si_m');
  assert.equal(sent.get('items[0][price]'), 'price_y');
  assert.equal(sent.get('discounts[0][coupon]'), 'STAY20');
  assert.equal((await status()).offers.annual, null, 'already annual');
  assert.equal((await post('/api/billing/annual')).status, 409);
});
