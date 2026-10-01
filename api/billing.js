/* Paid access for a hosted instance: a free trial, then a subscription — bought with Stripe on
 * the website, or in the App Store / Google Play through RevenueCat.
 *
 * Off unless Stripe (STRIPE_SECRET_KEY and a price) or RevenueCat (REVENUECAT_WEBHOOK_AUTH) is
 * configured. While it is off every profile has everything and none of the routes exist: a
 * self-hosted instance is byte-for-byte the app it was before this file.
 *
 * What a subscription pays for is the AI — the Coach's plans, reviews and debriefs, which cost
 * the operator money on every call. Logging a workout, the history, the charts and an export
 * never stop working when a trial ends or a card fails. The data is the person's; a paywall in
 * front of it would be holding it hostage.
 *
 * Two kinds of free time, which add up:
 *
 *   open trial  TRIAL_DAYS (+ a creator code's bonus days) from sign-up, no card. 0 turns it off.
 *   card trial  STRIPE_TRIAL_DAYS on the website, the introductory offer in the stores: the
 *               subscription is taken out with a card and the first charge comes when it ends.
 *               Once per person — a second checkout starts paying at once.
 *
 * No SDK for either: the API talks to Stripe and RevenueCat with fetch, and checks a Stripe
 * webhook's signature with node:crypto, so the package keeps its short dependency list.
 *
 * What is stored, on the user record in db.json:
 *
 *   user.billing = { customer, subscription, status, periodEnd, endsAt, trialUsed, at }   Stripe
 *   user.store   = { active, expiresAt, willRenew, billingIssue, periodType, store,
 *                    productId, trialUsed, at }                                          stores
 *
 * `status` is Stripe's own subscription status, copied as it arrives. `at` is the time of the
 * last event applied, so a retried or late event never undoes a newer one. `user.comp === true`
 * is a profile the operator does not charge (a coach, a partner) — set by hand in db.json;
 * admins are never charged either.
 */
import crypto from 'node:crypto';

const DAY = 86400000;
// Stripe refuses a Checkout trial_end less than 48 hours away; a minute of slack on top.
const MIN_TRIAL_END_MS = 48 * 3600000 + 60000;
// The Stripe statuses that keep the AI on. past_due is Stripe retrying a failed card: access
// stays while it does, and the subscription moves on to canceled or unpaid if the retries run out.
const PAYING = new Set(['active', 'trialing', 'past_due']);
// How far a webhook's timestamp may be from this clock — Stripe's own libraries use the same.
export const TOLERANCE_S = 300;

export const isPaying = billing => PAYING.has(billing?.status);
export const storeActive = (s, now = Date.now()) => !!s?.active && (s.expiresAt == null || now < s.expiresAt);
const iso = ms => (ms ? new Date(ms).toISOString() : null);

export function billingConfig(env = process.env) {
  const str = k => String(env[k] || '').trim();
  const days = (k, dflt) => {
    const n = Number.parseInt(env[k] ?? String(dflt), 10);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 365) : dflt;
  };
  const base = (k, dflt) => (str(k) || dflt).replace(/\/+$/, '');
  const key = str('STRIPE_SECRET_KEY');
  // STRIPE_PRICE_ID is the one-price spelling of the first version, read as the monthly price.
  const prices = { monthly: str('STRIPE_PRICE_MONTHLY') || str('STRIPE_PRICE_ID'), annual: str('STRIPE_PRICE_ANNUAL') };
  const stripeOn = !!(key && (prices.monthly || prices.annual));
  const rcAuth = str('REVENUECAT_WEBHOOK_AUTH');
  return {
    on: stripeOn || !!rcAuth,
    trialDays: days('TRIAL_DAYS', 30),
    cardTrialDays: days('STRIPE_TRIAL_DAYS', 0),
    stripe: {
      on: stripeOn, key, prices,
      webhookSecret: str('STRIPE_WEBHOOK_SECRET'),
      // Only ever changed to point the tests (or stripe-mock) somewhere other than Stripe.
      apiBase: base('STRIPE_API_BASE', 'https://api.stripe.com')
    },
    rc: {
      on: !!rcAuth,
      // The exact Authorization header RevenueCat is told to send with every webhook.
      webhookAuth: rcAuth,
      // A secret (sk_…) API key, to read a customer's entitlements straight from RevenueCat.
      secretKey: str('REVENUECAT_SECRET_KEY'),
      entitlement: str('REVENUECAT_ENTITLEMENT') || 'pro',
      apiBase: base('REVENUECAT_API_BASE', 'https://api.revenuecat.com')
    }
  };
}

