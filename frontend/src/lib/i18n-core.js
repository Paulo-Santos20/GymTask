// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, exerciseNameFor, getLang). Plain Node-loadable — the browser-only pieces
// (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

// Brazilian Portuguese is the app's only language. English remains the *source-key* language:
// every t('…') call is written in English and falls back to that source string when the pack
// has no entry (and, for exercises, to the catalogue's own ex.st steps / ex.n name).
export const LANGS = { 'pt-BR': 'Português (Brasil)' }
export const INSTR_LANGS = ['pt-BR']
export const EXERCISE_NAME_LANGS = ['pt-BR']
export const DATE_LOCALES = { 'pt-BR': 'pt-BR' }

let lang = 'pt-BR' // set only by _setLangState, called from i18n.js setLang
let dict = {} // current locale pack (empty = English source fallback)
let instr = null // { exId: [steps] } for the current language, null = English
let exerciseNames = null // { exId: translated name }, null = original catalogue name
let version = 0 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'pt-BR'
export const getVersion = () => version

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// Built-in catalogue names are bilingual when a complete translated name pack is active.
// User-created exercises have no entry in the pack and keep their exact chosen name.
export const exerciseNameFor = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  if (!translated) return ex?.n || ''
  // Some names (Burpee, Pilates, brand/model terms) are the established term in the target
  // language too. Repeating an identical loanword in parentheses adds noise rather than
  // context. Compared in the active language's own casing rules, not hardcoded to one —
  // this only ever differs from ordinary casing for languages with locale-specific rules
  // (e.g. Turkish dotless i), which does not include any language shipped here today.
  return translated.toLocaleLowerCase(lang) === ex.n.toLocaleLowerCase('en') ? translated : `${translated} (${ex.n})`
}

// Search both the localized and canonical English title without changing persisted data.
export const exerciseNameSearchText = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  return translated ? `${translated} ${ex.n}` : ex?.n || ''
}

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`, `instr` and `exerciseNames` may be null to reset to their English fallbacks.
export function _setLangState(newLang, newDict, newInstr, newExerciseNames) {
  lang = LANGS[newLang] ? newLang : 'pt-BR'
  dict = newDict || {}
  instr = INSTR_LANGS.includes(lang) ? newInstr || null : null
  exerciseNames = EXERCISE_NAME_LANGS.includes(lang) ? newExerciseNames || null : null
  version++
  return version
}
