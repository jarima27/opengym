import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, useLang } from '../lib/i18n.js'
import { todayISO, weekKey, weekStartOf } from '../lib/format.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { coachAccess } from '../lib/billing.js'
import { pillsFor, reportView } from '../lib/coach-pills.js'
import { coachReportFor, sameReport } from '../lib/coach-report.js'
import { track } from '../lib/track.js'
import { openPaywall } from './Paywall.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Whether the Coach is this profile's (lib/billing.js accessOf): null while the server is asked,
// then 'pro' | 'free' | 'open'. Nothing is sold in the phone app yet (it will sell through its
// store), on an instance that does not charge, to a guest or in the demo: all 'open'.
export function useCoachAccess() {
  const charging = !!useStore(s => s.config?.billing)
  const uid = useStore(s => s.user?.id)
  const sold = charging && !!uid && !MOBILE && !DEMO
  const [access, setAccess] = useState(sold ? null : 'open')
  useEffect(() => {
    if (!sold) { setAccess('open'); return }
    let live = true
    coachAccess().then(a => { if (live) setAccess(a || 'open') })
    return () => { live = false }
  }, [sold, uid])
  return access
}

// What the training says, recomputed when the training does: the parts of S the pills read.
const pillDeps = S => [S.workouts, S.routines, S.week, S.dayPlan, S.balanceTemplate, S.unit, S.weekStart, S.customEx]

/**
 * Keeps S.coachReport — the report the next first-morning-of-the-week push carries
 * (lib/coach-report.js) — in step with the training. Draws nothing.
 */
export function CoachReportSync() {
  const S = useStore(s => s.S)
  const ready = useStore(s => s.ready)
  const update = useStore(s => s.update)
  const access = useCoachAccess()
  const langV = useLang()
  useEffect(() => {
    if (!ready || DEMO || !access) return
    // After the change has settled: a finished workout, an import, a plan edit.
    const tm = setTimeout(() => {
      const cur = useStore.getState().S
      const next = coachReportFor(cur, todayISO(), { push: access !== 'pro' })
      if (!sameReport(next, cur.coachReport || null)) update(s => { if (next) s.coachReport = next; else delete s.coachReport })
    }, 1500)
    return () => clearTimeout(tm)
  }, [ready, access, langV, ...pillDeps(S)])
  return null
}

// One per device and week: the card was put away until the next one.
const HIDDEN = 'tiza_report_hidden'
const SEEN = 'tiza_report_seen'
const readKey = k => { try { return localStorage.getItem(k) || '' } catch { return '' } }
const writeKey = (k, v) => { try { localStorage.setItem(k, v) } catch { /* shown again next time */ } }

/**
 * "What your Coach would tell you this week", on Home (F2). Without the Coach: the most useful
 * pill whole, the person's own progress whole, and up to three more by their real title with
 * the rest held back — a tap on one opens the plans. With it: every pill, and the way to the
 * Coach's own weekly review. Nothing at all in a week with nothing to say.
 */
export default function CoachReportCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const access = useCoachAccess()
  const langV = useLang()
  const today = todayISO()
  const week = weekKey(today, weekStartOf(S))
  const [hidden, setHidden] = useState(() => readKey(HIDDEN) === week)
  const pills = useMemo(() => pillsFor(S, today), [today, langV, ...pillDeps(S)])
  const view = reportView(pills, access !== 'free')

  // Counted once per pill and week on this device, not on every visit to Home.
  useEffect(() => {
    if (!access || hidden || !pills.length) return
    let seen = []
    try { seen = JSON.parse(readKey(SEEN) || '[]') } catch { seen = [] }
    if (!Array.isArray(seen)) seen = []
    const mark = id => `${week}:${id}`
    if (!seen.includes(mark('report'))) { track('weekly_report_viewed', { kind: pills[0].kind }); seen.push(mark('report')) }
    for (const p of [...view.shown, ...view.locked]) {
      if (seen.includes(mark(p.id))) continue
      track('pill_shown', { kind: p.kind, locked: view.locked.includes(p) })
      seen.push(mark(p.id))
    }
    writeKey(SEEN, JSON.stringify(seen.filter(s => s.startsWith(week + ':'))))
  }, [access, hidden, week, pills.map(p => p.id).join()])

  if (!access || hidden || !pills.length) return null
  const hide = () => { writeKey(HIDDEN, week); setHidden(true) }
  const locked = p => { track('pill_locked_tapped', { kind: p.kind }); openPaywall('pill:' + p.kind) }
  const n = view.locked.length

  return (
    <div className="card coach-report">
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <Icon name="sparkles" style={{ color: 'var(--acc)', fontSize: 18 }} />
          <strong>{t('What your Coach would tell you this week')}</strong>
        </div>
        <button className="iconbtn" style={{ width: 28, height: 28, fontSize: 13 }} onClick={hide} aria-label={t('Hide until next week')}><Icon name="xmark" /></button>
      </div>
      {view.shown.map(p => (
        <div key={p.id} className="pill">
          <div className="pill-title">{p.title}</div>
          <div className="small pill-body">{p.body}</div>
        </div>
      ))}
      {n > 0 && <>
        <div className="small muted" style={{ margin: '12px 0 6px' }}>
          {n === 1 ? t('1 more observation from the Coach about your week') : t('{0} more observations from the Coach about your week', n)}
        </div>
        {view.locked.map(p => (
          <button key={p.id} className="pill pill-locked" onClick={() => locked(p)}>
            <div className="row between" style={{ gap: 8 }}>
              <div className="pill-title">{p.title}</div>
              <Icon name="lock" style={{ color: 'var(--label-3)', fontSize: 14, flexShrink: 0 }} />
            </div>
            <div className="small pill-body blurred" aria-hidden="true">{p.body}</div>
          </button>
        ))}
        <Button variant="primary" style={{ width: '100%', marginTop: 10 }} onClick={() => { track('pill_locked_tapped', { kind: 'report' }); openPaywall('pill:report') }}>
          {t('See the full report')}
        </Button>
      </>}
      {access === 'pro' && (
        <Button style={{ width: '100%', marginTop: 10 }} icon="sparkles" onClick={() => nav('/coach')}>{t('Open the Coach’s review')}</Button>
      )}
    </div>
  )
}
