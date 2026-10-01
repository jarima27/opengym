// "Pills": short observations about someone's training, worked out on the device from rules —
// no model, no network — so the free plan gets a taste of what the Coach notices, and a paid one
// has them beside the Coach's own weekly review. Every pill is true and rests on the person's
// own data: with too little of it there is no pill at all, and nothing here is ever invented to
// fill a slot (the spec's honesty rules are acceptance criteria, not style).
//
// A pill DIAGNOSES; the Coach PRESCRIBES. A pill says what is happening and, at most, gives one
// small tip ("add a curl next session"); the way out of a stall or the reworked week is always
// the Coach's. If the free pill solved it, nobody would need the Coach.
//
// Three more rules keep people reading them:
//   - no repeats: the same pill (kind and lift or muscle) does not come back within REPEAT_WEEKS
//     of the week it was shown, and the kind that led last week does not lead again if another
//     one can (S.pillLog, written by the Home card and the week's report: lib/coach-report.js);
//   - no false alarms: a stall is read from the estimated 1RM and from reps at a weight (a double
//     progression climbing its range is progress), never on a deload or a bodyweight lift; a
//     muscle is "neglected" against the rhythm of the person's own plan; an imbalance only with
//     enough sessions of both lifts;
//   - no reproach: the missed-sessions pill says what fitted and what the Coach can do about it.
//
// Pure over S and a date, so the same state and the same day always give the same pills — which
// is what lets the phone and the server agree on the week's report, and what the tests pin.
// Nothing is recomputed here that another module owns: the next prescription comes from
// progression.js, the estimate from onerm.js, the muscles from muscles.js, the ratios from
// structuralBalance.js.
import { t, exerciseNameFor, dateLocale } from './i18n-core.js'
import { EXIDX, isAssisted } from './exercises.js'
import { modeOf, isBw, effectiveRoutineIds } from './history.js'
import { nextPrescription } from './progression.js'
import { estimate1RM } from './onerm.js'
import { musclesOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { computeBalance } from './structuralBalance.js'
import { TEMPLATES, DEFAULT_TEMPLATE_ID, BALANCE_STATUSES, EVALUATION_MODES, BORDERLINE_BAND_PCT } from './structuralBalanceTemplates.js'
import { isWarmupRow } from './workout-model.js'
import { weekKey, weekStartOf, fmtNum } from './format.js'

// The kinds, most useful first: the order a report shows them in when two compete.
export const PILL_KINDS = ['stall', 'imbalance', 'neglected', 'near_pr', 'missed', 'progress']
const BASE = { stall: 90, imbalance: 70, neglected: 60, near_pr: 55, missed: 50, progress: 20 }
// Good news about the person's own training: always shown whole, never sold back to them.
export const POSITIVE_KINDS = new Set(['near_pr', 'progress'])

// Less than this much history and nothing is said: two weeks is the least that a stall, a
// neglected muscle or a trend can honestly be read from.
export const MIN_HISTORY_DAYS = 14
// A pill shown in one week stays away for this many weeks after it.
export const REPEAT_WEEKS = 3
// The kind that led last week steps behind every other kind this week (it is still shown, just not
// first), so the report's opening line — and the Monday push — changes from week to week.
const ROTATE_PENALTY = 1000
// A stall: the best not beaten for this many sessions…
export const STALL_SESSIONS = 3
// …or for this many days with at least two sessions since (a lift trained once a week).
export const STALL_DAYS = 21
// A lift not trained for this long is not "stalled", it is no longer being trained.
const STALL_RECENT_DAYS = 21
// A top weight this far under the best one since it is a deload: the lift is being rebuilt.
const DELOAD_SHARE = 0.92
// The least a muscle may go without direct work before it is mentioned, whatever the plan…
export const NEGLECTED_DAYS = 8
// …and how far past the plan's own longest gap for that muscle (a split that trains legs on
// Mondays only is not neglecting them on the following Monday).
const NEGLECTED_GRACE = 4
// An imbalance is read only from lifts with this many sessions in the last eight weeks.
const BALANCE_SESSIONS = 3
const BALANCE_WINDOW_DAYS = 56
// A clear rise: over the last four weeks, at least this share of the starting estimate…
const PROGRESS_PCT = 0.025
// …and at least this much in the profile's unit, over at least two weeks of sessions.
const PROGRESS_MIN = { kg: 2.5, lb: 5 }
const PROGRESS_WINDOW_DAYS = 28
const PROGRESS_SPAN_DAYS = 14
// "Close to a record": a lift trained in the last two weeks, with its next session within a week.
const NEAR_RECENT_DAYS = 14
const NEAR_AHEAD_DAYS = 7

/* ---------- days as ISO strings (the same calendar the workouts' `d` is on) ---------- */
const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000
const isoOfNum = n => new Date(n * 86400000).toISOString().slice(0, 10)
export const addDays = (iso, n) => isoOfNum(dayNum(iso) + n)
const daysBetween = (from, to) => dayNum(to) - dayNum(from)
const ISO = /^\d{4}-\d{2}-\d{2}$/

const round1 = n => Math.round(n * 10) / 10
const roundHalf = n => Math.round(n * 2) / 2

// The exercise's name in the app's language, without the English original the lists add in
// brackets — a pill is a sentence, and a sentence names a lift once.
const nameOf = (S, id) => {
  const custom = (S.customEx || []).find(c => c && c.id === id)
  if (custom) return custom.n || id
  const ex = EXIDX[id]
  if (!ex) return id
  const name = exerciseNameFor(ex)
  const tail = ` (${ex.n})`
  return name.endsWith(tail) ? name.slice(0, -tail.length) : name
}
export const exerciseName = nameOf
// A sentence starts with a capital, whatever the catalogue's casing put first.
const cap = s => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
// A day's name as the person's language writes it mid-sentence ("jueves", "Donnerstag").
const weekdayName = iso => {
  try { return new Intl.DateTimeFormat(dateLocale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(dayNum(iso) * 86400000 + 43200000)) } catch { return iso }
}

// The routines the week is built from; every routine when no weekday has one yet.
function planRoutines(S) {
  const routines = (S.routines || []).filter(r => r && r.id != null)
  const ids = new Set(Object.values(S.week || {}).flatMap(v => [].concat(v || [])))
  const inWeek = routines.filter(r => ids.has(r.id))
  return inWeek.length ? inWeek : routines
}
// Each exercise of the plan once, with the routine it was first found in (the progression rule
// reads a lift per routine).
function planExercises(S) {
  const seen = new Map()
  for (const r of planRoutines(S)) for (const cfg of r.ex || []) {
    if (cfg && cfg.id != null && !seen.has(cfg.id)) seen.set(cfg.id, { cfg, routine: r })
  }
  return [...seen.values()]
}
// A lift a pill can speak about in kilos: reps against a load of its own.
const loadedLift = cfg => modeOf(cfg) === 'reps' && !isAssisted(cfg) && !isBw(cfg)

const history = (S, today) => (S.workouts || [])
  .filter(w => w && typeof w.d === 'string' && ISO.test(w.d) && w.d <= today)
  .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))

