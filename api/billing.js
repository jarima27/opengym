/* Paid access for a hosted instance: a free trial, then a Stripe subscription.
 *
 * Off unless STRIPE_SECRET_KEY and STRIPE_PRICE_ID are both set. While it is off every profile
 * has everything and none of the routes exist: a self-hosted instance is byte-for-byte the app
 * it was before this file.
 *
 * What a subscription pays for is the AI — the Coach's plans, reviews and debriefs, which cost
 * the operator money on every call. Logging a workout, the history, the charts and an export
 * never stop working when a trial ends or a card fails. The data is the person's; a paywall in
 * front of it would be holding it hostage.
 *
 * No Stripe SDK: the API talks to Stripe with fetch and form-encoded bodies, and checks a
 * webhook's signature with node:crypto, so the package keeps its short dependency list.
 *
 * What is stored, on the user record in db.json:
 *
 *   user.billing = { customer, subscription, status, periodEnd, endsAt, at }
 *
 * `status` is Stripe's own subscription status, copied as it arrives. `at` is the `created`
 * time of the last subscription event applied, so a retried or late event never undoes a newer
 * one. `user.comp === true` is a profile the operator does not charge (a coach, a partner) —
 * set by hand in db.json; admins are never charged either.
 */
import crypto from 'node:crypto';

const DAY = 86400000;
// Stripe refuses a Checkout trial_end less than 48 hours away; a minute of slack on top.
const MIN_TRIAL_END_MS = 48 * 3600000 + 60000;
// The statuses that keep the AI on. past_due is Stripe retrying a failed card: access stays
// while it does, and the subscription moves on to canceled or unpaid if the retries run out.
const PAYING = new Set(['active', 'trialing', 'past_due']);
// How far a webhook's timestamp may be from this clock — Stripe's own libraries use the same.
export const TOLERANCE_S = 300;

export const isPaying = billing => PAYING.has(billing?.status);

export function billingConfig(env = process.env) {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  const price = String(env.STRIPE_PRICE_ID || '').trim();
  const days = Number.parseInt(env.TRIAL_DAYS ?? '30', 10);
  return {
    on: !!(key && price),
    key,
    price,
    webhookSecret: String(env.STRIPE_WEBHOOK_SECRET || '').trim(),
    trialDays: Number.isFinite(days) && days >= 0 ? Math.min(days, 365) : 30,
    // Only ever changed to point the tests (or stripe-mock) somewhere other than Stripe.
    apiBase: String(env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/+$/, '')
  };
}

/* Where a profile stands. `since` is when this instance switched billing on (db.billingSince):
   a profile that existed before then gets its trial from that day, not from a sign-up date that
   would have it expire the moment the operator turned charging on. */
export function accessOf(user, cfg, { since = 0, now = Date.now(), staff = false } = {}) {
  if (!cfg.on) return { on: false, ai: true };
  const b = user?.billing || {};
  const trialEnds = Math.max(Date.parse(user?.created) || 0, since) + cfg.trialDays * DAY;
  const plan = staff || user?.comp === true ? 'free'
    : isPaying(b) ? (b.status === 'past_due' ? 'past_due' : 'active')
      : now < trialEnds ? 'trial' : 'expired';
  return {
    on: true,
    plan,
    ai: plan !== 'expired',
    trialEnds: new Date(trialEnds).toISOString(),
    trialDaysLeft: Math.max(0, Math.ceil((trialEnds - now) / DAY)),
    status: b.status || null,
    periodEnd: b.periodEnd ? new Date(b.periodEnd).toISOString() : null,
    endsAt: b.endsAt ? new Date(b.endsAt).toISOString() : null,
    // Whether there is a Stripe customer, i.e. a billing portal to send them to.
    portal: !!b.customer
  };
}

/* The Checkout Session for one profile. Subscribing during the trial does not cut the trial
   short: the first charge waits for the day the trial would have ended anyway. */
export function checkoutForm(user, cfg, { origin, since = 0, now = Date.now() }) {
  const f = new URLSearchParams();
  f.set('mode', 'subscription');
  f.set('line_items[0][price]', cfg.price);
  f.set('line_items[0][quantity]', '1');
  f.set('client_reference_id', user.id);
  f.set('metadata[uid]', user.id);
  // On the subscription as well, so its own events name the profile even when they arrive
  // before checkout.session.completed has told us which customer it is.
  f.set('subscription_data[metadata][uid]', user.id);
  f.set('allow_promotion_codes', 'true');
  const back = String(origin || '').replace(/\/+$/, '') + '/#/settings';
  f.set('success_url', back);
  f.set('cancel_url', back);
  if (user.billing?.customer) f.set('customer', user.billing.customer);
  else if (user.email) f.set('customer_email', user.email);
  const trialEnds = Date.parse(accessOf(user, cfg, { since, now }).trialEnds);
  if (trialEnds - now >= MIN_TRIAL_END_MS) f.set('subscription_data[trial_end]', String(Math.floor(trialEnds / 1000)));
  return f;
}

