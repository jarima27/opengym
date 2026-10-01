/* The smart reminders through the real server: the reminder tick plans today's nudge
   (coach/core/nudges.js) on the user's own clock and sends it once — recorded on the user's row
   so no later tick, and no restart, sends it again. Real server.js in a child, a short tick, and a
   push endpoint on localhost that PUSH_AGENT refuses, so nothing leaves the machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const created = new Date(Date.now() - 30 * 86400000).toISOString();
const USERS = [
  { id: 'u_test_1', name: 'One', created },
  { id: 'u_test_2', name: 'Two', created }
];
const keys = { p256dh: 'p', auth: 'a' };
const subs = USERS.map(u => ({ userId: u.id, endpoint: 'https://localhost/x', keys, created }));

async function startServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nudges-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs, invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', REMINDER_TICK_MS: '300' }
  });
  const h = { dataDir, child, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.port = await boundPort(child, () => h.log);
  return h;
}

// "now" minus some minutes on the UTC clock, the way server.js userNow() reads it.
const utc = (minsAgo = 0) => {
  const d = new Date(Date.now() - minsAgo * 60000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = type => parts.find(p => p.type === type)?.value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const yesterday = iso => new Date(Date.parse(iso + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);

const state = (todayTime, over = {}) => ({
  lang: 'es',
  reminder: { on: false, time: '08:00', tz: 'UTC' },
  // only "trained today?" in play: a run on a Sunday at 19:00 must not meet the week's summary
  nudges: { todayTime, weekly: false, comeback: false },
  routines: [{ id: 'r1', name: 'Pierna', ex: [{ id: 'squat' }] }],
  week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' },
  workouts: [{ id: 'w0', d: yesterday(utc().date), vol: 1000 }],
  ...over
});

test('"trained today?" goes out once on the user’s clock, is recorded, and a user with no known clock gets nothing', async t => {
  const late = utc(2);
  if (late.date !== utc().date) return t.skip('just after midnight UTC — a same-day window cannot be set up');
  const h = await startServer(t);
  fs.writeFileSync(path.join(h.dataDir, 'state-u_test_1.json'), JSON.stringify(state(late.hhmm)));
  // the same plan, but no timezone ever stamped: nobody's evening is known
  const noClock = state(late.hhmm);
  noClock.reminder = { on: false, time: '08:00', tz: null };
  fs.writeFileSync(path.join(h.dataDir, 'state-u_test_2.json'), JSON.stringify(noClock));

  const key = `today:${late.date}`;
  const firings = () => (h.log.match(new RegExp(`nudge firing u_test_1 ${key}`, 'g')) || []).length;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !firings()) await wait(300);
  assert.equal(firings(), 1, h.log);
  await wait(1500); // several more ticks
  assert.equal(firings(), 1, 'sent again inside its window');
  assert.doesNotMatch(h.log, /nudge firing u_test_2/, 'a user whose clock is unknown is left alone');
  assert.doesNotMatch(h.log, /reminder tick/, h.log);

  const db = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8'));
  const u1 = db.users.find(u => u.id === 'u_test_1');
  assert.equal(u1.nudges.today, key);
  assert.equal(u1.nudgedOn, late.date);
});

test('a day already trained, a nudge switched off, or one 40 minutes past its time stays silent', async t => {
  const late = utc(2), stale = utc(40);
  if (stale.date !== utc().date) return t.skip('too close to midnight UTC — a same-day window cannot be set up');
  const h = await startServer(t);
  const file = uid => path.join(h.dataDir, `state-${uid}.json`);
  fs.writeFileSync(file('u_test_1'), JSON.stringify(state(late.hhmm, { workouts: [{ id: 'w1', d: late.date, vol: 500 }] })));
  fs.writeFileSync(file('u_test_2'), JSON.stringify(state(late.hhmm, { nudges: { todayTime: late.hhmm, today: false, weekly: false, comeback: false } })));
  await wait(2000);
  fs.writeFileSync(file('u_test_1'), JSON.stringify(state(stale.hhmm)));
  await wait(2000);
  assert.doesNotMatch(h.log, /nudge firing/, h.log);
  assert.equal(h.child.exitCode, null, h.log);
});
