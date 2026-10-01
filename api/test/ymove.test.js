/* Exercise videos from YMove (ymove.js, spec F10): what the hosted version shows instead of the
   dataset's animations, and the promises behind it — the key never leaves the server, one URL per
   exercise shared by everybody and renewed every 24 hours, only the studio take, no broken gap
   when YMove cannot give a video, and a switch that turns it all off. Against a fake YMove. */
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
import { ymoveConfig, exerciseMediaConfig, studioOf, createVideoStore, loadMap, YmoveDown, URL_TTL_MS } from '../ymove.js';

const HOUR = 3600000;
const T0 = Date.parse('2026-10-01T12:00:00Z');

/* ------------------------------ config ------------------------------ */

test('a self-hosted instance answers exactly as before; the paid one never shows the dataset', () => {
  const plain = ymoveConfig({});
  assert.deepEqual([plain.on, plain.video, plain.dataset], [false, false, true]);
  assert.equal(exerciseMediaConfig(plain), null, 'no exercise_media block at all');

  // Selling access without YMove: no Gym visual media, and no video either — the text stays.
  assert.deepEqual(exerciseMediaConfig(ymoveConfig({}, { selling: true })), { dataset: false, video: false });
  // With YMove.
  assert.deepEqual(exerciseMediaConfig(ymoveConfig({ YMOVE_API_KEY: 'ym_x' })), { dataset: false, video: true });
  // The switch: configured, but off.
  const off = ymoveConfig({ YMOVE_API_KEY: 'ym_x', YMOVE_VIDEOS: 'off' });
  assert.deepEqual([off.on, off.video], [true, false]);
  assert.deepEqual(exerciseMediaConfig(off), { dataset: false, video: false });
  // The operator's word wins either way.
  assert.equal(ymoveConfig({ DATASET_MEDIA: 'off' }).dataset, false);
  assert.equal(ymoveConfig({ DATASET_MEDIA: 'on' }, { selling: true }).dataset, true);
});

/* ------------------------------ the studio take ------------------------------ */

const video = (tag, isPrimary, n = 1) => ({
  tag, isPrimary, orientation: 'portrait',
  videoUrl: `https://cdn.test/${tag}-${n}.mp4?token=t${n}`,
  thumbnailUrl: `https://ymove.test/thumb/${tag}-${n}?crop=default`,
  thumbnails: { default: `https://ymove.test/thumb/${tag}-${n}?crop=default`, square: `https://ymove.test/thumb/${tag}-${n}?crop=square` }
});

test('only the white-background take, the primary one first; a gym shot is never used', () => {
  const s = studioOf({ videos: [video('gym-shot', true), video('white-background', false, 2), video('white-background', true, 3)] });
  assert.equal(s.url, 'https://cdn.test/white-background-3.mp4?token=t3');
  assert.equal(s.poster, 'https://ymove.test/thumb/white-background-3?crop=default');
  assert.equal(s.thumb, 'https://ymove.test/thumb/white-background-3?crop=square');
  assert.equal(studioOf({ videos: [video('white-background', false, 4)] }).url, 'https://cdn.test/white-background-4.mp4?token=t4');
  assert.equal(studioOf({ videos: [video('gym-shot', true)] }), null);
  assert.equal(studioOf({ videoUrl: 'https://cdn.test/primary.mp4', videos: [] }), null);
  assert.equal(studioOf(null), null);
});

test('the table: ids with a YMove exercise; reviewed-out entries and junk left out', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ymove-map-')), 'map.json');
  fs.writeFileSync(f, JSON.stringify({ map: { '0025': { ym: 'barbell-bench-press', by: 'review' }, '0043': 'barbell-back-squat', '0001': { ym: null, by: 'review' }, x: { ym: 'y' } } }));
  assert.deepEqual(loadMap(f), { '0025': 'barbell-bench-press', '0043': 'barbell-back-squat' });
  assert.deepEqual(loadMap(f + '.missing'), {});
  // The committed table parses.
  assert.equal(typeof loadMap(new URL('../ymove-map.json', import.meta.url)), 'object');
});

/* ------------------------------ the shared cache ------------------------------ */

/** A fetch standing in for YMove: `answers[slug]` is what it says, the calls are recorded. */
function fakeFetch(answers) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, key: opts.headers['X-API-Key'] });
    const slug = decodeURIComponent(url.split('/').pop());
    const a = typeof answers[slug] === 'function' ? answers[slug]() : answers[slug];
    if (a instanceof Error) throw a;
    if (!a) return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    if (a.status) return { ok: a.status < 400, status: a.status, json: async () => a.body || {} };
    return { ok: true, status: 200, json: async () => a };
  };
  f.calls = calls;
  return f;
}
const CFG = ymoveConfig({ YMOVE_API_KEY: 'ym_secret', YMOVE_API_BASE: 'https://ymove.test/api/v2' });
const MAP = { '0025': 'barbell-bench-press', '0043': 'barbell-back-squat', '0032': 'barbell-deadlift' };

