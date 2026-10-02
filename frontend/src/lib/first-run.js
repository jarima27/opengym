// F11 — the first run, guided all the way to a first finished workout. The answers asked one per
// screen (views/FirstRun.jsx), the plan they recommend when the Coach is not the one building it,
// the lifts whose starting weight is asked for, and the small state the first week keeps
// (S.firstRun): where the person came from, the one-time hints of the first workout, the
// checklist on Home.
//
// Training data only: every word on screen is written inside a t() call in the view, so
// check-source-strings.mjs finds it.
import { buildStarterPlan } from './starter.js'
import { EXIDX } from './exercises.js'
import { isBw } from './history.js'

export const GOALS = ['strength', 'muscle', 'fatloss', 'general']
export const EXPERIENCE = ['starting', 'lt1', '1to3', 'gt3']
export const PLACES = ['gym', 'basic', 'dumbbells', 'bodyweight']
export const LENGTHS = [30, 45, 60, 90]
export const DAY_COUNTS = [2, 3, 4, 5, 6]
// F12: what has held them back, what to bring up first, how they sleep, how they feel about their
// progress, and by when they want to see it. None of them changes the plan by rule: they are kept
// for the Coach (coachProfile below), which reads them when it makes or adjusts the plan.
export const HOLDBACKS = ['time', 'plan', 'results', 'motivation', 'injury', 'none']
export const FOCUS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core']
export const SLEEP = ['lt6', '6to7', '7to8', 'gt8']
export const FEELINGS = ['great', 'ok', 'stuck', 'new']
export const WHEN = ['4w', '8w', '3m', 'any']
/** An answer about their progress that is a good moment to ask for a store review (once). */
export const feelsGood = feeling => feeling === 'great' || feeling === 'ok'

/*
 * The guided first run, screen by screen (F11, lengthened by F12). Before an account exists —
 * the hosted app — it opens with the short video and ends with the sign-up, just before the
 * paywall; signed up already (a self-hosted instance, a guest), those two are not shown. The
 * starting weights are asked only for lifts the plan has; the paywall decides for itself whether
 * there is anything to sell (views/FirstRun.jsx).
 */
export const FLOW = [
  'intro', 'goal', 'experience', 'holdback', 'focus', 'boost1', 'body', 'days', 'place', 'length',
  'sleep', 'feeling', 'boost2', 'when', 'limits', 'lifts', 'building', 'plan', 'account', 'paywall',
  'coach', 'import', 'notify', 'today'
]
// The screens the progress bar counts: the questions, from the first to the starting weights.
export const QUESTION_STEPS = FLOW.slice(FLOW.indexOf('goal'), FLOW.indexOf('lifts') + 1)

// The questions only the Coach reads, and the screens between them: not asked where there is no
// Coach to read them (a self-hosted instance without one).
const COACH_ONLY = new Set(['holdback', 'focus', 'boost1', 'sleep', 'feeling', 'boost2', 'when'])

/** Whether `step` is shown: `pre` before an account exists, `lifts` how many weights to ask for,
    `coach` whether there is a Coach to read the answers only it uses. */
export function stepShown(step, { pre = false, lifts = 1, coach = true } = {}) {
  if (step === 'intro' || step === 'account') return pre
  if (step === 'lifts') return lifts > 0
  if (COACH_ONLY.has(step)) return !!coach
  return FLOW.includes(step)
}

/** The screen after `step`, or null at the end. */
export function nextStep(step, ctx) {
  for (let i = FLOW.indexOf(step) + 1; i > 0 && i < FLOW.length; i++) if (stepShown(FLOW[i], ctx)) return FLOW[i]
  return null
}

// The weekdays (DAYN index, 1 = Monday) a number of days spreads over before the person picks
// their own: never two days in a row where the week allows it.
export const DEFAULT_DAYS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6] }

export const isNovice = experience => experience === 'starting' || experience === 'lt1'
const barbell = place => place === 'gym' || place === 'basic'

