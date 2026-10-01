# frontend/src/locales/

## Responsibility

UI translation packs for the t() string layer. Every key is the English source string
(`t('Save')` → `'Salvar'`); there is no message-id numbering.

- `pt.js` — European Portuguese base pack (~1376 entries). Not shipped as a runtime locale:
  `LANGS` in `lib/i18n-core.js` only exposes `pt-BR`, so nothing ever loads it via `setLang`.
  It exists as the base layer of `pt-BR.js` and as the key-set reference for tests.
- `pt-BR.js` — the app's only real locale. `import pt from './pt.js'`, exports
  `PT_BR_OVERRIDES` (735 Brazilian-specific entries) and
  `export default { ...pt, ...PT_BR_OVERRIDES }` (pt-BR.js:773), i.e. base + override merge.

## Design

- **Override semantics**: inherited `pt` values are shared, region-neutral wording;
  anything Brazil-specific (or wording that must not drift with pt-PT) goes into
  `PT_BR_OVERRIDES`, which wins on spread.
- **Inheritance is fingerprinted** (`lib/pt-br-locale.test.js`): a SHA-256 over all
  inherited key/value pairs must match a pinned hash — upstream `pt.js` edits force an
  explicit review. Also asserted: key sets match exactly, `{0}`-style placeholders are
  preserved per key, and no European-Portuguese terms leak (regex denylist + spot checks).
- **Fallback, not failure**: `t()` (`i18n-core.js:25`) returns the English source string
  when the dict has no entry, and substitutes `{0}`, `{1}`… on both translated and
  fallback text.

## Flow

1. `App.jsx:78` runs `setLang(S.lang || 'pt-BR')` on mount/lang change.
2. `lib/i18n.js` `setLang` resolves `../locales/<lang>.js` through
   `import.meta.glob('../locales/*.js')` (Vite lazy chunk), awaits `.default`, and passes it
   to `_setLangState(l, dict, instr, exerciseNames)`.
3. Core stores the dict and bumps `version`; `useLang()` (`useSyncExternalStore`)
   re-renders subscribers.
4. Views/components call `t('English source', …args)` at render; before the pack loads the
   bundle ships English source strings (i18n.js:18-19 comment).

## Integration

- Loaded alongside sibling packs `../instr/*.js` and `../exercise-names/*.js` in the same
  `setLang` call — one language swap loads all three.
- Consumed by essentially every view/component/store via `import { t } from 'lib/i18n.js'`
  (`sheets.jsx`, `views/*`, `store/useStore.js`, `store/useUI.js`, …).
- Tests import packs directly: `lib/pt-br-locale.test.js` (inheritance fingerprint),
  `lib/i18n-core.test.js`, `lib/active-workout-order.test.js`, and several
  `import.meta.glob('../locales/*.js')` key-coverage checks in view tests.
- Adding a string = add the English key to `pt.js`, translate in `PT_BR_OVERRIDES`
  (or both layers), tests enforce key-set parity.
