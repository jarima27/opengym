// The week's report — "What your Coach would tell you this week" — as it goes out on its own:
// a push on the first morning of the week with its first line (api/coach/core/nudges.js, kind
// 'report'; the phone schedules the same one). The pills need the exercise catalogue and the
// progression engine, which only the app has, so the app works the report out for the coming
// report day whenever the training changes and keeps it in the profile (S.coachReport); the
// server and the phone only read it. Nothing new is logged between the last change and that
// morning — any change recomputes it — so it is exactly the report that day would show.
import { t } from './i18n-core.js'
import { pillsFor, addDays } from './coach-pills.js'
import { weekKey, weekStartOf } from './format.js'

/** The day the next report goes out: today when today starts the week, else the next week's start. */
export function reportDay(S, today) {
  const start = weekKey(today, weekStartOf(S))
  return start === today ? today : addDays(start, 7)
}

/**
 * What S.coachReport should hold as of `today`, or null for a week with nothing to say (no
 * report, no push — the Coach's own rule of never announcing that there is no news).
 * `push`: whether the push is this report's to send. Someone with the Coach hears from the Coach
 * itself (its weekly review); the pills are only its support on the card.
 */
export function coachReportFor(S, today, { push = true } = {}) {
  const on = reportDay(S, today)
  const pills = pillsFor(S, on)
  if (!pills.length) return null
  return { on, kind: pills[0].kind, title: t('What your Coach would tell you this week'), body: pills[0].body, push: !!push }
}

export const sameReport = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null)