/** The weekdays an answer trains on, Monday first: the ones picked, or the count's default. */
export function trainingDays({ days, count } = {}) {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const picked = [...new Set((days || []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
  if (picked.length) return order.filter(d => picked.includes(d))
  return DEFAULT_DAYS[Math.min(6, Math.max(2, count || 3))]
}

/**
 * Which starter plan the answers point to, and why (a key the view words): two days → full body;
 * three → 5×5 for a beginner after strength with a bar to load, full body for any other beginner,
 * push/pull/legs for someone who already trains; four → upper/lower; five or six → push/pull/legs.
 */
export function recommendPlan(answers = {}) {
  const n = trainingDays(answers).length
  if (n <= 2) return { plan: 'full-body', reason: 'two-days' }
  if (n === 3) {
    if (!isNovice(answers.experience)) return { plan: 'ppl', reason: 'three-trained' }
    if (answers.goal === 'strength' && barbell(answers.place)) return { plan: '5x5', reason: 'three-strength' }
    return { plan: 'full-body', reason: 'three-new' }
  }
  if (n === 4) return { plan: 'upper-lower', reason: 'four' }
  return { plan: 'ppl', reason: 'five-six' }
}

// What each starter exercise becomes where there is no machine or cable (a basic gym: bars,
// dumbbells, a bench, a pull-up bar), only dumbbells (at home, with a bench) or nothing at all.
// null leaves it out; the full gym keeps every exercise as it is.
const SUBS = {
  basic: {
    '2330': '0652', '1323': '0293', '0241': '0430', '0739': '0336', '0585': '0410', '0586': '1459', '0605': '0417'
  },
  dumbbells: {
    '0025': '0289', '0047': '0314', '0027': '0293', '0031': '0294', '0043': '1760', '0085': '1459',
    '2330': '0292', '1323': '0292', '0241': '0430', '0251': '0129', '0739': '0336', '0585': '0410', '0586': '0431', '0605': '0417'
  },
  bodyweight: {
    '0025': '0662', '0047': '0279', '0426': '0283', '0334': null, '0241': '1399', '0251': '1399',
    '2330': '3165', '0027': '3161', '1323': '3165', '0031': null, '0313': null,
    '0043': '2368', '0085': '3013', '0739': '1460', '0585': null, '0586': '3013', '0605': '1373'
  }
}
// Exercises a session of this length has room for: the main lifts come first in every routine.
const ROOM = { 30: 3, 45: 4, 60: 6, 90: 99 }

/**
 * The plan built from the answers: the recommended starter plan, its exercises fitted to where
 * the person trains and to the time a session has, its routines on the days they picked.
 * Returns { plan, reason, routines, schedule: [{ day, routineId }] } with fresh ids; only the
 * routines the week uses are kept.
 */
export function buildFirstPlan(answers = {}, { weekday } = {}) {
  const { plan, reason } = recommendPlan(answers)
  const built = buildStarterPlan(plan)
  const subs = SUBS[answers.place] || {}
  const room = ROOM[answers.sessionMin] || ROOM[60]
  const routines = built.routines.map(r => {
    const seen = new Set()
    const ex = []
    for (const e of r.ex) {
      const id = e.id in subs ? subs[e.id] : e.id
      if (!id || seen.has(id) || !EXIDX[id]) continue
      seen.add(id)
      ex.push({ ...e, id })
    }
    return { ...r, ex: ex.slice(0, room) }
  })
  const days = trainingDays(answers)
  // The plan opens with its first session on the first training day from today (`weekday`) on,
  // so the session the summary shows, and the one "I'm training today" starts, is the one with
  // the main lifts; the rest follow it around the week.
  const at = Number.isInteger(weekday) ? days.findIndex(d => (d || 7) >= (weekday || 7)) : 0
  const from = Math.max(0, at)
  const schedule = days.map((day, i) => ({ day, routineId: routines[((i - from) % days.length + days.length) % days.length % routines.length].id }))
  const used = new Set(schedule.map(s => s.routineId))
  return { plan, reason, routines: routines.filter(r => used.has(r.id)), schedule }
}

/**
 * Training today, on a day the plan has no session, brings its next session forward — so the
 * week moves along by one: the day that would have repeated it takes the one after, and so on
 * around. Any other week comes back as it was.
 */
export function shiftWeekPast(week = {}, weekday, routineId) {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const at = order.indexOf(weekday)
  const days = [...order.slice(at + 1), ...order.slice(0, at + 1)].filter(d => [].concat(week[d] ?? []).length)
  if (days.length < 2 || [].concat(week[days[0]])[0] !== routineId) return week
  const out = { ...week }
  days.forEach((d, i) => { out[d] = week[days[(i + 1) % days.length]] })
  return out
}

/**
 * "Not today" on a day the plan opens with: today rests (the caller marks it in dayPlan) and the
 * week moves back by one, so the plan still starts with the session the summary showed, on the
 * next training day, and the order after it holds. Any other week comes back as it was.
 */
export function postponeWeek(week = {}, weekday) {
  const order = [1, 2, 3, 4, 5, 6, 0]
  const at = order.indexOf(weekday)
  const days = [...order.slice(at), ...order.slice(0, at)].filter(d => [].concat(week[d] ?? []).length)
  if (days.length < 2 || days[0] !== weekday) return week
  const out = { ...week }
  days.forEach((d, i) => { out[days[(i + 1) % days.length]] = week[d] })
  return out
}

/**
 * The lifts whose starting weight is worth asking for: the first two of each routine that carry
 * a load, in the order the plan meets them, at most four. Bodyweight work starts from reps.
 */
export function mainLifts(routines = [], max = 4) {
  const out = []
  for (const r of routines) {
    for (const e of (r.ex || []).slice(0, 2)) {
      const ex = EXIDX[e.id]
      if (!ex || isBw({ ...e, id: e.id }) || out.includes(e.id)) continue
      out.push(e.id)
    }
  }
  return out.slice(0, max)
}

/**
 * A weight someone can lift for `reps`, carried to the plan's reps with Epley's estimate and
 * rounded down to `step`: 60 kg × 5 asks 52.5 kg for a set of 10. Null without a usable answer.
 */
export function startingWeight(weight, reps, planReps, step = 2.5) {
  if (!(weight > 0) || !(reps > 0)) return null
  const target = planReps > 0 ? planReps : reps
  const est = weight * (1 + reps / 30)
  const w = est / (1 + target / 30)
  const s = step > 0 ? step : 2.5
  return Math.max(s, Math.floor(w / s + 1e-9) * s)
}

/** What the Coach is asked with, from the same answers (views/CoachIntake.jsx's profile). */
export function coachProfile(answers = {}) {
  const days = trainingDays(answers)
  const EQUIPMENT = {
    gym: [],
    basic: ['barbell', 'dumbbell', 'body weight', 'ez barbell'],
    dumbbells: ['dumbbell', 'body weight'],
    bodyweight: ['body weight']
  }
  const YEARS = { starting: 'Just starting to lift.', lt1: 'Training for less than a year.', '1to3': 'Training for 1 to 3 years.', gt3: 'Training for more than 3 years.' }
  // F12's questions, for the Coach: they do not change the plan by rule.
  const HELD = { time: 'Finding the time has been the problem so far.', plan: 'Not knowing what to do has been the problem so far.', results: 'Not seeing results has been the problem so far.', motivation: 'Staying consistent has been the problem so far.', injury: 'Injuries or pain have held them back.' }
  const SLEPT = { lt6: 'Sleeps less than 6 hours a night.', '6to7': 'Sleeps 6 to 7 hours a night.', '7to8': 'Sleeps 7 to 8 hours a night.', gt8: 'Sleeps more than 8 hours a night.' }
  const FELT = { great: 'Happy with their progress, and wants more.', ok: 'Progressing, but feels it could be better.', stuck: 'Feels stuck.', new: 'Has not started training yet.' }
  const BY = { '4w': 'Wants to notice a change within 4 weeks.', '8w': 'Wants to notice a change within 8 weeks.', '3m': 'Wants to notice a change within 3 months.', any: 'In no hurry to see a change.' }
  const unit = answers.unit === 'lb' ? 'lb' : 'kg'
  const body = answers.bw > 0 ? `Body weight ${answers.bw} ${unit}${answers.bwGoal > 0 ? `, aiming for ${answers.bwGoal} ${unit}` : ''}.` : ''
  const focus = (answers.focus || []).filter(m => FOCUS.includes(m))
  return {
    goal: answers.goal === 'general' ? 'general' : answers.goal || 'general',
    experience: isNovice(answers.experience) ? 'new' : 'regular',
    daysPerWeek: days.length,
    preferredDays: days,
    sessionMin: answers.sessionMin || 60,
    equipment: EQUIPMENT[answers.place] || [],
    limitations: (answers.limits || '').trim(),
    likes: focus.length ? `Wants to prioritise: ${focus.join(', ')}.` : '',
    dislikes: '',
    notes: [YEARS[answers.experience], HELD[answers.holdback], body, SLEPT[answers.sleep], FELT[answers.feeling], BY[answers.when]].filter(Boolean).join(' ')
  }
}

/* -------------------------------- the first week -------------------------------- */

const DAY = 86400000
export const FIRST_WEEK_DAYS = 14

/** A first run starting now: when, and whether the person came from another app. */
export const firstRunState = (now = Date.now(), fromApp = null) => ({ startedAt: now, ...(fromApp ? { fromApp } : {}), tips: {} })

/** Whether a one-time hint of the first workout still has to be shown (and closed). */
export function tipDue(S, key) {
  const fr = S?.firstRun
  return !!fr && !fr.tips?.[key] && !(S.workouts || []).length
}

/**
 * The "first steps" checklist on Home: a first workout, three in the first week, the history
 * imported (only for someone who said they came from another app), a body weight. Shown until all
 * are done, it is closed, or two weeks have passed since the first run started.
 */
export function firstSteps(S, now = Date.now()) {
  const fr = S?.firstRun
  if (!fr?.startedAt) return null
  const workouts = (S.workouts || []).filter(w => w && w.end)
  const firstWeek = workouts.filter(w => (w.start || 0) >= fr.startedAt && (w.start || 0) < fr.startedAt + 7 * DAY)
  const items = [
    { key: 'first', done: workouts.length > 0 },
    { key: 'three', done: firstWeek.length >= 3, count: Math.min(3, firstWeek.length) },
    ...(fr.fromApp ? [{ key: 'import', done: !!fr.imported }] : []),
    { key: 'weight', done: (S.bodyweight || []).length > 0 }
  ]
  const done = items.every(i => i.done)
  const expired = now - fr.startedAt > FIRST_WEEK_DAYS * DAY
  return { items, done, visible: !done && !expired && !fr.stepsClosed }
}
