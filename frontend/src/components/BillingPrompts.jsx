import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { billingStatus } from '../lib/billing.js'
import { takeTrialOffer } from '../lib/welcome.js'
import { openPaywall } from './Paywall.jsx'

// The two moments the website opens the paywall by itself, each at most once:
//
//  - right after the welcome, on an instance where the trial starts with a card (plan `none`):
//    the offer of that trial, once whatever the welcome opened (an import) has been closed;
//  - the end-of-trial screen, when a trial or a subscription has run out (plan `expired`) —
//    again at most every three days, so it reminds without nagging.
//
// Nothing at all on an instance that does not charge (no billing block in its config), in the
// demo, or in the phone app, which sells through its store.
const SEEN = 'gym_trial_end_seen'
const EVERY_MS = 3 * 86400000

export default function BillingPrompts() {
  const charging = !!useStore(s => s.config?.billing)
  const user = useStore(s => s.user)
  const sheets = useUI(s => s.sheets.length)
  const on = charging && !!user && !MOBILE && !DEMO

  useEffect(() => {
    if (!on || sheets) return
    let live = true
    const offer = takeTrialOffer()
    billingStatus().then(a => {
      if (!live || !a) return
      if (offer && a.plan === 'none') { openPaywall('onboarding'); return }
      if (a.plan !== 'expired') return
      let last = 0
      try { last = +localStorage.getItem(SEEN) || 0 } catch { /* private mode */ }
      if (Date.now() - last < EVERY_MS) return
      try { localStorage.setItem(SEEN, String(Date.now())) } catch { /* shown anyway */ }
      openPaywall('trial_end')
    }).catch(() => {})
    return () => { live = false }
  }, [on, user?.id, sheets === 0])
  return null
}
