/* The events the app may report (analytics.js CLIENT_EVENTS) — anything else is dropped. The
   guided first run (spec F11) reports its six; a name missing here would vanish without a word. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_EVENTS, cleanProps, createAnalytics } from '../analytics.js';

test('the guided first run’s events are accepted', () => {
  for (const e of ['onboarding_step', 'onboarding_done', 'first_workout_started', 'first_workout_done', 'calibration_used', 'checklist_done', 'coach_first_plan',
    'paywall_viewed', 'paywall_dismissed', 'exit_offer_viewed', 'exit_offer_accepted', 'continued_free']) {
    assert.ok(CLIENT_EVENTS.has(e), e);
  }
});

test('an onboarding step keeps its step and answer', () => {
  assert.deepEqual(cleanProps({ step: 'goal', answer: 'strength' }), { step: 'goal', answer: 'strength' });
});

test('the device that went through the first run is the profile that signed up', async () => {
  const sent = [];
  const a = createAnalytics({ on: true, key: 'k', host: 'https://ph.test' }, { flushMs: 5, fetchImpl: async (u, o) => { sent.push(...JSON.parse(o.body).batch); return { ok: true }; } });
  a.captureAnon('onboarding_step', 'f3Kq9xY2-vB7nP1s', { step: 'intro' });
  a.captureAnon('onboarding_step', 'short', { step: 'intro' });
  a.alias({ id: 'u1' }, 'f3Kq9xY2-vB7nP1s');
  a.alias({ id: 'u1' }, '');
  await a.flush();
  assert.deepEqual(sent.map(e => [e.event, e.properties.distinct_id, e.properties.alias]), [
    ['onboarding_step', 'anon_f3Kq9xY2-vB7nP1s', undefined],
    ['$create_alias', 'u1', 'anon_f3Kq9xY2-vB7nP1s']
  ]);
});