// One point per session of a lift: its heaviest weight, the most reps done at that weight, and
// its best estimated 1RM — null when every set ran past the formula's rep cap, which is where a
// double progression often lives.
function liftSessions(ws, exId) {
  const out = []
  for (const w of ws) {
    const sets = (w.entries || []).filter(e => e && e.id === exId).flatMap(e => e.sets || [])
      .filter(s => s && s.done && !isWarmupRow(s) && Number(s.w) > 0 && Number(s.r) > 0)
    if (!sets.length) continue
    const top = Math.max(...sets.map(s => Number(s.w)))
    const reps = Math.max(...sets.filter(s => Number(s.w) === top).map(s => Number(s.r)))
    const ests = sets.map(s => estimate1RM(s.w, s.r)).filter(n => n != null)
    out.push({ d: w.d, top, reps, est: ests.length ? Math.max(...ests) : null })
  }
  return out
}
// Did this session go past the best so far? A heavier estimate, or more reps at a weight at least
// as heavy (a rep range being climbed counts, past the rep cap too), or more weight for as many.
const beats = (p, best) => (p.est != null && best.est != null && p.est > best.est + 1e-9)
  || (p.top >= best.top && p.reps > best.reps) || (p.top > best.top && p.reps >= best.reps)

/**
 * Whether one exercise has stalled as of `today`, and how. Exported for the in-workout and
 * Progress-screen notice (F3), which asks about one lift rather than the whole plan.
 * → null, or { exercise, sessions, days, since, last }
 */
