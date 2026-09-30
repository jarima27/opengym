// The paywall as the operator last worded it (Admin → Paywall, api/paywall.js): what the server
// sends, and the few sums the screen does with it. The words are the operator's, in the app's
// language, so none of them is in the locale packs.
import { api } from './api.js'
import { getLang } from './i18n.js'

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
