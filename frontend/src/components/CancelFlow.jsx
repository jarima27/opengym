import { useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { fmtDate } from '../lib/format.js'
import { track } from '../lib/track.js'
import { CANCEL_REASONS, billingCancel, billingPause, billingAnnual, billingResume, storeManageUrl } from '../lib/billing.js'
import { money } from '../lib/paywall.js'
import Icon from './Icon.jsx'
import { Button, Row, Section } from './ui.jsx'

// Settings → Subscription → Cancel (spec F8). One question first — why, in one tap, never
// required to go on — then, for a subscription bought on the website, what could suit better
// than leaving: a month's pause, or the annual plan. Cancelling stays one button on that same
// screen, as big as the offers. A store subscription can only be cancelled in its store, so the
// answer leads straight there.
//
// `a` is GET /api/billing; `done(next)` is told what the profile's access became.
export function openCancelFlow(a, done) {
  useUI.getState().openSheet(close => <CancelFlow a={a} done={done} close={close} />)
}

const date = iso => fmtDate(String(iso).slice(0, 10), false, true)

function CancelFlow({ a, done, close }) {
  const [step, setStep] = useState('why')
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  const toast = useUI(s => s.toast)
  const store = a.via !== 'stripe' ? storeManageUrl(a.via) : null
  const offers = a.via === 'stripe' ? a.offers : null
  const annual = offers?.annual?.price ? offers.annual : null

  const run = async (what, call) => {
    if (busy) return
    setBusy(what)
    try {
      const next = await call()
      done?.(next)
      // Taken back: nothing more to say here.
      if (what === 'resume') { close(); return }
      setResult({ what, a: next })
      setStep('done')
    } catch {
      toast(t('Could not reach the payment provider. Try again in a moment.'))
    } finally { setBusy(null) }
  }
  const reason = useRef(null)
  const cancel = () => run('cancel', () => billingCancel(reason.current))

  const answer = key => {
    reason.current = key
    track('cancel_reason', { reason: key, via: a.via || null })
    if (store) { window.open(store, '_blank', 'noopener'); close(); return }
    if (offers && (offers.pause || annual)) setStep('offer')
    else cancel()
  }

  if (step === 'why') return <div>
    <h3 style={{ margin: '4px 0 14px' }}>{t('Why are you cancelling? It helps us improve.')}</h3>
    <Section>
      {CANCEL_REASONS.map(([key, label]) =>
        <Row key={key} title={label()} accessory="chevron" onClick={() => answer(key)} />)}
    </Section>
    {store && <div className="muted small" style={{ marginTop: 10, lineHeight: 1.5 }}>
      {t('You subscribed in the store, so it is cancelled there. Answering takes you to it.')}
    </div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Keep my subscription')}</Button>
  </div>

  if (step === 'offer') {
    const loc = dateLocale()
    const resumes = new Date(Date.now() + 30 * 86400000).toISOString()
    return <div>
      <h3 style={{ margin: '4px 0 6px' }}>{t('Before you go')}</h3>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>{t('If it’s a question of timing or money, one of these may suit you better.')}</div>
      <Section>
        {offers.pause && <Row icon="pause" iconTint="var(--acc)" accessory="chevron"
          title={t('Pause for a month')}
          subtitle={t('Nothing is charged until {0} and the Coach rests too. It comes back by itself.', date(resumes))}
          onClick={() => run('pause', billingPause)} />}
        {annual && <Row icon="star" iconTint="var(--acc)" accessory="chevron"
          title={t('Switch to the annual plan')}
          subtitle={[
            t('{0} a year — {1} a month.', money(annual.price, loc), money({ amount: Math.round(annual.price.amount / 12), currency: annual.price.currency }, loc)),
            annual.discount ? t('With a discount for staying.') : null,
            t('Charged today, minus what is left of this month.')
          ].filter(Boolean).join(' ')}
          onClick={() => run('annual', billingAnnual)} />}
      </Section>
      <div style={{ height: 14 }} />
      <Button variant="danger" onClick={cancel} disabled={!!busy}>{busy === 'cancel' ? t('Cancelling…') : t('Cancel subscription')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={close}>{t('Keep my subscription')}</Button>
    </div>
  }

  // Done: what happens now, in dates — and the way back while it is still open.
  const r = result?.a || {}
  const text = result?.what === 'pause' ? t('Paused. Nothing is charged until {0}; then it carries on by itself.', date(r.pausedUntil || new Date().toISOString()))
    : result?.what === 'annual' ? t('Done: you are on the annual plan.')
      : r.endsAt && a.cardTrial ? t('Cancelled. Your trial ends on {0} and nothing will be charged.', date(r.endsAt))
        : r.endsAt ? t('Cancelled. The Coach stays with you until {0}; nothing more will be charged.', date(r.endsAt))
          : t('Cancelled.')
  const undo = result?.what === 'cancel' || result?.what === 'pause'
  return <div style={{ padding: '4px 0' }}>
    <div style={{ fontSize: 36, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <p style={{ textAlign: 'center', lineHeight: 1.5, margin: '10px 0' }}>{text}</p>
    {result?.what === 'cancel' && <p className="muted small" style={{ textAlign: 'center', lineHeight: 1.5, margin: '0 0 16px' }}>{t('Your workouts and your history stay yours, and logging stays free.')}</p>}
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
    {undo && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" disabled={!!busy} onClick={() => run('resume', billingResume)}>
        {result.what === 'pause' ? t('Resume now') : t('Keep my subscription')}
      </Button>
    </>}
  </div>
}
