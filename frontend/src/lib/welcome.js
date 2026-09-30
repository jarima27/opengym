// The first screens after someone signs up (or picks "use on this device" on a phone): the
// import question comes second, straight after the sign-up, because "bring your history from
// Strong or Hevy" is the strongest reason to switch — it has to be seen, not found in Settings.
//
// A flag for this tab only: set by the sign-up, cleared once the welcome is done. An existing
// profile signing in on a new device never sees it.
const KEY = 'gym_welcome'
const store = () => { try { return globalThis.sessionStorage || null } catch { return null } }

export function markWelcome() { try { store()?.setItem(KEY, '1') } catch { /* private mode: no welcome */ } }
export function welcomePending() { try { return store()?.getItem(KEY) === '1' } catch { return false } }
export function clearWelcome() { try { store()?.removeItem(KEY) } catch { /* nothing to clear */ } }

// After the welcome, on an instance where the trial starts with the card: offer it once, when
// nothing else is open (components/BillingPrompts.jsx).
const OFFER = 'gym_offer_trial'
export function markTrialOffer() { try { store()?.setItem(OFFER, '1') } catch { /* no offer */ } }
export function takeTrialOffer() {
  try { const on = store()?.getItem(OFFER) === '1'; store()?.removeItem(OFFER); return on } catch { return false }
}
