/* The pure half of what a hosted instance does to grow: codes and what they give, and the
   feedback people send. server.js keeps the routes, the records and the calls out (Stripe).

   One table of codes (db.codes), three kinds:

     creator  no `kind`, as the first version wrote them: whoever signs up with it gets `days`
              on top of the open trial, and is counted under it (user.src.ref).
     tester   Pro for good: whoever redeems it is marked `comp` (billing.js: plan 'free', the
              Coach included) — at sign-up or any time after. Uses are counted; `max` caps them
              (0: no cap). Revoking it stops new redemptions; nobody loses what they have.
     friend   one per person (`owner`), made the first time they open "Invite a friend": the
              friend who signs up with it gets FRIEND_DAYS on the trial, and the owner as many
              days of Pro on top of whatever they have — up to MAX_FRIEND_REWARDS friends.

   A creator's or a friend's code belongs to the sign-up, so it can also be typed in during the
   first REDEEM_WINDOW_DAYS (the guided first run asks for it just before the paywall). On an
   iPhone a creator's code can stand for an Apple offer code (`appleOffer`, made in App Store
   Connect): typed in, it is redeemed in the App Store instead of giving days here. */
import crypto from 'node:crypto';

const DAY = 86400000;
export const FRIEND_DAYS = 30;
export const MAX_FRIEND_REWARDS = 12;
export const REDEEM_WINDOW_DAYS = 7;
export const CODE_RE = /^[A-Z0-9_-]{2,24}$/;

export const kindOf = row => (row?.kind === 'tester' || row?.kind === 'friend' ? row.kind : 'creator');
export const normalizeCode = s => String(s ?? '').trim().toUpperCase();

/** What a code gives a new profile, in days on the trial (a tester code gives Pro instead). */
export const codeDays = row => (kindOf(row) === 'friend' ? FRIEND_DAYS : kindOf(row) === 'tester' ? 0 : Math.max(0, +row?.days || 0));

/**
 * Whether `user` may redeem `row` now — null — or why not: 'unknown', 'revoked', 'full' (a
 * tester code at its cap), 'already' (Pro for good already), 'own' (one's own invite), 'used'
 * (a sign-up code already counts for this profile), 'late' (past the first week).
 */
export function redeemCheck(row, user, { now = Date.now() } = {}) {
  if (!row) return 'unknown';
  if (row.revoked) return 'revoked';
  if (kindOf(row) === 'tester') {
    if (user?.comp === true) return 'already';
    if (row.max > 0 && (row.uses || 0) >= row.max) return 'full';
    return null;
  }
  if (row.owner && row.owner === user?.id) return 'own';
  if (user?.src?.ref) return 'used';
  if (now - (Date.parse(user?.created) || 0) > REDEEM_WINDOW_DAYS * DAY) return 'late';
  return null;
}

/**
 * What a code does to the profile that signs up with it, or redeems it later. A tester code
 * marks it Pro for good and counts the use; a creator's or a friend's sets its days and counts
 * the profile under the code. Returns the id of the friend to reward, if any.
 */
export function applyCode(row, user, { signup = false, apple = false } = {}) {
  // A creator's Apple offer code, redeemed in the App Store: what it gives is Apple's (free or
  // cheaper time on the subscription), so the profile is only counted under the creator.
  if (apple) {
    user.src = { ...(user.src || {}), ref: row.code };
    return null;
  }
  if (kindOf(row) === 'tester') {
    user.comp = true;
    user.compCode = row.code;
    row.uses = (row.uses || 0) + 1;
    if (signup) user.src = { ...(user.src || {}), ref: row.code };
    return null;
  }
  user.src = { ...(user.src || {}), ref: row.code };
  user.bonusDays = codeDays(row);
  return kindOf(row) === 'friend' ? row.owner || null : null;
}

/**
 * A friend signed up with `owner`'s code: counted, and — up to MAX_FRIEND_REWARDS — rewarded.
 * `bank`: the days are kept on the profile (`bonusUntil`, read by billing.js as more open
 * trial) on top of `freeUntil`, the end of whatever free or paid-up time it already has. The
 * caller passes bank: false when it gave the days another way (a Stripe charge moved back).
 * Returns whether this one was rewarded.
 */
export function rewardOwner(owner, { now = Date.now(), freeUntil = 0, bank = true } = {}) {
  const inv = (owner.invites = { signups: 0, rewarded: 0, ...(owner.invites || {}) });
  inv.signups++;
  if (inv.rewarded >= MAX_FRIEND_REWARDS) return false;
  inv.rewarded++;
  if (bank) owner.bonusUntil = Math.max(now, freeUntil || 0, owner.bonusUntil || 0) + FRIEND_DAYS * DAY;
  return true;
}

// No 0/O or 1/I: a code read out loud or copied from a story should not be mistyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A friend code for `user`: their name's first letters and four random ones — "ANA-7K3P". */
export function makeFriendCode(user, taken, rand = n => crypto.randomBytes(n)) {
  const base = String(user?.name || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 8) || 'TIZA';
  for (let i = 0; i < 50; i++) {
    const bytes = rand(4);
    const tail = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
    const code = `${base}-${tail}`;
    if (!taken(code)) return code;
  }
  throw new Error('no free friend code');
}

