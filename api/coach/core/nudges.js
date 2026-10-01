/**
 * Engagement notifications ("nudges"): which one, if any, a person gets on a given day, and what
 * it says. Shared by the two places that deliver them — the api's reminder tick (Web Push, sent
 * when due) and the phone (local notifications, scheduled ahead) — so a person gets the same
 * thing from either, in their language.
 *
 * Pure: a date is an ISO day on the person's own calendar and a time is "HH:MM" on their clock,
 * both supplied by the caller. Neither runtime's clock or timezone leaks in, and a test can pin
 * any day it likes.
 *
 * The kinds, at most ONE per day (the first in NUDGE_PRIORITY wins):
 *   trial     3 days and 1 day before a web trial ends (the server knows; the stores do their own)
 *   report    the first morning of the week: the first line of "What your Coach would tell you
 *             this week", which the app works out ahead and keeps in S.coachReport (the pills
 *             need the exercise catalogue and the progression engine: frontend/src/lib/
 *             coach-report.js). Only when the app says the push is the report's to send
 *   today     "Trained today?" in the evening of a planned day with nothing logged yet
 *   weekly    the week's summary, on its last evening, when there was at least one workout — a
 *             week with training in it hears about that rather than about the days since
 *   comeback  4, 7, 14 and 30 days after the last workout — or 1, 3 and 7 days after signing up
 *             for someone who has not logged one yet
 * The day reminder the person sets themselves (S.reminder) is separate and unchanged.
 *
 * Each nudge carries a `key`: the same nudge planned twice has the same key, so the server
 * sends it once however many ticks see it, and the phone replaces rather than stacks it.
 */

import { NUDGE_KINDS, NUDGE_DEFAULTS, HHMM, nudgePrefs } from './nudge-prefs.js';

export { NUDGE_KINDS, NUDGE_DEFAULTS, nudgePrefs };
export const NUDGE_PRIORITY = ['trial', 'report', 'today', 'weekly', 'comeback'];
// Fixed local times for the kinds the person does not time themselves: late enough to be after
// work, early enough not to wake anyone.
export const NUDGE_TIMES = { comeback: '18:30', weekly: '19:00', trial: '12:00', report: '09:00' };
export const COMEBACK_DAYS = [4, 7, 14, 30];
export const FIRST_DAYS = [1, 3, 7];
// "Trained today?" stops after two weeks without a workout: by then it is the comeback's job,
// and a plan someone walked away from should not ask them three times a week forever.
const TODAY_MAX_GAP = 14;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Every local time a nudge can go out at — the tick skips the planning when none is near. */
export const nudgeTimes = prefs => [prefs.todayTime, ...Object.values(NUDGE_TIMES)];

/* ---------- calendar arithmetic on ISO days (UTC, so no DST can move a day) ---------- */
const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const isoOfNum = n => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDays = (iso, n) => isoOfNum(dayNum(iso) + n);
const weekdayOf = iso => new Date(dayNum(iso) * 86400000).getUTCDay();

// What is planned on a day, the way the app reads it (lib/history.js effectiveRoutineIds): a
// per-date override first, then the weekday, which can hold several routines. Tolerant of
// whatever is on disk, and a routine with no exercises is not something to go and train.
function plannedRoutines(S, iso) {
  const routines = (Array.isArray(S.routines) ? S.routines : [])
    .filter(r => r && r.id != null && Array.isArray(r.ex) && r.ex.length);
  const find = id => routines.find(r => r.id === id);
  const ov = S.dayPlan && typeof S.dayPlan === 'object' ? S.dayPlan[iso] : undefined;
  if (ov === 'rest') return [];
  if (ov && find(ov)) return [find(ov)];
  const week = S.week && typeof S.week === 'object' ? S.week : {};
  return [].concat(week[weekdayOf(iso)] || []).map(find).filter(Boolean);
}

