/* Lifecycle emails for a hosted instance, sent with Resend — over fetch, no SDK, the way
   billing.js talks to Stripe. Off unless RESEND_API_KEY is set: without it nothing is planned and
   nothing leaves.

   Three, each at most once per profile:

     welcome  right after signing up
     day3     three days in, when nothing has been trained yet
     week1    a week in: the first week's workouts, sets, volume and records — or, with none,
              that the plan is still waiting

   Only to profiles created after emails were switched on (db.emailsSince), so turning the key
   on never mails everyone who was already there; only to an address the profile has — its
   sign-in e-mail, or the one Apple or Google vouched for at sign-in (user.contact) — and never
   once it unsubscribed. Every email carries a one-click unsubscribe (RFC 8058: the
   List-Unsubscribe headers, and the link in the footer), signed with the server's secret so
   nobody can unsubscribe someone else. Sent in the profile's language, during its daytime when
   its time zone is known.

   This file is pure: what is due, what it says, the token. server.js keeps the clock, the
   records and the request to Resend. */
import crypto from 'node:crypto';
import { EMAIL_COPY } from './emails-copy.js';

const DAY = 86400000;
export const EMAIL_KINDS = ['welcome', 'day3', 'week1'];
// How long each one stays worth sending: a welcome is not a welcome after two days.
const WINDOWS = { welcome: [0, 2 * DAY], day3: [3 * DAY, 5 * DAY], week1: [7 * DAY, 10 * DAY] };

export function emailConfig(env = process.env) {
  const str = k => String(env[k] || '').trim();
  const key = str('RESEND_API_KEY');
  return {
    on: !!key,
    key,
    from: str('RESEND_FROM') || 'Tiza <hola@tiza.fit>',
    replyTo: str('RESEND_REPLY_TO') || null,
    // Only ever changed to point the tests somewhere other than Resend.
    apiBase: (str('RESEND_API_BASE') || 'https://api.resend.com').replace(/\/+$/, '')
  };
}

/** The address emails go to, if the profile has one. */
export function contactOf(user) {
  const a = user?.email || user?.contact?.email || '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a) ? a : null;
}

const finished = S => (S?.workouts || []).filter(w => w && (w.end || (w.entries || []).some(e => (e.sets || []).some(s => s?.done))));

/** Which email is due for `user` now, if any. */
export function dueEmail(user, S, { now = Date.now(), since = 0 } = {}) {
  if (!user || user.disabled || user.emailOptOut || !contactOf(user)) return null;
  const created = Date.parse(user.created);
  if (!Number.isFinite(created) || created < since) return null;
  const age = now - created;
  const sent = user.emails || {};
  for (const kind of EMAIL_KINDS) {
    if (sent[kind]) continue;
    const [from, to] = WINDOWS[kind];
    if (age < from || age >= to) continue;
    if (kind === 'day3' && finished(S).length) continue;
    return kind;
  }
  return null;
}

/** The first seven days from sign-up, in numbers: workouts, work sets, volume, records. */
export function firstWeek(S, created) {
  const start = Date.parse(created) || 0;
  const end = start + 7 * DAY;
  const inWeek = finished(S).filter(w => {
    const at = w.start || Date.parse(w.d + 'T12:00:00Z') || 0;
    return at >= start - DAY && at < end;
  });
  let sets = 0, volume = 0, records = 0;
  for (const w of inWeek) {
    records += (w.prs || []).length;
    for (const e of w.entries || []) for (const s of e.sets || []) {
      if (!s?.done || s.phase === 'warmup' || s.warmup) continue;
      sets++;
      if (s.w > 0 && s.r > 0) volume += s.w * s.r;
    }
  }
  return { workouts: inWeek.length, sets, volume: Math.round(volume), records, unit: S?.unit === 'lb' ? 'lb' : 'kg' };
}

/* ---------------------------------- the words ---------------------------------- */

const LOCALES = {
  en: 'en-GB', de: 'de-DE', 'de-CH': 'de-CH', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', th: 'th-TH', hu: 'hu-HU', ar: 'ar-u-nu-latn'
};
let deCH = null;
/** The words for a language: its own, Swiss German from German (ss for ß), or English. */
export function emailCopy(lang) {
  if (EMAIL_COPY[lang]) return EMAIL_COPY[lang];
  if (lang === 'de-CH') return deCH || (deCH = JSON.parse(JSON.stringify(EMAIL_COPY.de).replace(/ß/g, 'ss')));
  const base = String(lang || '').split('-')[0];
  return EMAIL_COPY[base] || EMAIL_COPY.en;
}
const RTL = new Set(['ar']);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
const num = (n, lang) => { try { return new Intl.NumberFormat(LOCALES[lang] || 'en-GB', { maximumFractionDigits: 0 }).format(n); } catch { return String(n); } };
// The first name only, and only what reads as a name.
const firstName = name => String(name || '').trim().split(/\s+/)[0].replace(/[<>{}]/g, '').slice(0, 30);

/**
 * The email `kind` for a profile, in `lang`: { subject, html, text }. `data`: { name, week }
 * (week: firstWeek's numbers). `links`: { app, unsubscribe }.
 */
