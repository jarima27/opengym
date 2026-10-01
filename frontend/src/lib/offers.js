// When the website offers Pro on its own (spec F5): one place decides, with the reason as its
// answer, so every offer obeys the same limits —
//   - at most one offer every three days, whatever its reason (the end-of-trial screen included);
//   - never with a workout running;
//   - never right after a record: that moment belongs to the person, not to a sale;
//   - "Not now" is always on the paywall itself (components/Paywall.jsx).
// The reasons, in the order they win when several are due:
//   day7      a week after the free first Coach plan, with at least two workouts since
//   stall     a lift of the plan has stalled (lib/coach-pills.js stallOf)
//   comeback  back after five days or more without training
//   cycle_end the end of a programme or a cycle — reserved: plans here are open-ended weekly
//             routines with no end, so nothing raises it yet
// Each reason is offered once for what raised it (that stall, that absence, that gift).
// Pure: the caller passes the clock and what the device remembers.
import { stallOf, exerciseName } from './coach-pills.js'

export const OFFER_EVERY_MS = 3 * 86400000
// A record this recent puts any offer off.
const AFTER_RECORD_MS = 12 * 3600000
const DAY7_DAYS = 7
const DAY7_WORKOUTS = 2
const COMEBACK_DAYS = 5

const ISO = /^\d{4}-\d{2}-\d{2}$/
const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000

/** Whether the shared limits let any offer through right now. */
export function offerAllowed({ S, now, lastOfferAt = 0 }) {
  if (S?.active) return false
  if (now - (Number(lastOfferAt) || 0) < OFFER_EVERY_MS) return false
  const ws = (S?.workouts || []).filter(w => w && w.end)
  const lastEnded = ws.reduce((m, w) => (!m || w.end > m.end ? w : m), null)
  if (lastEnded && (lastEnded.prs || []).length && now - lastEnded.end < AFTER_RECORD_MS) return false
  return true
}

/**
 * The offer due now, if any: { reason, key, context } — `key` is what the device remembers it by,
 * `context` what the paywall can quote (lib/paywall.js fillNamed). `seen` holds the keys already
 * offered; `freePlanAt` is when the free first plan was taken (GET /api/billing).
 */
export function offerFor({ S, today, now, access, lastOfferAt = 0, seen = [], freePlanAt = null }) {
  if (access !== 'free' || !S || !ISO.test(today || '')) return null
  if (!offerAllowed({ S, now, lastOfferAt })) return null
  const done = new Set(seen)
  const workouts = (S.workouts || []).filter(w => w && typeof w.d === 'string' && ISO.test(w.d) && w.d <= today)

  if (freePlanAt && !done.has('day7')) {
    const since = String(freePlanAt).slice(0, 10)
    if (ISO.test(since) && dayNum(today) - dayNum(since) >= DAY7_DAYS && workouts.filter(w => w.d >= since).length >= DAY7_WORKOUTS) {
      return { reason: 'day7', key: 'day7', context: {} }
    }
  }

  const routines = (S.routines || []).filter(r => r && r.id != null)
  const seenEx = new Set()
  for (const r of routines) for (const cfg of r.ex || []) {
    if (!cfg || cfg.id == null || seenEx.has(cfg.id)) continue
    seenEx.add(cfg.id)
    const s = stallOf(S, cfg.id, today, { cfg, routine: r })
    if (!s) continue
    const key = `stall:${s.exercise}:${s.since}`
    if (done.has(key)) continue
    return { reason: 'stall', key, context: { exercise: exerciseName(S, s.exercise), weeks: Math.max(1, Math.round(s.days / 7)) } }
  }

  const last = workouts.reduce((m, w) => (w.d > m ? w.d : m), '')
  if (last && dayNum(today) - dayNum(last) >= COMEBACK_DAYS && !done.has('comeback:' + last)) {
    return { reason: 'comeback', key: 'comeback:' + last, context: {} }
  }
  return null
}

/* What the device remembers: when the last offer was made, and what was offered. Per device, like
   the paywall itself — and a lost record only means one more offer, never one too early: the
   three-day gap is kept by the newest of the two keys below. */
const AT = 'tiza_offer_at'
const SEEN = 'tiza_offers_seen'
// The end-of-trial screen kept its own clock before this module existed.
const LEGACY_AT = 'gym_trial_end_seen'
export function lastOfferAt() {
  try { return Math.max(+localStorage.getItem(AT) || 0, +localStorage.getItem(LEGACY_AT) || 0) } catch { return 0 }
}
export function offersSeen() {
  try { const v = JSON.parse(localStorage.getItem(SEEN) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
export function markOffer(key, now = Date.now()) {
  try {
    localStorage.setItem(AT, String(now))
    if (key) localStorage.setItem(SEEN, JSON.stringify([...offersSeen().filter(k => k !== key), key].slice(-50)))
  } catch { /* storage blocked: the gap cannot be kept, so the next visit may offer again */ }
}

