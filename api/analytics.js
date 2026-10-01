/* Product analytics for a hosted instance: PostHog, fed from this server and nowhere else.
 *
 * Off unless POSTHOG_KEY is set, and then nothing leaves the box: a self-hosted instance keeps
 * the "no telemetry" it has always had.
 *
 * Why the server and not a script in the page: the events that matter most (a subscription
 * starting or ending) only the server ever sees; the app's own events come here first
 * (POST /api/track) so there is one list of what can be sent, no third-party script in the
 * browser for an ad blocker to drop, and one place that attaches the attribution — which creator
 * code or campaign a profile came from — to every event.
 *
 * What is sent: the event name, the profile's id as the distinct id (never a name or an e-mail),
 * the attribution recorded at sign-up, and the few properties the caller names. Nothing from the
 * training log.
 *
 * No SDK: PostHog's /batch/ endpoint over fetch, a small queue flushed every couple of seconds,
 * bounded so a PostHog outage costs events rather than memory. */

// What the app may report through POST /api/track. The server's own events (signup,
// trial_started, subscribed, cancelled) are not in it: a client must not be able to fake those.
export const CLIENT_EVENTS = new Set([
  'import_done', 'workout_completed', 'paywall_viewed', 'paywall_dismissed', 'checkout_started',
  'onboarding_import_shown', 'onboarding_import_picked', 'onboarding_import_skipped', 'review_prompted',
  'notification_opened', 'notifications_prompted', 'notifications_enabled',
  // The Coach's pills and the way to Pro (spec "píldoras del Coach y conversión a Pro", F9).
  'pill_shown', 'pill_locked_tapped', 'weekly_report_viewed', 'coach_free_plan_created',
  'trial_recap_viewed', 'cancel_reason',
  // The guided first run (spec F11): each answer, the end of it, the first workout started and
  // finished, a lift calibrated instead of guessed, the first-steps checklist completed.
  'onboarding_step', 'onboarding_done', 'first_workout_started', 'first_workout_done', 'calibration_used', 'checklist_done'
]);
export const SERVER_EVENTS = new Set(['signup', 'trial_started', 'subscribed', 'cancelled', 'notification_sent', 'subscription_paused', 'plan_switched']);

const MAX_QUEUE = 1000;
const BATCH = 100;

export function analyticsConfig(env = process.env) {
  const key = String(env.POSTHOG_KEY || '').trim();
  return {
    on: !!key,
    key,
    // EU cloud by default: the people this app is sold to are in the EU.
    host: String(env.POSTHOG_HOST || 'https://eu.i.posthog.com').trim().replace(/\/+$/, ''),
    // How long events wait to be sent together. The tests shorten it.
    flushMs: Math.max(50, +(env.POSTHOG_FLUSH_MS || 2000) || 2000)
  };
}

/* The properties a client may attach: a handful of short scalars, nothing nested. Everything
   else is dropped rather than refused — an app one version ahead must not lose its events. */
export function cleanProps(p) {
  const out = {};
  if (!p || typeof p !== 'object' || Array.isArray(p)) return out;
  for (const [k, v] of Object.entries(p).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/* A profile's attribution as recorded at sign-up (user.src), flattened into event properties. */
export const sourceProps = user => {
  const s = user?.src || {};
  const out = {};
  for (const k of ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'platform']) if (s[k]) out[k] = s[k];
  return out;
};

export function createAnalytics(cfg, { fetchImpl = globalThis.fetch, flushMs = cfg.flushMs || 2000, log = console } = {}) {
  const queue = [];
  let timer = null;
  let failing = false;

  async function flush() {
    timer = null;
    if (!queue.length) return;
    const batch = queue.splice(0, BATCH);
    try {
      const r = await fetchImpl(`${cfg.host}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: cfg.key, batch }),
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) throw new Error(`posthog answered ${r.status}`);
      failing = false;
    } catch (e) {
      // Said once per outage, not once per batch.
      if (!failing) log.warn('analytics: events dropped —', e.message);
      failing = true;
    }
    if (queue.length) schedule();
  }
  function schedule() {
    if (!timer) { timer = setTimeout(flush, flushMs); timer.unref?.(); }
  }

  return {
    on: cfg.on,
    /** Queue one event for one profile. `set` becomes person properties in PostHog. */
    capture(event, user, props = {}, set = null) {
      if (!cfg.on || !user?.id) return;
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({
        event,
        timestamp: new Date().toISOString(),
        properties: { distinct_id: user.id, ...sourceProps(user), ...props, ...(set ? { $set: set } : {}), $lib: 'opengym-api' }
      });
      schedule();
    },
    flush,
    get pending() { return queue.length; }
  };
}
