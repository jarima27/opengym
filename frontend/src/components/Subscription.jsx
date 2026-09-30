import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { billingStatus, billingPortal, billingView } from '../lib/billing.js'
import { openPaywall } from './Paywall.jsx'
import { Section, Row } from './ui.jsx'

// Settings → Subscription, on an instance that charges. Renders nothing anywhere else.
//
// Checked again whenever the tab comes back into focus: coming back from Stripe's checkout is
// exactly that, and the webhook that records the payment can land a moment after the redirect.
export default function SubscriptionSection() {
  const [a, setA] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)

  useEffect(() => {
    let live = true
    const load = () => billingStatus().then(r => { if (live) setA(r) }).catch(() => {})
    load()
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { live = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [])

  const view = billingView(a)
  if (!view) return null

  // Subscribing goes through the paywall (the operator's words and both plans); managing an
  // existing subscription goes straight to Stripe's portal.
  const go = async () => {
    if (view.action === 'checkout') { openPaywall(a.plan === 'expired' ? 'trial_end' : 'settings'); return }
    if (busy) return
    setBusy(true)
    try {
      const { url } = await billingPortal()
      window.location.assign(url)
    } catch {
      toast(t('Could not open the payment page'))
      setBusy(false)
    }
  }

  return <Section title={t('Subscription')} footer={t('Logging workouts is always free. The subscription pays for the AI Coach.')}>
    <Row icon={view.icon} iconTint={view.tint} title={view.title} subtitle={view.subtitle} />
    {view.action && <Row icon={view.action === 'portal' ? 'gear' : 'star'} iconTint="var(--acc)" accessory="chevron"
      title={view.action === 'portal' ? t('Manage subscription') : t('Subscribe')} onClick={go} />}
  </Section>
}
