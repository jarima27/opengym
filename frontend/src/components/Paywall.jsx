import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t, useLang } from '../lib/i18n.js'
import { dateLocale, getLang } from '../lib/i18n-core.js'
import { MOBILE } from '../lib/mobile.js'
import { billingCheckout, billingCached, billingResume } from '../lib/billing.js'
import { useStore } from '../store/useStore.js'
import { DEFAULT_SERVER } from '../lib/app-account.js'
import { fmtDate } from '../lib/format.js'
import { fetchPaywall, demoPaywall, annualSaving, planLines, ctaText, fillNamed, titleFor, timelineText, badgeText, exitLines, fill } from '../lib/paywall.js'
import { offersSeen, markOffer } from '../lib/offers.js'
import { DEMO } from '../lib/demo.js'
import { SIGNUP } from '../lib/brand.js'
import { track } from '../lib/track.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The paywall and the end-of-trial screen of the website. Every word on it is the operator's
// (Admin → Paywall), for this profile's variant — which is why the variant rides on its events.
// The recommended plan comes first and is picked already.
//
// The store app shows the same screen and the same words, but sells through the App Store and
// Google Play (lib/store-purchases.js, RevenueCat): a store app may not send anyone to a web
// checkout. Its prices are the store's, and the store's own sheet confirms the purchase.
// Any other mobile build sells nothing and never opens this.
const ORDER = ['annual', 'monthly']
const STORE = MOBILE && !!DEFAULT_SERVER
const storeLib = () => import('../lib/store-purchases.js')
const ENV = import.meta.env || {}
const TERMS_URL = ENV.VITE_TERMS_URL || 'https://tiza.fit/terminos/'
const PRIVACY_URL = ENV.VITE_PRIVACY_URL || 'https://tiza.fit/privacidad/'

// `context` is the person's own data behind the moment it opens on — { exercise, weeks, missed,
// gainKg } — which the operator's words can quote by name (lib/paywall.js fillNamed).
export function openPaywall(reason, context = null) {
  // On a phone, buying needs the account the purchase unlocks: without one there is nothing to sell.
  if (MOBILE && !(STORE && useStore.getState().user)) return false
  useUI.getState().openSheet(close => <Paywall reason={reason} context={context} close={close} />)
  return true
}
// Admin → Paywall → Preview: the words being edited, on the real screen with today's prices.
// Nothing is reported and nothing can be bought from it.
export function openPaywallPreview(preview, reason = 'preview') {
  useUI.getState().openSheet(close => <Paywall reason={reason} preview={preview} close={close} />)
}

// The paywall right after the first plan (F12), as a screen of the guided first run rather than a
// sheet: an X instead of "Not now", the operator's "continue with the free version" link unless a
// variant hides it, and — once, as it is closed — the offer of the annual plan's first year for
// less. `onDone(outcome)`: 'subscribed' (bought in the store), 'checkout' (off to Stripe, which
// brings the browser back to the first run; `onLeave` is called just before) or 'free'.
export function PaywallScreen({ onDone, onLeave }) {
  return <div className="pw-screen"><Paywall reason="onboarding" funnel onDone={onDone} onLeave={onLeave} close={() => onDone('free')} /></div>
}

