// The copy of the notifications the server sends on its own: the rest timer, the test from
// Settings and the day reminder. The engagement nudges carry theirs in coach/core/nudges.js,
// shared with the phone. Same languages as the app; anything else reads English.
const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayTitle: '{routine} today',
    dayBody: "It's on your plan — let's go 💪",
  },
  es: {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Toca la siguiente serie.',
    testBody: 'Notificación de prueba ✅ — así se ven los avisos.',
    dayFallbackTitle: 'Hoy toca entrenar',
    dayTitle: '{routine} hoy',
    dayBody: 'Está en tu plan. ¡Vamos! 💪',
  },
  de: {
    restTitle: 'Pause vorbei 💪',
    restBody: 'Zeit für deinen nächsten Satz.',
    testBody: 'Testbenachrichtigung ✅ — so sehen Hinweise aus.',
    dayFallbackTitle: 'Heute steht Training an',
    dayTitle: '{routine} heute',
    dayBody: 'Es steht in deinem Plan — los geht’s 💪',
  },
  fr: {
    restTitle: 'Repos terminé 💪',
    restBody: 'C’est l’heure de ta prochaine série.',
    testBody: 'Notification de test ✅ — voici à quoi ressemblent les alertes.',
    dayFallbackTitle: 'Séance prévue aujourd’hui',
    dayTitle: '{routine} aujourd’hui',
    dayBody: 'C’est dans ton plan — c’est parti 💪',
  },
  it: {
    restTitle: 'Recupero finito 💪',
    restBody: 'È ora della prossima serie.',
    testBody: 'Notifica di prova ✅ — ecco come appaiono gli avvisi.',
    dayFallbackTitle: 'Allenamento in programma oggi',
    dayTitle: '{routine} oggi',
    dayBody: 'È nel tuo piano — andiamo 💪',
  },
  pt: {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planeado para hoje',
    dayTitle: '{routine} hoje',
    dayBody: 'Está no teu plano — vamos lá 💪',
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayTitle: '{routine} hoje',
    dayBody: 'Está no seu plano — vamos treinar 💪',
  },
  pl: {
    restTitle: 'Koniec przerwy 💪',
    restBody: 'Czas na kolejną serię.',
    testBody: 'Powiadomienie testowe ✅ — tak wyglądają alerty.',
    dayFallbackTitle: 'Dziś zaplanowany trening',
    dayTitle: '{routine} dziś',
    dayBody: 'Jest w Twoim planie — do dzieła 💪',
  },
  tr: {
    restTitle: 'Dinlenme bitti 💪',
    restBody: 'Sıradaki set zamanı.',
    testBody: 'Test bildirimi ✅ — uyarılar böyle görünür.',
    dayFallbackTitle: 'Bugün antrenman planlı',
    dayTitle: 'Bugün {routine}',
    dayBody: 'Planında var — hadi başlayalım 💪',
  },
  ru: {
    restTitle: 'Отдых окончен 💪',
    restBody: 'Пора делать следующий подход.',
    testBody: 'Тестовое уведомление ✅ — так выглядят оповещения.',
    dayFallbackTitle: 'Сегодня запланирована тренировка',
    dayTitle: '{routine} сегодня',
    dayBody: 'Это в вашем плане — вперёд 💪',
  },
  uk: {
    restTitle: 'Відпочинок завершено 💪',
    restBody: 'Час для наступного підходу.',
    testBody: 'Тестове сповіщення ✅ — так виглядатимуть нагадування.',
    dayFallbackTitle: 'Сьогодні заплановане тренування',
    dayTitle: '{routine} сьогодні',
    dayBody: 'Це у твоєму плані — вперед 💪',
  },
  zh: {
    restTitle: '休息结束 💪',
    restBody: '该做下一组了。',
    testBody: '测试通知 ✅ — 提醒就是这个样子。',
    dayFallbackTitle: '今天有训练计划',
    dayTitle: '今天：{routine}',
    dayBody: '在你的计划里 — 开练吧 💪',
  },
  ko: {
    restTitle: '휴식 끝 💪',
    restBody: '다음 세트를 할 시간이에요.',
    testBody: '테스트 알림 ✅ — 알림은 이렇게 표시돼요.',
    dayFallbackTitle: '오늘 운동 계획이 있어요',
    dayTitle: '오늘: {routine}',
    dayBody: '계획에 있어요 — 시작해요 💪',
  },
  hi: {
    restTitle: 'आराम खत्म 💪',
    restBody: 'अगले सेट का समय।',
    testBody: 'टेस्ट सूचना ✅ — अलर्ट ऐसे दिखते हैं।',
    dayFallbackTitle: 'आज वर्कआउट प्लान है',
    dayTitle: 'आज {routine}',
    dayBody: 'यह आपके प्लान में है — चलिए शुरू करें 💪',
  },
  th: {
    restTitle: 'หมดเวลาพัก 💪',
    restBody: 'ได้เวลาเซ็ตถัดไป',
    testBody: 'การแจ้งเตือนทดสอบ ✅ — การแจ้งเตือนจะหน้าตาแบบนี้',
    dayFallbackTitle: 'วันนี้มีแผนออกกำลังกาย',
    dayTitle: 'วันนี้: {routine}',
    dayBody: 'อยู่ในแผนของคุณ — ลุยกันเลย 💪',
  },
  hu: {
    restTitle: 'Vége a pihenőnek 💪',
    restBody: 'Jöhet a következő sorozat.',
    testBody: 'Tesztértesítés ✅ — így néznek ki az értesítések.',
    dayFallbackTitle: 'Mára edzés van tervezve',
    dayTitle: 'Ma: {routine}',
    dayBody: 'Benne van a tervedben — hajrá 💪',
  },
  ar: {
    restTitle: 'انتهت الراحة 💪',
    restBody: 'حان وقت المجموعة التالية.',
    testBody: 'إشعار تجريبي ✅ — هكذا تبدو التنبيهات.',
    dayFallbackTitle: 'لديك تمرين مخطط اليوم',
    dayTitle: '{routine} اليوم',
    dayBody: 'إنه في خطتك — هيا بنا 💪',
  },
};
// Swiss German reads the German copy (none of it has an ß to turn into ss).
COPY['de-CH'] = COPY.de;

export const PUSH_LANGS = Object.keys(COPY);
const copyFor = lang => COPY[lang] || COPY.en;

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'Tiza', body: copyFor(lang).testBody, tag: 'test' };
}

// `url` is where a tap on it lands, relative to the app (public/sw.js); `n` lets the app count
// the open.
export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? copy.dayTitle.replace('{routine}', `${routine.emoji || '🏋️'} ${routine.name}`)
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
    url: '#/home?n=day',
  };
}