/* ------------------------------ the creator program ------------------------------ */
/* What each creator's code brought in, month by month, for paying them by hand from a CSV — no
   payouts, no creator pages. One ledger (db.creatorEvents), one line per event:

     signup   a profile counted under the code: signed up with it (a link, a store install
              referrer), typed it in, or redeemed the creator's Apple offer code
     trial    that profile started a subscription's free trial (website or store), once
     paid     its first paid period, once — a paying customer
     refund   a payment of its refunded (each one)

   A profile is only ever known here by `who`, a keyed hash of its id: the report counts people,
   and stays whole when a profile is deleted. Each line carries the code it counted for, so a
   later change of code does not move history. */
export const CREATOR_EVENTS = ['signup', 'trial', 'paid', 'refund'];
export const LEDGER_KEEP = 200000;
export const whoOf = (uid, secret) => crypto.createHmac('sha256', String(secret)).update('creator:' + uid).digest('base64url').slice(0, 16);

/** The ledger with `ev` ({ code, who, kind, at, id? }) added — or as it was, when the profile
    already has that milestone under the code (or an event with that id is in). Refunds repeat. */
export function ledgerAdd(list, ev) {
  const all = list || [];
  if (!ev?.code || !ev.who || !CREATOR_EVENTS.includes(ev.kind)) return all;
  if (ev.id && all.some(e => e.id === ev.id)) return all;
  if (ev.kind !== 'refund' && all.some(e => e.kind === ev.kind && e.who === ev.who && e.code === ev.code)) return all;
  const at = ev.at ? new Date(ev.at).toISOString() : new Date().toISOString();
  return [...all, { code: ev.code, who: ev.who, kind: ev.kind, at, ...(ev.id ? { id: String(ev.id).slice(0, 80) } : {}) }].slice(-LEDGER_KEEP);
}

const monthOf = at => String(at || '').slice(0, 7);
/** The months the ledger has anything in, newest first ("2026-10"). */
export const ledgerMonths = events => [...new Set((events || []).map(e => monthOf(e.at)).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();

/**
 * One row per creator's code: sign-ups, trials started, paying customers and refunds — in
 * `month` ("2026-10"), or all time without one. Codes with nothing in that month are still
 * listed, at zero, so a creator who brought nobody is there to see.
 */
export function creatorReport(events, codes, { month = null } = {}) {
  const rows = new Map((codes || []).filter(c => kindOf(c) === 'creator').map(c => [c.code, {
    code: c.code, label: c.label || '', days: codeDays(c), appleOffer: c.appleOffer || '', revoked: !!c.revoked,
    signups: 0, trials: 0, paying: 0, refunds: 0
  }]));
  const field = { signup: 'signups', trial: 'trials', paid: 'paying', refund: 'refunds' };
  for (const e of events || []) {
    if (month && monthOf(e.at) !== month) continue;
    const r = rows.get(e.code);
    if (r && field[e.kind]) r[field[e.kind]]++;
  }
  return [...rows.values()].sort((a, b) => b.paying - a.paying || b.signups - a.signups || a.code.localeCompare(b.code));
}

/** The same, month by month: one row per code and month it had anything in, newest month first —
    what a CSV of the whole program is made of. */
export function creatorReportByMonth(events, codes) {
  return ledgerMonths(events).flatMap(month => creatorReport(events, codes, { month })
    .filter(r => r.signups || r.trials || r.paying || r.refunds)
    .map(r => ({ month, ...r })));
}

/** The creator's code an Apple offer code redeemed in the App Store stands for, if any. */
export function codeForOffer(codes, offer) {
  const o = normalizeCode(offer);
  if (!o) return null;
  return (codes || []).find(c => kindOf(c) === 'creator' && !c.revoked && (normalizeCode(c.appleOffer) === o || c.code === o)) || null;
}

/* ---------------------------------- feedback ---------------------------------- */

export const FEEDBACK_MAX_CHARS = 2000;
export const FEEDBACK_KEEP = 1000;
const PLATFORMS = new Set(['web', 'ios', 'android']);
const short = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** A feedback row from what the app sent, or null when there is nothing to read. */
export function cleanFeedback(body, user, { now = Date.now(), id = crypto.randomBytes(8).toString('base64url') } = {}) {
  const text = String(body?.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, FEEDBACK_MAX_CHARS);
  if (!text) return null;
  const platform = short(body?.platform, 10);
  return {
    id,
    at: new Date(now).toISOString(),
    uid: user.id,
    text,
    version: short(body?.version, 24),
    platform: PLATFORMS.has(platform) ? platform : '',
    screen: short(body?.screen, 60),
    lang: short(body?.lang, 10),
    done: false
  };
}

/** The list with `row` added, newest last, at most FEEDBACK_KEEP long (the oldest go first). */
export const addFeedback = (list, row) => [...(list || []), row].slice(-FEEDBACK_KEEP);
