/* The engagement notifications planner (coach/core/nudges.js): which nudge a day gets, and what
   it says. The server sends what it plans for today; the phone schedules what it plans for the
   week — so every rule here is both of them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNudges, nudgePrefs, copyOf, NUDGE_LANGS, NUDGE_DEFAULTS, addDays } from '../coach/core/nudges.js';

// 2026-10-05 is a Monday.
const MON = '2026-10-05';
const routine = { id: 'r1', name: 'Pierna', ex: [{ id: 'squat' }] };
const plan = (over = {}) => ({
  lang: 'es', unit: 'kg', weekStart: 1,
  routines: [routine, { id: 'r2', name: 'Torso', ex: [{ id: 'bench' }] }, { id: 'empty', name: 'Nada', ex: [] }],
  week: { 1: 'r1', 3: ['r1', 'r2'], 5: 'empty' },
  workouts: [], ...over
});
const workout = (d, extra = {}) => ({ d, vol: 1000, prs: [], ...extra });

test('"trained today?" on a planned day with nothing logged, naming what is planned', () => {
  const S = plan({ workouts: [workout(addDays(MON, -2))] });
  const [n] = planNudges(S, { today: MON });
  assert.equal(n.kind, 'today');
  assert.equal(n.date, MON);
  assert.equal(n.time, '20:00');
  assert.equal(n.key, `today:${MON}`);
  assert.match(n.title + n.body, /Pierna/);
  assert.equal(n.url, '/home?n=today');
  assert.equal(n.tag, 'nudge-today');
  // A combined day names both routines.
  const wed = planNudges(S, { today: addDays(MON, 2) })[0];
  assert.match(wed.title + wed.body, /Pierna \+ Torso/);
});

test('no "trained today?" on a rest day, a trained day, mid-session, or for a routine with nothing in it', () => {
  const S = plan({ workouts: [workout(addDays(MON, -1))] });
  assert.deepEqual(planNudges(S, { today: addDays(MON, 1) }), [], 'Tuesday: nothing planned');
  assert.deepEqual(planNudges(plan({ workouts: [workout(MON)] }), { today: MON }), [], 'already trained');
  assert.deepEqual(planNudges({ ...S, active: { start: 1 } }, { today: MON }), [], 'a session is running');
  // The person's own day reminder asks the same thing: not twice within three hours…
  assert.deepEqual(planNudges({ ...S, reminder: { on: true, time: '18:00' } }, { today: MON }), [], 'reminder at 18:00');
  // …but a morning reminder and an evening "trained today?" are two different moments.
  assert.equal(planNudges({ ...S, reminder: { on: true, time: '08:00' } }, { today: MON })[0].kind, 'today');
  assert.equal(planNudges({ ...S, reminder: { on: false, time: '19:30' } }, { today: MON })[0].kind, 'today');
  assert.deepEqual(planNudges(S, { today: addDays(MON, 4) }), [], 'Friday: the planned routine is empty');
  // A per-date override wins over the weekday, both ways.
  assert.deepEqual(planNudges({ ...S, dayPlan: { [MON]: 'rest' } }, { today: MON }), []);
  assert.equal(planNudges({ ...S, dayPlan: { [addDays(MON, 1)]: 'r2' } }, { today: addDays(MON, 1) })[0].kind, 'today');
});

test('"trained today?" stops two weeks after the last workout; the comeback takes over', () => {
  const S = d => plan({ workouts: [workout(addDays(MON, -d))] });
  assert.equal(planNudges(S(14), { today: MON })[0].kind, 'today');
  assert.equal(planNudges(S(15), { today: MON }).length, 0);
  // 14 days is also a comeback day: one nudge only, and "trained today?" outranks it.
  const both = planNudges(S(14), { today: MON });
  assert.equal(both.length, 1);
});

test('comebacks at 4, 7, 14 and 30 days, each once, keyed to the last workout', () => {
  const last = '2026-09-01';
  const S = plan({ week: {}, workouts: [workout(last)] });
  const found = [];
  for (let d = 1; d <= 40; d++) {
    const today = addDays(last, d);
    for (const n of planNudges({ ...S, nudges: { weekly: false } }, { today })) found.push([d, n.kind, n.key, n.time]);
  }
  assert.deepEqual(found.map(f => f[0]), [4, 7, 14, 30]);
  assert.ok(found.every(f => f[1] === 'comeback' && f[3] === '18:30'));
  assert.deepEqual(found.map(f => f[2]), [4, 7, 14, 30].map(d => `comeback:${last}:${d}`));
  assert.equal(planNudges(S, { today: addDays(last, 7) })[0].title, 'Una semana sin pasar por el gym');
  // The week's last evening, 5 days on: the summary of a week with training in it, not "5 days".
  assert.equal(planNudges(S, { today: addDays(last, 5) })[0].kind, 'weekly');
});

test('before the first workout: 1, 3 and 7 days after signing up — and nothing without a signup day', () => {
  const S = plan({ week: {} });
  const days = [];
  for (let d = 0; d <= 10; d++) {
    const n = planNudges(S, { today: addDays(MON, d), startedOn: MON })[0];
    if (n) days.push([d, n.title]);
  }
  assert.deepEqual(days, [[1, 'Tu primer entreno te espera'], [3, '¿Empezamos hoy?'], [7, 'Una semana con Tiza']]);
  assert.deepEqual(planNudges(S, { today: addDays(MON, 1) }), [], 'no workouts and no signup day: no reference to count from');
  // With a plan, the planned days get "trained today?" from the start.
  assert.equal(planNudges(plan(), { today: MON, startedOn: MON })[0].kind, 'today');
});

test('the week’s summary on its last evening: workouts, volume, records and the trend', () => {
  const sun = addDays(MON, 6);
  const S = plan({
    workouts: [
      workout(addDays(MON, -5)), // the week before: one
      workout(MON, { vol: 8200 }), workout(addDays(MON, 2), { vol: 4200, prs: ['squat', 'bench'] })
    ]
  });
  const [n] = planNudges(S, { today: sun });
  assert.equal(n.kind, 'weekly');
  assert.equal(n.time, '19:00');
  assert.equal(n.key, `weekly:${MON}`);
  assert.equal(n.title, 'Tu semana: 2 entrenos');
  assert.equal(n.body, '12.400 kg levantados · 2 récords. Más que la semana pasada 🔥');
  assert.equal(n.url, '/stats?n=weekly');
  // English, pounds, one workout, fewer than the week before.
  const en = planNudges({ ...S, lang: 'en', unit: 'lb', workouts: [workout(addDays(MON, -5)), workout(addDays(MON, -4)), workout(MON, { vol: 500 })] }, { today: sun })[0];
  assert.equal(en.title, 'Your week: 1 workout');
  assert.equal(en.body, '500 lb lifted. Next week, go for one more.');
  // A week that starts on Sunday closes on Saturday.
  assert.equal(planNudges({ ...S, weekStart: 0 }, { today: addDays(MON, 5) })[0].kind, 'weekly');
  // Nothing logged that week: no summary.
  assert.deepEqual(planNudges(plan({ week: {}, workouts: [workout(addDays(MON, -2))] }), { today: addDays(MON, 13) }), []);
});

test('the trial: 3 days and 1 day before it ends, worded for a card trial or an open one; it outranks everything', () => {
  const S = plan({ workouts: [workout(addDays(MON, -1))] });
  const open = planNudges(S, { today: MON, trial: { endsOn: addDays(MON, 3), card: false } })[0];
  assert.equal(open.kind, 'trial');
  assert.equal(open.time, '12:00');
  assert.equal(open.key, `trial:${addDays(MON, 3)}:3`);
  assert.equal(open.title, 'Te quedan 3 días de prueba');
  assert.equal(open.url, '/home?paywall=trial&n=trial');
  const card = planNudges(S, { today: MON, trial: { endsOn: addDays(MON, 1), card: true } })[0];
  assert.equal(card.title, 'Tu prueba termina mañana');
  assert.match(card.body, /Ajustes → Suscripción/);
  assert.equal(card.url, '/settings?n=trial');
  // A day already trained still gets it.
  const trained = plan({ workouts: [workout(MON)] });
  assert.equal(planNudges(trained, { today: MON, trial: { endsOn: addDays(MON, 1) } })[0].kind, 'trial');
});

test('a week ahead: at most one a day, in order — what the phone schedules', () => {
  const S = plan({ workouts: [workout(addDays(MON, -1))] });
  const week = planNudges(S, { today: MON, days: 7 });
  const dates = week.map(n => n.date);
  assert.deepEqual(dates, [...new Set(dates)].sort());
  assert.deepEqual(week.map(n => [n.date, n.kind]), [
    [MON, 'today'],                 // planned
    [addDays(MON, 2), 'today'],     // planned (combined day)
    [addDays(MON, 3), 'comeback'],  // 4 days since Sunday, nothing planned
    [addDays(MON, 6), 'comeback']   // 7 days; the week ending today had no training to sum up
  ]);
});

test('each kind can be switched off, and the evening time moved; anything malformed is the default', () => {
  const S = plan({ workouts: [workout(addDays(MON, -1))] });
  assert.deepEqual(planNudges({ ...S, nudges: { today: false } }, { today: MON }), []);
  assert.equal(planNudges({ ...S, nudges: { todayTime: '18:45' } }, { today: MON })[0].time, '18:45');
  assert.deepEqual(nudgePrefs({ nudges: { today: 'yes', todayTime: '25:00', weekly: false } }), { ...NUDGE_DEFAULTS, weekly: false });
  assert.deepEqual(nudgePrefs({ nudges: [] }), NUDGE_DEFAULTS);
  assert.deepEqual(nudgePrefs(null), NUDGE_DEFAULTS);
  // Whatever is on disk does not throw.
  for (const bad of [null, 'x', { workouts: 'x' }, { routines: {}, week: [], workouts: [null, { d: 7 }] }, { dayPlan: 'x' }]) {
    assert.doesNotThrow(() => planNudges(bad, { today: MON, startedOn: MON, days: 7 }));
  }
  assert.deepEqual(planNudges(plan(), { today: 'yesterday' }), []);
});

// The shape of English, everywhere: a language missing a line would send a notification with
// `undefined` in it.
const shape = v => Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => !['zero', 'one', 'two', 'few', 'many'].includes(k)).map(k => [k, shape(v[k])])) : typeof v;
const LOCALES = { en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR', pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', th: 'th-TH', hu: 'hu-HU', ar: 'ar' };

test('every language the app ships has every line, and a plural form for every count a week can have', () => {
  assert.deepEqual(NUDGE_LANGS().sort(), Object.keys(LOCALES).sort());
  const en = shape(copyOf('en'));
  for (const lang of NUDGE_LANGS()) {
    const c = copyOf(lang);
    assert.deepEqual(shape(c), en, lang);
    const rules = new Intl.PluralRules(LOCALES[lang]);
    for (let n = 1; n <= 60; n++) {
      for (const forms of [c.week, c.records]) assert.ok(forms[rules.select(n)] || forms.other, `${lang} ${n}`);
      // a form the rules pick must exist outright where the language has one (ru "few", ar "two"…)
      if (['ru', 'uk', 'pl', 'ar'].includes(lang)) assert.ok(c.week[rules.select(n)], `${lang} week ${n} → ${rules.select(n)}`);
    }
    for (const [title, body] of [...c.today, ...Object.values(c.comeback), ...Object.values(c.first), ...Object.values(c.trial)]) {
      assert.ok(title.length <= 60, `${lang}: title too long for a lock screen — ${title}`);
      assert.ok(body.length <= 140, `${lang}: body too long — ${body}`);
    }
  }
  // A language the app does not ship falls back to English; Swiss German is German without ß.
  assert.equal(copyOf('xx'), copyOf('en'));
  assert.doesNotMatch(JSON.stringify(copyOf('de-CH')), /ß/);
});

test('Russian and Arabic counts read right', () => {
  const sun = addDays(MON, 6);
  const S = lang => plan({ lang, week: {}, workouts: [workout(MON), workout(addDays(MON, 1)), workout(addDays(MON, 2))] });
  assert.equal(planNudges(S('ru'), { today: sun })[0].title, 'Ваша неделя: 3 тренировки');
  assert.equal(planNudges(S('pl'), { today: sun })[0].title, 'Twój tydzień: 3 treningi');
  assert.equal(planNudges(S('ar'), { today: sun })[0].title, 'أسبوعك: 3 تمارين');
});

test('the Coach’s weekly report: its first line on the morning the app worked it out for, once, and only when it is the report’s to send', () => {
  const report = { on: MON, kind: 'stall', title: 'Lo que te diría tu Coach esta semana', body: 'Sentadilla: 4 sesiones en 3 semanas sin subir.', push: true };
  const S = plan({ coachReport: report, workouts: [workout(addDays(MON, -1))] });
  const [n] = planNudges(S, { today: MON });
  assert.equal(n.kind, 'report');
  assert.equal(n.time, '09:00');
  assert.equal(n.key, `report:${MON}`);
  assert.equal(n.title, report.title);
  assert.equal(n.body, report.body);
  assert.equal(n.url, '/home?n=report');
  // Another day, a report someone with the Coach hears from the Coach about, or switched off: none.
  assert.notEqual(planNudges(S, { today: addDays(MON, 1) })[0]?.kind, 'report');
  assert.notEqual(planNudges({ ...S, coachReport: { ...report, push: false } }, { today: MON })[0]?.kind, 'report');
  assert.notEqual(planNudges({ ...S, nudges: { report: false } }, { today: MON })[0]?.kind, 'report');
  assert.notEqual(planNudges({ ...S, coachReport: { ...report, body: 7 } }, { today: MON })[0]?.kind, 'report');
  // Only the trial outranks it.
  assert.equal(planNudges(S, { today: MON, trial: { endsOn: addDays(MON, 3) } })[0].kind, 'trial');
});
