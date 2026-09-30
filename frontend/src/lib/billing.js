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
export const billingCheckout = () => api('/api/billing/checkout', { method: 'POST', body: '{}' })
export const billingPortal = () => api('/api/billing/portal', { method: 'POST', body: '{}' })

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
    case 'active':
      return {
        icon: 'checkCircle', tint: 'var(--green)',
        title: t('Subscription active'),
        subtitle: a.endsAt ? t('Ends on {0}', date(a.endsAt)) : a.periodEnd ? t('Renews on {0}', date(a.periodEnd)) : null,
        action: a.portal ? 'portal' : null
      }
    case 'past_due':
      return {
        icon: 'warning', tint: 'var(--orange)',
        title: t('Payment failed'),
        subtitle: t('Update your card to keep the AI Coach.'),
        action: a.portal ? 'portal' : null
      }
    default:
      return { icon: 'lock', tint: 'var(--red)', title: t('Your free trial has ended'), subtitle: null, action: 'checkout' }
  }
}