const routineLabel = rs => {
  const names = rs.map(r => String(r.name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  return names.length <= 2 ? names.join(' + ') : names.slice(0, 2).join(' + ') + ' …';
};

/**
 * The nudges due over `days` days from `today`, at most one a day.
 *
 *   S          the person's state (workouts, plan, unit, weekStart, nudges, lang, active)
 *   today      ISO day on their calendar; planning never looks back
 *   days       how many days ahead, today included (server 1, phone a week)
 *   startedOn  ISO day they signed up — what "days since" counts from before the first workout
 *   trial      { endsOn: ISO day, card: bool } while a web trial runs, else null
 *   lang       overrides S.lang
 *
 * Days ahead are planned as if nothing else gets logged: the phone re-plans on every change,
 * so a workout logged tomorrow takes tomorrow's "trained today?" back with it.
 */
export function planNudges(S, { today, days = 1, startedOn = null, trial = null, lang } = {}) {
  if (!S || typeof S !== 'object' || !ISO.test(today || '')) return [];
  const prefs = nudgePrefs(S);
  const L = lang || S.lang;
  const workouts = (Array.isArray(S.workouts) ? S.workouts : [])
    .filter(w => w && typeof w.d === 'string' && ISO.test(w.d) && w.d <= today);
  const trained = new Set(workouts.map(w => w.d));
  const last = workouts.reduce((m, w) => (w.d > m ? w.d : m), '');
  const since = last || (ISO.test(startedOn || '') && startedOn <= today ? startedOn : '');
  const busyToday = !!S.active;
  // The day reminder the person set (S.reminder) already asks on the same days; within three
  // hours of it, a second "trained today?" is the same question twice.
  const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const reminderNear = !!(S.reminder?.on && HHMM.test(S.reminder.time || '')
    && Math.abs(toMin(S.reminder.time) - toMin(prefs.todayTime)) < 180);
  const weekStart = Number.isInteger(S.weekStart) && S.weekStart >= 0 && S.weekStart <= 6 ? S.weekStart : 1;
  const out = [];

  for (let i = 0; i < Math.max(1, Math.min(days, 31)); i++) {
    const date = addDays(today, i);
    const gap = since ? dayNum(date) - dayNum(since) : null;
    // Trained already, or mid-session right now: nothing asks about training on this day. The
    // trial and the week's summary are not about that, and still go out.
    const quiet = trained.has(date) || (busyToday && date === today);
    const candidates = [];

    if (prefs.trial && trial && ISO.test(trial.endsOn || '')) {
      for (const n of [3, 1]) {
        if (addDays(trial.endsOn, -n) === date) {
          candidates.push(make('trial', `trial:${trial.endsOn}:${n}`, date, NUDGE_TIMES.trial,
            copyOf(L).trial[(trial.card ? 'card' : 'open') + n], { url: trial.card ? '/settings' : '/home?paywall=trial' }));
        }
      }
    }
    const rep = S.coachReport;
    if (prefs.report && rep && typeof rep === 'object' && rep.on === date && rep.push !== false
      && typeof rep.title === 'string' && typeof rep.body === 'string' && rep.title && rep.body) {
      candidates.push(make('report', `report:${date}`, date, NUDGE_TIMES.report,
        [rep.title.slice(0, 80), rep.body.slice(0, 240)], { url: '/home' }));
    }
    if (prefs.today && !quiet && !reminderNear && gap != null && gap <= TODAY_MAX_GAP) {
      const rs = plannedRoutines(S, date);
      if (rs.length) {
        const [title, body] = copyOf(L).today[dayNum(date) % 2];
        const routine = routineLabel(rs);
        candidates.push(make('today', `today:${date}`, date, prefs.todayTime,
          [fill(title, { routine }), fill(body, { routine })], { url: '/home' }));
      }
    }
    if (prefs.comeback && !quiet && gap != null) {
      const levels = last ? COMEBACK_DAYS : FIRST_DAYS;
      if (levels.includes(gap)) {
        const text = last ? copyOf(L).comeback[gap] : copyOf(L).first[gap];
        candidates.push(make('comeback', `comeback:${since}:${gap}`, date, NUDGE_TIMES.comeback, text, { url: '/home' }));
      }
    }
    if (prefs.weekly) { const w = weekly(date); if (w) candidates.push(w); }

    candidates.sort((a, b) => NUDGE_PRIORITY.indexOf(a.kind) - NUDGE_PRIORITY.indexOf(b.kind));
    if (candidates.length) out.push(candidates[0]);
  }
  return out;

  // The summary for the week that ends on `date`, or null when that is not the week's last day
  // or nothing was logged in it.
  function weekly(date) {
    if (weekdayOf(date) !== (weekStart + 6) % 7) return null;
    const first = addDays(date, -6);
    const inWeek = (from, to) => workouts.filter(w => w.d >= from && w.d <= to);
    const these = inWeek(first, date);
    if (!these.length) return null;
    const prev = inWeek(addDays(first, -7), addDays(first, -1)).length;
    const vol = these.reduce((n, w) => n + (Number.isFinite(w.vol) && w.vol > 0 ? w.vol : 0), 0);
    const prs = these.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0);
    const c = copyOf(L);
    const facts = [];
    if (vol > 0) facts.push(fill(c.lifted, { vol: fmtInt(vol, L) + ' ' + (S.unit === 'lb' ? 'lb' : 'kg') }));
    if (prs > 0) facts.push(plural(c.records, prs, L));
    const trend = these.length > prev ? c.up : these.length === prev ? c.same : c.down;
    const body = (facts.length ? facts.join(' · ') + '. ' : '') + trend;
    return make('weekly', `weekly:${first}`, date, NUDGE_TIMES.weekly, [plural(c.week, these.length, L), body], { url: '/stats' });
  }
}

function make(kind, key, date, time, [title, body], { url }) {
  // `n` marks the app's arrival from a notification, so the open can be counted (lib/track.js).
  const sep = url.includes('?') ? '&' : '?';
  return { kind, key, date, time, title, body, url: `${url}${sep}n=${kind}`, tag: `nudge-${kind}` };
}

/* ---------- copy ---------- */

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));

// The app's own number locales (lib/i18n-core.js DATE_LOCALES): Arabic keeps Latin digits there.
const LOCALES = {
  en: 'en-GB', de: 'de-DE', 'de-CH': 'de-CH', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', 'pt-BR': 'pt-BR',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN', th: 'th-TH', hu: 'hu-HU', ar: 'ar-u-nu-latn'
};
const localeOf = lang => LOCALES[lang] || 'en-GB';
const fmtInt = (n, lang) => {
  try { return new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 0 }).format(Math.round(n)); } catch { return String(Math.round(n)); }
};
function plural(forms, n, lang) {
  let cat = 'other';
  try { cat = new Intl.PluralRules(localeOf(lang)).select(n); } catch { /* old runtime: 'other' */ }
  return fill(forms[cat] ?? forms.other, { n: fmtInt(n, lang) });
}

/** The copy for a language: its own, a derived locale's base, or English. */
export function copyOf(lang) {
  if (COPY[lang]) return COPY[lang];
  if (lang === 'de-CH') return swissGerman();
  return COPY.en;
}
let deCH = null;
// Swiss German writes ss for ß — the same transform the app's de-CH pack is derived with.
const swissGerman = () => deCH || (deCH = JSON.parse(JSON.stringify(COPY.de).replace(/ß/g, 'ss')));

export const NUDGE_LANGS = () => Object.keys(COPY);

