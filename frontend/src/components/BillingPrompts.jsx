import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { billingCached, accessOf } from '../lib/billing.js'
import { takeTrialOffer } from '../lib/welcome.js'
import { todayISO, isoOf, fmtNum, weekStartOf } from '../lib/format.js'
import { emptyCoach } from '../lib/coach.js'
import { trialRecap, recapHasNews, recapContext } from '../lib/trial-recap.js'
import { openTrialRecap } from './TrialRecap.jsx'
import { offerFor, offerAllowed, lastOfferAt, offersSeen, markOffer } from '../lib/offers.js'
import { useLang, getLang } from '../lib/i18n.js'
import { effectiveLang } from '../lib/default-lang.js'
import { openPaywall } from './Paywall.jsx'
import { sellsHere } from './useCoachAccess.js'

// The moments the website opens the paywall by itself:
//
//  - right after the welcome, on an instance where the trial starts with a card (plan `none`):
//    the offer of that trial, once whatever the welcome opened (an import) has been closed;
//  - the end-of-trial screen, when a trial or a subscription has run out (plan `expired`) — first,
//    and then again only when no moment below has something more particular to say;
//  - day 25 of a trial: what the Coach has done so far (components/TrialRecap.jsx), once;
//  - the offer moments (lib/offers.js): a week after the free first Coach plan, a stalled lift,
//    a return after days off — on arriving at Home only, not in the middle of something else.
//
// All of them under the same limits (lib/offers.js offerAllowed): one offer every three days at
// most, never with a workout running, never right after a record. Nothing at all on an instance
// that does not charge (no billing block in its config), in the demo, or in a phone build that
// sells nothing (useCoachAccess.js sellsHere); the store app gets them, with its store's paywall.
export default function BillingPrompts() {
  const charging = !!useStore(s => s.config?.billing)
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  const sheets = useUI(s => s.sheets.length)
  const loc = useLocation()
  const on = sellsHere(charging, user?.id)
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
      // Paused from the cancel flow: already a subscriber, who asked for a month off — nothing to offer.
      if (!live || !a || a.plan === 'paused') return
      if (offer && a.plan === 'none') { markOffer('onboarding'); openPaywall('onboarding'); return }
      const { S, config } = useStore.getState()
      const now = Date.now()
      const today = todayISO()
      const unit = S.unit === 'lb' ? 'lb' : 'kg'
      const days = config?.billing || {}
      // Day 25 of a trial: what the Coach has done so far, once, before the trial becomes a charge.
      const trial = a.plan === 'trial' && a.trialEnds ? { end: a.trialEnds, len: days.trial_days, card: false }
        : a.cardTrial && a.periodEnd && !a.endsAt ? { end: a.periodEnd, len: days.card_trial_days, card: true } : null
      // The day a trial starts, the Coach starts working on its own: a weekly review on the
      // week's last evening and a read of every session (spec F7). Once — what the person
      // changes afterwards in the Coach's settings stays changed.
      if (trial && !S.coach?.trialDefaults) {
        useStore.getState().update(s => {
          const c = (s.coach = s.coach || emptyCoach())
          if (!c.cadence || c.cadence === 'off') c.cadence = { weekly: { day: (weekStartOf(s) + 6) % 7, time: '18:00' } }
          c.autoDebrief = true
          c.trialDefaults = true
        })
      }
      if (trial && home) {
        const endsOn = isoOf(new Date(trial.end))
        const left = Math.ceil((Date.parse(trial.end) - now) / 86400000)
        const key = 'recap:' + endsOn
        if (left > 0 && left <= 5 && !offersSeen().includes(key)) {
          const recap = trialRecap(S, { from: isoOf(new Date(Date.parse(trial.end) - (trial.len || 30) * 86400000)), to: today })
          if (recapHasNews(recap)) {
            markOffer(key, trial.card ? lastOfferAt() : now)
            openTrialRecap(recap, { endsOn, card: trial.card })
            return
          }
        }
      }
      const at = lastOfferAt()
      if (!offerAllowed({ S, now, lastOfferAt: at })) return
      const ended = a.plan === 'expired'
      // After a trial, the screen says what the Coach did in it — in the person's numbers.
      const endCtx = () => recapContext(trialRecap(S, { from: isoOf(new Date(now - ((days.card_trial_days || days.trial_days || 30) + 5) * 86400000)), to: today }), { unit, fmt: fmtNum })
      // The end of a trial is said once, first; after that a moment with something of the
      // person's own to say (a stall, a return) goes before the same screen again.
      if (ended && !offersSeen().includes('trial_end')) { markOffer('trial_end', now); openPaywall('trial_end', endCtx()); return }
      const o = home ? offerFor({ S, today: todayISO(), now, access: accessOf(a), lastOfferAt: at, seen: offersSeen(), freePlanAt: a.freePlanAt }) : null
      if (o) { markOffer(o.key, now); openPaywall(o.reason, o.context); return }
      if (ended) { markOffer('trial_end', now); openPaywall('trial_end', endCtx()) }
    }).catch(() => {})
    return () => { live = false }
  }, [on, ready, langReady, user?.id, sheets === 0, home])
  return null
}
