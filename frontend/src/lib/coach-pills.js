// "Pills": short observations about someone's training, worked out on the device from rules —
// no model, no network — so the free plan gets a taste of what the Coach notices, and a paid one
// has them beside the Coach's own weekly review. Every pill is true and rests on the person's
// own data: with too little of it there is no pill at all, and nothing here is ever invented to
// fill a slot (the spec's honesty rules are acceptance criteria, not style).
//
// Pure over S and a date, so the same state and the same day always give the same pills — which
// is what lets the phone and the server agree on the week's report (lib/coach-report.js), and
// what the tests pin. Nothing is computed twice: the stall reads the progression engine and the
// e1RM series, the muscles come from muscles.js, the imbalance from structuralBalance.js.
import { t, exerciseNameFor } from './i18n-core.js'
import { EXIDX, isAssisted } from './exercises.js'
import { modeOf, effectiveRoutineIds } from './history.js'
import { sessionsFor, stallCount, policyFor } from './progression.js'
import { e1rmSeries } from './onerm.js'
import { musclesOf, MUSCLES, MUSCLE_NAME } from './muscles.js'
import { computeBalance } from './structuralBalance.js'
import { TEMPLATES, DEFAULT_TEMPLATE_ID, BALANCE_STATUSES, EVALUATION_MODES, BORDERLINE_BAND_PCT } from './structuralBalanceTemplates.js'
import { isWarmupRow } from './workout-model.js'
import { weekKey, weekStartOf, fmtNum } from './format.js'

// The kinds, most useful first: the order a report shows them in when two compete.
export const PILL_KINDS = ['stall', 'imbalance', 'neglected', 'missed', 'progress']
const BASE = { stall: 90, imbalance: 70, neglected: 60, missed: 50, progress: 20 }

// Less than this much history and nothing is said: two weeks is the least that a stall, a
// neglected muscle or a trend can honestly be read from.
export const MIN_HISTORY_DAYS = 14
// A stall: the best estimated 1RM not beaten for this many sessions…
export const STALL_SESSIONS = 3
// …or for this many days with at least two sessions since (a lift trained once a week).
export const STALL_DAYS = 21
// …or this many misses in a row by the progression rule's own reading.
export const STALL_MISSES = 2
// A lift not trained for this long is not "stalled", it is no longer being trained.
const STALL_RECENT_DAYS = 21
// A muscle of the plan with no direct work for this many days.
export const NEGLECTED_DAYS = 8
// A clear rise: over the last four weeks, at least this share of the starting estimate…
const PROGRESS_PCT = 0.025
// …and at least this much in the profile's unit, over at least two weeks of sessions.
const PROGRESS_MIN = { kg: 2.5, lb: 5 }
const PROGRESS_WINDOW_DAYS = 28
const PROGRESS_SPAN_DAYS = 14

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
// A sentence starts with a capital, whatever the catalogue's casing put first.
const cap = s => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)

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

const history = (S, today) => (S.workouts || [])
  .filter(w => w && typeof w.d === 'string' && ISO.test(w.d) && w.d <= today)

/**
 * Whether one exercise has stalled as of `today`, and how. Exported for the in-workout and
 * Progress-screen notice (F3), which asks about one lift rather than the whole plan.
 * → null, or { exercise, sessions, days, misses, since, last }
 */
export function stallOf(S, exId, today, ctx = null) {
  if (!ISO.test(today || '')) return null
  const found = ctx || planExercises(S).find(x => x.cfg.id === exId)
  const cfg = found?.cfg || { id: exId }
  if (modeOf(cfg) !== 'reps' || isAssisted(cfg)) return null
  const scoped = { ...S, workouts: history(S, today) }
  const pts = e1rmSeries(scoped, exId).filter(p => ISO.test(p.d || ''))
  if (pts.length < STALL_SESSIONS + 1) return null
  const last = pts[pts.length - 1]
  if (daysBetween(last.d, today) > STALL_RECENT_DAYS) return null
  // The best estimate, at the session that first reached it: equalling it later is not a rise.
  let bestIdx = 0
  pts.forEach((p, i) => { if (p.y > pts[bestIdx].y + 1e-9) bestIdx = i })
  const sessions = pts.length - 1 - bestIdx
  const days = daysBetween(pts[bestIdx].d, today)
  const flat = sessions >= STALL_SESSIONS || (days >= STALL_DAYS && sessions >= 2)
  let misses = 0
  if (found?.routine) {
    const policy = policyFor(cfg, found.routine, 'reps')
    if (policy && policy !== 'off') misses = stallCount(sessionsFor(scoped, exId, cfg, found.routine.id).filter(s => s.mode === 'reps'), policy)
  }
  if (!flat && misses < STALL_MISSES) return null
  return { exercise: exId, sessions, days, misses, since: pts[bestIdx].d, last: last.d, flat }
}

