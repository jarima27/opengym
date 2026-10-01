import test from 'node:test';
import assert from 'node:assert/strict';
import { dayReminderPush, restTimerPush, testPush, PUSH_LANGS } from '../push-messages.js';

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'Tiza',
    body: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano — vamos treinar 💪',
    tag: 'day-reminder',
    url: '#/home?n=day',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('xx'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ — this is what alerts look like.');
});

test('speaks every language the app does, with the routine where each language puts it', () => {
  for (const l of ['en', 'es', 'de', 'de-CH', 'fr', 'it', 'pt', 'pt-BR', 'pl', 'tr', 'ru', 'uk', 'zh', 'ko', 'hi', 'th', 'hu', 'ar']) {
    assert.ok(PUSH_LANGS.includes(l), l);
    const day = dayReminderPush(l, { name: 'Pierna', emoji: '🦵' });
    assert.match(day.title, /🦵 Pierna/, l);
    for (const v of [day.title, day.body, restTimerPush(l).title, restTimerPush(l).body, testPush(l).body]) assert.ok(v && !v.includes('{'), `${l}: ${v}`);
  }
  assert.equal(restTimerPush('es').title, 'Descanso terminado 💪');
  assert.equal(dayReminderPush('es', { name: 'Pierna' }).title, '🏋️ Pierna hoy');
  assert.equal(dayReminderPush('ko', { name: '하체', emoji: '🦵' }).title, '오늘: 🦵 하체');
});
