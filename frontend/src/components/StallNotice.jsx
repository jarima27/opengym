import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { nav } from '../lib/nav.js'
import { track } from '../lib/track.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { stallOf, exerciseName } from '../lib/coach-pills.js'
import { requestReview } from '../lib/coach-api.js'
import { useCoachAccess } from './useCoachAccess.js'
import { openPaywall } from './Paywall.jsx'
import Icon from './Icon.jsx'

// "The Coach has a proposal for this exercise" — on a stalled lift (lib/coach-pills.js stallOf),
// in the workout and on the lift's history (spec F3). What it says is the diagnosis, which is the
// person's own data; the way out is the Coach's: with the Coach, a tap asks it about this lift
// and opens the chat; without, a tap opens the plans on this very lift.
//
// In a workout it waits for a set of this lift to be done and for the rest to be over: a notice
// during the rest is a distraction at the one moment someone is counting seconds.
export default function StallNotice({ exId, inWorkout = false, doneSets = 0 }) {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const resting = useUI(s => !!s.timer && !s.timer.ready)
  const access = useCoachAccess()
  const today = todayISO()
  const stall = useMemo(() => stallOf(S, exId, today), [S.workouts, S.routines, S.week, exId, today])
  const available = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  if (!stall || !available || !access) return null
  if (inWorkout && (doneSets < 1 || resting)) return null

  const name = exerciseName(S, exId)
  const weeks = Math.max(1, Math.round(stall.days / 7))
  const open = () => {
    if (access === 'free') {
      track('pill_locked_tapped', { kind: 'stall', where: inWorkout ? 'workout' : 'history' })
      openPaywall('stall', { exercise: name, weeks })
      return
    }
    if (!hasConsent(S)) { nav('/coach'); return }
    requestReview(t('My {0} has stalled: {1} sessions without going up. What do you propose?', name, stall.sessions)).catch(() => {})
    nav('/coach')
  }
  return (
    <button type="button" className="progline stall-notice" onClick={open}>
      <Icon name="sparkles" />
      <span>
        <strong>{t('The Coach has a proposal for this exercise')}</strong>
        {' · '}{t('{0} sessions without going up.', stall.sessions)} <u>{t('See the proposal')}</u>
      </span>
    </button>
  )
}