export function stallOf(S, exId, today, ctx = null) {
  if (!ISO.test(today || '')) return null
  const found = ctx || planExercises(S).find(x => x.cfg.id === exId)
  const cfg = found?.cfg || { id: exId }
  if (!loadedLift(cfg)) return null
  const ws = history(S, today)
  const pts = liftSessions(ws, exId)
  if (pts.length < STALL_SESSIONS + 1) return null
  const last = pts[pts.length - 1]
  if (daysBetween(last.d, today) > STALL_RECENT_DAYS) return null
  let bestIdx = 0
  pts.forEach((p, i) => { if (i && beats(p, pts[bestIdx])) bestIdx = i })
  const best = pts[bestIdx]
  const sessions = pts.length - 1 - bestIdx
  const days = daysBetween(best.d, today)
  if (!(sessions >= STALL_SESSIONS || (days >= STALL_DAYS && sessions >= 2))) return null
  // A deload since the best — or one due next session — is the plan working, not a stall.
  if (pts.slice(bestIdx + 1).some(p => p.top <= best.top * DELOAD_SHARE)) return null
  if (found?.routine) {
    try { if (nextPrescription({ ...S, workouts: ws }, cfg, found.routine).kind === 'deload') return null } catch { /* read as no deload */ }
  }
  return { exercise: exId, sessions, days, since: best.d, last: last.d }
}

function stallPill(S, today) {
  const all = planExercises(S).map(x => stallOf(S, x.cfg.id, today, x)).filter(Boolean)
  if (!all.length) return null
  all.sort((a, b) => (b.sessions - a.sessions) || (b.days - a.days) || (a.exercise < b.exercise ? -1 : 1))
  const s = all[0]
  const name = nameOf(S, s.exercise)
  const body = s.days >= 14
    ? t('{0}: {1} sessions in {2} weeks without going up. The Coach has a plan to get it moving.', name, s.sessions, Math.round(s.days / 7))
    : t('{0}: {1} sessions in {2} days without going up. The Coach has a plan to get it moving.', name, s.sessions, s.days)
  return {
    id: 'stall:' + s.exercise, kind: 'stall', priority: BASE.stall + Math.min(9, s.sessions),
    title: t('Stalled: {0}', name), body, exercise: s.exercise,
    window: { from: s.since, to: s.last }, data: { sessions: s.sessions, days: s.days },
    context: { exercise: name, weeks: Math.max(1, Math.round(s.days / 7)) }
  }
}

const primaryOf = src => Object.entries(musclesOf(src)).filter(([, v]) => v >= 1).map(([m]) => m)
const sourceOf = (S, cfg) => EXIDX[cfg.id] || (S.customEx || []).find(c => c && c.id === cfg.id) || cfg

// The longest stretch, in days, the weekly plan itself leaves between two sessions that train a
// muscle directly — 7 for a muscle trained once a week. Null when no weekday trains it.
function planGap(S, muscle) {
  const routines = new Map((S.routines || []).filter(r => r && r.id != null).map(r => [r.id, r]))
  const days = []
  for (let d = 0; d < 7; d++) {
    const ids = [].concat((S.week || {})[d] || [])
    if (ids.some(id => (routines.get(id)?.ex || []).some(cfg => cfg && primaryOf(sourceOf(S, cfg)).includes(muscle)))) days.push(d)
  }
  if (!days.length) return null
  let gap = days[0] + 7 - days[days.length - 1]
  for (let i = 1; i < days.length; i++) gap = Math.max(gap, days[i] - days[i - 1])
  return gap
}

