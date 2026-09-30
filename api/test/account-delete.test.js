/* POST /api/account/delete — a person deleting their own account from the app, which the App
   Store requires of any app that lets people create one. It has to remove everything the admin's
   delete removes, refuse without the typed confirmation, and never leave an instance without an
   admin. */
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
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function startServer(t, users, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-delete-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users, creds: users.map(u => ({ id: 'cred-' + u.id, userId: u.id, publicKey: 'x', counter: 0 })), subs: [{ userId: users[0].id, endpoint: 'https://push.example/1' }], invites: []
  }));
  for (const u of users) fs.writeFileSync(path.join(dataDir, `state-${u.id}.json`), JSON.stringify({ workouts: [{ id: 'w1' }] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0', STRIPE_SECRET_KEY: '', ...env }
  });
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  const port = await boundPort(child, () => log);
  const del = (uid, confirm) => fetch(`http://127.0.0.1:${port}/api/account/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: `gymsid=${mint(uid)}` } : {}) },
    body: JSON.stringify(confirm === undefined ? {} : { confirm })
  });
  return { dataDir, del, db: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')) };
}

test('deleting your own account removes the profile, its passkeys, pushes and history', async t => {
  const h = await startServer(t, [{ id: 'ana', name: 'Ana', created: new Date().toISOString() }, { id: 'bo', name: 'Bo', created: new Date().toISOString() }]);
  assert.equal((await h.del(null, 'Ana')).status, 401);
  // Without the name typed, or with someone else's, nothing happens.
  assert.equal((await h.del('ana')).status, 400);
  assert.equal((await h.del('ana', 'Bo')).status, 400);
  assert.equal(h.db().users.length, 2);

  const r = await h.del('ana', ' Ana ');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') || '', /Max-Age=0/, 'the session cookie is cleared');
  const db = h.db();
  assert.deepEqual(db.users.map(u => u.id), ['bo']);
  assert.deepEqual(db.creds.map(c => c.userId), ['bo']);
  assert.equal(db.subs.length, 0);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-ana.json')), false);
  assert.equal(fs.existsSync(path.join(h.dataDir, 'state-bo.json')), true, 'nobody else is touched');
  // The session that did it no longer resolves to anyone.
  assert.equal((await h.del('ana', 'Ana')).status, 401);
});

test('the last admin cannot delete their own account', async t => {
  const h = await startServer(t, [{ id: 'boss', name: 'Boss', created: new Date().toISOString() }], { ADMIN_UIDS: 'boss' });
  const r = await h.del('boss', 'Boss');
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'last-admin');
  assert.equal(h.db().users.length, 1);
});
