/* Lifecycle emails (emails.js): which one is due and when, what the first week's numbers are,
   that every language has every word, the unsubscribe token — and, against a real server.js with
   a fake Resend behind RESEND_API_BASE, that a sign-up gets its welcome in its own language with
   a one-click unsubscribe that works, and that without the key nothing is ever sent. */
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
import { emailConfig, contactOf, dueEmail, firstWeek, renderEmail, unsubscribePage, unsubToken, unsubOk, resendBody, emailCopy } from '../emails.js';
import { EMAIL_COPY } from '../emails-copy.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const user = (over = {}) => ({ id: 'u1', name: 'Ana López', created: iso(NOW - 1 * 3600000), email: 'ana@example.com', ...over });
const done = d => ({ id: 'w' + d, d, start: Date.parse(d + 'T18:00:00Z'), end: Date.parse(d + 'T19:00:00Z'), prs: [], entries: [{ id: '0043', sets: [{ w: 60, r: 5, done: true }] }] });

/* ------------------------------ the rules ------------------------------ */

test('off without RESEND_API_KEY; the sender and the address it goes from', () => {
  assert.equal(emailConfig({}).on, false);
  const c = emailConfig({ RESEND_API_KEY: 're_x', RESEND_FROM: 'Tiza <hola@tiza.fit>' });
  assert.deepEqual([c.on, c.from, c.apiBase], [true, 'Tiza <hola@tiza.fit>', 'https://api.resend.com']);
});

test('an address to write to: the sign-in e-mail, or the one a provider vouched for', () => {
  assert.equal(contactOf({ email: 'a@b.co' }), 'a@b.co');
  assert.equal(contactOf({ contact: { email: 'x@privaterelay.appleid.com' } }), 'x@privaterelay.appleid.com');
  assert.equal(contactOf({ name: 'no address' }), null);
  assert.equal(contactOf({ email: 'not an address' }), null);
});

test('welcome at once, day 3 only without a workout, the first week a week in — each once', () => {
  const at = h => ({ now: Date.parse(user().created) + h * 3600000 });
  assert.equal(dueEmail(user(), {}, at(0)), 'welcome');
  assert.equal(dueEmail(user({ emails: { welcome: 'x' } }), {}, at(1)), null);
  assert.equal(dueEmail(user({ emails: { welcome: 'x' } }), { workouts: [] }, at(72)), 'day3');
  assert.equal(dueEmail(user({ emails: { welcome: 'x' } }), { workouts: [done('2026-10-11')] }, at(72)), null, 'trained: no nudge');
  assert.equal(dueEmail(user({ emails: { welcome: 'x' } }), {}, at(5 * 24)), null, 'day 3 is over by day 5');
  assert.equal(dueEmail(user({ emails: { welcome: 'x', day3: 'x' } }), {}, at(7 * 24 + 1)), 'week1');
  assert.equal(dueEmail(user({ emails: { welcome: 'x', day3: 'x', week1: 'x' } }), {}, at(8 * 24)), null);
  // A welcome that never went is not sent days late.
  assert.equal(dueEmail(user(), {}, at(50)), null);
});

test('never to someone who unsubscribed, has no address, is disabled, or signed up before emails were on', () => {
  const now = Date.parse(user().created) + 60000;
  assert.equal(dueEmail(user({ emailOptOut: iso(now) }), {}, { now }), null);
  assert.equal(dueEmail(user({ email: undefined }), {}, { now }), null);
  assert.equal(dueEmail(user({ disabled: true }), {}, { now }), null);
  assert.equal(dueEmail(user(), {}, { now, since: now }), null);
});

test('the first week in numbers: workouts, work sets, volume and records, warm-ups left out', () => {
  const created = '2026-10-01T10:00:00Z';
  const S = {
    unit: 'kg',
    workouts: [
      { ...done('2026-10-02'), prs: ['0043'], entries: [{ id: '0043', sets: [{ w: 20, r: 10, done: true, phase: 'warmup' }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: false }] }] },
      done('2026-10-05'),
      done('2026-10-12')   // the second week
    ]
  };
  assert.deepEqual(firstWeek(S, created), { workouts: 2, sets: 3, volume: 900, records: 1, unit: 'kg' });
  assert.deepEqual(firstWeek({}, created), { workouts: 0, sets: 0, volume: 0, records: 0, unit: 'kg' });
});

test('every language has every word, and the emails read in it', () => {
  const shape = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.keys(v).sort()]));
  for (const [lang, copy] of Object.entries(EMAIL_COPY)) {
    assert.deepEqual(shape(copy), shape(EMAIL_COPY.en), lang);
    assert.ok(copy.welcome.titleName.includes('{name}'), lang);
    for (const kind of ['welcome', 'day3', 'week1']) {
      const m = renderEmail(kind, { name: 'Ana', week: { workouts: 2, sets: 9, volume: 1500, records: 1, unit: 'kg' } }, lang, { app: 'https://app.tiza.fit', unsubscribe: 'https://app.tiza.fit/api/email/unsubscribe?u=1&t=x' });
      assert.ok(m.subject && m.html.includes(m.subject) && m.text.length > 40, `${lang} ${kind}`);
      assert.ok(!/\{\w+\}/.test(m.html + m.text), `${lang} ${kind}: a placeholder left`);
      assert.ok(m.html.includes('unsubscribe?u=1'), `${lang} ${kind}: no unsubscribe link`);
    }
  }
  assert.ok(renderEmail('welcome', { name: 'Ana López' }, 'es').html.includes('¡Hola, Ana!'));
  assert.ok(renderEmail('welcome', {}, 'es').html.includes('¡Te damos la bienvenida a Tiza!'));
  assert.ok(renderEmail('welcome', {}, 'ar').html.includes('dir="rtl"'));
  assert.equal(emailCopy('de-CH').welcome.cta, 'Tiza öffnen');
  assert.equal(emailCopy('xx').welcome.cta, 'Open Tiza');
  // The first week: the numbers as cells, or the plan still waiting.
  const w = renderEmail('week1', { week: { workouts: 3, sets: 30, volume: 12500, records: 2, unit: 'kg' } }, 'es');
  assert.ok(w.html.includes('12.500 kg') && w.html.includes('Récords'));
  assert.ok(renderEmail('week1', { week: { workouts: 0 } }, 'es').html.includes('Tu plan sigue esperándote'));
  // Names are text, never markup.
  assert.ok(!renderEmail('welcome', { name: '<script>x' }, 'en').html.includes('<script>x'));
});

