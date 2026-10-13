const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    restTickTitle: 'Resting ⏳',
    restTickBody: '{0} left.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan — let's go 💪",
  },
  'pt-BR': {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Hora da próxima série.',
    restTickTitle: 'Descanso ⏳',
    restTickBody: 'Faltam {0}.',
    testBody: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    dayFallbackTitle: 'Treino planejado para hoje',
    dayRoutineSuffix: 'hoje',
    dayBody: 'Está no seu plano — vamos treinar 💪',
  },
}

const copyFor = lang => COPY[lang] || COPY.en

export function restTimerPush(lang) {
  const copy = copyFor(lang)
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' }
}

// The countdown shown on a locked phone: same tag as the end alert, so the service worker
// closes the previous one and the lock screen keeps a single updating row (sw.js, issue #172).
export function restTickPush(lang, left) {
  const copy = copyFor(lang)
  const n = Math.max(0, Math.round(left))
  const shown = n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : `${n}s`
  return { title: copy.restTickTitle, body: copy.restTickBody.replace('{0}', shown), tag: 'rest-timer' }
}

// When each countdown update fires, as seconds from the start: every `cadence` seconds of
// remaining time, stopping before zero — the end alert covers that moment. Pure so the
// schedule is testable without timers.
export function restTickTimes(sec, cadence) {
  const times = []
  for (let left = sec - cadence; left > 0; left -= cadence) times.push({ at: sec - left, left })
  return times
}

export function testPush(lang) {
  return { title: 'GymTask', body: copyFor(lang).testBody, tag: 'test' }
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang)
  return {
    title: routine ? `${routine.emoji || '🏋️'} ${routine.name} ${copy.dayRoutineSuffix}` : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  }
}
