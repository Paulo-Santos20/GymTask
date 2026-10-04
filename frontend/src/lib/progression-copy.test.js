import { describe, expect, it } from 'vitest'
import ptBR from '../locales/pt-BR.js'
import { nextPrescription } from './progression.js'
import { progressionGuidance } from './progression-copy.js'

describe('policy-labelled progression guidance', () => {
  it('keeps the calculated outcome and identifies the policy that produced it', () => {
    const why = ['Every rep last time — {0} {1} more.', 2.5, 'kg']

    expect(progressionGuidance({ policy: 'linear', kind: 'up', weight: 62.5, why })).toEqual({
      policyLabel: 'Linear progression',
      why,
    })
  })

  it('labels hold and deload outcomes without changing their calculated reasons', () => {
    const hold = ['Missed reps last time — same weight again ({0} of {1} to go).', 2, 3]
    const deload = ['Missed reps — reset to {0} {1} and work back up.', 55, 'kg']

    expect(progressionGuidance({ policy: 'double', kind: 'hold', why: hold })).toEqual({
      policyLabel: 'Double progression',
      why: hold,
    })
    expect(progressionGuidance({ policy: 'greyskull', kind: 'deload', why: deload })).toEqual({
      policyLabel: 'Greyskull LP',
      why: deload,
    })
  })

  it('labels a baseline outcome and omits policies with no visible outcome', () => {
    const baseline = ['Nothing logged yet — this session sets the baseline.']
    expect(progressionGuidance({ policy: 'linear', kind: 'first', why: baseline })).toEqual({
      policyLabel: 'Linear progression',
      why: baseline,
    })
    expect(progressionGuidance({ policy: 'off', kind: 'off' })).toBeNull()
    expect(progressionGuidance({ policy: 'linear', kind: 'first' })).toBeNull()
    expect(progressionGuidance(null)).toBeNull()
  })
})

// RF2: the planned-block deload must surface on screen like any other outcome — labelled by
// the policy that chose it and explained by its own why-template, with both templates shipped
// in the locale pack.
describe('planned-deload guidance', () => {
  const blockPlan = () => {
    const st = {
      unit: 'kg',
      workouts: [1, 2, 3].map(i => ({
        d: '2026-07-0' + i,
        entries: [
          {
            id: '0025',
            target: { sets: 3, reps: 5, weight: 60 },
            sets: [5, 5, 5].map(r => ({ w: 60, r, done: true })),
          },
        ],
      })),
    }
    return nextPrescription(st, { id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', deloadEvery: 3 })
  }

  it('explains the block deload on screen, labelled with the policy that chose it', () => {
    expect(blockPlan()).toMatchObject({ kind: 'deload', weight: 55 })
    expect(progressionGuidance(blockPlan())).toEqual({
      policyLabel: 'Linear progression',
      why: ['Planned deload every {0} sessions — down to {1} {2} and build back up.', 3, 55, 'kg'],
    })
  })

  it('ships both planned-deload explanations in the locale pack', () => {
    expect(ptBR['Planned deload every {0} sessions — down to {1} {2} and build back up.']).toBeTruthy()
    expect(ptBR['Planned deload every {0} sessions — {1} {2} more help while you build back up.']).toBeTruthy()
  })
})
