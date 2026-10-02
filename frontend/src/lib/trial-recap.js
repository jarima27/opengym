// "What the Coach has done for you" during a trial (spec F7): the changes to the plan the person
// accepted, the sessions the Coach read, and the clearest rise in a lift — on day 5 of 7, before the
// trial turns into a charge, and again after it ends without one ("during your trial the Coach…").
// From the Coach's own log (lib/coach.js appendLog) and the numbers in coach-insights.js, never
// from anything the model wrote. Pure over S and a window of ISO days.
import { t } from './i18n-core.js'
import { insightsFor } from './coach-insights.js'
import { exerciseName } from './coach-pills.js'

const ms = (iso, end) => new Date(iso + (end ? 'T23:59:59' : 'T00:00:00')).getTime()

export function trialRecap(S, { from, to }) {
  const lo = ms(from), hi = ms(to, true)
  const log = (S?.coach?.log || []).filter(e => e && Number.isFinite(e.at) && e.at >= lo && e.at <= hi && !e.dismissed)
  // A plan the Coach built counts as one change; a review counts each change accepted from it.
  const adjustments = log.filter(e => e.kind === 'create').length
    + log.filter(e => e.kind === 'review').reduce((n, e) => n + (e.decisions || []).filter(d => d?.status === 'accepted').length, 0)
  const analysed = log.filter(e => e.kind === 'debrief').length
  let gain = null
  try {
    const best = insightsFor(S, { from, to }, { topN: 5 }).strength.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta)[0]
    if (best) gain = { exercise: best.id, name: exerciseName(S, best.id), delta: best.delta }
  } catch { gain = null }
  return { adjustments, analysed, gain }
}

/** Whether there is anything worth saying: a recap of nothing is not shown. */
export const recapHasNews = r => !!r && (r.adjustments > 0 || r.analysed > 0 || !!r.gain)

/** The recap as the lines a screen shows, each only when it has something in it. */
export function recapLines(r, { unit = 'kg', fmt = String } = {}) {
  const out = []
  if (r.adjustments > 0) out.push(r.adjustments === 1 ? t('1 change to your plan') : t('{0} changes to your plan', r.adjustments))
  if (r.analysed > 0) out.push(r.analysed === 1 ? t('1 session analysed') : t('{0} sessions analysed', r.analysed))
  if (r.gain) out.push(t('+{0} on {1}', `${fmt(r.gain.delta)} ${unit}`, r.gain.name))
  return out
}

/** What the end-of-trial paywall can quote (api/paywall.js endRecap): only what there is. */
export function recapContext(r, { unit = 'kg', fmt = String } = {}) {
  const ctx = {}
  if (r?.adjustments > 0) ctx.adjustments = r.adjustments
  if (r?.gain) { ctx.gainKg = `${fmt(r.gain.delta)} ${unit}`; ctx.exercise = r.gain.name }
  return ctx
}
