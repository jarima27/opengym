import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { coachStatus, resolvePending } from '../lib/coach-api.js'
import { coachAsk, adoptCoachPlan } from '../lib/coach-first-plan.js'
import { track } from '../lib/track.js'
import { DEMO } from '../lib/demo.js'
import { t } from '../lib/i18n.js'

const POLL_MS = DEMO ? 800 : 4000     // while the Coach is still thinking
const OFFLINE_MS = 20000              // a status call that failed: no network, a server restart
const HOLD_MS = 1500                  // the plan is here, waiting for a calm moment (no network)

// F11: the Coach's first plan, asked in the background by the guided first run, adopted the
// moment it arrives (lib/coach-first-plan.js) — but never in the middle of something: not during
// the first run's own screens, not during a workout, not over an open sheet such as the finished
// workout's summary. A Coach that fails says nothing; the plan by rule simply stays.
export default function CoachPlanWatcher() {
  const ask = useStore(s => coachAsk(s.S))
  const update = useStore(s => s.update)
  const loc = useLocation()
  const path = useRef(loc.pathname)
  path.current = loc.pathname

  useEffect(() => {
    if (!ask) return
    if (ask === 'stale') {
      update(s => { s.firstRun = { ...s.firstRun, coach: { ...s.firstRun.coach, state: 'stale' } } })
      return
    }
    let gone = false, tm = null, found = null
    const busy = () => !!useStore.getState().S.active || path.current === '/welcome' || useUI.getState().sheets.length > 0
    const later = ms => { if (!gone) tm = setTimeout(tick, ms) }
    async function tick() {
      if (gone) return
      if (!found) {
        const st = await coachStatus().catch(() => null)
        if (gone) return
        if (!st) return later(OFFLINE_MS)
        if (st.pending?.kind === 'create') found = st.pending
        else if (!st.job) {
          // Nothing running and nothing to adopt: the job ended without a plan.
          update(s => { s.firstRun = { ...s.firstRun, coach: { ...s.firstRun.coach, state: 'failed' } } })
          track('coach_first_plan', { result: 'failed' })
          return
        } else return later(POLL_MS)
      }
      if (busy()) return later(HOLD_MS)
      try {
        update(s => { adoptCoachPlan(s, found) })
      } catch {
        update(s => { s.firstRun = { ...s.firstRun, coach: { ...s.firstRun.coach, state: 'failed' } } })
        track('coach_first_plan', { result: 'unusable' })
        return
      }
      resolvePending({ accepted: ['plan'] }).catch(() => {})
      useUI.getState().toast(t('Your Coach has improved your plan'))
      track('coach_first_plan', { result: 'adopted', ms: Date.now() - (useStore.getState().S.firstRun?.coach?.askedAt || Date.now()) })
    }
    tick()
    return () => { gone = true; clearTimeout(tm) }
  }, [ask])

  return null
}
