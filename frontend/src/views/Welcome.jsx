import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { importFromApp, importFromHevy, starterPlanSheet } from '../sheets.jsx'
import { clearWelcome, markTrialOffer } from '../lib/welcome.js'
import { track } from '../lib/track.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Screen two, right after signing up: bring the history from Strong or Hevy before anything
// else. Picking a file opens the same import summary Settings uses; either way out lands on
// Home, and the trial is offered once whatever was opened here is closed.
export default function Welcome() {
  const nav = useNavigate()
  const strong = useRef(null)
  const hevy = useRef(null)
  const other = useRef(null)
  useEffect(() => { track('onboarding_import_shown') }, [])

  const done = () => { clearWelcome(); markTrialOffer(); nav('/home', { replace: true }) }
  const picked = source => e => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    importFromApp(f, () => { track('onboarding_import_picked', { source }); done() })
  }
  const scratch = () => { track('onboarding_import_skipped'); done(); setTimeout(starterPlanSheet, 0) }
  const file = (ref, source) => <input ref={ref} type="file" accept=".csv,text/csv,text/plain" hidden onChange={picked(source)} />

  const option = (icon, title, help, onClick) => <button type="button" className="card" onClick={onClick}
    style={{ textAlign: 'start', margin: 0, display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%' }}>
    <span className="lrow-i" style={{ flex: 'none' }}><Icon name={icon} /></span>
    <span><strong style={{ display: 'block' }}>{title}</strong>{help && <span className="dim small" style={{ display: 'block', marginTop: 3, lineHeight: 1.45 }}>{help}</span>}</span>
  </button>

  return <div className="narrow" style={{ paddingTop: 28 }}>
    <div style={{ fontSize: 44, color: 'var(--acc)', display: 'flex', justifyContent: 'center' }}><Icon name="download" /></div>
    <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.02em', textAlign: 'center', margin: '10px 0 6px' }}>{t('Coming from Strong or Hevy?')}</h1>
    <div className="muted" style={{ textAlign: 'center', marginBottom: 22, lineHeight: 1.5 }}>
      {t('Bring your history: workouts, weights and records. It takes a minute, and your progression picks up where you left off.')}
    </div>
    <div style={{ display: 'grid', gap: 10 }}>
      {option('upload', t('Import from Strong'), t('In Strong: Settings → Export Strong Data. Then pick the file here.'), () => strong.current?.click())}
      {option('upload', t('Import from Hevy'), t('In Hevy: Settings → Export & Import Data → Export Workouts. Then pick the file here.'), () => hevy.current?.click())}
      {option('folder', t('Another app or a spreadsheet (CSV)'), null, () => other.current?.click())}
    </div>
    {file(strong, 'strong')}{file(hevy, 'hevy')}{file(other, 'csv')}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim small" onClick={() => { importFromHevy(); done() }}>{t('Hevy Pro? Import with your API key instead')}</Button>
    <div style={{ height: 18 }} />
    <Button onClick={scratch}>{t('Start from scratch')}</Button>
  </div>
}