// A muscle the weekly plan trains directly that has gone longer than the plan's own rhythm
// without it. Only for someone who is training: a week with no workouts at all is not a
// neglected muscle.
function neglectedPill(S, today, ws) {
  if (!ws.some(w => daysBetween(w.d, today) <= 7)) return null
  const planMuscles = new Map() // slug → first plan exercise that trains it directly
  for (const { cfg } of planExercises(S)) for (const m of primaryOf(sourceOf(S, cfg))) if (!planMuscles.has(m)) planMuscles.set(m, cfg.id)
  if (!planMuscles.size) return null
  const lastDirect = new Map()
  for (const w of ws) for (const e of w.entries || []) {
    if (!(e?.sets || []).some(s => s && s.done && !isWarmupRow(s))) continue
    const src = e.exercise?.muscleWeights ? e.exercise : (EXIDX[e.id] || e.exercise || e)
    for (const m of primaryOf(src)) if (!lastDirect.has(m) || lastDirect.get(m) < w.d) lastDirect.set(m, w.d)
  }
  const first = ws[0].d
  let pick = null
  for (const m of MUSCLES) {
    if (!planMuscles.has(m)) continue
    const gap = planGap(S, m)
    if (gap == null) continue
    const limit = Math.max(NEGLECTED_DAYS, gap + NEGLECTED_GRACE)
    const days = daysBetween(lastDirect.get(m) || first, today)
    if (days >= limit && (!pick || days - limit > pick.over)) pick = { muscle: m, days, over: days - limit }
  }
  if (!pick) return null
  const muscle = t(MUSCLE_NAME[pick.muscle] || pick.muscle)
  const exId = planMuscles.get(pick.muscle)
  return {
    id: 'neglected:' + pick.muscle, kind: 'neglected', priority: BASE.neglected + Math.min(9, pick.over),
    title: t('No direct work: {0}', muscle),
    body: t('{0}: {1} days without direct work. Add {2} to your next session.', muscle, pick.days, nameOf(S, exId)),
    exercise: exId, muscle: pick.muscle,
    window: { from: lastDirect.get(pick.muscle) || first, to: today }, data: { days: pick.days },
    context: { exercise: nameOf(S, exId) }
  }
}

// The weakest link of the structural balance the person follows, when it is clearly behind:
// below the band that still counts as borderline, against a lift of their own — and only when
// both lifts have been trained enough lately for the ratio to mean something.
function imbalancePill(S, today, ws) {
  const template = TEMPLATES[S.balanceTemplate] || TEMPLATES[DEFAULT_TEMPLATE_ID]
  if (!template) return null
  let rows
  try { rows = computeBalance({ ...S, workouts: ws }, template) } catch { return null }
  const recent = ws.filter(w => daysBetween(w.d, today) <= BALANCE_WINDOW_DAYS)
  const enough = id => liftSessions(recent, id).length >= BALANCE_SESSIONS
  const byRole = new Map(rows.map(r => [r.roleId, r]))
  let pick = null
  for (const role of template.roles) {
    if (role.evaluationMode !== EVALUATION_MODES.LOAD_RATIO || !role.anchorRoleId) continue
    const row = byRole.get(role.id), anchor = byRole.get(role.anchorRoleId)
    if (!row || row.status !== BALANCE_STATUSES.WEAK || !row.mappedExerciseId || !anchor?.mappedExerciseId) continue
    if (!(row.actualPct < row.targetPct - BORDERLINE_BAND_PCT)) continue
    if (!enough(row.mappedExerciseId) || !enough(anchor.mappedExerciseId)) continue
    const share = row.actualPct / row.targetPct
    if (!pick || share < pick.share) pick = { share, row, anchor }
  }
  if (!pick) return null
  const weak = nameOf(S, pick.row.mappedExerciseId), strong = nameOf(S, pick.anchor.mappedExerciseId)
  return {
    id: 'imbalance:' + pick.row.roleId, kind: 'imbalance', priority: BASE.imbalance + Math.min(9, Math.round((1 - pick.share) * 20)),
    title: t('Weakest link: {0}', weak),
    body: t('Your {0} is lagging behind your {1}. It is your weakest link right now.', weak, strong),
    exercise: pick.row.mappedExerciseId,
    window: { from: addDays(today, -BALANCE_WINDOW_DAYS), to: today }, data: { pct: Math.round(pick.row.actualPct), target: pick.row.targetPct },
    context: { exercise: weak }
  }
}