export function renderEmail(kind, { name = '', week = null } = {}, lang = 'en', links = {}) {
  const c = emailCopy(lang);
  const k = c[kind];
  const dir = RTL.has(String(lang).split('-')[0]) ? 'rtl' : 'ltr';
  const who = firstName(name);
  let title, paras = [], stats = null, cta = k.cta;
  if (kind === 'welcome') { title = who ? fill(k.titleName, { name: who }) : k.title; paras = [k.body, k.tip]; }
  if (kind === 'day3') { title = k.title; paras = [k.body]; }
  if (kind === 'week1') {
    if (week?.workouts) {
      title = k.title;
      stats = [[k.workouts, num(week.workouts, lang)], [k.sets, num(week.sets, lang)], [k.volume, `${num(week.volume, lang)} ${week.unit}`], [k.records, num(week.records, lang)]];
      paras = [k.body];
    } else { title = k.title0; paras = [k.body0]; }
  }
  const subject = k.subject;
  const app = links.app || 'https://app.tiza.fit';
  const unsub = links.unsubscribe || '';
  const statsHtml = stats ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 20px;border-collapse:separate;border-spacing:8px 0"><tr>${
    stats.map(([l, v]) => `<td style="background:#F4F4F6;border-radius:12px;padding:12px 8px;text-align:center"><div style="font-size:22px;font-weight:800;color:#111">${esc(v)}</div><div style="font-size:12px;color:#666;margin-top:2px">${esc(l)}</div></td>`).join('')
  }</tr></table>` : '';
  const html = `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#F4F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
<div style="display:none;max-height:0;overflow:hidden">${esc(paras[0] || '')}</div>
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
<div style="font-size:24px;font-weight:800;letter-spacing:-.02em;margin:0 4px 16px">Tiza<span style="color:#E6B800">.</span></div>
<div style="background:#fff;border-radius:18px;padding:28px 24px">
<h1 style="font-size:24px;line-height:1.25;margin:0 0 14px">${esc(title)}</h1>
${statsHtml}${paras.map(p => `<p style="font-size:16px;line-height:1.55;margin:0 0 14px;color:#333">${esc(p)}</p>`).join('')}
<p style="margin:22px 0 4px"><a href="${esc(app)}" style="display:inline-block;background:#FFD60A;color:#111;font-weight:700;font-size:16px;text-decoration:none;padding:13px 22px;border-radius:12px">${esc(cta)}</a></p>
</div>
<p style="font-size:12px;line-height:1.5;color:#888;margin:18px 4px 0">${esc(c.footer.why)}${unsub ? ` <a href="${esc(unsub)}" style="color:#888">${esc(c.footer.unsub)}</a>` : ''}</p>
</div></body></html>`;
  const text = [title, '', ...(stats ? [stats.map(([l, v]) => `${l}: ${v}`).join(' · '), ''] : []), ...paras.flatMap(p => [p, '']), `${cta}: ${app}`, '', '—', c.footer.why, ...(unsub ? [`${c.footer.unsub}: ${unsub}`] : [])].join('\n');
  return { subject, html, text };
}

/** The page the unsubscribe link lands on, in `lang`. `state`: 'out' or 'in' (subscribed again). */
export function unsubscribePage(lang, state, form = null) {
  const c = emailCopy(lang).page;
  const dir = RTL.has(String(lang).split('-')[0]) ? 'rtl' : 'ltr';
  const title = state === 'in' ? c.resubbed : c.title;
  return `<!doctype html><html lang="${esc(lang)}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tiza</title></head>
<body style="margin:0;background:#0B0C0F;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<main style="max-width:440px;margin:0 auto;padding:18vh 20px 40px;text-align:center">
<div style="font-size:26px;font-weight:800;margin-bottom:28px">Tiza<span style="color:#FFD60A">.</span></div>
<h1 style="font-size:22px;line-height:1.3;margin:0 0 12px">${esc(title)}</h1>
<p style="color:#aaa;line-height:1.5;margin:0 0 26px">${esc(c.body)}</p>
${state === 'out' && form ? `<form method="post" action="${esc(form)}"><button style="background:none;border:1px solid #444;color:#ddd;border-radius:10px;padding:10px 16px;font-size:15px">${esc(c.again)}</button></form>` : ''}
</main></body></html>`;
}

/* ---------------------------------- unsubscribing ---------------------------------- */

/** The token that lets a link unsubscribe one profile, and nobody else. */
export const unsubToken = (uid, secret) => crypto.createHmac('sha256', String(secret)).update('unsubscribe:' + uid).digest('base64url').slice(0, 32);
export function unsubOk(uid, token, secret) {
  if (!uid || typeof token !== 'string') return false;
  const want = Buffer.from(unsubToken(uid, secret));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** The body Resend is sent for one email (POST /emails). */
export function resendBody(cfg, to, mail, { unsubscribe, kind }) {
  return {
    from: cfg.from,
    to: [to],
    ...(cfg.replyTo ? { reply_to: cfg.replyTo } : {}),
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: unsubscribe ? { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {},
    tags: [{ name: 'kind', value: kind }]
  };
}
