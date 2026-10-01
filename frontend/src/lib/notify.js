// Notifications on the app's side: what a tapped one asks for when it lands, and when to offer
// turning them on. Which nudge goes out when, and what it says, is api/coach/core/nudges.js —
// shared with the server, which sends them as Web Push, and with lib/mobile.js, which schedules
// them on the phone.

// A notification's route carries marks for the app (nudges.js make(), push-messages.js): `n`,
// the kind it was, so the open is counted; `paywall`, to open the plans on arrival. Returns them
// with the route's own query minus the marks, or null when it carries none. Pure, for the test.
export function readArrival(search) {
  const q = new URLSearchParams(search || '')
  const kind = q.get('n')
  if (!kind || !/^[a-z]{2,20}$/.test(kind)) return null
  const paywall = q.get('paywall')
  q.delete('n'); q.delete('paywall')
  const rest = q.toString()
  return { kind, paywall: paywall && /^[a-z_]{1,20}$/.test(paywall) ? paywall : null, search: rest ? '?' + rest : '' }
}

// The service worker tells a window that is already open where a tapped notification goes
// (public/sw.js notificationclick): the router lives in the page, so the page moves itself.
export function listenForNotificationTaps(go) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.addEventListener) return () => {}
  const on = e => {
    const hash = e.data?.type === 'open' ? e.data.hash : null
    if (typeof hash === 'string' && hash.startsWith('#/')) go(hash.slice(1))
  }
  navigator.serviceWorker.addEventListener('message', on)
  return () => navigator.serviceWorker.removeEventListener('message', on)
}

// The offer to turn reminders on comes after the first finished workout — the moment the app has
// shown what it is for, and a reminder obviously means something. Declined, it comes back once,
// three workouts later, and never after that. `record` is what declineOffer() kept.
export function offerDue(workouts, record) {
  if (!(workouts >= 1)) return false
  const r = record && typeof record === 'object' ? record : {}
  const declined = Number.isInteger(r.declined) ? r.declined : 0
  if (declined >= 2) return false
  if (declined === 0) return true
  return workouts >= (Number(r.at) || 0) + 3
}

// Per device, not per profile: the question is about this phone's or this browser's permission.
const OFFER_KEY = 'tiza_notify_offer'
export function readOffer() {
  try { return JSON.parse(localStorage.getItem(OFFER_KEY) || 'null') } catch { return null }
}
export function declineOffer(workouts) {
  try {
    const r = readOffer() || {}
    localStorage.setItem(OFFER_KEY, JSON.stringify({ declined: (Number(r.declined) || 0) + 1, at: workouts }))
  } catch { /* storage blocked: it asks again next time, which is the lesser evil */ }
}

// The day the phone counts "since you joined" from, before the first workout (the server uses
// the account's creation date). Set the first time it is asked for, on this device.
const FIRST_RUN_KEY = 'tiza_first_run'
export function firstRunDay(today) {
  try {
    const kept = localStorage.getItem(FIRST_RUN_KEY)
    if (/^\d{4}-\d{2}-\d{2}$/.test(kept || '')) return kept
    localStorage.setItem(FIRST_RUN_KEY, today)
  } catch { /* without storage, every day is the first: no "since you joined" nudge */ }
  return today
}