/* When a profile's open trial ends. `since` is when this instance switched billing on
   (db.billingSince): a profile that existed before then gets its trial from that day, not from
   a sign-up date that would have it expire the moment the operator turned charging on. */
export function openTrialEnd(user, cfg, since = 0) {
  const days = cfg.trialDays + (Number.isFinite(+user?.bonusDays) ? Math.max(0, +user.bonusDays) : 0);
  return Math.max(Date.parse(user?.created) || 0, since) + days * DAY;
}

/* Where a profile stands.

   plan: trial     inside the open trial
         active    a live subscription, on either side (its own card trial included)
         past_due  a live subscription whose last charge failed; the AI stays on meanwhile
         expired   had an open trial or a subscription, and has neither now
         none      never had either — an instance without an open trial, before the first
                   checkout or store purchase
         free      admin, or marked comp */
export function accessOf(user, cfg, { since = 0, now = Date.now(), staff = false } = {}) {
  if (!cfg.on) return { on: false, ai: true };
  const b = user?.billing || {};
  const s = user?.store || null;
  const openEnds = openTrialEnd(user, cfg, since);
  const onStripe = isPaying(b);
  const onStore = storeActive(s, now);
  const via = onStripe ? 'stripe' : onStore ? (s.store || 'store') : null;
  const hadSomething = openEnds > (Math.max(Date.parse(user?.created) || 0, since)) || !!b.status || !!s;
  const plan = staff || user?.comp === true ? 'free'
    : via ? ((onStripe ? b.status === 'past_due' : s.billingIssue) ? 'past_due' : 'active')
      : now < openEnds ? 'trial'
        : hadSomething ? 'expired' : 'none';
  return {
    on: true,
    plan,
    ai: plan === 'trial' || plan === 'active' || plan === 'past_due' || plan === 'free',
    // Who the subscription is managed with: 'stripe' (the portal), or the store it was bought in.
    via,
    trialEnds: iso(openEnds),
    trialDaysLeft: Math.max(0, Math.ceil((openEnds - now) / DAY)),
    // Inside the subscription's own free period: the first charge is `periodEnd`.
    cardTrial: onStripe ? b.status === 'trialing' : onStore ? s.periodType === 'TRIAL' : false,
    // Whether checking out now starts with a card trial, and how long it is.
    cardTrialDays: b.trialUsed || s?.trialUsed ? 0 : cfg.cardTrialDays,
    status: b.status || null,
    periodEnd: onStripe ? iso(b.periodEnd) : onStore ? iso(s.expiresAt) : null,
    endsAt: onStripe ? iso(b.endsAt) : onStore && s.willRenew === false ? iso(s.expiresAt) : null,
    // Whether there is a Stripe customer, i.e. a billing portal to send them to.
    portal: !!b.customer,
    // Whether this server sells on the website at all (the stores are the app's business).
    web: cfg.stripe.on
  };
}

/* The facts analytics and the activity log care about, before and after an event. */
export function snapshot(user, now = Date.now()) {
  const b = user?.billing || {}, s = user?.store || null;
  const onStripe = isPaying(b), onStore = storeActive(s, now);
  return {
    paying: onStripe || onStore,
    trialing: (onStripe && b.status === 'trialing') || (onStore && s.periodType === 'TRIAL'),
    cancelling: (onStripe && !!b.endsAt) || (onStore && s.willRenew === false),
    via: onStripe ? 'stripe' : onStore ? (s.store || 'store') : null
  };
}
/* trial_started / subscribed / cancelled, from two snapshots. A cancellation is counted once:
   when it is scheduled, or when a subscription ends that nobody had scheduled to end. */
