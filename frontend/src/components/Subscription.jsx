import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { billingStatus, billingPortal, billingView, billingResume, storeManageUrl } from '../lib/billing.js'
import { openPaywall } from './Paywall.jsx'
import { openCancelFlow } from './CancelFlow.jsx'
import { openRedeem } from './Invite.jsx'
import { MOBILE } from '../lib/mobile.js'
import { useStore } from '../store/useStore.js'
import { Section, Row } from './ui.jsx'

// Settings → Subscription, on an instance that charges. Renders nothing anywhere else.
//
// Checked again whenever the tab comes back into focus: coming back from Stripe's checkout is
// exactly that, and the webhook that records the payment can land a moment after the redirect.
//
// Cancelling (spec F8) is the section's last row whenever there is something to cancel, and it is
// never anywhere else or hidden behind anything: a cancelled subscription shows the way back in
// that same place. The trial's last reminder links here with ?cancel=1, which opens it at once.
export default function SubscriptionSection() {
  const [a, setA] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const navigate = useNavigate()
  const asked = useRef(false)
  const reload = useRef(() => {})

  useEffect(() => {
    let live = true
    const load = () => billingStatus().then(r => { if (live) setA(r) }).catch(() => {})
    reload.current = load
    load()
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { live = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [])

  const view = billingView(a)
  const cancellable = !!a && (a.plan === 'active' || a.plan === 'past_due' || a.plan === 'paused') && !a.endsAt
    && (a.via === 'stripe' || !!storeManageUrl(a.via))
  const keepable = !!a && a.via === 'stripe' && !!a.endsAt && a.plan !== 'expired'
  const cancel = () => openCancelFlow(a, () => reload.current())

  // The route is in the hash (HashRouter): #/settings?cancel=1.
  useEffect(() => {
    if (asked.current || !cancellable || !/[?&]cancel(=|&|$)/.test(window.location.hash)) return
    asked.current = true
    navigate('/settings', { replace: true })
    cancel()
  }, [cancellable])

  if (!view) return null

  // Subscribing goes through the paywall (the operator's words and both plans); managing an
  // existing subscription goes straight to Stripe's portal.
  const go = async () => {
    if (view.action === 'checkout') { openPaywall(a.plan === 'expired' ? 'trial_end' : 'settings'); return }
    if (busy) return
    setBusy(true)
    try {
      if (view.action === 'resume') { await billingResume(); await reload.current(); setBusy(false); return }
      const { url } = await billingPortal()
      window.location.assign(url)
    } catch {
      toast(t('Could not open the payment page'))
      setBusy(false)
    }
  }
  // The store app: what this store account bought before — a new phone, a reinstall.
  const restore = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await (await import('../lib/store-purchases.js')).restore(useStore.getState().user?.id)
      toast(r.active ? t('Your purchase is restored.') : t('There is nothing to restore on this store account.'))
      await reload.current()
    } catch { toast(t('Could not reach the store. Try again in a moment.')) }
    setBusy(false)
  }
  const keep = async () => {
    if (busy) return
    setBusy(true)
    try { await billingResume(); await reload.current() } catch { toast(t('Could not reach the payment provider. Try again in a moment.')) }
    setBusy(false)
  }
  // In the store app nothing leads to the website's payment pages (the stores do not allow it):
  // a web subscription is shown, and cancelled in the app, but managed on the website.
  const action = MOBILE && view.action === 'portal' ? null : view.action
  const ACTION = {
    portal: ['gear', () => t('Manage subscription')],
    resume: ['play', () => t('Resume subscription')],
    checkout: ['star', () => t('Subscribe')]
  }

  return <Section title={t('Subscription')} footer={t('Logging workouts is always free. The subscription pays for the AI Coach.')}>
    <Row icon={view.icon} iconTint={view.tint} title={view.title} subtitle={view.subtitle} />
    {action && <Row icon={ACTION[action][0]} iconTint="var(--acc)" accessory="chevron" title={ACTION[action][1]()} onClick={go} />}
    {keepable && <Row icon="reset" iconTint="var(--acc)" accessory="chevron" title={t('Keep my subscription')} onClick={keep} />}
    {MOBILE && <Row icon="reset" iconTint="var(--acc)" accessory="chevron" title={t('Restore purchases')} onClick={restore} />}
    {/* A tester's code at any time; a creator's or a friend's in the first week (components/Invite.jsx). */}
    {a.plan !== 'free' && <Row icon="key" iconTint="var(--acc)" accessory="chevron" title={t('Have a code?')} onClick={() => openRedeem(next => (next ? setA(next) : reload.current()))} />}
    {cancellable && <Row icon="xmark" iconTint="var(--red)" danger accessory="chevron" title={t('Cancel subscription')} onClick={cancel} />}
  </Section>
}