export function portalForm(user, { origin }) {
  const f = new URLSearchParams();
  f.set('customer', user.billing.customer);
  f.set('return_url', String(origin || '').replace(/\/+$/, '') + '/#/settings');
  return f;
}

/* A webhook body, if and only if Stripe signed it with this secret in the last five minutes.
   `raw` must be the bytes exactly as they arrived: the signature is over them, not over any
   re-serialisation of the parsed JSON. */
export function verifyWebhook(raw, header, secret, now = Date.now()) {
  if (!secret || !header || !Buffer.isBuffer(raw)) return null;
  let t = null;
  const sigs = [];
  for (const part of String(header).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) sigs.push(Buffer.from(v, 'hex'));
  }
  if (!/^\d{1,12}$/.test(t || '') || !sigs.length) return null;
  if (Math.abs(now / 1000 - Number(t)) > TOLERANCE_S) return null;
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest();
  // Every candidate is compared, match or not, so the time taken says nothing about which.
  let ok = false;
  for (const s of sigs) ok = crypto.timingSafeEqual(s, expected) || ok;
  if (!ok) return null;
  try {
    const event = JSON.parse(raw.toString('utf8'));
    return event && typeof event === 'object' && typeof event.type === 'string' ? event : null;
  } catch { return null; }
}

const toMs = s => (Number.isFinite(+s) && +s > 0 ? +s * 1000 : null);
const SUBSCRIPTION_EVENT = /^customer\.subscription\.(created|updated|deleted|paused|resumed)$/;

/* Folds one verified event into the profile it is about. Returns { user, was } — the profile and
   the status it had before — when something changed (the caller saves), null for an event this
   instance has nothing to do with. */
export function applyEvent(users, event) {
  const o = event?.data?.object;
  if (!o || typeof o !== 'object') return null;

  if (event.type === 'checkout.session.completed') {
    if (o.mode !== 'subscription') return null;
    const user = users.find(u => u.id === (o.client_reference_id || o.metadata?.uid));
    if (!user) return null;
    const b = { ...(user.billing || {}) };
    if (typeof o.customer === 'string') b.customer = o.customer;
    if (typeof o.subscription === 'string' && !isPaying(b)) b.subscription = o.subscription;
    const was = user.billing?.status || null;
    user.billing = b;
    return { user, was };
  }

  if (SUBSCRIPTION_EVENT.test(event.type)) {
    const user = users.find(u => u.id === o.metadata?.uid)
      || (typeof o.customer === 'string' && users.find(u => u.billing?.customer === o.customer)) || null;
    if (!user) return null;
    const b = user.billing || {};
    const at = +event.created || 0;
    if (b.subscription === o.id && b.at && at < b.at) return null;   // older than what is held
    // A second subscription for the same profile (two checkouts in two tabs) must not replace a
    // live one with its own dead state; the live one is what the person is paying for.
    if (b.subscription && b.subscription !== o.id && isPaying(b) && !PAYING.has(o.status)) return null;
    const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(o.status || '');
    // current_period_end moved onto the subscription items in Stripe's 2025 API versions.
    const periodEnd = toMs(o.current_period_end ?? o.items?.data?.[0]?.current_period_end);
    user.billing = {
      ...b,
      customer: typeof o.customer === 'string' ? o.customer : b.customer,
      subscription: o.id,
      status,
      periodEnd,
      endsAt: o.cancel_at ? toMs(o.cancel_at) : o.cancel_at_period_end ? periodEnd : null,
      at
    };
    return { user, was: b.status || null };
  }
  return null;
}

/* One call to Stripe's API. Answers the parsed body, or throws with Stripe's own message —
   which goes to the log, never to the person (the route says something of its own). */
export async function stripe(cfg, method, path, form, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(`${cfg.apiBase}/v1/${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/x-www-form-urlencoded' },
    ...(form ? { body: form.toString() } : {}),
    signal: AbortSignal.timeout(20000)
  });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON: the status says enough */ }
  if (!r.ok) throw Object.assign(new Error(body?.error?.message || `stripe answered ${r.status}`), { status: r.status });
  return body || {};
}