function stallPill(S, today) {
  const all = planExercises(S).map(x => stallOf(S, x.cfg.id, today, x)).filter(Boolean)
  if (!all.length) return null
  all.sort((a, b) => (b.flat - a.flat) || (b.sessions - a.sessions) || (b.misses - a.misses) || (a.exercise < b.exercise ? -1 : 1))
  const s = all[0]
  const name = nameOf(S, s.exercise)
  let body
  if (s.flat) {
    body = s.days >= 14
      ? t('{0}: {1} sessions in {2} weeks without going up. The Coach has a plan to get it moving.', name, s.sessions, Math.round(s.days / 7))
      : t('{0}: {1} sessions in {2} days without going up. The Coach has a plan to get it moving.', name, s.sessions, s.days)
  } else {
    body = t('{0}: {1} sessions in a row short of the target reps. The Coach has a plan to get it moving.', name, s.misses)
  }
  return {
    id: 'stall:' + s.exercise, kind: 'stall', priority: BASE.stall + Math.min(9, s.sessions + s.misses),
    title: t('Stalled: {0}', name), body, exercise: s.exercise,
    window: { from: s.since, to: s.last }, data: { sessions: s.sessions, days: s.days, misses: s.misses }
  }
}

// A muscle the plan trains directly (a primary target of one of its exercises) that has had no
// direct work for NEGLECTED_DAYS. Only for someone who is training: a week with no workouts at
// all is "missed", not a neglected muscle.
function neglectedPill(S, today, ws) {
  const recent = ws.filter(w => daysBetween(w.d, today) <= 7 && daysBetween(w.d, today) >= 0)
  if (!recent.length) return null
  const primaryOf = src => Object.entries(musclesOf(src)).filter(([, v]) => v >= 1).map(([m]) => m)
  const planMuscles = new Map() // slug → first plan exercise that trains it directly
  for (const { cfg } of planExercises(S)) {
    const src = EXIDX[cfg.id] || (S.customEx || []).find(c => c && c.id === cfg.id) || cfg
    for (const m of primaryOf(src)) if (!planMuscles.has(m)) planMuscles.set(m, cfg.id)
  }
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
    const days = daysBetween(lastDirect.get(m) || first, today)
    if (days >= NEGLECTED_DAYS && (!pick || days > pick.days)) pick = { muscle: m, days }
  }
  if (!pick) return null
  const muscle = t(MUSCLE_NAME[pick.muscle] || pick.muscle)
  const exId = planMuscles.get(pick.muscle)
  return {
    id: 'neglected:' + pick.muscle, kind: 'neglected', priority: BASE.neglected + Math.min(9, pick.days - NEGLECTED_DAYS),
    title: t('No direct work: {0}', muscle),
    body: t('{0}: {1} days without direct work. Add {2} to your next session.', muscle, pick.days, nameOf(S, exId)),
    exercise: exId, muscle: pick.muscle,
    window: { from: lastDirect.get(pick.muscle) || first, to: today }, data: { days: pick.days }
  }
}

// The weakest link of the structural balance the person follows, when it is clearly behind:
// below the band that still counts as borderline, against a lift of their own.
function imbalancePill(S, today) {
  const template = TEMPLATES[S.balanceTemplate] || TEMPLATES[DEFAULT_TEMPLATE_ID]
  if (!template) return null
  let rows
  try { rows = computeBalance({ ...S, workouts: history(S, today) }, template) } catch { return null }
  const byRole = new Map(rows.map(r => [r.roleId, r]))
  let pick = null
  for (const role of template.roles) {
    if (role.evaluationMode !== EVALUATION_MODES.LOAD_RATIO || !role.anchorRoleId) continue
    const row = byRole.get(role.id), anchor = byRole.get(role.anchorRoleId)
    if (!row || row.status !== BALANCE_STATUSES.WEAK || !row.mappedExerciseId || !anchor?.mappedExerciseId) continue
    if (!(row.actualPct < row.targetPct - BORDERLINE_BAND_PCT)) continue
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
    window: { from: null, to: today }, data: { pct: Math.round(pick.row.actualPct), target: pick.row.targetPct }
  }
}

