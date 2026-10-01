import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { DEFAULT_SERVER } from '../lib/app-account.js'
import { billingCached, accessOf } from '../lib/billing.js'

/** Whether a profile is sold the Coach here: an instance that charges, an account, and a build
    that can sell — the website, or the store app, which sells through its store. Any other phone
    build sells nothing. */
export const sellsHere = (charging, uid) => !!charging && !!uid && !DEMO && (!MOBILE || !!DEFAULT_SERVER)

// The demo is the paid product as a free account sees it: one pill whole and the rest by title,
// the free first plan still there to take, the paywall showing the real offer (lib/paywall.js).
export const DEMO_STATUS = { on: true, ai: false, plan: 'none', freePlan: true }

// Whether the Coach is this profile's (lib/billing.js accessOf), and whether its free first plan
// is still there to take (api/billing.js freePlanOpen). Both from one cached GET /api/billing.
// Where nothing is sold (an instance that does not charge, a guest, a phone build without a
// store) the Coach reads as 'open' and there is no gift.
function useBilling() {
  const charging = !!useStore(s => s.config?.billing)
  const uid = useStore(s => s.user?.id)
  const sold = sellsHere(charging, uid)
  const [status, setStatus] = useState(DEMO ? DEMO_STATUS : sold ? undefined : null)
  useEffect(() => {
    if (DEMO) return
    if (!sold) { setStatus(null); return }
    let live = true
    billingCached().then(a => { if (live) setStatus(a === undefined ? null : a) })
    return () => { live = false }
  }, [sold, uid])
  return status // undefined while it is asked
}

/** null while the server is asked, then 'pro' | 'free' | 'open'. */
export function useCoachAccess() {
  const status = useBilling()
  return status === undefined ? null : accessOf(status)
}

/** Whether the free first Coach plan is still this profile's to ask for. */
export function useFreePlan() {
  const status = useBilling()
  return !!status?.freePlan
}