// The week that just ended against its plan, said as what fitted and what the Coach can do about
// it — never as a tally of what was skipped. A session moved to another day is not missing.
function missedPill(S, today, ws) {
  const start = weekKey(today, weekStartOf(S))
  const from = addDays(start, -7), to = addDays(start, -1)
  let planned = 0
  for (let i = 0; i < 7; i++) {
    let ids = []
    try { ids = effectiveRoutineIds(S, addDays(from, i)) } catch { ids = [] }
    if (ids.length) planned++
  }
  if (!planned) return null
  const done = Math.min(planned, new Set(ws.filter(w => w.d >= from && w.d <= to).map(w => w.d)).size)
  const missed = planned - done
  if (missed < 1) return null
  return {
    id: 'missed', kind: 'missed', priority: BASE.missed + Math.min(9, missed),
    title: t('The Coach can rework your week'),
    body: t('Last week {0} of {1} planned sessions fitted in. The Coach can fit the plan to your real week.', done, planned),
    window: { from, to }, data: { missed, planned, done },
    context: { missed }
  }
}

// The next day the plan trains this lift, from today (tomorrow when today is already trained).
function nextSessionDay(S, today, exId, ws) {
  const trainedToday = ws.some(w => w.d === today)
  const routines = new Map((S.routines || []).filter(r => r && r.id != null).map(r => [r.id, r]))
  for (let i = trainedToday ? 1 : 0; i <= NEAR_AHEAD_DAYS; i++) {
    const d = addDays(today, i)
    let ids = []
    try { ids = effectiveRoutineIds(S, d) } catch { ids = [] }
    if (ids.some(id => (routines.get(id)?.ex || []).some(c => c && c.id === exId))) return d
  }
  return null
}

// A record within reach: the lift's last top weight a little under its best, and the next session
// the progression rule prescribes at or past that best — enough for a new best estimate if it goes.
// Said with the day it can fall on, because that is what brings people back to train.
function nearRecordPill(S, today, ws) {
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  let pick = null
  for (const { cfg, routine } of planExercises(S)) {
    if (!loadedLift(cfg)) continue
    const pts = liftSessions(ws, cfg.id)
    if (pts.length < 2) continue
    const last = pts[pts.length - 1]
    if (daysBetween(last.d, today) > NEAR_RECENT_DAYS) continue
    const bestTop = Math.max(...pts.map(p => p.top))
    const ests = pts.map(p => p.est).filter(n => n != null)
    const bestEst = ests.length ? Math.max(...ests) : null
    const gap = bestTop - last.top
    if (!(gap > 0)) continue
    let next
    try { next = nextPrescription({ ...S, workouts: ws }, cfg, routine) } catch { continue }
    if (next?.kind !== 'up' || !(next.weight >= bestTop)) continue
    const nextEst = estimate1RM(next.weight, next.reps ?? cfg.reps)
    if (bestEst != null && nextEst != null && !(nextEst > bestEst)) continue
    if (nextEst == null && !(next.weight > bestTop)) continue
    const day = nextSessionDay(S, today, cfg.id, ws)
    if (!day) continue
    if (!pick || gap < pick.gap || (gap === pick.gap && day < pick.day)) pick = { id: cfg.id, gap, day }
  }
  if (!pick) return null
  const name = nameOf(S, pick.id)
  const gap = fmtNum(pick.gap)
  return {
    id: 'near_pr:' + pick.id, kind: 'near_pr', priority: BASE.near_pr,
    title: t('Close to a record: {0}', name),
    body: pick.day === today
      ? t('You are {1} {2} from your {0} record. It could fall today.', name, gap, unit)
      : t('You are {1} {2} from your {0} record. It could fall on {3}.', name, gap, unit, weekdayName(pick.day)),
    exercise: pick.id, window: { from: today, to: pick.day }, data: { gap: pick.gap, day: pick.day },
    context: { exercise: name }
  }
}

// The plan's clearest rise in estimated 1RM over the last four weeks.
function progressPill(S, today, ws) {
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const from = addDays(today, -PROGRESS_WINDOW_DAYS)
  let pick = null
  for (const { cfg } of planExercises(S)) {
    if (modeOf(cfg) !== 'reps' || isAssisted(cfg)) continue
    const pts = liftSessions(ws.filter(w => w.d >= from), cfg.id).filter(p => p.est != null)
    if (pts.length < 2) continue
    const a = pts[0], b = pts[pts.length - 1]
    if (daysBetween(a.d, b.d) < PROGRESS_SPAN_DAYS || !(a.est > 0)) continue
    const gain = b.est - a.est
    if (gain < PROGRESS_MIN[unit] || gain / a.est < PROGRESS_PCT) continue
    if (!pick || gain / a.est > pick.pct) pick = { id: cfg.id, gain, pct: gain / a.est, from: a.d, to: b.d }
  }
  if (!pick) return null
  const name = nameOf(S, pick.id)
  const gain = roundHalf(pick.gain)
  return {
    id: 'progress:' + pick.id, kind: 'progress', priority: BASE.progress,
    title: t('Going up: {0}', name),
    body: t('{0}: +{1} {2} estimated 1RM in the last 4 weeks. Keep it up.', name, fmtNum(gain), unit),
    exercise: pick.id, window: { from: pick.from, to: pick.to }, data: { gain, pct: round1(pick.pct * 100) },
    context: { exercise: name, gainKg: fmtNum(gain) }
  }
}

