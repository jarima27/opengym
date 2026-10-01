import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { nav } from '../lib/nav.js'
import { track } from '../lib/track.js'
import { recapLines } from '../lib/trial-recap.js'
import { openPaywall } from './Paywall.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Day 25 of a trial (spec F7): what the Coach has done so far, in the person's own numbers, and
// when the trial ends — before it turns into anything. An open trial is offered the plans; a card
// trial is told when its subscription starts and where to manage it (cancelling is one tap away).
export function openTrialRecap(recap, { endsOn, card }) {
  useUI.getState().openSheet(close => <TrialRecap recap={recap} endsOn={endsOn} card={card} close={close} />)
}

function TrialRecap({ recap, endsOn, card, close }) {
  const unit = useStore(s => (s.S.unit === 'lb' ? 'lb' : 'kg'))
  useEffect(() => { track('trial_recap_viewed', { kind: card ? 'card' : 'open' }) }, [])
  const lines = recapLines(recap, { unit, fmt: fmtNum })
  const when = fmtDate(endsOn, true)
  return <div style={{ padding: '4px 0' }}>
    <div style={{ fontSize: 40, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="sparkles" /></div>
    <h3 style={{ textAlign: 'center', margin: '8px 0 14px' }}>{t('What the Coach has done for you')}</h3>
    <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      {lines.map((l, i) => <div key={i} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon name="checkCircle" style={{ color: 'var(--acc)', flex: 'none', marginTop: 2 }} />
        <span>{l}</span>
      </div>)}
    </div>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {card ? t('Your subscription starts on {0}.', when) : t('Your trial ends on {0}.', when)}
    </div>
    {card
      ? <>
        <Button variant="primary" onClick={close}>{t('Got it')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" className="dim" onClick={() => { close(); nav('/settings') }}>{t('Manage subscription')}</Button>
      </>
      : <>
        <Button variant="primary" onClick={() => { close(); openPaywall('trial_recap') }}>{t('Keep the Coach')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" className="dim" onClick={close}>{t('Not now')}</Button>
      </>}
  </div>
}
