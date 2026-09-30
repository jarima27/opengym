/* The paywall's words and prices, changed from the admin dashboard (paywall.js). What the
   operator relies on: a profile always lands in the same variant, the weights are honoured, a
   field left empty still says something in the right language, a variant's own Stripe price is
   what its checkout charges — and nothing malformed is ever saved. */
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
import { validatePaywall, variantFor, copyFor, createPriceCache, DEFAULTS, PaywallError } from '../paywall.js';

const two = validatePaywall({
  experiment: 'price-test',
  variants: [
    { id: 'a', weight: 50, highlight: 'annual', copy: { es: { title: 'Plan A', bullets: ['uno', '', 'dos'] } } },
    { id: 'b', weight: 50, highlight: 'monthly', prices: { annual: 'price_B' }, copy: { es: { title: 'Plan B' } } }
  ]
});

test('a profile always gets the same variant, and the weights hold over many profiles', () => {
  assert.equal(variantFor(two, 'u1').id, variantFor(two, 'u1').id);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i++) counts[variantFor(two, 'user-' + i).id]++;
  assert.ok(counts.a > 1800 && counts.b > 1800, JSON.stringify(counts));
  const lopsided = validatePaywall({ variants: [{ id: 'a', weight: 90 }, { id: 'b', weight: 10 }] });
  const n = Array.from({ length: 4000 }, (_, i) => variantFor(lopsided, 'x' + i).id).filter(id => id === 'b').length;
  assert.ok(n > 280 && n < 520, String(n));
  // A variant at weight 0 is shown to nobody.
  const off = validatePaywall({ variants: [{ id: 'a', weight: 100 }, { id: 'b', weight: 0 }] });
  assert.ok(Array.from({ length: 500 }, (_, i) => variantFor(off, 'y' + i).id).every(id => id === 'a'));
});

test('an empty field falls back to the built-in words, in the same language when there are some', () => {
  const a = two.variants[0];
  const es = copyFor(a, 'es');
  assert.equal(es.title, 'Plan A');
  assert.deepEqual(es.bullets, ['uno', 'dos'], 'blank bullets are dropped');
  assert.equal(es.later, 'Ahora no');
  assert.equal(copyFor(a, 'es-MX').title, 'Plan A', 'a regional tag reads its language');
  // English asked, no English written: the built-in English — not the Spanish title.
  assert.equal(copyFor(a, 'en').title, DEFAULTS.variants[0].copy.en.title);
  // A language nobody wrote and nothing built in for: English.
  assert.equal(copyFor(a, 'de').cta, 'Start {0} days free');
});

test('nothing malformed is saved', () => {
  const bad = [
    null, { variants: [] }, { variants: new Array(5).fill({ id: 'a', weight: 1 }) },
    { variants: [{ id: 'A B', weight: 1 }] }, { variants: [{ id: 'a', weight: 1 }, { id: 'a', weight: 1 }] },
    { variants: [{ id: 'a', weight: 101 }] }, { variants: [{ id: 'a', weight: 0 }] },
    { variants: [{ id: 'a', weight: 1, prices: { monthly: 'prod_123' } }] }, { experiment: 'no spaces', variants: [{ id: 'a', weight: 1 }] }
  ];
  for (const b of bad) assert.throws(() => validatePaywall(b), PaywallError, JSON.stringify(b));
  // Unknown fields and languages are dropped, long text is cut.
  const ok = validatePaywall({ variants: [{ id: 'a', weight: 1, evil: 1, copy: { es: { title: 'x'.repeat(900), script: '<b>' }, '../etc': { title: 'y' } } }] });
  assert.equal(ok.variants[0].copy.es.title.length, 300);
  assert.deepEqual(Object.keys(ok.variants[0].copy), ['es']);
  assert.equal('evil' in ok.variants[0], false);
});