// Planned days of the week that just ended, against the days trained in it — a session moved to
// another day is not a missed one.
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
  const trained = new Set(ws.filter(w => w.d >= from && w.d <= to).map(w => w.d)).size
  const missed = planned - trained
  if (missed < 1) return null
  return {
    id: 'missed:' + from, kind: 'missed', priority: BASE.missed + Math.min(9, missed),
    title: t('Missed sessions last week'),
    body: missed === 1
      ? t('Last week you missed 1 planned session. The Coach can rework your week.')
      : t('Last week you missed {0} planned sessions. The Coach can rework your week.', missed),
    window: { from, to }, data: { missed, planned }
  }
}

// The plan's clearest rise in estimated 1RM over the last four weeks. Never locked: it is the
// person's own progress, not something to sell back to them.
function progressPill(S, today) {
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const from = addDays(today, -PROGRESS_WINDOW_DAYS)
  const scoped = { ...S, workouts: history(S, today) }
  let pick = null
  for (const { cfg } of planExercises(S)) {
    if (modeOf(cfg) !== 'reps' || isAssisted(cfg)) continue
    const pts = e1rmSeries(scoped, cfg.id).filter(p => ISO.test(p.d || '') && p.d >= from)
    if (pts.length < 2) continue
    const a = pts[0], b = pts[pts.length - 1]
    if (daysBetween(a.d, b.d) < PROGRESS_SPAN_DAYS || !(a.y > 0)) continue
    const gain = b.y - a.y
    if (gain < PROGRESS_MIN[unit] || gain / a.y < PROGRESS_PCT) continue
    if (!pick || gain / a.y > pick.pct) pick = { id: cfg.id, gain, pct: gain / a.y, from: a.d, to: b.d }
  }
  if (!pick) return null
  const name = nameOf(S, pick.id)
  const gain = roundHalf(pick.gain)
  return {
    id: 'progress:' + pick.id, kind: 'progress', priority: BASE.progress,
    title: t('Going up: {0}', name),
    body: t('{0}: +{1} {2} estimated 1RM in the last 4 weeks. Keep it up.', name, fmtNum(gain), unit),
    exercise: pick.id, window: { from: pick.from, to: pick.to }, data: { gain, pct: round1(pick.pct * 100) }
  }
}

/**
 * The pills for `today` (an ISO day on the person's calendar), most useful first, one per kind:
 * [{ id, kind, priority, title, body, exercise?, muscle?, window, data }]. Empty with less than
 * MIN_HISTORY_DAYS of history, and whenever nothing is clearly true.
 */
export function pillsFor(S, today) {
  if (!S || !ISO.test(today || '')) return []
  const ws = history(S, today).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  if (!ws.length || daysBetween(ws[0].d, today) < MIN_HISTORY_DAYS) return []
  const out = [stallPill(S, today), imbalancePill(S, today), neglectedPill(S, today, ws), missedPill(S, today, ws), progressPill(S, today)]
    .filter(Boolean)
    .map(p => ({ ...p, title: cap(p.title), body: cap(p.body) }))
  return out.sort((a, b) => (b.priority - a.priority) || (PILL_KINDS.indexOf(a.kind) - PILL_KINDS.indexOf(b.kind)))
}

/**
 * How a report shows the pills to someone without the Coach: the most useful one whole, the
 * person's own progress always whole, and up to three more with their real title and the rest
 * held back. With the Coach (`open`), everything is whole.
 */
export function reportView(pills, open) {
  if (!pills.length) return { shown: [], locked: [] }
  if (open) return { shown: pills, locked: [] }
  const [first, ...rest] = pills
  return {
    shown: [first, ...rest.filter(p => p.kind === 'progress')],
    locked: rest.filter(p => p.kind !== 'progress').slice(0, 3)
  }
}
