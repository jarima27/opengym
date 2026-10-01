// Asking for a store review in the store app (App Store / Google Play), once: right after the
// third finished workout, when the person has just done the thing the app is for three times and
// is looking at what they did. Never in a browser, never for a workout logged into the past, and
// never again once asked. Whether a review sheet actually appears is the OS's decision (Apple shows
// it at most three times a year); the app only says when the moment is right.
//
// The plugin is imported on demand, behind MOBILE, so it never reaches the web bundle.
import { MOBILE } from './mobile.js'
import { track } from './track.js'

export const REVIEW_AFTER = 3
const KEY = 'tiza_review_asked'

/** Whether to ask now: the count of finished workouts, and whether it has been asked before. */
export function reviewDue(finished, asked) {
  return !asked && Number(finished) >= REVIEW_AFTER
}
const askedBefore = () => { try { return !!localStorage.getItem(KEY) } catch { return true } }
const remember = () => { try { localStorage.setItem(KEY, new Date().toISOString()) } catch { /* asked again later, at worst */ } }

/** Called as a just-finished workout's summary closes. `finished`: workouts finished so far. */
export async function maybeAskForReview(finished, { mobile = MOBILE, plugin } = {}) {
  if (!mobile || !reviewDue(finished, askedBefore())) return false
  remember()
  try {
    const InAppReview = plugin || (await import('@capacitor-community/in-app-review')).InAppReview
    await InAppReview.requestReview()
    track('review_prompted', { count: Number(finished) })
    return true
  } catch { return false }
}
