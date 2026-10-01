// The paywall as the operator last worded it (Admin → Paywall, api/paywall.js): what the server
// sends, and the few sums the screen does with it. The words are the operator's, in the app's
// language, so none of them is in the locale packs.
import { api } from './api.js'
import { getLang } from './i18n.js'
import { OFFER } from './brand.js'
import { DEFAULT_COPY } from '../../../api/coach/core/paywall-copy.js'

export const fetchPaywall = (lang = getLang()) => api('/api/paywall?lang=' + encodeURIComponent(lang))

/** "{0} days free" with its blanks filled. */
export const fill = (s, ...args) => String(s || '').replace(/\{(\d+)\}/g, (m, i) => (args[+i] != null ? String(args[+i]) : m))

export function money(price, locale) {
  if (!price || !Number.isFinite(price.amount)) return ''
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency }).format(price.amount / 100) }
  catch { return (price.amount / 100).toFixed(2) + ' ' + price.currency }
}

/** How much cheaper a year is than twelve months, in whole percent — or null when they cannot be
    compared (a plan missing, two currencies, no saving at all). */
export function annualSaving(plans) {
  const m = plans?.monthly, y = plans?.annual
  if (!m || !y || m.currency !== y.currency || !(m.amount > 0)) return null
  const pct = Math.round((1 - y.amount / (m.amount * 12)) * 100)
  return pct > 0 ? pct : null
}

/** The lines on one plan's card: its price per period, and for the year what that is a month. */
export function planLines(plan, price, copy, locale) {
  if (!price) return { main: '', sub: '' }
  if (plan === 'annual') {
    return {
      main: fill(copy.perYear, money(price, locale)),
      sub: fill(copy.perMonth, money({ amount: Math.round(price.amount / 12), currency: price.currency }, locale))
    }
  }
  return { main: fill(copy.perMonth, money(price, locale)), sub: '' }
}

/** The call to action: the trial's length when checking out starts one, else the plain one. */
export const ctaText = (pw, end) => (pw.cardTrialDays > 0 ? fill(pw.copy.cta, pw.cardTrialDays) : end ? pw.copy.endCta : pw.copy.ctaNoTrial)

// The person's own data a paywall can quote (api/paywall.js COPY_FIELDS): blanks by name, so
// the operator writes "Stop stalling on {exercise}" and never a number they cannot know.
export const CONTEXT_KEYS = ['exercise', 'weeks', 'missed', 'gainKg', 'adjustments']

/** A line with its named blanks filled from `ctx`, or null when one of them has no data — the
    line is then left out rather than shown with a hole in it. Numbered blanks are left alone. */
export function fillNamed(s, ctx = {}) {
  if (typeof s !== 'string' || !s) return null
  let missing = false
  const out = s.replace(/\{([a-zA-Z]+)\}/g, (m, k) => {
    const v = ctx?.[k]
    if (v == null || v === '') { missing = true; return m }
    return String(v)
  })
  return missing ? null : out
}

// Which title a moment opens the paywall with; anything else gets the general one.
const TITLE_FOR = { stall: 'titleStall', 'pill:stall': 'titleStall', comeback: 'titleComeback', day7: 'titleDay7' }

/** The title for this paywall: the moment's own when it has one and its blanks can be filled,
    else the general title. */
export function titleFor(copy, reason, ctx) {
  const own = TITLE_FOR[reason] && fillNamed(copy[TITLE_FOR[reason]], ctx)
  return own || fillNamed(copy.title, ctx) || copy.title || ''
}

/** "Today · Day 27: we remind you · Day 30: billing starts" — only when checking out starts a
    trial, with the reminder three days before its first charge (the promise the trial makes). */
export function timelineText(copy, cardTrialDays) {
  if (!(cardTrialDays > 3) || !copy.timeline) return null
  return fill(copy.timeline, cardTrialDays - 3, cardTrialDays)
}

// The paywall of the demo, which has no server to ask: the real offer (lib/brand.js OFFER) in the
// built-in words (api/coach/core/paywall-copy.js). Its button opens the sign-up for an account.
export function demoPaywall(lang = getLang()) {
  const copy = DEFAULT_COPY[lang] || DEFAULT_COPY[String(lang).split('-')[0]] || DEFAULT_COPY.en
  return {
    experiment: 'demo', variant: 'demo', highlight: 'annual', offering: null, copy,
    plans: {
      monthly: { amount: OFFER.monthly, currency: OFFER.currency, interval: 'month' },
      annual: { amount: OFFER.annual, currency: OFFER.currency, interval: 'year' }
    },
    cardTrialDays: OFFER.trialDays
  }
}
