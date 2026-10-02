// The app's own product events (api/analytics.js CLIENT_EVENTS), sent to this app's server and
// from there to PostHog. Nothing is sent unless the server says it takes them (config.analytics,
// only with POSTHOG_KEY set) and someone is signed in — a self-hosted instance sends nothing, and
// neither does a guest or the demo. Fire and forget: an event never holds anything up.
import { api } from './api.js'
import { DEMO } from './demo.js'
import { platform } from './attribution.js'
import { useStore } from '../store/useStore.js'

export function track(event, props = {}) {
  const st = useStore.getState()
  if (DEMO || !st.config?.analytics || !st.user) return
  api('/api/track', { method: 'POST', body: JSON.stringify({ event, props: { platform: platform(), ...props } }) }).catch(() => {})
}

// The guided first run before there is an account (F12): its screens are where most people
// leave, and there is no profile to report them under yet. Under an id this device makes up and
// keeps, sent with the sign-up so the server joins the two (api/server.js adoptSource) — and only
// where the server takes events (config.analytics), or from the store app, whose server is Tiza.
const ANON = 'tiza_anon'
export function anonId(create = false) {
  try {
    let id = localStorage.getItem(ANON)
    if (!id && create) {
      const b = new Uint8Array(12)
      crypto.getRandomValues(b)
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      localStorage.setItem(ANON, id)
    }
    return id || null
  } catch { return null }
}

/** One screen of the first run: under the profile once there is one, else under the device. */
export function trackStep(props, { base = '', store = false } = {}) {
  const st = useStore.getState()
  if (st.user) { track('onboarding_step', props); return }
  if (DEMO || !(st.config?.analytics || store)) return
  const anon = anonId(true)
  if (!anon) return
  try {
    fetch(base + '/api/track/anon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ event: 'onboarding_step', anon, props: { platform: platform(), ...props } })
    }).catch(() => {})
  } catch { /* never in the way */ }
}
