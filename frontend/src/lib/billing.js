// Paid access on a hosted instance (api/billing.js): a free trial, then a Stripe subscription
// that pays for the AI Coach. Logging never depends on any of it.
//
// The server answers 404 on every billing route when the instance does not charge, which is
// every self-hosted one; billingStatus() turns that into null and nothing is drawn.
import { api } from './api.js'
import { t } from './i18n.js'
import { fmtDate } from './format.js'

export async function billingStatus() {
  try { return await api('/api/billing') }
  catch (e) { if (e.status === 404) return null; throw e }
}
// Whether the Coach is this profile's, for what the app SHOWS — the server still decides every
// Coach call (api/coach/routes.js answers 402):
//   'pro'   a trial, a subscription, past due, or comped: the Coach is theirs
//   'free'  an instance that charges, and this profile is not paying
//   'open'  nothing is sold here (a self-hosted instance): everything shown, nothing offered
export const accessOf = a => (!a || !a.on ? 'open' : a.ai ? 'pro' : 'free')
// Asked once and kept for a few minutes: the Home card, the report sync and the paywall moments
// all want it, and none of them is worth a request each. A checkout or a store purchase drops it.
const ACCESS_TTL = 5 * 60000
let accessMemo = null // { at, value: Promise<'pro'|'free'|'open'> }
export function coachAccess() {
  if (accessMemo && Date.now() - accessMemo.at < ACCESS_TTL) return accessMemo.value
  const value = billingStatus().then(accessOf, () => { accessMemo = null; return null })
  accessMemo = { at: Date.now(), value }
  return value
}
export const forgetCoachAccess = () => { accessMemo = null }

export const billingCheckout = plan => api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan: plan || 'monthly' }) })
export const billingPortal = () => api('/api/billing/portal', { method: 'POST', body: '{}' })

// Where a subscription bought in a store is managed — the web cannot do it for them.
const STORE_NAME = { app_store: () => t('Managed in the App Store'), mac_app_store: () => t('Managed in the App Store'), play_store: () => t('Managed in Google Play') }

// What Settings says about one profile's access, from GET /api/billing. `action` is the one
// thing the person can do next: pay, or manage what they pay. null = draw nothing (an instance
// that does not charge, or a profile it never charges).
export function billingView(a) {
  if (!a || !a.on || a.plan === 'free') return null
  const date = iso => fmtDate(String(iso).slice(0, 10), false, true)
  switch (a.plan) {
    case 'trial':
      return {
        icon: 'sparkles', tint: 'var(--acc)',
        title: a.trialDaysLeft === 1 ? t('Free trial — 1 day left') : t('Free trial — {0} days left', a.trialDaysLeft),
        subtitle: t('Subscribe now and you won’t be charged until the trial ends.'),
        action: 'checkout'
      }
    case 'active': {
      const store = a.via && a.via !== 'stripe' ? (STORE_NAME[a.via] || (() => null))() : null
      const when = a.endsAt ? t('Ends on {0}', date(a.endsAt))
        : a.periodEnd ? (a.cardTrial ? t('First charge on {0}', date(a.periodEnd)) : t('Renews on {0}', date(a.periodEnd))) : null
      return {
        icon: 'checkCircle', tint: 'var(--green)',
        title: a.cardTrial ? t('Free trial active') : t('Subscription active'),
        subtitle: [when, store].filter(Boolean).join(' · ') || null,
        action: a.via === 'stripe' && a.portal ? 'portal' : null
      }
    }
    case 'past_due':
      return {
        icon: 'warning', tint: 'var(--orange)',
        title: t('Payment failed'),
        subtitle: t('Update your card to keep the AI Coach.'),
        action: a.via === 'stripe' && a.portal ? 'portal' : null
      }
    case 'none':
      return {
        icon: 'sparkles', tint: 'var(--acc)',
        title: a.cardTrialDays > 0 ? t('Try the AI Coach free for {0} days', a.cardTrialDays) : t('The AI Coach comes with the subscription'),
        subtitle: null,
        action: 'checkout'
      }
    default:
      return { icon: 'lock', tint: 'var(--red)', title: t('Your free trial has ended'), subtitle: null, action: 'checkout' }
  }
}