export function transitions(a, b) {
  const out = [];
  if (b.paying && b.trialing && !(a.paying && a.trialing)) out.push('trial_started');
  if (b.paying && !b.trialing && !(a.paying && !a.trialing)) out.push('subscribed');
  if (b.paying && b.cancelling && !(a.paying && a.cancelling)) out.push('cancelled');
  else if (a.paying && !b.paying && !a.cancelling) out.push('cancelled');
  return out;
}

/* ------------------------------------ Stripe ------------------------------------ */

/* The Checkout Session for one profile and one price. The card trial, when there is one, starts
   where the open trial ends, so subscribing early never costs a free day. */
export function checkoutForm(user, cfg, { origin, price, since = 0, now = Date.now() }) {
  const f = new URLSearchParams();
  f.set('mode', 'subscription');
  f.set('line_items[0][price]', price);
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
  const cardDays = user.billing?.trialUsed || user.store?.trialUsed ? 0 : cfg.cardTrialDays;
  const trialEnd = Math.max(openTrialEnd(user, cfg, since), now) + cardDays * DAY;
  if (trialEnd - now >= MIN_TRIAL_END_MS) f.set('subscription_data[trial_end]', String(Math.floor(trialEnd / 1000)));
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

/* Folds one verified Stripe event into the profile it is about. Returns that profile when
   something changed (the caller saves), null for an event this instance has nothing to do with. */
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
    user.billing = b;
    return user;
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
    // What the first (or next) charge will be: the trial's reminder says it in so many words.
    const p = o.items?.data?.[0]?.price;
    const price = p && Number.isFinite(p.unit_amount) && p.currency
      ? { amount: p.unit_amount, currency: String(p.currency).toUpperCase(), interval: p.recurring?.interval || null }
      : b.price || null;
    user.billing = {
      ...b,
      customer: typeof o.customer === 'string' ? o.customer : b.customer,
      subscription: o.id,
      status,
      periodEnd,
      endsAt: o.cancel_at ? toMs(o.cancel_at) : o.cancel_at_period_end ? periodEnd : null,
      trialUsed: b.trialUsed || status === 'trialing' || !!o.trial_end,
      ...(price ? { price } : {}),
      at
    };
    return user;
  }
  return null;
}

/* One call to Stripe's API. Answers the parsed body, or throws with Stripe's own message —
   which goes to the log, never to the person (the route says something of its own). */
