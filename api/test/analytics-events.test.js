/* The events the app may report (analytics.js CLIENT_EVENTS) — anything else is dropped. The
   guided first run (spec F11) reports its six; a name missing here would vanish without a word. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_EVENTS, cleanProps } from '../analytics.js';

test('the guided first run’s events are accepted', () => {
  for (const e of ['onboarding_step', 'onboarding_done', 'first_workout_started', 'first_workout_done', 'calibration_used', 'checklist_done', 'coach_first_plan']) {
    assert.ok(CLIENT_EVENTS.has(e), e);
  }
});

test('an onboarding step keeps its step and answer', () => {
  assert.deepEqual(cleanProps({ step: 'goal', answer: 'strength' }), { step: 'goal', answer: 'strength' });
});
