# frontend/scripts/

Standalone Node CLI helpers for the Vite app — no dependencies beyond `node:*`
(and one that imports app source), never bundled, never imported by `src/`.

## Responsibility

Five independent one-shot scripts:

| Script | Job | Invoked by |
|---|---|---|
| `check-locales.mjs` | every file in `src/locales/*.js` must expose the identical key set; reference = union of all locales, so a key added to one pack flags the other ten ("missing" / "only here") | CI: `.github/workflows/test.yml` (`node scripts/check-locales.mjs`, cwd `frontend/`), exit 1 on mismatch |
| `check-source-strings.mjs` | regex-scans `src/**/*.js(x)` (skipping `src/locales`, `instr/`, tests) for literal `t('…')` calls and reports keys defined in no pack — the gap `check-locales` cannot see | CI same job, **report-only** (exit 0; `--strict` exits 1 — held back by the untranslated demo-view backlog) |
| `fatigue-monotonic-probe.mjs` | property probe over `src/lib/recovery.js`: 100 seeded histories × 1080 hourly steps, asserts `fatigueOf()` never rises with time and never rises when a workout is deleted or an out-of-scan import is added; deterministic LCG, no property-test dep | `npm run test:fatigue-probe` (package.json) and CI; too slow for the vitest suite |
| `bundle-size.mjs` | measures `dist/` (raw + gzip per `.js/.css/.html`, content-hash stripped from keys so chunks line up across builds): `--out FILE` writes JSON, `--compare BASE CURRENT` prints per-file delta and warns past +10% gzip | manual/CI-on-demand only — no workflow references it yet; report-only by design |
| `pt-br-inheritance-fingerprint.mjs` | sha256 over the sorted keys `pt-BR` inherits from `pt` (i.e. `pt` minus `PT_BR_OVERRIDES`); `--list` dumps them. Detects silent drift in the inheritance contract asserted by `src/lib/pt-br-locale.test.js` | manual (`node scripts/… --list`) |

## Design

- All `.mjs`, ESM, `#!/usr/bin/env node`, runnable straight from `frontend/` with
  zero install — they resolve paths from `import.meta.url`, never from cwd.
- Checkers **import the locale packs as modules** (dynamic `import()`) instead of
  parsing them; the packs are the single source of truth.
- `check-locales` fails the build, `check-source-strings` and `bundle-size` only
  report — gating is a deliberate choice per script, encoded in its own `exit` codes.
- Probes use seeded/deterministic inputs so failures reproduce byte-for-byte.

## Flow

Input (locale files / `src/` tree / `dist/` / app source) → parse in-process →
compare against an invariant → human-readable stdout + exit code. No files are
written except `bundle-size --out`. Data only flows outward; nothing here feeds
the app at runtime.

## Integration

- CI: `test.yml` runs `npm ci` → `npm test` → `npm run build` → the two locale
  checkers → `test:fatigue-probe`, all with `working-directory: frontend`.
- Consumers: `src/locales/*` (packs), `src/lib/recovery.js` (probe),
  `src/lib/pt-br-locale.test.js` (fingerprint contract), `dist/` (bundle-size,
  after `npm run build`).
- Repo-level siblings live outside this folder: `scripts/build-coach-*.mjs` (root)
  and `api/scripts/` are separate concerns, though they run in the same CI job.
