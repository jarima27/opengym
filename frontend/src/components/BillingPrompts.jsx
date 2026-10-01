import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { billingCached, accessOf } from '../lib/billing.js'
import { takeTrialOffer } from '../lib/welcome.js'
import { todayISO } from '../lib/format.js'
import { offerFor, offerAllowed, lastOfferAt, offersSeen, markOffer } from '../lib/offers.js'
import { useLang, getLang } from '../lib/i18n.js'
import { effectiveLang } from '../lib/default-lang.js'
import { openPaywall } from './Paywall.jsx'

// The moments the website opens the paywall by itself:
//
//  - right after the welcome, on an instance where the trial starts with a card (plan `none`):
//    the offer of that trial, once whatever the welcome opened (an import) has been closed;
//  - the end-of-trial screen, when a trial or a subscription has run out (plan `expired`) — first,
//    and then again only when no moment below has something more particular to say;
//  - the offer moments (lib/offers.js): a week after the free first Coach plan, a stalled lift,
//    a return after days off — on arriving at Home only, not in the middle of something else.
//
// All of them under the same limits (lib/offers.js offerAllowed): one offer every three days at
// most, never with a workout running, never right after a record. Nothing at all on an instance
// that does not charge (no billing block in its config), in the demo, or in the phone app, which
// sells through its store.
export default function BillingPrompts() {
  const charging = !!useStore(s => s.config?.billing)
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  const sheets = useUI(s => s.sheets.length)
  const loc = useLocation()
  const on = charging && !!user && !MOBILE && !DEMO
  const home = loc.pathname === '/home'
  // An offer quotes the person's own lift by name, so it waits for their language — exercise
  // names included — to be in place: one opened a moment earlier says "barbell full squat".
  const langV = useLang()
  const lang = useStore(s => effectiveLang(s.S, s.config))
  const langReady = langV > 0 && getLang() === lang

  useEffect(() => {
    if (!on || sheets || !ready || !langReady) return
    let live = true
    const offer = takeTrialOffer()
    billingCached().then(a => {
      if (!live || !a) return
      if (offer && a.plan === 'none') { markOffer('onboarding'); openPaywall('onboarding'); return }
      const S = useStore.getState().S
      const now = Date.now()
      const at = lastOfferAt()
      if (!offerAllowed({ S, now, lastOfferAt: at })) return
      const ended = a.plan === 'expired'
      // The end of a trial is said once, first; after that a moment with something of the
      // person's own to say (a stall, a return) goes before the same screen again.
      if (ended && !offersSeen().includes('trial_end')) { markOffer('trial_end', now); openPaywall('trial_end'); return }
      const o = home ? offerFor({ S, today: todayISO(), now, access: accessOf(a), lastOfferAt: at, seen: offersSeen(), freePlanAt: a.freePlanAt }) : null
      if (o) { markOffer(o.key, now); openPaywall(o.reason, o.context); return }
      if (ended) { markOffer('trial_end', now); openPaywall('trial_end') }
    }).catch(() => {})
    return () => { live = false }
  }, [on, ready, langReady, user?.id, sheets === 0, home])
  return null
}