test('one URL per exercise, shared, renewed after 24 hours', async () => {
  let clock = T0, n = 0;
  const fetchImpl = fakeFetch({ 'barbell-bench-press': () => ({ data: { videos: [video('white-background', true, ++n)] } }) });
  const saved = [];
  const store = createVideoStore({ cfg: CFG, map: MAP, fetchImpl, now: () => clock, persist: o => saved.push(o) });

  const a = await store.get('0025');
  assert.equal(a.url, 'https://cdn.test/white-background-1.mp4?token=t1');
  assert.equal(a.poster, 'https://ymove.test/thumb/white-background-1?crop=default');
  assert.equal(fetchImpl.calls[0].url, 'https://ymove.test/api/v2/exercises/barbell-bench-press');
  assert.equal(fetchImpl.calls[0].key, 'ym_secret');

  // Everybody else that day gets the same URL, without asking YMove.
  clock += 23 * HOUR;
  assert.equal(store.needsFetch('0025'), false);
  assert.equal((await store.get('0025')).url, a.url);
  assert.equal(fetchImpl.calls.length, 1);

  // A day on: a new one.
  clock = T0 + URL_TTL_MS;
  assert.equal(store.needsFetch('0025'), true);
  assert.equal((await store.get('0025')).url, 'https://cdn.test/white-background-2.mp4?token=t2');
  assert.equal(fetchImpl.calls.length, 2);

  // Kept across a restart.
  const again = createVideoStore({ cfg: CFG, map: MAP, saved: saved.at(-1), fetchImpl, now: () => clock });
  assert.equal((await again.get('0025')).url, 'https://cdn.test/white-background-2.mp4?token=t2');
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(again.thumbs(), { '0025': 'https://ymove.test/thumb/white-background-2?crop=square' });
});

test('many viewers at once make one request', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const fetchImpl = fakeFetch({});
  const slow = async (url, opts) => { await gate; return fakeFetch({ 'barbell-back-squat': { data: { videos: [video('white-background', true)] } } })(url, opts); };
  let calls = 0;
  const store = createVideoStore({ cfg: CFG, map: MAP, fetchImpl: (u, o) => { calls++; return slow(u, o); }, now: () => T0 });
  const all = Promise.all([store.get('0043'), store.get('0043'), store.get('0043')]);
  release();
  const got = await all;
  assert.equal(calls, 1);
  assert.ok(got.every(g => g.url === got[0].url));
  void fetchImpl;
});

test('no video, the monthly cap, YMove down: never a broken gap, never a guess', async () => {
  let clock = T0;
  let deadlift = { data: { videos: [video('white-background', true, 7)] } };
  const fetchImpl = fakeFetch({
    'barbell-bench-press': { data: { videos: [video('gym-shot', true)] } },   // no studio take
    'barbell-deadlift': () => deadlift
  });
  const store = createVideoStore({ cfg: CFG, map: MAP, fetchImpl, now: () => clock });

  // Only a gym shot: no video, and YMove is not asked again for a week.
  assert.equal(await store.get('0025'), null);
  assert.equal(store.needsFetch('0025'), false);
  // Not in the table, or not in YMove at all: no video.
  assert.equal(await store.get('0001'), null);
  assert.equal(await store.get('0043'), null, 'YMove answered 404');
  const asked = fetchImpl.calls.length;
  assert.equal(await store.get('0043'), null);
  assert.equal(fetchImpl.calls.length, asked, 'remembered');

  // A video, then the cap: the still stays, and the URL while it is still good.
  const first = await store.get('0032');
  assert.ok(first.url);
  clock += 25 * HOUR;
  deadlift = { data: { videos: [] }, _warning: { reason: 'monthly_exercise_cap' } };
  assert.deepEqual(await store.get('0032'), { url: first.url, poster: first.poster });
  clock += 23 * HOUR;
  assert.deepEqual(await store.get('0032'), { url: null, poster: first.poster }, 'past 47 h the URL is not handed out');

  // YMove down with the still kept: the still. With nothing kept: YmoveDown.
  clock += 7 * HOUR;
  deadlift = new Error('ECONNRESET');
  assert.deepEqual(await store.get('0032'), { url: null, poster: first.poster });
  const bare = createVideoStore({ cfg: CFG, map: MAP, fetchImpl: fakeFetch({ 'barbell-bench-press': { status: 503 } }), now: () => T0 });
  await assert.rejects(bare.get('0025'), YmoveDown);
  const refused = createVideoStore({ cfg: CFG, map: MAP, fetchImpl: fakeFetch({ 'barbell-bench-press': { status: 401 } }), now: () => T0, log: { error() {} } });
  await assert.rejects(refused.get('0025'), YmoveDown);
});

test('a URL that failed to load can be renewed, at most every ten minutes', async () => {
  let clock = T0, n = 0;
  const fetchImpl = fakeFetch({ 'barbell-bench-press': () => ({ data: { videos: [video('white-background', true, ++n)] } }) });
  const store = createVideoStore({ cfg: CFG, map: MAP, fetchImpl, now: () => clock });
  await store.get('0025');
  clock += 5 * 60000;
  assert.equal(store.needsFetch('0025', { refresh: true }), false);
  assert.equal((await store.get('0025', { refresh: true })).url, 'https://cdn.test/white-background-1.mp4?token=t1');
  clock += 6 * 60000;
  assert.equal((await store.get('0025', { refresh: true })).url, 'https://cdn.test/white-background-2.mp4?token=t2');
  assert.equal((await store.get('0025', { refresh: true })).url, 'https://cdn.test/white-background-2.mp4?token=t2', 'not again straight away');
});

