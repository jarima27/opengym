import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import { billingCached, accessOf } from '../lib/billing.js'

// Whether the Coach is this profile's (lib/billing.js accessOf), and whether its free first plan
// is still there to take (api/billing.js freePlanOpen). Both from one cached GET /api/billing.
// Nothing is sold in the phone app yet (it will sell through its store), on an instance that does
// not charge, to a guest or in the demo: there the Coach reads as 'open' and there is no gift.
function useBilling() {
  const charging = !!useStore(s => s.config?.billing)
  const uid = useStore(s => s.user?.id)
  const sold = charging && !!uid && !MOBILE && !DEMO
  const [status, setStatus] = useState(sold ? undefined : null)
  useEffect(() => {
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
