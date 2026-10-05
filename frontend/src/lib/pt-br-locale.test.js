import { describe, expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import pt from '../locales/pt.js'
import ptBR, { PT_BR_OVERRIDES } from '../locales/pt-BR.js'
import { DATE_LOCALES, LANGS } from './i18n-core.js'

const placeholders = value => [...String(value).matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
const byCodeUnit = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)

describe('Brazilian Portuguese locale', () => {
  test('is the appâ€™s only selectable locale, with Brazilian date formatting', () => {
    expect(LANGS).toEqual({ 'pt-BR': 'PortuguÃªs (Brasil)' })
    expect(DATE_LOCALES['pt-BR']).toBe('pt-BR')
  })

  test('matches the source key set and preserves interpolation placeholders', () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(pt).sort())
    for (const [source, translated] of Object.entries(ptBR)) {
      expect(placeholders(translated), source).toEqual(placeholders(source))
    }
  })

  test('makes every inherited pt-PT value an explicit reviewed snapshot', () => {
    const inherited = Object.entries(pt)
      .filter(([key]) => !(key in PT_BR_OVERRIDES))
      .sort(byCodeUnit)
    const fingerprint = createHash('sha256').update(JSON.stringify(inherited)).digest('hex')

    expect(Object.keys(PT_BR_OVERRIDES)).toHaveLength(862)
    expect(inherited).toHaveLength(641)
    // If this fails, review the changed keys and wording before accepting a new hash. From
    // frontend/: node scripts/pt-br-inheritance-fingerprint.mjs --list
    expect(fingerprint, 'pt-PT inheritance changed; review the inherited pt-BR wording').toBe(
      '4f9c1cf24a394a45ac8e14d412a97f0462e9ef4c6a9ae348a27203511aea84f3',
    )
  })

  test('does not leak European Portuguese UI terms', () => {
    const text = Object.values(ptBR).join('\n')
    const europeanPortuguese =
      /(?:^|[^\p{L}])(?:ficheiro\p{L}*|telemÃ³vel\p{L}*|ecrÃ£\p{L}*|regist(?:o|am|ado|ada|ados|adas)|eliminad\p{L}*|definiÃ§Ãµes|cronÃ³metro|detetad\p{L}*|gÃ©meos|abdÃ³men|anca|coifa dos rotadores|escadora|completaste|acabaste|aguentas|definires|completares|aguenta|aguentaste|ficaste|viajares)(?=$|[^\p{L}])/iu
    expect(text).not.toMatch(europeanPortuguese)
    expect(text).not.toMatch(/[Â«Â»]/u)
    expect(ptBR.Save).toBe('Salvar')
    expect(ptBR.Settings).toBe('ConfiguraÃ§Ãµes')
    expect(ptBR['Delete workout']).toBe('Excluir treino')
    expect(ptBR.Superset).toBe('Superset')
    expect(ptBR['Guest mode â€” data lives only in this browser.']).toContain('visitante')
    expect(ptBR.band).toBe('elÃ¡stico')
    expect(ptBR['resistance band']).toBe('faixa elÃ¡stica')
    expect(ptBR.soleus).toBe('sÃ³leo')
    expect(ptBR.Unpair).toBe('Desvincular')
    expect(ptBR['Choose starter plan']).toBe('Escolha um plano inicial')
  })
})