// Each language is written in the register its app pack already uses (tú, du, tu, você, вы, ти…)
// and names things the way the pack does ("Entrenador IA", "Einstellungen → Abonnement").
const COPY = {
  en: {
    today: [['Trained today?', '{routine} is on today’s plan. There’s still time 💪'],
      ['{routine} today?', 'It’s on your plan. Open Tiza and start in one tap.']],
    comeback: {
      4: ['4 days without training', 'A short session counts too. Your next weights are already worked out.'],
      7: ['A week away from the gym', 'Your history and your weights are waiting. Come back with a short session.'],
      14: ['Shall we get back to it?', 'Two weeks off. Start easy: what matters is coming back.'],
      30: ['Your progress is waiting', 'It’s been a month since your last workout. Pick it up whenever you like.']
    },
    first: {
      1: ['Your first workout is waiting', 'Pick a routine and log your first set. It takes less time than you think.'],
      3: ['Start today?', 'Pick a routine and go: Tiza tells you what to lift.'],
      7: ['One week with Tiza', 'Tiza is ready when you are. Is today the day?']
    },
    week: { one: 'Your week: 1 workout', other: 'Your week: {n} workouts' },
    lifted: '{vol} lifted',
    records: { one: '1 record', other: '{n} records' },
    up: 'More than last week 🔥', same: 'Same as last week. Consistency pays off 💪', down: 'Next week, go for one more.',
    trial: {
      open3: ['3 days of your trial left', 'Choose a plan to keep the AI Coach. Your history stays yours either way.'],
      open1: ['Your trial ends tomorrow', 'Choose a plan today to keep the AI Coach.'],
      card3: ['Your trial ends in 3 days', 'Then your subscription starts. Not for you? Cancel in Settings → Subscription.'],
      card1: ['Your trial ends tomorrow', 'Your subscription starts tomorrow. You can cancel in Settings → Subscription.']
    }
  },
  es: {
    today: [['¿Has entrenado hoy?', '{routine} sigue en el plan de hoy. Aún estás a tiempo 💪'],
      ['¿Hoy toca {routine}?', 'Está en tu plan. Abre Tiza y empieza en un toque.']],
    comeback: {
      4: ['4 días sin entrenar', 'Una sesión corta también cuenta. Tus próximos pesos ya están calculados.'],
      7: ['Una semana sin pasar por el gym', 'Tu historial y tus pesos te esperan. Vuelve con una sesión corta.'],
      14: ['¿Volvemos a entrenar?', 'Dos semanas sin entrenar. Empieza suave: lo importante es volver.'],
      30: ['Tu progreso te espera', 'Hace un mes de tu último entreno. Retómalo cuando quieras.']
    },
    first: {
      1: ['Tu primer entreno te espera', 'Elige una rutina y apunta tu primera serie. Es más rápido de lo que crees.'],
      3: ['¿Empezamos hoy?', 'Elige una rutina y a por ello: Tiza te dice cuánto levantar.'],
      7: ['Una semana con Tiza', 'Tiza está lista cuando tú lo estés. ¿Hoy es el día?']
    },
    week: { one: 'Tu semana: 1 entreno', other: 'Tu semana: {n} entrenos' },
    lifted: '{vol} levantados',
    records: { one: '1 récord', other: '{n} récords' },
    up: 'Más que la semana pasada 🔥', same: 'Igual que la semana pasada. La constancia gana 💪', down: 'La semana que viene, a por uno más.',
    trial: {
      open3: ['Te quedan 3 días de prueba', 'Elige un plan para seguir con el Entrenador IA. Tu historial es tuyo pase lo que pase.'],
      open1: ['Tu prueba termina mañana', 'Elige un plan hoy para no perder el Entrenador IA.'],
      card3: ['Tu prueba termina en 3 días', 'Después empieza tu suscripción. ¿No es para ti? Cancélala en Ajustes → Suscripción.'],
      card1: ['Tu prueba termina mañana', 'Mañana empieza tu suscripción. Puedes cancelarla en Ajustes → Suscripción.']
    }
  },
  de: {
    today: [['Heute schon trainiert?', '{routine} steht heute auf dem Plan. Noch ist Zeit 💪'],
      ['Heute {routine}?', 'Es steht in deinem Plan. Öffne Tiza und starte mit einem Tipp.']],
    comeback: {
      4: ['4 Tage ohne Training', 'Auch eine kurze Einheit zählt. Deine nächsten Gewichte sind schon berechnet.'],
      7: ['Eine Woche ohne Gym', 'Dein Verlauf und deine Gewichte warten. Komm mit einer kurzen Einheit zurück.'],
      14: ['Wollen wir wieder loslegen?', 'Zwei Wochen Pause. Fang locker an: Hauptsache, du kommst zurück.'],
      30: ['Dein Fortschritt wartet', 'Dein letztes Training ist einen Monat her. Mach weiter, wann immer du willst.']
    },
    first: {
      1: ['Dein erstes Training wartet', 'Wähle eine Routine und trag deinen ersten Satz ein. Geht schneller, als du denkst.'],
      3: ['Heute anfangen?', 'Wähle eine Routine und leg los: Tiza sagt dir, wie viel du hebst.'],
      7: ['Eine Woche mit Tiza', 'Tiza ist bereit, wenn du es bist. Ist heute der Tag?']
    },
    week: { one: 'Deine Woche: 1 Training', other: 'Deine Woche: {n} Trainings' },
    lifted: '{vol} bewegt',
    records: { one: '1 Rekord', other: '{n} Rekorde' },
    up: 'Mehr als letzte Woche 🔥', same: 'Genauso viel wie letzte Woche. Dranbleiben zahlt sich aus 💪', down: 'Nächste Woche: eins mehr.',
    trial: {
      open3: ['Noch 3 Tage Testphase', 'Wähle einen Tarif, um den KI-Coach zu behalten. Dein Verlauf bleibt so oder so deiner.'],
      open1: ['Deine Testphase endet morgen', 'Wähle heute einen Tarif, damit du den KI-Coach behältst.'],
      card3: ['Deine Testphase endet in 3 Tagen', 'Danach startet dein Abonnement. Nichts für dich? Kündige unter Einstellungen → Abonnement.'],
      card1: ['Deine Testphase endet morgen', 'Morgen startet dein Abonnement. Du kannst unter Einstellungen → Abonnement kündigen.']
    }
  },
  fr: {
    today: [['Entraîné aujourd’hui ?', '{routine} est au programme aujourd’hui. Il est encore temps 💪'],
      ['{routine} aujourd’hui ?', 'C’est dans ton plan. Ouvre Tiza et lance-toi en un geste.']],
    comeback: {
      4: ['4 jours sans entraînement', 'Une séance courte compte aussi. Tes prochaines charges sont déjà calculées.'],
      7: ['Une semaine loin de la salle', 'Ton historique et tes charges t’attendent. Reviens avec une séance courte.'],
      14: ['On reprend ?', 'Deux semaines de pause. Reprends en douceur : l’important, c’est de revenir.'],
      30: ['Ta progression t’attend', 'Ta dernière séance date d’il y a un mois. Reprends quand tu veux.']
    },
    first: {
      1: ['Ta première séance t’attend', 'Choisis une routine et note ta première série. C’est plus rapide que tu ne le crois.'],
      3: ['On commence aujourd’hui ?', 'Choisis une routine et c’est parti : Tiza te dit quoi soulever.'],
      7: ['Déjà une semaine avec Tiza', 'Tiza est prête quand tu l’es. Et si c’était aujourd’hui ?']
    },
    week: { one: 'Ta semaine : 1 séance', other: 'Ta semaine : {n} séances' },
    lifted: '{vol} soulevés',
    records: { one: '1 record', other: '{n} records' },
    up: 'Plus que la semaine dernière 🔥', same: 'Autant que la semaine dernière. La régularité paie 💪', down: 'La semaine prochaine, vise une séance de plus.',
    trial: {
      open3: ['Plus que 3 jours d’essai', 'Choisis une formule pour garder le Coach IA. Ton historique reste à toi quoi qu’il arrive.'],
      open1: ['Ton essai se termine demain', 'Choisis une formule aujourd’hui pour garder le Coach IA.'],
      card3: ['Ton essai se termine dans 3 jours', 'Ensuite, ton abonnement démarre. Pas pour toi ? Résilie dans Réglages → Abonnement.'],
      card1: ['Ton essai se termine demain', 'Ton abonnement démarre demain. Tu peux résilier dans Réglages → Abonnement.']
    }
  },
  it: {
    today: [['Allenamento fatto oggi?', '{routine} è nel piano di oggi. Sei ancora in tempo 💪'],
      ['Oggi {routine}?', 'È nel tuo piano. Apri Tiza e inizia con un tocco.']],
    comeback: {
      4: ['4 giorni senza allenarti', 'Anche una sessione breve conta. I tuoi prossimi carichi sono già calcolati.'],
      7: ['Una settimana lontano dalla palestra', 'Il tuo storico e i tuoi carichi ti aspettano. Torna con una sessione breve.'],
      14: ['Ricominciamo?', 'Due settimane di pausa. Riparti con calma: l’importante è tornare.'],
      30: ['I tuoi progressi ti aspettano', 'Il tuo ultimo allenamento è di un mese fa. Riprendi quando vuoi.']
    },
    first: {
      1: ['Il tuo primo allenamento ti aspetta', 'Scegli una routine e registra la tua prima serie. Ci vuole meno di quanto pensi.'],
      3: ['Iniziamo oggi?', 'Scegli una routine e via: Tiza ti dice quanto sollevare.'],
      7: ['Una settimana con Tiza', 'Tiza è pronta quando lo sei tu. Oggi è il giorno giusto?']
    },
    week: { one: 'La tua settimana: 1 allenamento', other: 'La tua settimana: {n} allenamenti' },
    lifted: '{vol} sollevati',
    records: { one: '1 record', other: '{n} record' },
    up: 'Più della settimana scorsa 🔥', same: 'Come la settimana scorsa. La costanza paga 💪', down: 'La prossima settimana, puntane a uno in più.',
    trial: {
      open3: ['Ancora 3 giorni di prova', 'Scegli un piano per tenere il Coach IA. Il tuo storico resta tuo in ogni caso.'],
      open1: ['La tua prova finisce domani', 'Scegli un piano oggi per non perdere il Coach IA.'],
      card3: ['La tua prova finisce tra 3 giorni', 'Poi parte il tuo abbonamento. Non fa per te? Annulla in Impostazioni → Abbonamento.'],
      card1: ['La tua prova finisce domani', 'Domani parte il tuo abbonamento. Puoi annullarlo in Impostazioni → Abbonamento.']
    }
  },
  pt: {
    today: [['Já treinaste hoje?', '{routine} está no plano de hoje. Ainda vais a tempo 💪'],
      ['Hoje é dia de {routine}?', 'Está no teu plano. Abre a app e começa com um toque.']],
    comeback: {
      4: ['4 dias sem treinar', 'Uma sessão curta também conta. Os teus próximos pesos já estão calculados.'],
      7: ['Uma semana longe do ginásio', 'O teu histórico e os teus pesos estão à tua espera. Volta com uma sessão curta.'],
      14: ['Voltamos a treinar?', 'Duas semanas de pausa. Começa com calma: o importante é voltar.'],
      30: ['O teu progresso está à tua espera', 'O teu último treino foi há um mês. Retoma quando quiseres.']
    },
    first: {
      1: ['O teu primeiro treino está à tua espera', 'Escolhe uma rotina e regista a tua primeira série. É mais rápido do que pensas.'],
      3: ['Começamos hoje?', 'Escolhe uma rotina e avança: a app diz-te quanto levantar.'],
      7: ['Já passou uma semana', 'A app está pronta quando estiveres. Hoje é o dia?']
    },
    week: { one: 'A tua semana: 1 treino', other: 'A tua semana: {n} treinos' },
    lifted: '{vol} levantados',
    records: { one: '1 recorde', other: '{n} recordes' },
    up: 'Mais do que na semana passada 🔥', same: 'Igual à semana passada. A constância compensa 💪', down: 'Na próxima semana, mais um.',
    trial: {
      open3: ['Faltam 3 dias de teste', 'Escolhe um plano para manter o Treinador IA. O teu histórico é teu aconteça o que acontecer.'],
      open1: ['O teu teste termina amanhã', 'Escolhe um plano hoje para não perderes o Treinador IA.'],
      card3: ['O teu teste termina daqui a 3 dias', 'Depois começa a tua subscrição. Não é para ti? Cancela em Definições → Subscrição.'],
      card1: ['O teu teste termina amanhã', 'A tua subscrição começa amanhã. Podes cancelar em Definições → Subscrição.']
    }
  },
  'pt-BR': {
    today: [['Já treinou hoje?', '{routine} está no plano de hoje. Ainda dá tempo 💪'],
      ['Hoje tem {routine}?', 'Está no seu plano. Abra o app e comece com um toque.']],
    comeback: {
      4: ['4 dias sem treinar', 'Um treino curto também conta. Suas próximas cargas já estão calculadas.'],
      7: ['Uma semana longe da academia', 'Seu histórico e suas cargas estão te esperando. Volte com um treino curto.'],
      14: ['Bora voltar a treinar?', 'Duas semanas de pausa. Comece leve: o importante é voltar.'],
      30: ['Seu progresso está te esperando', 'Seu último treino foi há um mês. Retome quando quiser.']
    },
    first: {
      1: ['Seu primeiro treino está te esperando', 'Escolha uma rotina e registre sua primeira série. É mais rápido do que você imagina.'],
      3: ['Vamos começar hoje?', 'Escolha uma rotina e bora: o app diz quanto levantar.'],
      7: ['Já faz uma semana', 'O app está pronto quando você estiver. Hoje é o dia?']
    },
    week: { one: 'Sua semana: 1 treino', other: 'Sua semana: {n} treinos' },
    lifted: '{vol} levantados',
    records: { one: '1 recorde', other: '{n} recordes' },
    up: 'Mais que na semana passada 🔥', same: 'Igual à semana passada. Constância é tudo 💪', down: 'Na próxima semana, mais um.',
    trial: {
      open3: ['Faltam 3 dias de teste', 'Escolha um plano para manter o Treinador IA. Seu histórico é seu de qualquer jeito.'],
      open1: ['Seu teste termina amanhã', 'Escolha um plano hoje para não perder o Treinador IA.'],
      card3: ['Seu teste termina em 3 dias', 'Depois começa sua assinatura. Não é pra você? Cancele em Configurações → Assinatura.'],
      card1: ['Seu teste termina amanhã', 'Sua assinatura começa amanhã. Você pode cancelar em Configurações → Assinatura.']
    }
  },
  pl: {
    today: [['Trening dziś zaliczony?', '{routine} jest dziś w planie. Jeszcze zdążysz 💪'],
      ['Dziś {routine}?', 'Jest w Twoim planie. Otwórz Tiza i zacznij jednym dotknięciem.']],
    comeback: {
      4: ['4 dni bez treningu', 'Krótka sesja też się liczy. Twoje kolejne ciężary są już wyliczone.'],
      7: ['Tydzień bez siłowni', 'Twoja historia i ciężary czekają. Wróć z krótką sesją.'],
      14: ['Wracamy do treningów?', 'Dwa tygodnie przerwy. Zacznij spokojnie: najważniejsze to wrócić.'],
      30: ['Twoje postępy czekają', 'Ostatni trening był miesiąc temu. Wróć, kiedy zechcesz.']
    },
    first: {
      1: ['Twój pierwszy trening czeka', 'Wybierz plan treningowy i zapisz pierwszą serię. To szybsze, niż myślisz.'],
      3: ['Zaczynamy dziś?', 'Wybierz plan treningowy i do dzieła: Tiza podpowie, ile dźwignąć.'],
      7: ['Tydzień z Tiza', 'Tiza jest gotowa, kiedy Ty będziesz. Może dziś?']
    },
    week: { one: 'Twój tydzień: 1 trening', few: 'Twój tydzień: {n} treningi', many: 'Twój tydzień: {n} treningów', other: 'Twój tydzień: {n} treningu' },
    lifted: 'Podniesiono {vol}',
    records: { one: '1 rekord', few: '{n} rekordy', many: '{n} rekordów', other: '{n} rekordu' },
    up: 'Więcej niż w zeszłym tygodniu 🔥', same: 'Tyle samo co w zeszłym tygodniu. Regularność popłaca 💪', down: 'W przyszłym tygodniu o jeden więcej.',
    trial: {
      open3: ['Zostały 3 dni okresu próbnego', 'Wybierz subskrypcję, żeby zachować Trenera AI. Twoja historia i tak zostaje Twoja.'],
      open1: ['Okres próbny kończy się jutro', 'Wybierz subskrypcję dziś, żeby nie stracić Trenera AI.'],
      card3: ['Okres próbny kończy się za 3 dni', 'Potem zacznie się Twoja subskrypcja. Nie dla Ciebie? Anuluj w Ustawienia → Subskrypcja.'],
      card1: ['Okres próbny kończy się jutro', 'Jutro zaczyna się Twoja subskrypcja. Możesz ją anulować w Ustawienia → Subskrypcja.']
    }
  },
  tr: {
    today: [['Bugün antrenman yaptın mı?', '{routine} bugünkü planında. Hâlâ vaktin var 💪'],
      ['Bugün sıra {routine} programında', 'Planında var. Uygulamayı aç ve tek dokunuşla başla.']],
    comeback: {
      4: ['4 gündür antrenman yok', 'Kısa bir seans da sayılır. Sonraki ağırlıkların zaten hesaplandı.'],
      7: ['Spordan bir hafta uzak', 'Geçmişin ve ağırlıkların seni bekliyor. Kısa bir seansla geri dön.'],
      14: ['Yeniden başlayalım mı?', 'İki haftalık ara. Yavaş başla: önemli olan geri dönmek.'],
      30: ['İlerlemen seni bekliyor', 'Son antrenmanının üzerinden bir ay geçti. İstediğin zaman devam et.']
    },
    first: {
      1: ['İlk antrenmanın seni bekliyor', 'Bir rutin seç ve ilk setini kaydet. Düşündüğünden hızlı.'],
      3: ['Bugün başlayalım mı?', 'Bir rutin seç ve başla: Tiza ne kadar kaldıracağını söyler.'],
      7: ['Tiza ile bir hafta', 'Tiza, sen hazır olduğunda hazır. Bugün o gün mü?']
    },
    week: { one: 'Haftan: 1 antrenman', other: 'Haftan: {n} antrenman' },
    lifted: '{vol} kaldırıldı',
    records: { one: '1 rekor', other: '{n} rekor' },
    up: 'Geçen haftadan fazla 🔥', same: 'Geçen haftayla aynı. İstikrar kazandırır 💪', down: 'Gelecek hafta bir tane daha.',
    trial: {
      open3: ['Denemenin bitmesine 3 gün kaldı', 'Yapay Zekâ Koçu’nu korumak için bir plan seç. Geçmişin her durumda senin.'],
      open1: ['Denemen yarın bitiyor', 'Yapay Zekâ Koçu’nu kaybetmemek için bugün bir plan seç.'],
      card3: ['Denemen 3 gün sonra bitiyor', 'Ardından aboneliğin başlar. Sana göre değil mi? Ayarlar → Abonelik’ten iptal et.'],
      card1: ['Denemen yarın bitiyor', 'Aboneliğin yarın başlıyor. Ayarlar → Abonelik’ten iptal edebilirsin.']
    }
  },
  ru: {
    today: [['Вы сегодня тренировались?', '{routine} в плане на сегодня. Ещё не поздно 💪'],
      ['Сегодня {routine}?', 'Это в вашем плане. Откройте Tiza и начните одним касанием.']],
    comeback: {
      4: ['4 дня без тренировок', 'Короткая тренировка тоже считается. Следующие веса уже рассчитаны.'],
      7: ['Неделя без зала', 'Ваша история и веса ждут. Вернитесь с короткой тренировкой.'],
      14: ['Вернёмся к тренировкам?', 'Две недели перерыва. Начните спокойно: главное — вернуться.'],
      30: ['Ваш прогресс ждёт вас', 'С последней тренировки прошёл месяц. Продолжайте, когда захотите.']
    },
    first: {
      1: ['Ваша первая тренировка ждёт', 'Выберите программу и запишите первый подход. Это быстрее, чем кажется.'],
      3: ['Начнём сегодня?', 'Выберите программу и вперёд: Tiza подскажет, какой вес брать.'],
      7: ['Неделя с Tiza', 'Tiza готова, когда готовы вы. Может, сегодня?']
    },
    week: { one: 'Ваша неделя: {n} тренировка', few: 'Ваша неделя: {n} тренировки', many: 'Ваша неделя: {n} тренировок', other: 'Ваша неделя: {n} тренировки' },
    lifted: 'Поднято {vol}',
    records: { one: '{n} рекорд', few: '{n} рекорда', many: '{n} рекордов', other: '{n} рекорда' },
    up: 'Больше, чем на прошлой неделе 🔥', same: 'Столько же, сколько на прошлой неделе. Регулярность — залог успеха 💪', down: 'На следующей неделе — на одну больше.',
    trial: {
      open3: ['До конца пробного периода 3 дня', 'Выберите тариф, чтобы сохранить ИИ-тренера. Ваша история в любом случае останется вашей.'],
      open1: ['Пробный период заканчивается завтра', 'Выберите тариф сегодня, чтобы не потерять ИИ-тренера.'],
      card3: ['Пробный период закончится через 3 дня', 'Затем начнётся подписка. Не подходит? Отмените в Настройки → Подписка.'],
      card1: ['Пробный период заканчивается завтра', 'Завтра начнётся ваша подписка. Отменить можно в Настройки → Подписка.']
    }
  },
  uk: {
    today: [['Тренування сьогодні вже було?', '{routine} у плані на сьогодні. Ще не пізно 💪'],
      ['Сьогодні {routine}?', 'Це у твоєму плані. Відкрий Tiza й почни одним дотиком.']],
    comeback: {
      4: ['4 дні без тренувань', 'Коротке тренування теж рахується. Наступні ваги вже розраховані.'],
      7: ['Тиждень без залу', 'Твоя історія й ваги чекають. Повернися з коротким тренуванням.'],
      14: ['Повертаємося до тренувань?', 'Два тижні перерви. Почни спокійно: головне — повернутися.'],
      30: ['Твій прогрес чекає', 'Від останнього тренування минув місяць. Продовжуй, коли захочеш.']
    },
    first: {
      1: ['Твоє перше тренування чекає', 'Обери програму й запиши перший підхід. Це швидше, ніж здається.'],
      3: ['Почнімо сьогодні?', 'Обери програму — і вперед: Tiza підкаже, яку вагу брати.'],
      7: ['Тиждень із Tiza', 'Tiza чекає на тебе. Може, сьогодні?']
    },
    week: { one: 'Твій тиждень: {n} тренування', few: 'Твій тиждень: {n} тренування', many: 'Твій тиждень: {n} тренувань', other: 'Твій тиждень: {n} тренування' },
    lifted: 'Піднято {vol}',
    records: { one: '{n} рекорд', few: '{n} рекорди', many: '{n} рекордів', other: '{n} рекорду' },
    up: 'Більше, ніж минулого тижня 🔥', same: 'Стільки ж, скільки минулого тижня. Регулярність — запорука успіху 💪', down: 'Наступного тижня — на одне більше.',
    trial: {
      open3: ['До кінця пробного періоду 3 дні', 'Обери тариф, щоб зберегти ШІ-тренера. Твоя історія за будь-яких умов залишиться твоєю.'],
      open1: ['Пробний період закінчується завтра', 'Обери тариф сьогодні, щоб не втратити ШІ-тренера.'],
      card3: ['Пробний період закінчиться через 3 дні', 'Потім почнеться підписка. Не підходить? Скасуй у Налаштування → Підписка.'],
      card1: ['Пробний період закінчується завтра', 'Завтра почнеться твоя підписка. Скасувати можна в Налаштування → Підписка.']
    }
  },
  zh: {
    today: [['今天练了吗？', '今天的计划里有 {routine}。现在还来得及 💪'],
      ['今天练 {routine}？', '它在你的计划里。打开 Tiza，一键开始。']],
    comeback: {
      4: ['已经 4 天没训练了', '短一点的训练也算数。你的下一次重量已经算好了。'],
      7: ['一周没去健身房了', '你的记录和重量都在等你。来一次短训练，重新开始吧。'],
      14: ['我们重新开始训练吧？', '已经休息两周了。慢慢来，重要的是回来。'],
      30: ['你的进步在等你', '距离上次训练已经一个月了。随时可以继续。']
    },
    first: {
      1: ['你的第一次训练在等你', '选一个训练日，记录你的第一组。比你想的更快。'],
      3: ['今天开始吧？', '选一个训练日就出发：Tiza 告诉你该举多重。'],
      7: ['来到 Tiza 一周了', 'Tiza 随时准备好了。今天就是那一天吗？']
    },
    week: { other: '本周：{n} 次训练' },
    lifted: '共举起 {vol}',
    records: { other: '{n} 项纪录' },
    up: '比上周多 🔥', same: '和上周一样。坚持就是胜利 💪', down: '下周再多练一次。',
    trial: {
      open3: ['试用还剩 3 天', '选择一个方案，继续使用 AI 教练。无论如何，你的记录都属于你。'],
      open1: ['你的试用明天结束', '今天选择方案，继续使用 AI 教练。'],
      card3: ['你的试用将在 3 天后结束', '之后订阅开始。不需要？在 设置 → 订阅 中取消。'],
      card1: ['你的试用明天结束', '你的订阅明天开始。可在 设置 → 订阅 中取消。']
    }
  },
  ko: {
    today: [['오늘 운동하셨나요?', '오늘 계획: {routine}. 아직 늦지 않았어요 💪'],
      ['오늘 {routine} 할까요?', '계획에 있어요. Tiza를 열고 한 번에 시작하세요.']],
    comeback: {
      4: ['4일째 운동을 쉬었어요', '짧은 운동도 의미 있어요. 다음 무게는 이미 계산해 뒀어요.'],
      7: ['헬스장을 떠난 지 일주일', '기록과 무게가 기다리고 있어요. 짧은 운동으로 다시 시작해 보세요.'],
      14: ['다시 운동해 볼까요?', '2주 동안 쉬었어요. 가볍게 시작하세요. 돌아오는 게 중요해요.'],
      30: ['성장이 기다리고 있어요', '마지막 운동 후 한 달이 지났어요. 언제든 다시 시작하세요.']
    },
    first: {
      1: ['첫 운동이 기다리고 있어요', '루틴을 고르고 첫 세트를 기록하세요. 생각보다 빨라요.'],
      3: ['오늘 시작해 볼까요?', '루틴을 고르고 출발하세요. 얼마나 들지는 Tiza가 알려 줘요.'],
      7: ['Tiza와 함께한 지 일주일', 'Tiza는 언제든 준비되어 있어요. 오늘이 그날일까요?']
    },
    week: { other: '이번 주: 운동 {n}회' },
    lifted: '총 {vol} 들어 올림',
    records: { other: '기록 {n}개 경신' },
    up: '지난주보다 많아요 🔥', same: '지난주와 같아요. 꾸준함이 이겨요 💪', down: '다음 주엔 한 번 더 해 봐요.',
    trial: {
      open3: ['체험 기간이 3일 남았어요', 'AI 코치를 계속 쓰려면 요금제를 선택하세요. 기록은 어떤 경우에도 당신의 것이에요.'],
      open1: ['체험 기간이 내일 끝나요', '오늘 요금제를 선택하고 AI 코치를 계속 사용하세요.'],
      card3: ['체험 기간이 3일 후에 끝나요', '그 후 구독이 시작돼요. 원하지 않으면 설정 → 구독에서 취소하세요.'],
      card1: ['체험 기간이 내일 끝나요', '내일 구독이 시작돼요. 설정 → 구독에서 취소할 수 있어요.']
    }
  },
  hi: {
    today: [['आज वर्कआउट किया?', 'आज के प्लान में {routine} है। अभी भी समय है 💪'],
      ['आज {routine}?', 'यह आपके प्लान में है। Tiza खोलें और एक टैप में शुरू करें।']],
    comeback: {
      4: ['4 दिन से वर्कआउट नहीं', 'छोटा सेशन भी गिना जाता है। आपके अगले वज़न पहले से तय हैं।'],
      7: ['जिम से एक हफ़्ता दूर', 'आपका इतिहास और वज़न आपका इंतज़ार कर रहे हैं। एक छोटे सेशन से वापसी करें।'],
      14: ['फिर से शुरू करें?', 'दो हफ़्ते का ब्रेक। आराम से शुरू करें: वापस आना ही सबसे ज़रूरी है।'],
      30: ['आपकी प्रगति इंतज़ार कर रही है', 'आपके पिछले वर्कआउट को एक महीना हो गया। जब चाहें फिर शुरू करें।']
    },
    first: {
      1: ['आपका पहला वर्कआउट इंतज़ार कर रहा है', 'एक रूटीन चुनें और अपना पहला सेट दर्ज करें। जितना सोचते हैं उससे जल्दी।'],
      3: ['आज शुरू करें?', 'एक रूटीन चुनें और शुरू हो जाएँ: Tiza बताएगा कितना उठाना है।'],
      7: ['Tiza के साथ एक हफ़्ता', 'जब आप तैयार हों, Tiza तैयार है। क्या आज वह दिन है?']
    },
    week: { one: 'आपका हफ़्ता: 1 वर्कआउट', other: 'आपका हफ़्ता: {n} वर्कआउट' },
    lifted: 'कुल {vol} उठाया',
    records: { one: '1 रिकॉर्ड', other: '{n} रिकॉर्ड' },
    up: 'पिछले हफ़्ते से ज़्यादा 🔥', same: 'पिछले हफ़्ते जितना। निरंतरता ही जीत है 💪', down: 'अगले हफ़्ते एक और।',
    trial: {
      open3: ['ट्रायल के 3 दिन बचे हैं', 'AI कोच जारी रखने के लिए एक प्लान चुनें। आपका इतिहास हर हाल में आपका है।'],
      open1: ['आपका ट्रायल कल खत्म होगा', 'AI कोच न खोने के लिए आज ही प्लान चुनें।'],
      card3: ['आपका ट्रायल 3 दिन में खत्म होगा', 'फिर आपकी सदस्यता शुरू होगी। नहीं चाहिए? सेटिंग्स → सदस्यता में रद्द करें।'],
      card1: ['आपका ट्रायल कल खत्म होगा', 'कल से आपकी सदस्यता शुरू होगी। आप सेटिंग्स → सदस्यता में रद्द कर सकते हैं।']
    }
  },
  th: {
    today: [['วันนี้ออกกำลังกายแล้วหรือยัง?', 'วันนี้มี {routine} ในแผน ยังทันอยู่ 💪'],
      ['วันนี้เล่น {routine} ไหม?', 'อยู่ในแผนของคุณ เปิด Tiza แล้วเริ่มได้ในแตะเดียว']],
    comeback: {
      4: ['ไม่ได้ออกกำลังกายมา 4 วันแล้ว', 'เล่นสั้น ๆ ก็นับนะ น้ำหนักครั้งถัดไปคำนวณไว้แล้ว'],
      7: ['ห่างยิมมาหนึ่งสัปดาห์', 'ประวัติและน้ำหนักของคุณรออยู่ กลับมาด้วยการเล่นสั้น ๆ สักครั้ง'],
      14: ['กลับมาออกกำลังกายกันไหม?', 'พักมาสองสัปดาห์แล้ว เริ่มเบา ๆ สิ่งสำคัญคือการกลับมา'],
      30: ['ความก้าวหน้าของคุณรออยู่', 'ผ่านมาหนึ่งเดือนแล้วตั้งแต่การออกกำลังกายครั้งล่าสุด เริ่มใหม่ได้ทุกเมื่อ']
    },
    first: {
      1: ['การออกกำลังกายครั้งแรกรอคุณอยู่', 'เลือกรูทีนแล้วบันทึกเซ็ตแรก เร็วกว่าที่คิด'],
      3: ['เริ่มวันนี้เลยไหม?', 'เลือกรูทีนแล้วลุยเลย Tiza จะบอกว่าต้องยกเท่าไร'],
      7: ['ครบหนึ่งสัปดาห์กับ Tiza', 'Tiza พร้อมเสมอเมื่อคุณพร้อม วันนี้เลยไหม?']
    },
    week: { other: 'สัปดาห์นี้: ออกกำลังกาย {n} ครั้ง' },
    lifted: 'ยกรวม {vol}',
    records: { other: 'ทำสถิติใหม่ {n} รายการ' },
    up: 'มากกว่าสัปดาห์ที่แล้ว 🔥', same: 'เท่ากับสัปดาห์ที่แล้ว ความสม่ำเสมอคือชัยชนะ 💪', down: 'สัปดาห์หน้า เพิ่มอีกสักครั้ง',
    trial: {
      open3: ['เหลือเวลาทดลองใช้ 3 วัน', 'เลือกแพ็กเกจเพื่อใช้โค้ช AI ต่อ ประวัติของคุณยังเป็นของคุณเสมอ'],
      open1: ['การทดลองใช้จะสิ้นสุดพรุ่งนี้', 'เลือกแพ็กเกจวันนี้เพื่อไม่ให้เสียโค้ช AI'],
      card3: ['การทดลองใช้จะสิ้นสุดในอีก 3 วัน', 'หลังจากนั้นการสมัครสมาชิกจะเริ่ม ไม่ต้องการหรือ? ยกเลิกได้ที่ ตั้งค่า → การสมัครสมาชิก'],
      card1: ['การทดลองใช้จะสิ้นสุดพรุ่งนี้', 'การสมัครสมาชิกจะเริ่มพรุ่งนี้ ยกเลิกได้ที่ ตั้งค่า → การสมัครสมาชิก']
    }
  },
  hu: {
    today: [['Edzettél ma?', 'A mai tervben ott van: {routine}. Még nem késő 💪'],
      ['Ma {routine}?', 'Benne van a tervedben. Nyisd meg a Tizát, és indulj egy koppintással.']],
    comeback: {
      4: ['4 napja nem edzettél', 'Egy rövid edzés is számít. A következő súlyaid már ki vannak számolva.'],
      7: ['Egy hete nem voltál edzeni', 'Az előzményeid és a súlyaid várnak. Térj vissza egy rövid edzéssel.'],
      14: ['Visszatérünk az edzéshez?', 'Két hét szünet. Kezdd lazán: a lényeg, hogy visszatérj.'],
      30: ['A fejlődésed vár rád', 'Egy hónapja volt az utolsó edzésed. Folytasd, amikor csak akarod.']
    },
    first: {
      1: ['Vár az első edzésed', 'Válassz egy rutint, és rögzítsd az első sorozatod. Gyorsabb, mint gondolnád.'],
      3: ['Kezdjük ma?', 'Válassz egy rutint, és rajta: a Tiza megmondja, mennyit emelj.'],
      7: ['Egy hete vagy a Tizával', 'A Tiza készen áll, amikor te is. Ma van az a nap?']
    },
    week: { one: 'A heted: 1 edzés', other: 'A heted: {n} edzés' },
    lifted: '{vol} megemelve',
    records: { one: '1 rekord', other: '{n} rekord' },
    up: 'Több, mint múlt héten 🔥', same: 'Ugyanannyi, mint múlt héten. A kitartás kifizetődik 💪', down: 'Jövő héten eggyel több.',
    trial: {
      open3: ['Még 3 nap a próbaidőből', 'Válassz csomagot, hogy megtartsd az MI-edzőt. Az előzményeid mindenképp a tieid maradnak.'],
      open1: ['Holnap lejár a próbaidőd', 'Válassz ma csomagot, hogy ne veszítsd el az MI-edzőt.'],
      card3: ['3 nap múlva lejár a próbaidőd', 'Utána indul az előfizetésed. Nem neked való? Mondd le itt: Beállítások → Előfizetés.'],
      card1: ['Holnap lejár a próbaidőd', 'Holnap indul az előfizetésed. Lemondhatod itt: Beállítások → Előfizetés.']
    }
  },
  ar: {
    today: [['هل تمرنت اليوم؟', '{routine} في خطة اليوم. ما زال هناك وقت 💪'],
      ['هل اليوم يوم {routine}؟', 'إنه في خطتك. افتح Tiza وابدأ بلمسة واحدة.']],
    comeback: {
      4: ['4 أيام بلا تمرين', 'الحصة القصيرة تُحتسب أيضًا. أوزانك التالية محسوبة مسبقًا.'],
      7: ['أسبوع بعيدًا عن النادي', 'سجلك وأوزانك بانتظارك. عُد بحصة قصيرة.'],
      14: ['هل نعود إلى التمرين؟', 'أسبوعان من الراحة. ابدأ بهدوء: المهم أن تعود.'],
      30: ['تقدمك بانتظارك', 'مرّ شهر على آخر تمرين لك. استأنف متى شئت.']
    },
    first: {
      1: ['تمرينك الأول بانتظارك', 'اختر روتينًا وسجّل مجموعتك الأولى. أسرع مما تظن.'],
      3: ['هل نبدأ اليوم؟', 'اختر روتينًا وانطلق: Tiza يخبرك بالوزن المناسب.'],
      7: ['أسبوع مع Tiza', 'Tiza جاهز عندما تكون جاهزًا. هل اليوم هو اليوم؟']
    },
    week: { zero: 'أسبوعك: لا تمارين', one: 'أسبوعك: تمرين واحد', two: 'أسبوعك: تمرينان', few: 'أسبوعك: {n} تمارين', many: 'أسبوعك: {n} تمرينًا', other: 'أسبوعك: {n} تمرين' },
    lifted: 'رفعت {vol}',
    records: { one: 'رقم قياسي واحد', two: 'رقمان قياسيان', few: '{n} أرقام قياسية', many: '{n} رقمًا قياسيًا', other: '{n} رقم قياسي' },
    up: 'أكثر من الأسبوع الماضي 🔥', same: 'مثل الأسبوع الماضي. الاستمرار يصنع الفرق 💪', down: 'الأسبوع القادم، تمرين إضافي واحد.',
    trial: {
      open3: ['تبقّى 3 أيام من الفترة التجريبية', 'اختر خطة للاحتفاظ بمدرب الذكاء الاصطناعي. سجلك ملكك في كل الأحوال.'],
      open1: ['تنتهي فترتك التجريبية غدًا', 'اختر خطة اليوم كي لا تفقد مدرب الذكاء الاصطناعي.'],
      card3: ['تنتهي فترتك التجريبية بعد 3 أيام', 'بعدها يبدأ اشتراكك. لا يناسبك؟ ألغِه من الإعدادات ← الاشتراك.'],
      card1: ['تنتهي فترتك التجريبية غدًا', 'يبدأ اشتراكك غدًا. يمكنك الإلغاء من الإعدادات ← الاشتراك.']
    }
  }
};