test('the unsubscribe token: one profile’s, under the server’s secret', () => {
  const t = unsubToken('u1', 's3cret');
  assert.equal(unsubOk('u1', t, 's3cret'), true);
  assert.equal(unsubOk('u2', t, 's3cret'), false);
  assert.equal(unsubOk('u1', t, 'other'), false);
  assert.equal(unsubOk('u1', t.slice(1), 's3cret'), false);
  assert.ok(unsubscribePage('es', 'out', '/x').includes('Ya no recibirás estos correos'));
  const b = resendBody(emailConfig({ RESEND_API_KEY: 'k' }), 'a@b.co', { subject: 's', html: 'h', text: 't' }, { unsubscribe: 'https://x/u', kind: 'welcome' });
  assert.deepEqual(b.headers, { 'List-Unsubscribe': '<https://x/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
  assert.deepEqual([b.to, b.tags], [['a@b.co'], [{ name: 'kind', value: 'welcome' }]]);
});

/* ------------------------------ against the server ------------------------------ */

const SECRET = crypto.randomBytes(32).toString('hex');

async function fakeResend(t) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], body: JSON.parse(body || '{}') });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'em_' + seen.length }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${srv.address().port}`, seen };
}

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-emails-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'https://app.example', RP_ID: 'localhost', COACH_DISABLED: '1', MEDIA_UPLOADS: '0', PASSWORD_LOGIN: '1', EMAIL_FIRST_MS: '50', RESEND_API_KEY: '', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const base = `http://127.0.0.1:${port}`;
  const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return { base, stored };
}
const settle = async (cond, ms = 4000) => { for (let i = 0; i < ms / 25 && !cond(); i++) await new Promise(r => setTimeout(r, 25)); };
const signUp = (base, name, email, lang) => fetch(base + '/api/register/password', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name, password: 'correct horse battery staple', email, src: { platform: 'web', lang } })
});

test('a sign-up gets its welcome, in its language, with a one-click unsubscribe that works', async t => {
  const resend = await fakeResend(t);
  const h = await startServer(t, { RESEND_API_KEY: 're_test', RESEND_API_BASE: resend.base, RESEND_FROM: 'Tiza <hola@tiza.fit>' });
  const r = await signUp(h.base, 'Ana López', 'ana@example.com', 'es');
  assert.equal(r.status, 200);
  const uid = (await r.json()).user.id;
  await settle(() => resend.seen.length > 0);
  assert.equal(resend.seen.length, 1);
  const mail = resend.seen[0];
  assert.deepEqual([mail.method, mail.url, mail.auth, mail.idem], ['POST', '/emails', 'Bearer re_test', `${uid}-welcome`]);
  assert.deepEqual([mail.body.from, mail.body.to, mail.body.subject], ['Tiza <hola@tiza.fit>', ['ana@example.com'], 'Te damos la bienvenida a Tiza']);
  assert.ok(mail.body.html.includes('¡Hola, Ana!'));
  const link = /<(https:\/\/app\.example\/api\/email\/unsubscribe\?[^>]+)>/.exec(mail.body.headers['List-Unsubscribe'])[1];
  assert.equal(mail.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  await settle(() => h.stored().users[0].emails?.welcome);
  assert.ok(h.stored().users[0].emails.welcome, 'recorded as sent');

  // The link, followed: unsubscribed, a page in Spanish that offers to undo it.
  const path = link.replace('https://app.example', '');
  const page = await fetch(h.base + path);
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('Ya no recibirás estos correos'));
  assert.ok(h.stored().users[0].emailOptOut);
  const back = await fetch(h.base + path.replace('/unsubscribe', '/resubscribe'), { method: 'POST' });
  assert.ok((await back.text()).includes('volverás a recibirlos'));
  assert.equal(h.stored().users[0].emailOptOut, undefined);
  // A mail client's one-click POST.
  const one = await fetch(h.base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  assert.deepEqual([one.status, await one.text()], [200, 'ok']);
  assert.ok(h.stored().users[0].emailOptOut);
  // Someone else's id, or a forged token: nothing changes.
  assert.equal((await fetch(h.base + `/api/email/unsubscribe?u=${uid}&t=forged`)).status, 404);
  // No address: no email.
  await signUp(h.base, 'Bo', undefined, 'en');
  await new Promise(r => setTimeout(r, 300));
  assert.equal(resend.seen.length, 1);
});

test('without RESEND_API_KEY nothing is ever sent', async t => {
  const resend = await fakeResend(t);
  const h = await startServer(t, { RESEND_API_BASE: resend.base });
  assert.equal((await signUp(h.base, 'Cy', 'cy@example.com', 'en')).status, 200);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(resend.seen.length, 0);
  assert.equal(h.stored().emailsSince, undefined);
});
