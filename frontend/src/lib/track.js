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
