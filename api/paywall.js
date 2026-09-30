/* The paywall and the end-of-trial screen, as the operator words them — changed from the admin
 * dashboard, live on the next screen anyone opens, no app release in between.
 *
 * Stored in DATA_DIR/paywall.json. Until the operator saves one, DEFAULTS below is the paywall.
 *
 *   { experiment: 'launch',               changing it reshuffles who sees which variant
 *     variants: [{
 *       id: 'a', weight: 50,               share of profiles that see it
 *       highlight: 'annual',               the plan drawn as the recommended one
 *       prices: { monthly, annual },       Stripe price ids for this variant (else the env ones)
 *       offering: 'default',               the RevenueCat offering the app shows for it
 *       copy: { es: {...}, en: {...} }     every text on both screens, per language
 *     }] }
 *
 * A profile always gets the same variant for the same experiment (a hash of its id), so a
 * price test is not a coin toss on every screen. The variant id rides on the paywall's events,
 * which is how PostHog tells the variants apart. */
import crypto from 'node:crypto';
import fs from 'node:fs';

export const PLANS = ['monthly', 'annual'];
// Every text field, in the order the admin form lists them. {0} is filled in by the app: the
// trial's days in the call to action, the price in perMonth / perYear.
export const COPY_FIELDS = [
  'title', 'subtitle', 'bullets', 'cta', 'ctaNoTrial', 'monthlyLabel', 'annualLabel', 'annualBadge',
  'perMonth', 'perYear', 'footnote', 'later', 'endTitle', 'endBody', 'endCta'
];
const MAX_TEXT = 300;
const MAX_BULLETS = 6;

export const DEFAULT_COPY = {
  es: {
    title: 'Entrena con un plan que progresa solo',
    subtitle: 'El Coach IA ajusta tu plan cada semana según lo que levantas de verdad.',
    bullets: ['Coach IA incluido, sin claves ni configuraciones', 'Progresión automática de cada ejercicio', 'Tus datos sincronizados en todos tus dispositivos'],
    cta: 'Empezar {0} días gratis',
    ctaNoTrial: 'Suscribirme',
    monthlyLabel: 'Mensual',
    annualLabel: 'Anual',
    annualBadge: 'Ahorra más',
    perMonth: '{0}/mes',
    perYear: '{0}/año',
    footnote: 'Registrar entrenamientos es siempre gratis. La suscripción se renueva sola; cancela cuando quieras.',
    later: 'Ahora no',
    endTitle: 'Tu prueba gratis ha terminado',
    endBody: 'Tus entrenamientos siguen aquí y puedes seguir registrándolos gratis. Para seguir con el Coach IA, elige un plan.',
    endCta: 'Seguir con el Coach IA'
  },
  en: {
    title: 'Train on a plan that progresses itself',
    subtitle: 'The AI Coach adjusts your plan every week from what you actually lift.',
    bullets: ['AI Coach included — no keys, no setup', 'Automatic progression on every exercise', 'Your data synced across all your devices'],
    cta: 'Start {0} days free',
    ctaNoTrial: 'Subscribe',
    monthlyLabel: 'Monthly',
    annualLabel: 'Yearly',
    annualBadge: 'Best value',
    perMonth: '{0}/month',
    perYear: '{0}/year',
    footnote: 'Logging workouts is always free. The subscription renews automatically; cancel anytime.',
    later: 'Not now',
    endTitle: 'Your free trial has ended',
    endBody: 'Your workouts are all still here, and logging stays free. To keep the AI Coach, pick a plan.',
    endCta: 'Keep the AI Coach'
  }
};
export const DEFAULTS = {
  experiment: 'launch',
  variants: [{ id: 'a', weight: 100, highlight: 'annual', prices: {}, offering: '', copy: DEFAULT_COPY }]
};

class PaywallError extends Error {}
const str = (v, max = MAX_TEXT) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* What an admin sent, checked and normalised — or a PaywallError naming the first problem. The
   form only ever sends what it drew, but this route is reachable by hand too. */
