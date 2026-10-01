// The engagement nudges ("trained today?", comebacks, the week's summary) as the phone's local
// notifications. Planned by the same module the server sends them from (api/coach/core/
// nudges.js), a week ahead — iOS keeps only the 64 soonest pending notifications, and the nudges
// are among the soonest. Planned as if nothing more gets logged: every persist re-plans
// (lib/mobile.js syncReminder), so tomorrow's workout takes tomorrow's "trained today?" back with
// it. The trial is the store's to remind about, not the phone's.
//
// Its own module so that only the mobile build ever loads the planner's copy in every language.
import { getLang } from './i18n-core.js'
import { isoOf } from './format.js'
import { NUDGE_WINDOW_DAYS, NUDGE_ID_BASE } from './mobile.js'
import { planNudges } from '../../../api/coach/core/nudges.js'

export function buildNudgeNotifications(S, now = new Date(), { startedOn = null, lang = getLang() } = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
  return planNudges(S, { today: isoOf(now), days: NUDGE_WINDOW_DAYS, startedOn, lang })
    .map(n => {
      const [y, mo, d] = n.date.split('-').map(Number)
      const [h, mi] = n.time.split(':').map(Number)
      const at = new Date(y, mo - 1, d, h, mi, 0, 0)
      // one a day at most, so the day's offset in the window is a stable, unique id
      const offset = Math.round((new Date(y, mo - 1, d, 12) - today) / 86400000)
      return { id: NUDGE_ID_BASE + offset, title: n.title, body: n.body, schedule: { at, allowWhileIdle: true }, extra: { url: n.url } }
    })
    .filter(n => n.schedule.at > now)
}