test('switched off: nothing is asked', async () => {
  const fetchImpl = fakeFetch({ 'barbell-bench-press': { data: { videos: [video('white-background', true)] } } });
  const store = createVideoStore({ cfg: ymoveConfig({ YMOVE_API_KEY: 'ym_x', YMOVE_VIDEOS: 'off' }), map: MAP, fetchImpl });
  assert.equal(await store.get('0025'), null);
  assert.equal(fetchImpl.calls.length, 0);
});

/* ------------------------------ against server.js ------------------------------ */

const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function fakeYmove(t) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    calls.push({ url: req.url, key: req.headers['x-api-key'] });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-api-key'] !== 'ym_test_key') { res.statusCode = 401; return res.end('{"error":"bad key"}'); }
    if (req.url === '/api/v2/exercises/barbell-bench-press') return res.end(JSON.stringify({ data: { title: 'Barbell Bench Press', videos: [video('white-background', true)] } }));
    res.statusCode = 404; res.end('{"error":"not found"}');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  return { base: `http://127.0.0.1:${srv.address().port}/api/v2`, calls };
}

async function startServer(t, env, { before = () => {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-ymove-'));
  before(dataDir);
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'U', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }));
  const mapFile = path.join(dataDir, 'map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ map: { '0025': { ym: 'barbell-bench-press' }, '0043': { ym: 'barbell-back-squat' } } }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0',
      STRIPE_SECRET_KEY: '', STRIPE_PRICE_ID: '', REVENUECAT_WEBHOOK_AUTH: '', YMOVE_API_KEY: '', YMOVE_VIDEOS: '', DATASET_MEDIA: '',
      YMOVE_MAP_FILE: mapFile, ...env
    }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const call = (p, uid) => fetch(`http://127.0.0.1:${port}${p}`, { headers: uid ? { Cookie: `gymsid=${mint(uid)}` } : {} });
  return { call, dataDir, log: () => log };
}

test('the routes: signed in only, the key never in an answer, a still for the lists', async t => {
  const ym = await fakeYmove(t);
  const h = await startServer(t, { YMOVE_API_KEY: 'ym_test_key', YMOVE_API_BASE: ym.base });
  const cfg = await (await h.call('/api/config')).json();
  assert.deepEqual(cfg.exercise_media, { dataset: false, video: true });

  assert.equal((await h.call('/api/media/video/0025')).status, 401);
  const r = await h.call('/api/media/video/0025', 'u1');
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.doesNotMatch(text, /ym_test_key/);
  assert.deepEqual(JSON.parse(text), { url: 'https://cdn.test/white-background-1.mp4?token=t1', poster: 'https://ymove.test/thumb/white-background-1?crop=default' });
  assert.equal(ym.calls.length, 1);
  assert.equal(ym.calls[0].key, 'ym_test_key');
  // The second viewer is served from the cache.
  assert.equal((await h.call('/api/media/video/0025', 'u1')).status, 200);
  assert.equal(ym.calls.length, 1);

  const none = await h.call('/api/media/video/0043', 'u1');
  assert.equal(none.status, 404);
  assert.equal((await none.json()).code, 'none');
  assert.equal((await h.call('/api/media/video/0001', 'u1')).status, 404, 'not in the table: YMove is not asked');
  assert.equal(ym.calls.length, 2);
  assert.equal((await h.call('/api/media/video/abc', 'u1')).status, 404);

  assert.deepEqual(await (await h.call('/api/media/posters', 'u1')).json(), { posters: { '0025': 'https://ymove.test/thumb/white-background-1?crop=square' } });
  assert.ok(fs.existsSync(path.join(h.dataDir, 'ymove-cache.json')));
});

test('switched off: 410 for the app, and the server drops what it kept', async t => {
  // A cache left by the run before the switch.
  const h = await startServer(t, { YMOVE_API_KEY: 'ym_test_key', YMOVE_VIDEOS: 'off' }, { before: d => fs.writeFileSync(path.join(d, 'ymove-cache.json'), '{"v":1,"entries":{}}') });
  assert.equal(fs.existsSync(path.join(h.dataDir, 'ymove-cache.json')), false);
  const r = await h.call('/api/media/video/0025', 'u1');
  assert.equal(r.status, 410);
  assert.equal((await r.json()).code, 'off');
  assert.deepEqual((await (await h.call('/api/config')).json()).exercise_media, { dataset: false, video: false });
});

test('without a key the routes do not exist and the config is as before', async t => {
  const h = await startServer(t, {});
  assert.equal((await h.call('/api/media/video/0025', 'u1')).status, 404);
  assert.equal((await h.call('/api/media/posters', 'u1')).status, 404);
  assert.equal('exercise_media' in await (await h.call('/api/config')).json(), false);
});
