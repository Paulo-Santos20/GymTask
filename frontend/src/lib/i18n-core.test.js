import { describe, it, expect } from 'vitest'
import {
  LANGS,
  INSTR_LANGS,
  EXERCISE_NAME_LANGS,
  DATE_LOCALES,
  dateLocale,
  getLang,
  t,
  _setLangState,
} from './i18n-core.js'
import ptBR from '../locales/pt-BR.js'

describe('language tables', () => {
  it('offers exactly one selectable language: Brazilian Portuguese', () => {
    expect(LANGS).toEqual({ 'pt-BR': 'Português (Brasil)' })
    expect(INSTR_LANGS).toEqual(['pt-BR'])
    expect(EXERCISE_NAME_LANGS).toEqual(['pt-BR'])
    expect(DATE_LOCALES).toEqual({ 'pt-BR': 'pt-BR' })
  })
})

describe('t', () => {
  it('translates from the active pack and reports the active language', () => {
    _setLangState('pt-BR', ptBR, null, null)
    expect(t('Save')).toBe('Salvar')
    expect(getLang()).toBe('pt-BR')
    expect(dateLocale()).toBe('pt-BR')
  })

  it('falls back to the English source string for keys the pack lacks', () => {
    _setLangState('pt-BR', ptBR, null, null)
    expect(t('a key no pack defines')).toBe('a key no pack defines')
  })

  it('substitutes {0},{1} args on translated and fallback strings alike', () => {
    _setLangState('pt-BR', { 'Hi {0}': 'Olá {0}' }, null, null)
    expect(t('Hi {0}', 'Ana')).toBe('Olá Ana')
    expect(t('Bye {0}', 'Ana')).toBe('Bye Ana')
  })

  it('shows the English source when no pack is active', () => {
    _setLangState('pt-BR', null, null, null)
    expect(t('Save')).toBe('Save')
  })

  it('normalizes an unknown language code to pt-BR', () => {
    _setLangState('kl', { Save: 'ok' }, null, null)
    expect(getLang()).toBe('pt-BR')
    expect(t('Save')).toBe('ok')
  })
})