export async function stripe(cfg, method, path, form, fetchImpl = globalThis.fetch) {
  const s = cfg.stripe || cfg;
  const r = await fetchImpl(`${s.apiBase}/v1/${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + s.key, 'Content-Type': 'application/x-www-form-urlencoded' },
    ...(form ? { body: form.toString() } : {}),
    signal: AbortSignal.timeout(20000)
  });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON: the status says enough */ }
  if (!r.ok) throw Object.assign(new Error(body?.error?.message || `stripe answered ${r.status}`), { status: r.status });
  return body || {};
}

/* ---------------------------------- RevenueCat ---------------------------------- */
/* The app identifies itself to RevenueCat with the profile's id as the app user id, so every
   event and every lookup below is keyed by the same id as db.json. */

/** RevenueCat sends the Authorization header it was configured with, verbatim. */
export function revenueCatAuthOk(header, cfg) {
  const want = Buffer.from(cfg.rc.webhookAuth || '');
  const got = Buffer.from(String(header || ''));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Events after which the entitlement is live until `expiration_at_ms`.
const RC_LIVE = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT']);
const lower = v => (typeof v === 'string' && v ? v.toLowerCase() : null);

/* Folds one RevenueCat webhook into the profiles it names. Returns the profiles it changed, and
   the ones whose state has to be read back from RevenueCat because the event does not carry it
   (a TRANSFER hands the entitlement to another app user id without saying until when). */
export function applyRevenueCat(users, body, cfg) {
  const none = { changed: [], refresh: [] };
  const ev = body?.event;
  if (!ev || typeof ev !== 'object') return none;
  const byId = id => (typeof id === 'string' ? users.find(u => u.id === id) : null) || null;
  const at = +ev.event_timestamp_ms || 0;

  if (ev.type === 'TRANSFER') {
    const changed = [];
    for (const u of (ev.transferred_from || []).map(byId).filter(Boolean)) {
      if (!u.store?.active) continue;
      u.store = { ...u.store, active: false, at };
      changed.push(u);
    }
    return { changed, refresh: (ev.transferred_to || []).map(byId).filter(Boolean) };
  }
  // A product that does not unlock this instance's entitlement is none of its business.
  if (!Array.isArray(ev.entitlement_ids) || !ev.entitlement_ids.includes(cfg.rc.entitlement)) return none;
  const user = [ev.app_user_id, ev.original_app_user_id, ...(Array.isArray(ev.aliases) ? ev.aliases : [])].map(byId).find(Boolean);
  if (!user) return none;
  const s = user.store || {};
  if (s.at && at < s.at) return none;   // older than what is held
  const exp = +ev.expiration_at_ms || null;
  const next = {
    ...s,
    store: lower(ev.store) || s.store || null,
    productId: ev.product_id || s.productId || null,
    periodType: ev.period_type || s.periodType || null,
    at
  };
  if (RC_LIVE.has(ev.type)) Object.assign(next, { active: true, expiresAt: exp, willRenew: ev.type !== 'NON_RENEWING_PURCHASE', billingIssue: false });
  else if (ev.type === 'CANCELLATION' || ev.type === 'SUBSCRIPTION_PAUSED') Object.assign(next, { willRenew: false, expiresAt: exp ?? s.expiresAt ?? null });
  // The store keeps the subscription alive through its grace period while it retries the card.
  else if (ev.type === 'BILLING_ISSUE') Object.assign(next, { billingIssue: true, expiresAt: Math.max(exp || 0, +ev.grace_period_expiration_at_ms || 0, s.expiresAt || 0) || null });
  else if (ev.type === 'EXPIRATION') Object.assign(next, { active: false, expiresAt: exp ?? s.expiresAt ?? null });
  else return none;
  if (next.periodType === 'TRIAL') next.trialUsed = true;
  user.store = next;
  return { changed: [user], refresh: [] };
}

/* A profile's store state as RevenueCat itself computes it (GET /v1/subscribers). What the app
   asks for right after a purchase, so access does not wait on the webhook. */
export function storeFromSubscriber(sub, cfg, { now = Date.now(), prev = null } = {}) {
  const ent = sub?.entitlements?.[cfg.rc.entitlement];
  if (!ent) return prev ? { ...prev, active: false, at: now } : null;
  const exp = ent.expires_date ? Date.parse(ent.expires_date) : null;
  const grace = ent.grace_period_expires_date ? Date.parse(ent.grace_period_expires_date) : 0;
  const until = exp == null ? null : Math.max(exp, grace || 0);
  const info = sub.subscriptions?.[ent.product_identifier] || {};
  const periodType = info.period_type ? String(info.period_type).toUpperCase() : null;
  return {
    active: until == null || now < until,
    expiresAt: until,
    willRenew: !info.unsubscribe_detected_at,
    billingIssue: !!info.billing_issues_detected_at,
    periodType,
    store: lower(info.store),
    productId: ent.product_identifier || null,
    trialUsed: !!prev?.trialUsed || periodType === 'TRIAL',
    at: now
  };
}

export async function revenueCatSubscriber(cfg, uid, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(`${cfg.rc.apiBase}/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: 'Bearer ' + cfg.rc.secretKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000)
  });
  let body = null;
  try { body = await r.json(); } catch { /* the status says enough */ }
  if (!r.ok) throw Object.assign(new Error(body?.message || `revenuecat answered ${r.status}`), { status: r.status });
  return body?.subscriber || null;
}

/* The one Coach plan a profile may ask for without paying, once in the life of the account
   (spec F4). The mark lives on the profile's row, not on a device: clearing the app's data or
   signing in on another phone does not bring it back. A job that fails gives it back — the
   person got nothing for it — but only the job that took it. */
export const freePlanOpen = (user, cfg) => !!cfg.on && !!user && !user.freePlanUsedAt;
export function claimFreePlan(user, jobId, now = Date.now()) {
  user.freePlanUsedAt = new Date(now).toISOString();
  user.freePlanJob = jobId;
}
export function releaseFreePlan(user, jobId) {
  if (!user || !user.freePlanJob || user.freePlanJob !== jobId) return false;
  delete user.freePlanUsedAt;
  delete user.freePlanJob;
  return true;
}
