// F11, the Coach's first plan without the wait. The guided first run (views/FirstRun.jsx) starts
// on the plan by rule at once and asks the Coach in the background; when the Coach's plan comes
// back, components/CoachPlanWatcher.jsx adopts it with this: in place of the plan by rule, with
// the starting weights the person already gave, and says so ("Your Coach has improved your plan").
//
// S.firstRun.coach: { state: 'asked' | 'applied' | 'failed' | 'stale', askedAt, appliedAt,
// name, summary, seen }. Nobody waits on it: a Coach that fails or never answers leaves the plan
// by rule exactly as it is, and a plan that arrives a day late is no longer swapped in on its own
// — it waits in the Coach's chat like any other.
import { applyCreatedPlan, appendChat } from './coach.js'
import { deleteRoutine } from './routines.js'
import { markUnknownLifts } from './calibration.js'
import { startingWeight } from './first-run.js'
import { bestWeightFor } from './history.js'
import { weightIncrement } from './progression.js'
import { todayISO } from './format.js'
import { t } from './i18n.js'

export const ADOPT_WITHIN_MS = 24 * 3600 * 1000

/** Where the background ask stands: 'wait' while the Coach's plan may still be adopted, 'stale' once it is too late to swap plans, null when nothing is asked. */
export function coachAsk(S, now = Date.now()) {
  const c = S?.firstRun?.coach
  if (!c || c.state !== 'asked') return null
  return now - (c.askedAt || 0) > ADOPT_WITHIN_MS ? 'stale' : 'wait'
}

/**
 * The Coach's plan in place of the plan by rule, on the state draft `s`. Its routines and week
 * come in the way the Coach chat imports them (snapshot first, so "undo the last Coach changes"
 * brings the plan by rule back); the plan by rule's own routines then go; a lift the person gave
 * a set for starts from that set at the Coach's reps, and every other loaded lift with nothing
 * to start from finds its weight in its first session. Returns the new routines' ids.
 */
export function adoptCoachPlan(s, proposal, { now = Date.now(), today = todayISO() } = {}) {
  const fr = s.firstRun || {}
  const before = new Set((s.routines || []).map(r => r.id))
  // A new week drops today's reschedules (sweepDayPlan); a "not today" said in the first run stands.
  const resting = s.dayPlan?.[today] === 'rest' && !(s.workouts || []).some(w => w.d === today)
  const res = applyCreatedPlan(s, proposal, { schedule: true })
  const ids = s.routines.filter(r => !before.has(r.id)).map(r => r.id)
  for (const id of fr.routineIds || []) {
    if (!ids.includes(id) && s.routines.some(r => r.id === id)) deleteRoutine(s, id)
  }
  if (resting) s.dayPlan = { ...(s.dayPlan || {}), [today]: 'rest' }
  const fresh = s.routines.filter(r => ids.includes(r.id))
  const known = fr.known || {}
  for (const r of fresh) for (const e of r.ex || []) {
    const k = known[e.id]
    if (!k || e.weight > 0 || bestWeightFor(s, e.id) > 0) continue
    const w = startingWeight(k.w, k.r, e.reps, weightIncrement(e, s.unit))
    if (w) { e.weight = w; delete e.calibrate }
  }
  markUnknownLifts(fresh, id => bestWeightFor(s, id) > 0)
  appendChat(s, { role: 'coach', kind: 'applied', ref: res.logId, text: t('Imported — {0} routines are in your plan and your week is set. See you at the next session.', fresh.length) })
  const bundle = proposal.bundle || {}
  s.firstRun = {
    ...fr,
    routineIds: ids,
    coach: { ...(fr.coach || {}), state: 'applied', appliedAt: now, name: bundle.name || '', summary: bundle.summary || '' }
  }
  return ids
}
