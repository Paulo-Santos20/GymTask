import test from 'node:test'
import assert from 'node:assert/strict'
import { dayReminderPush, restTickPush, restTickTimes, restTimerPush, testPush } from './push-messages.js'

test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Descanso terminado 💪',
    body: 'Hora da próxima série.',
    tag: 'rest-timer',
  })
  assert.deepEqual(testPush('pt-BR'), {
    title: 'GymTask',
    body: 'Notificação de teste ✅ — é assim que os alertas aparecem.',
    tag: 'test',
  })
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A hoje',
    body: 'Está no seu plano — vamos treinar 💪',
    tag: 'day-reminder',
  })
})

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'))
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today')
  assert.equal(testPush(undefined).body, 'Test notification ✅ — this is what alerts look like.')
})

test('counts down on a locked phone: one update per cadence, never at zero', () => {
  // 90 s at a 15 s cadence: five updates at 15/30/45/60/75 s from the start, each showing the
  // time still to go. Zero is the end alert's job, so it is never a tick.
  assert.deepEqual(
    restTickTimes(90, 15).map(t => t.at),
    [15, 30, 45, 60, 75],
  )
  assert.deepEqual(
    restTickTimes(90, 15).map(t => t.left),
    [75, 60, 45, 30, 15],
  )
  assert.deepEqual(restTickTimes(20, 15), [{ at: 15, left: 5 }])
  // a rest no longer than the cadence has no countdown of its own — the end alert covers it
  assert.deepEqual(restTickTimes(15, 15), [])
  assert.deepEqual(restTickTimes(5, 15), [])
  assert.deepEqual(restTickTimes(0, 15), [])
})

test('renders the remaining time as seconds under a minute and m:ss above', () => {
  assert.deepEqual(restTickPush('pt-BR', 45), {
    title: 'Descanso ⏳',
    body: 'Faltam 45s.',
    tag: 'rest-timer', // same tag as the end alert: the row updates in place on the lock screen
  })
  assert.equal(restTickPush('pt-BR', 75).body, 'Faltam 1:15.')
  assert.equal(restTickPush('pt-BR', 90).body, 'Faltam 1:30.')
  assert.equal(restTickPush('pt-BR', 0).body, 'Faltam 0s.')
  assert.equal(restTickPush('fr', 30).body, '30s left.') // English fallback, as everywhere else
})