test('prices are read from Stripe once per ten minutes, and a failure shows no amount', async () => {
  let calls = 0, t = 0;
  const cache = createPriceCache(async id => { calls++; if (id === 'price_bad') throw new Error('down'); return { unit_amount: 3499, currency: 'eur', recurring: { interval: 'year' } }; }, { now: () => t });
  assert.deepEqual(await cache('price_y'), { amount: 3499, currency: 'EUR', interval: 'year' });
  await cache('price_y');
  assert.equal(calls, 1);
  t = 600001;
  await cache('price_y');
  assert.equal(calls, 2);
  assert.equal(await cache('price_bad'), null);
});

/* ------------------------------ against a real server ------------------------------ */

const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url'); };

test('the admin saves a price test; each profile sees its variant, and checks out at its price', async t => {
  const calls = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
      calls.push({ method: req.method, url: req.url, form: new URLSearchParams(b) });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/v1/prices/')) {
        const id = req.url.split('/').pop();
        return res.end(JSON.stringify({ id, unit_amount: id === 'price_B' ? 2999 : id === 'price_Y' ? 3499 : 499, currency: 'eur', recurring: { interval: id === 'price_M' ? 'month' : 'year' } }));
      }
      res.end(JSON.stringify({ url: 'https://checkout.stripe.test/x' }));
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  t.after(() => fake.close());

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-paywall-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  const users = [{ id: 'boss', name: 'Boss', created: new Date().toISOString() }, ...Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, created: new Date().toISOString() }))];
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0', ADMIN_UIDS: 'boss',
      STRIPE_SECRET_KEY: 'sk_test', STRIPE_PRICE_MONTHLY: 'price_M', STRIPE_PRICE_ANNUAL: 'price_Y', STRIPE_TRIAL_DAYS: '30', TRIAL_DAYS: '0',
      STRIPE_API_BASE: `http://127.0.0.1:${fake.address().port}`, STRIPE_WEBHOOK_SECRET: 'whsec'
    }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const api = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  const call = (p, uid, body) => fetch(api + p, { method: body ? 'POST' : 'GET', headers: { Cookie: `gymsid=${mint(uid)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

  // Before anything is saved: the built-in paywall, with the instance's prices.
  const first = await (await call('/api/paywall?lang=es', 'p0')).json();
  assert.equal(first.variant, 'a');
  assert.equal(first.copy.cta, 'Empezar {0} días gratis');
  assert.equal(first.cardTrialDays, 30);
  assert.deepEqual(first.plans, { monthly: { amount: 499, currency: 'EUR', interval: 'month' }, annual: { amount: 3499, currency: 'EUR', interval: 'year' } });

  assert.equal((await call('/api/admin/paywall', 'p0', { paywall: two })).status, 403);
  assert.equal((await call('/api/admin/paywall', 'boss', { paywall: { variants: [] } })).status, 400);
  assert.equal((await call('/api/admin/paywall', 'boss', { paywall: two })).status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, 'paywall.json')), 'kept where the backups are');

  const seen = {};
  for (let i = 0; i < 40; i++) {
    const p = await (await call('/api/paywall?lang=es', 'p' + i)).json();
    seen[p.variant] = p;
  }
  assert.deepEqual(Object.keys(seen).sort(), ['a', 'b'], 'forty profiles see both variants');
  assert.equal(seen.b.copy.title, 'Plan B');
  assert.equal(seen.b.highlight, 'monthly');
  assert.equal(seen.b.plans.annual.amount, 2999, 'variant b’s own annual price');
  assert.equal(seen.a.plans.annual.amount, 3499);

  // And the checkout charges the variant's price.
  const inB = users.slice(1).find(u => variantFor(two, u.id).id === 'b');
  await call('/api/billing/checkout', inB.id, { plan: 'annual' });
  assert.equal(calls.filter(c => c.url === '/v1/checkout/sessions').at(-1).form.get('line_items[0][price]'), 'price_B');
  const inA = users.slice(1).find(u => variantFor(two, u.id).id === 'a');
  await call('/api/billing/checkout', inA.id, { plan: 'annual' });
  assert.equal(calls.filter(c => c.url === '/v1/checkout/sessions').at(-1).form.get('line_items[0][price]'), 'price_Y');
});
