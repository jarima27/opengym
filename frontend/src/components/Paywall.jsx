import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t, useLang } from '../lib/i18n.js'
import { dateLocale, getLang } from '../lib/i18n-core.js'
import { MOBILE } from '../lib/mobile.js'
import { billingCheckout, billingCached, billingResume } from '../lib/billing.js'
import { fmtDate } from '../lib/format.js'
import { fetchPaywall, annualSaving, planLines, ctaText, fillNamed, titleFor, timelineText } from '../lib/paywall.js'
import { track } from '../lib/track.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// The paywall and the end-of-trial screen of the website. Every word on it is the operator's
// (Admin → Paywall), for this profile's variant — which is why the variant rides on its events.
// The recommended plan comes first and is picked already.
//
// The phone app sells through the App Store and Google Play instead, and never opens this: a
// store app may not send people to a web checkout.
const ORDER = ['annual', 'monthly']

// `context` is the person's own data behind the moment it opens on — { exercise, weeks, missed,
// gainKg } — which the operator's words can quote by name (lib/paywall.js fillNamed).
export function openPaywall(reason, context = null) {
  if (MOBILE) return false
  useUI.getState().openSheet(close => <Paywall reason={reason} context={context} close={close} />)
  return true
}
// Admin → Paywall → Preview: the words being edited, on the real screen with today's prices.
// Nothing is reported and nothing can be bought from it.
export function openPaywallPreview(preview, reason = 'preview') {
  useUI.getState().openSheet(close => <Paywall reason={reason} preview={preview} close={close} />)
}

function Paywall({ reason, context, preview, close }) {
  const [pw, setPw] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  // Asked again when the language arrives: a paywall opened while the app is still loading its
  // language pack would otherwise stay in English. Viewed is reported once.
  const langV = useLang()
  const viewed = useRef(false)
  // A subscription paused from the cancel flow is not sold again: it is resumed.
  const [paused, setPaused] = useState(null)
  useEffect(() => { if (!preview) billingCached().then(a => { if (a?.plan === 'paused') setPaused(a) }).catch(() => {}) }, [])

  useEffect(() => {
    let live = true
    fetchPaywall(getLang()).then(real => {
      if (!live) return
      const p = preview ? { ...real, ...preview } : real
      const offered = ORDER.filter(k => p.plans && k in p.plans)
      setPw(p)
      setPlan(cur => cur && offered.includes(cur) ? cur : offered.includes(p.highlight) ? p.highlight : offered[0] || null)
      if (!preview && !viewed.current) { viewed.current = true; track('paywall_viewed', { variant: p.variant, experiment: p.experiment, reason }) }
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
  const go = async () => {
    if (preview) { toast('Preview — nothing is charged'); return }
    setBusy(true)
    try { const { url } = await billingCheckout(plan); window.location.assign(url) }
    catch { toast(t('Could not open the payment page')); setBusy(false) }
  }
  const later = () => { if (!preview) track('paywall_dismissed', { variant: pw.variant, reason }); close() }

  // The operator's lines with the person's data in them; one whose data is missing is left out.
  const ctx = context || {}
  const subtitle = fillNamed(end ? c.endBody : c.subtitle, ctx)
  // After a trial: what the Coach did in it, in the person's numbers — left out when there are none.
  const recap = end ? fillNamed(c.endRecap, ctx) : null
  const bullets = (c.bullets || []).map(b => fillNamed(b, ctx)).filter(Boolean)
  const footnote = fillNamed(c.footnote, ctx)
  const timeline = end ? null : timelineText(c, pw.cardTrialDays)

  return <>
    <h3 style={{ marginBottom: 6 }}>{end ? c.endTitle : titleFor(c, reason, ctx)}</h3>
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
            {k === pw.highlight && <span className="chip nocap" style={{ background: 'var(--acc)', color: 'var(--on-acc)', fontSize: 12 }}>
              {c.annualBadge && k === 'annual' ? c.annualBadge : ''}{k === 'annual' && saving ? `${c.annualBadge ? ' · ' : ''}−${saving}%` : ''}
            </span>}
          </div>
          {lines.main && <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{lines.main}</div>}
          {lines.sub && <div className="dim small">{lines.sub}</div>}
        </button>
      })}
    </div> : <div className="card small muted" style={{ marginBottom: 14 }}>{t('Subscriptions are sold in the iPhone and Android app.')}</div>}

    {/* What the trial does and when, before the button that starts it: no surprise on day 30. */}
    {!!offered.length && timeline && <div className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12, lineHeight: 1.45 }}>
      <Icon name="calendar" style={{ color: 'var(--acc)', flex: 'none', marginTop: 2 }} />
      <span>{timeline}</span>
    </div>}
    {!!offered.length && <Button variant="primary" onClick={go} disabled={busy || !plan}>{ctaText(pw, end)}</Button>}
    {footnote && <div className="dim small" style={{ marginTop: 10, lineHeight: 1.5 }}>{footnote}</div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={later}>{c.later}</Button>
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
