// @vitest-environment happy-dom
// Idle cadence window (plan todo 28; draft audit-fixes.md:59 "cadence 15-min window"):
// with a Coach screen open and no job in flight, useCoachStatus's poll loop idles for
// IDLE_MS between status calls. The audit pins that window at 15 minutes.
// POLL_MS (job running → 3 s) is a different constant and is not in scope.
import { describe, expect, it } from 'vitest'
import * as coachApi from './coach-api.js'

describe('coach idle cadence window', () => {
  it('idles exactly the audit’s 15 minutes between status polls while no job runs', () => {
    expect(coachApi.IDLE_MS).toBe(15 * 60000)
  })
})