function Paywall({ reason, context, preview, close, funnel = false, onDone, onLeave }) {
  const [pw, setPw] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const [exit, setExit] = useState(null)       // the offer made once as it is closed, when there is one
  const [exitOn, setExitOn] = useState(false)  // ...and showing it now
  const toast = useUI(s => s.toast)
  // Asked again when the language arrives: a paywall opened while the app is still loading its
  // language pack would otherwise stay in English. Viewed is reported once.
  const langV = useLang()
  const viewed = useRef(false)
  // A subscription paused from the cancel flow is not sold again: it is resumed.
  const [paused, setPaused] = useState(null)
  useEffect(() => { if (!preview && !DEMO) billingCached().then(a => { if (a?.plan === 'paused') setPaused(a) }).catch(() => {}) }, [])
  // The screen after the plan, previewed from Admin, looks like the real one.
  const afterPlan = funnel || reason === 'preview_plan'

  useEffect(() => {
    let live = true
    // The demo has no server: the real offer, in the built-in words.
    const asked = DEMO ? Promise.resolve(demoPaywall(getLang())) : fetchPaywall(getLang())
    asked.then(async real => {
      if (!live) return
      let p = preview ? { ...real, ...preview } : real
      // The store app: the operator's offering for this variant, priced by the store.
      if (STORE && !preview) {
        const so = await (await storeLib()).storeOffer(useStore.getState().user?.id, p.offering)
        p = { ...p, plans: so.plans, cardTrialDays: so.trialDays, packages: so.packages }
        if (!live) return
      }
      const offered = ORDER.filter(k => p.plans && k in p.plans)
      setPw(p)
      setPlan(cur => cur && offered.includes(cur) ? cur : offered.includes(p.highlight) ? p.highlight : offered[0] || null)
      if (!preview && !viewed.current) { viewed.current = true; track('paywall_viewed', { variant: p.variant, experiment: p.experiment, reason }) }
      // The exit offer, only where it can be priced: Stripe's coupon on the website (the server
      // works the first year out), the operator's offering in the store app.
      if (funnel && !preview && !offersSeen().includes('exit')) {
        if (STORE) {
          const so = await (await storeLib()).storeExitOffer(useStore.getState().user?.id, p.exitOffering).catch(() => null)
          if (live && so) setExit(so)
        } else if (p.exit?.first && p.plans?.annual) setExit({ first: p.exit.first, full: p.plans.annual, trialDays: p.cardTrialDays || 0 })
      }
    }).catch(() => { if (live) setPw(false) })
    return () => { live = false }
  }, [langV])

  if (paused) return <PausedNote a={paused} close={close} />
  if (pw === null) return <div className="muted small" style={{ padding: '24px 0', textAlign: 'center' }}>{t('Loading…')}</div>
  if (pw === false) return <>
    <div className="muted" style={{ marginBottom: 14 }}>{t('Could not open the payment page')}</div>
    <Button onClick={close}>{t('Close')}</Button>
  </>

  const c = pw.copy
  const end = reason === 'trial_end' || reason === 'preview_end'
  const locale = dateLocale()
  const offered = ORDER.filter(k => k in pw.plans)
  const saving = annualSaving(pw.plans)
  const done = outcome => (onDone ? onDone(outcome) : close())
  const go = async (which = plan, offer = null) => {
    if (preview) { toast('Preview — nothing is charged'); return }
    // Nothing is sold in the demo: the button opens the sign-up for an account of one's own.
    if (DEMO) { window.open(SIGNUP, '_blank', 'noopener'); close(); return }
    setBusy(true)
    if (STORE) {
      track('checkout_started', { plan: which, via: 'store', variant: pw.variant, reason, ...(offer ? { offer } : {}) })
      try {
        const r = await (await storeLib()).buy(useStore.getState().user?.id, offer ? exit.pkg : pw.packages[which])
        if (r.cancelled) { setBusy(false); return }
        toast(t('Welcome to Tiza Pro'))
        done('subscribed')
      } catch { toast(t('The purchase did not go through. Nothing was charged.')); setBusy(false) }
      return
    }
    try {
      const { url } = await billingCheckout(which, { offer, back: funnel ? 'welcome' : undefined })
      if (funnel) onLeave?.()
      window.location.assign(url)
    } catch { toast(t('Could not open the payment page')); setBusy(false) }
  }
  const restore = async () => {
    setBusy(true)
    try {
      const r = await (await storeLib()).restore(useStore.getState().user?.id)
      if (r.active) { toast(t('Your purchase is restored.')); done('subscribed') }
      else { toast(t('There is nothing to restore on this store account.')); setBusy(false) }
    } catch { toast(t('Could not reach the store. Try again in a moment.')); setBusy(false) }
  }
  const later = () => { if (!preview) track('paywall_dismissed', { variant: pw.variant, reason }); close() }
  // Closing the paywall after the plan, by its X or its "free version" link: the exit offer once,
  // where there is one; else the free version.
  const leave = how => {
    if (preview) { close(); return }
    track('paywall_dismissed', { variant: pw.variant, reason, how })
    if (exit && !exitOn && !offersSeen().includes('exit')) {
      markOffer('exit')
      track('exit_offer_viewed', { variant: pw.variant, reason })
      setExitOn(true)
      return
    }
    track('continued_free', { variant: pw.variant, reason })
    done('free')
  }

  const xButton = afterPlan && <button type="button" className="iconbtn pw-x" aria-label={t('Close')} onClick={() => (exitOn ? done('free') : leave('close'))}><Icon name="xmark" /></button>

  // The offer made once: the annual plan's first year at the price Stripe or the store gives it.
  const exitText = exitOn && exitLines(c, exit, locale)
  if (exitText) return <>
    {xButton}
    <div className="pw-exit">
      <div className="pw-exit-icon"><Icon name="gift" /></div>
      <h3 style={{ marginBottom: 8 }}>{exitText.title}</h3>
      {exitText.body && <div className="muted small" style={{ marginBottom: 18, lineHeight: 1.5 }}>{exitText.body}</div>}
    </div>
    <Button variant="primary" disabled={busy} onClick={() => { track('exit_offer_accepted', { variant: pw.variant, reason }); go('annual', 'exit') }}>
      {exit.trialDays > 0 ? fill(c.cta, exit.trialDays) : c.ctaNoTrial}
    </Button>
    {STORE && <div className="dim small" style={{ marginTop: 10, lineHeight: 1.5 }}>
      {t('Charged to your store account. It renews automatically unless you cancel at least 24 hours before the end of the period; manage or cancel it in your store account settings.')}
      {' '}<a href={TERMS_URL} target="_blank" rel="noopener">{t('Terms')}</a> · <a href={PRIVACY_URL} target="_blank" rel="noopener">{t('Privacy')}</a>
    </div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={() => { track('continued_free', { variant: pw.variant, reason, after: 'exit' }); done('free') }}>{c.exitLater || c.later}</Button>
  </>

  // The operator's lines with the person's data in them; one whose data is missing is left out.
  const ctx = context || {}
  const subtitle = fillNamed(end ? c.endBody : c.subtitle, ctx)
  // After a trial: what the Coach did in it, in the person's numbers — left out when there are none.
  const recap = end ? fillNamed(c.endRecap, ctx) : null
  const bullets = (c.bullets || []).map(b => fillNamed(b, ctx)).filter(Boolean)
  const footnote = fillNamed(c.footnote, ctx)
  const timeline = end ? null : timelineText(c, pw.cardTrialDays)
  const badge = badgeText(c, saving)
  const showFree = afterPlan && pw.showFree !== false

  return <>
    {xButton}
    <h3 style={{ marginBottom: 6, ...(afterPlan ? { paddingInlineEnd: 40 } : {}) }}>{end ? c.endTitle : titleFor(c, reason, ctx)}</h3>
    {recap && <div className="small" style={{ marginBottom: 10, lineHeight: 1.5 }}>{recap}</div>}
    {subtitle && <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>{subtitle}</div>}
    {!!bullets.length && <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      {bullets.map((b, i) => <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="checkCircle" style={{ color: 'var(--acc)', flex: 'none', marginTop: 2 }} />
        <span className="small">{b}</span>
      </div>)}
    </div>}

    {offered.length ? <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
      {offered.map(k => {
        const lines = planLines(k, pw.plans[k], c, locale)
        const on = plan === k
        return <button key={k} type="button" className="card tap" onClick={() => setPlan(k)} aria-pressed={on}
          style={{ textAlign: 'start', margin: 0, border: `2px solid ${on ? 'var(--acc)' : 'transparent'}`, position: 'relative' }}>
          <div className="row between" style={{ alignItems: 'baseline', gap: 10 }}>
            <strong>{k === 'annual' ? c.annualLabel : c.monthlyLabel}</strong>
            {k === pw.highlight && k === 'annual' && badge && <span className="chip nocap" style={{ background: 'var(--acc)', color: 'var(--on-acc)', fontSize: 12 }}>{badge}</span>}
          </div>
          {lines.main && <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{lines.main}</div>}
          {lines.sub && <div className="dim small">{lines.sub}</div>}
        </button>
      })}
    </div> : <div className="card small muted" style={{ marginBottom: 14 }}>{STORE ? t('The plans could not be loaded from the store. Try again in a moment.') : t('Subscriptions are sold in the iPhone and Android app.')}</div>}

    {/* What the trial does and when, before the button that starts it: no surprise on day 7. */}
    {!!offered.length && timeline && <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, lineHeight: 1.45 }}>
      <Icon name="calendar" style={{ color: 'var(--acc)', flex: 'none', marginTop: 2 }} />
      <span>{timeline}</span>
    </div>}
    {!!offered.length && <Button variant="primary" onClick={() => go()} disabled={busy || !plan}>{ctaText(pw, end)}</Button>}
    {footnote && <div className="dim small" style={{ marginTop: 10, lineHeight: 1.5 }}>{footnote}</div>}
    {DEMO && <div className="dim small" style={{ marginTop: 6, lineHeight: 1.5 }}>{t('This is the demo: the button opens the sign-up for your own account.')}</div>}
    {/* What the stores ask every subscription screen to say, and where the terms are. */}
    {STORE && !!offered.length && <div className="dim small" style={{ marginTop: 10, lineHeight: 1.5 }}>
      {t('Charged to your store account. It renews automatically unless you cancel at least 24 hours before the end of the period; manage or cancel it in your store account settings.')}
      {' '}<a href={TERMS_URL} target="_blank" rel="noopener">{t('Terms')}</a> · <a href={PRIVACY_URL} target="_blank" rel="noopener">{t('Privacy')}</a>
    </div>}
    <div style={{ height: 8 }} />
    {/* After the plan: small, but there and legible — the free version is a real choice. */}
    {afterPlan
      ? showFree && <button type="button" className="pw-free" onClick={() => leave('free')}>{c.freeLink || c.later}</button>
      : <Button variant="ghost" className="dim" onClick={later}>{c.later}</Button>}
    {STORE && !preview && <Button variant="ghost" className="dim" onClick={restore} disabled={busy}>{t('Restore purchases')}</Button>}
  </>
}

function PausedNote({ a, close }) {
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const resume = async () => {
    setBusy(true)
    try { await billingResume(); close(); toast(t('Your subscription is back on.')) }
    catch { toast(t('Could not reach the payment provider. Try again in a moment.')); setBusy(false) }
  }
  return <>
    <h3 style={{ marginBottom: 6 }}>{t('Subscription paused')}</h3>
    {a.pausedUntil && <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Nothing is charged until {0}, when it resumes by itself.', fmtDate(String(a.pausedUntil).slice(0, 10), false, true))}
    </div>}
    <Button variant="primary" onClick={resume} disabled={busy}>{t('Resume now')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Not now')}</Button>
  </>
}