export function validatePaywall(raw) {
  if (!raw || typeof raw !== 'object') throw new PaywallError('not a paywall');
  const experiment = str(raw.experiment, 40) || 'launch';
  if (!/^[\w-]{1,40}$/.test(experiment)) throw new PaywallError('the experiment name is letters, digits, - and _');
  if (!Array.isArray(raw.variants) || !raw.variants.length || raw.variants.length > 4) throw new PaywallError('one to four variants');
  const ids = new Set();
  const variants = raw.variants.map((v, i) => {
    const id = str(v?.id, 16).toLowerCase();
    if (!/^[a-z0-9_-]{1,16}$/.test(id)) throw new PaywallError(`variant ${i + 1}: the id is letters, digits, - and _`);
    if (ids.has(id)) throw new PaywallError(`variant ${id}: the id is used twice`);
    ids.add(id);
    const weight = Math.round(+v.weight);
    if (!(weight >= 0 && weight <= 100)) throw new PaywallError(`variant ${id}: the weight is 0 to 100`);
    const highlight = PLANS.includes(v.highlight) ? v.highlight : 'annual';
    const prices = {};
    for (const p of PLANS) {
      const price = str(v.prices?.[p], 80);
      if (price && !/^price_\w+$/.test(price)) throw new PaywallError(`variant ${id}: a Stripe price id starts with price_`);
      if (price) prices[p] = price;
    }
    const offering = str(v.offering, 60);
    const copy = {};
    for (const [lang, c] of Object.entries(v.copy || {})) {
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang) || !c || typeof c !== 'object') continue;
      const one = {};
      for (const f of COPY_FIELDS) {
        if (f === 'bullets') {
          const list = (Array.isArray(c.bullets) ? c.bullets : []).map(b => str(b)).filter(Boolean).slice(0, MAX_BULLETS);
          if (list.length) one.bullets = list;
        } else if (str(c[f])) one[f] = str(c[f]);
      }
      if (Object.keys(one).length) copy[lang] = one;
    }
    return { id, weight, highlight, prices, offering, copy };
  });
  if (!variants.some(v => v.weight > 0)) throw new PaywallError('at least one variant needs a weight above 0');
  return { experiment, variants };
}
export { PaywallError };

export function loadPaywall(file) {
  try { return validatePaywall(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return DEFAULTS; }
}

/* The variant a profile sees: its id hashed with the experiment name, spread over the weights. */
export function variantFor(cfg, uid) {
  const live = cfg.variants.filter(v => v.weight > 0);
  const total = live.reduce((n, v) => n + v.weight, 0);
  const h = crypto.createHash('sha256').update(cfg.experiment + ':' + uid).digest().readUInt32BE(0);
  let at = h % total;
  for (const v of live) { if (at < v.weight) return v; at -= v.weight; }
  return live[live.length - 1];
}

/* Every text for one language: the variant's own words, field by field over the built-in ones —
   so a field the operator left empty still says something, in the right language when it can. */
export function copyFor(variant, lang) {
  const base = String(lang || 'en').split('-')[0];
  const pick = src => src?.[lang] || src?.[base] || null;
  const builtin = pick(DEFAULT_COPY) || DEFAULT_COPY.en;
  const own = pick(variant.copy) || (base === 'en' ? null : variant.copy?.en) || {};
  const out = {};
  for (const f of COPY_FIELDS) out[f] = own[f] ?? builtin[f];
  return out;
}

/* What a Stripe price looks like on screen: amount in minor units, currency, per month or year.
   Read from Stripe once and kept for ten minutes — the paywall is opened far more often than a
   price changes. */
export function createPriceCache(fetchPrice, { ttlMs = 600000, now = Date.now } = {}) {
  const cache = new Map();
  return async id => {
    const hit = cache.get(id);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    let value = null;
    try {
      const p = await fetchPrice(id);
      if (Number.isFinite(p?.unit_amount) && p.currency) value = { amount: p.unit_amount, currency: String(p.currency).toUpperCase(), interval: p.recurring?.interval || null };
    } catch { /* shown without an amount; the checkout page still states it */ }
    cache.set(id, { at: now(), value });
    return value;
  };
}