/**
 * What was shown in the weeks before `day`'s: the pill ids of the last REPEAT_WEEKS weeks, and
 * the kind that led the week just before (S.pillLog: { [week's first day]: [ids, the lead first] }).
 */
export function recentPills(S, day) {
  const log = S?.pillLog && typeof S.pillLog === 'object' && !Array.isArray(S.pillLog) ? S.pillLog : {}
  const week = weekKey(day, weekStartOf(S))
  const from = addDays(week, -7 * REPEAT_WEEKS)
  const ids = new Set()
  for (const [w, list] of Object.entries(log)) {
    if (ISO.test(w) && w >= from && w < week && Array.isArray(list)) list.forEach(id => ids.add(String(id)))
  }
  const prev = log[addDays(week, -7)]
  const lead = Array.isArray(prev) && prev.length ? String(prev[0]).split(':')[0] : null
  return { ids, lead }
}

/**
 * The pills for `today` (an ISO day on the person's calendar), most useful first, one per kind:
 * [{ id, kind, priority, title, body, exercise?, muscle?, window, data, context }] — `id` is the
 * pill's identity for the no-repeat rule (kind and lift or muscle), `context` what a paywall
 * opened from it can quote (lib/paywall.js fillNamed). Empty with less than MIN_HISTORY_DAYS of
 * history, and whenever nothing is clearly true.
 */
export function pillsFor(S, today) {
  if (!S || !ISO.test(today || '')) return []
  const ws = history(S, today)
  if (!ws.length || daysBetween(ws[0].d, today) < MIN_HISTORY_DAYS) return []
  const { ids, lead } = recentPills(S, today)
  return [stallPill(S, today), imbalancePill(S, today, ws), neglectedPill(S, today, ws), nearRecordPill(S, today, ws), missedPill(S, today, ws), progressPill(S, today, ws)]
    .filter(p => p && !ids.has(p.id))
    .map(p => ({ ...p, title: cap(p.title), body: cap(p.body), priority: p.kind === lead ? p.priority - ROTATE_PENALTY : p.priority }))
    .sort((a, b) => (b.priority - a.priority) || (PILL_KINDS.indexOf(a.kind) - PILL_KINDS.indexOf(b.kind)))
}

/**
 * How a report shows the pills to someone without the Coach: the most useful one whole, good
 * news always whole, and up to three more with their real title and the rest held back. With
 * the Coach (`open`), everything is whole.
 */
export function reportView(pills, open) {
  if (!pills.length) return { shown: [], locked: [] }
  if (open) return { shown: pills, locked: [] }
  const [first, ...rest] = pills
  return {
    shown: [first, ...rest.filter(p => POSITIVE_KINDS.has(p.kind))],
    locked: rest.filter(p => !POSITIVE_KINDS.has(p.kind)).slice(0, 3)
  }
}

/**
 * S.pillLog after `ids` were shown in the week starting `week` — pure. `replace` sets the week
 * to exactly those ids (the week's report, recomputed until its morning); otherwise they join
 * what the week already holds, the first one shown keeping the lead. Weeks older than the
 * no-repeat window are dropped.
 */
export function logPills(log, week, ids, { replace = false } = {}) {
  const src = log && typeof log === 'object' && !Array.isArray(log) ? log : {}
  const keep = addDays(week, -7 * (REPEAT_WEEKS + 1))
  const out = {}
  for (const [w, list] of Object.entries(src)) if (ISO.test(w) && w >= keep && Array.isArray(list)) out[w] = list.map(String)
  const had = replace ? [] : (out[week] || [])
  out[week] = [...had, ...ids.map(String).filter(id => !had.includes(id))]
  return out
}
export const samePillLog = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {})
