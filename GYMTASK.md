# GymTask — Documentação do Projeto

> PWA pessoal de academia: treinos + evolução + **dieta completa** + **Coach com IA (Grok/xAI)**.
> Fork do [openGym](https://github.com/DuarteSantos8/openGym) v1.3.8 (licença **AGPL-3.0 mantida**),
> 100% JavaScript, interface exclusivamente **pt-BR**, deploy na **Vercel** + **Firebase**.
> Repositório: `https://github.com/Paulo-Santos20/GymTask.git`

---

## 1. Visão geral

O GymTask é a evolução do openGym para uso pessoal:

| Área | openGym (upstream) | GymTask |
|---|---|---|
| Auth | Passkey/WebAuthn + servidor próprio | **Firebase Auth (e-mail/senha)** |
| Dados | JSON flat em disco (`state-<uid>.json`) | **Firestore** (`users/{uid}/state/app`) com fallback HTTP/local |
| Idiomas | 13 locales | **apenas pt-BR** |
| Admin/convites | painel admin, `INVITE_ONLY`, audit log | **removidos** |
| Dieta | não existe | **módulo completo** (TDEE, macros, banco de alimentos, busca por API) |
| Coach | Anthropic/OpenAI/Gemini/compatível | **+ Grok (xAI)** e **+ Groq** e proxy via **Cloud Functions** |
| Deploy | Docker self-hosted | **Vercel** (frontend estático) + Firebase (auth/db/functions) |

Mantidos do upstream: treinos guiados, motor de progressão, 1RM, recuperação muscular,
biblioteca de ~1.324 exercícios, importadores (FitNotes/Strong/Hevy/Apple Health),
MCP server, PWA instalável. (O shell Capacitor Android/iOS foi removido — decisão PWA-only.)

## 2. Arquitetura

```
GymTask/
├── frontend/            # React 19 + Vite + Zustand + React Router (HashRouter) — build estático → Vercel
│   └── src/
│       ├── views/       # uma tela por arquivo (Home, Workout, Plan, Stats, Coach*, Login, …)
│       ├── store/       # useStore.js (estado global persistido) + nutritionStore.js
│       ├── lib/         # lógica pura + testes (progression, onerm, tdee, foods, foodApis, …)
│       ├── locales/     # pt.js (base) + pt-BR.js (overrides) — únicos restantes
│       └── components/  # UI compartilhada (sheets, modais, gráficos)
├── api/                 # backend Node sem framework (herdado) — usado no dev local e como fallback
│   └── coach/           # núcleo do Coach: prompts, providers, adapters (inclui grok.js, groq.js)
├── functions/           # Firebase Cloud Functions (CJS): coach, nutritionProxy, pushDailyReminder
├── docs/                # docs do upstream (SELF_HOSTING, MOBILE, AI_COACH, …)
└── mcp/, website/, …    # herdados do upstream
```

### Caminho de dados (decisão central)

1. **Sem Firebase configurado** (`VITE_FIREBASE_*` ausente) → tudo funciona como openGym:
   `localStorage` + HTTP `/api/data`. Zero custo de bundle (o chunk do Firebase nem é baixado).
2. **Firebase configurado + usuário logado** → `lib/api.js` intercepta as chamadas de estado
   (`GET/PUT /api/data`, `/api/data/rev`) e usa **Firestore** diretamente:
   - doc `users/{uid}/state/app`, campos = chaves do próprio blob + `_rev` (server-owned)
   - offline via `persistentLocalCache`; erros mapeados para status HTTP (403/401/500/offline)
   - `PUT` replica a semântica do servidor: 409 em `baseRev` stale (merge-and-retry do useStore),
    filtro de lixo, `active` local não sincroniza, limite ~1 MB
3. **Login** (`views/Login.jsx`): e-mail/senha via Firebase; erros `auth/*` traduzidos para pt-BR;
   "Esqueci minha senha" → `sendPasswordResetEmail`; sem Firebase configurado → aviso claro.

### Contrato Firebase (`frontend/src/lib/firebase.js`)

Exports: `firebaseConfigured`, `app`, `auth`, `db` — `null`/`false` quando sem env;
Firestore inicializado com `persistentLocalCache`. **Todos os módulos importam daqui**,
nunca chamam `initializeApp` diretamente.

### Coach + Grok/Groq

- Providers em `api/coach/core/providers.js` (row `grok` → `https://api.x.ai`, `/v1/chat/completions`;
  row `groq` → `https://api.groq.com/openai`, default `qwen/qwen3.8-27b`, `GROQ_API_KEY`),
  adapters em `api/coach/core/adapters/{grok,groq}.js` (via `chatCompletionsSpec`; Groq usa
  `max_tokens` + `temperature: 0`).
- Chave/nunca no bundle: `XAI_API_KEY` / `XAI_MODEL` (default **`grok-3-mini`**) via env no servidor.
- **BYOK (grátis, com Groq)**: rota `/coach/setup` (`views/CoachSetup.jsx`, row "AI Coach" em
  `Settings.jsx`) escolhe modo server/BYOK/off; chave fica no `localStorage` (`lib/coach-local.js`),
  `coachAvailable()` libera o Coach quando `mode='byok'` (community continua exigindo server).
- `functions/index.js` exporta:
  - **`coach`** — `POST https://us-central1-<proj>.cloudfunctions.net/coach`, body `{system, prompt}`
    (ou `{kind, payload}`), responde `{ok, model, text, answer}`; 400 sem chave, 502/504 upstream, CORS `*`
  - **`nutritionProxy`** — `POST …/nutritionProxy`, body `{query}` → Nutritionix
    `/v2/natural/locales/br/search`; responde `{ok, query, results, foods}` (`foods` = pass-through
    bruto lido pelo `foodApis.js` via `VITE_NUTRITION_PROXY_URL`); 400 sem env
  - **`pushDailyReminder`** — FCM real: `onSchedule('every day 09:00', America/Sao_Paulo)`,
    publica no topic **`gytask-daily`** (kill-switch `DAILY_REMINDER_ENABLED`), sem tokens/Firestore;
    contrato do cliente documentado em `functions/README.md`; `engines.node` = **22**

### Nutrição (módulo novo) — ✅ completo

- `lib/tdee.js` — BMR (Mifflin-St Jeor), TDEE (fator de atividade), meta calórica, macros (+ `tdee.test.js`)
- `lib/foods.js` — banco de ~200+ alimentos BR com busca sem acento (+ `foods.test.js`)
- `lib/foodApis.js` — USDA (DEMO_KEY) / Open Food Facts / Nutritionix (via `VITE_NUTRITION_PROXY_URL`, skip sem env)
- `store/nutritionStore.js` — log de refeições por data, persistência `gym_nutrition_v1`
- UI: `views/Nutrition.jsx` (278 linhas) + `nutrition.css` — navegação de data, resumo calorias/macros,
  undo, add-food (busca local + externa), seletor de porção, formulário TDEE; rota `/nutrition` wired no `App.jsx`
- i18n: 42 keys em `pt.js` + `PT_BR_OVERRIDES` (censo **752** overrides, inherited 641, fingerprint intacto)

## 3. Configuração / variáveis de ambiente

**Frontend** (`frontend/.env`, ver `.env.example`):

```
VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID
VITE_NUTRITION_PROXY_URL=https://us-central1-<projeto>.cloudfunctions.net/nutritionProxy
VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae…/images/
VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae…/videos/
```

As duas últimas apontam a **mídia dos 1.324 exercícios** para o dataset no jsDelivr (mesmo
commit pinado do workflow do GitHub Pages). Vazio = `img/`+`gif/` relativos, que só funcionam
com a mídia servida junto ao app (dev: proxy do vite para `media/`). Sem elas a **Library e a
folha do exercício ficam sem imagem** — os arquivos são gitignored e nunca entram no build.

**Cloud Functions** (`functions/.env`, ver `functions/.env.example`):

```
XAI_API_KEY=...            # chave xAI (paga — ver §6)
XAI_MODEL=grok-3-mini      # opcional
NUTRITIONIX_APP_ID=...     # gratuito em nutritionix.com/developers
NUTRITIONIX_APP_KEY=...
```

## 4. Status atual (o que já está feito)

| # | Frente | Estado | Evidência |
|---|---|---|---|
| ① | Base + Firebase Auth | ✅ concluído | `lib/firebase.js`, `Login.jsx` reescrito, `firebase@^12.19.0`, `.env.example`, chaves i18n (24) |
| ② | Firestore no fluxo de estado | ✅ concluído | `lib/api.js` intercepta `/api/data*`; semântica 409/rev espelhada; fallback HTTP/local |
| ③ | Módulo Nutrition | ✅ concluído | `tdee/foods/foodApis/nutritionStore` + testes, `Nutrition.jsx` (278 ln), rota `/nutrition`, 42 keys i18n |
| ④ | Coach Grok + Cloud Functions | ✅ concluído | `api/coach/core/adapters/grok.js`, row em `providers.js`, `functions/` (coach, nutritionProxy, pushDailyReminder FCM) |
| ⑤ | Rebrand + strip (admin/convites/idiomas) | ✅ concluído (sweep final feito) | ✅ 12 locales, `instr/*`, `Admin.jsx`, `audit.js`, testes admin, `App.jsx`, `server.js`, manifest/sw, mobile strings, docker-compose, `website/` + `mcp/` (rebrand feito, `OPENGYM_*` mantidos por decisão), CI (GitLab/Gitea/mirror/docker-publish removidos), `.env.example` (seção passkey → ORIGIN/CORS), `scripts/fetch-media.sh` (0 refs), `scripts/build-api-docs.mjs` rebrandado + `website/api.html` regenerado, docs `.md` reescritos (`bg_d2e34ae5`), `website/docs.html`/`about.html`/`llms.txt` limpos (`bg_b6c0603d`), `docs/*` PWA-only (`bg_2a401c07`, `docs/MOBILE.md` apagado), dangles (`CONTRIBUTING.md`, `SECURITY.md`, `docs/AI_COACH.md`), `assets/banner.svg`/`banner.png` rebrandados. PWA-only: `bg_7a715c51` (android/ios/cap/MOBILE/libs fora) + resíduo `bg_5dbd7edc` (renovate.json/dependabot/functions/mcp/credential.test — greps 0). **Sweep final `passkey\|webauthn\|capacitor\|.apk\|Xcode\|pair/create` = 0 em código**; restam só menções explicativas em docs ("passkeys removed") e notas históricas — classificado, nenhum hit de código. |
| — | Passkey removido (frontend + api) | ✅ concluído | rotas WebAuthn/pairing removidas de `server.js`, `@simplewebauthn` fora de `package.json`, `RP_ID`/`RP_NAME` deletados, exports em `api.js` removidos, testes passkey removidos (−3), `openapi.yaml` limpo (`tags: [Data]`→`[data]`), 0 refs em `frontend/src` + `api` |
| — | Rotas `/api/pair/*` removidas | ✅ concluído | `pair/create`+`pair/redeem` (único caller era o shell nativo) fora de `server.js`; `api/test/server-pairing.test.js` deletado (api **177/159/18**, delta = −1 teste, mesmas 18 falhas pré-existentes); grep `pair` = 0 em `server.js`/`openapi.yaml`/`website/api.html`/`docs/{API,SELF_HOSTING*}.md`; `node --check server.js` exit 0; `sign()`/`SESSION_DAYS` órfãos mantidos na época, **depois removidos** (débito §6 fechado 2026-09-28) |
| — | Grok/Groq BYOK no frontend | ✅ concluído | `grok`+`groq` em `ADAPTERS` (`lib/coach-local.js`, `api/coach/adapters/index.js`); row `groq` (`providers.js`), `adapters/groq.js`, teste wire `adapters-http.test.js`; **tela BYOK restaurada**: `views/CoachSetup.jsx`+`CoachSetup.test.jsx`, rota `/coach/setup` (`App.jsx`), row "AI Coach" (`Settings.jsx`), gating `coachAvailable(byok→true)` (`lib/coach.js` + CoachChat/CoachIntake/Plan) |
| — | Card Nutrition no Home | ✅ concluído | link `/nutrition` em `views/Home.jsx`; rota existia desde o módulo |
| — | Rebrand do prompt do Coach + URLs upstream no `openapi` | ✅ concluído | `system-prompt.js`, `prompts/common.md` (+ `prompts.js` regenerado), `functions/index.js` → "GymTask Coach"; assertion `jobs.test.js:458` ajustada; comentários `config.js:19`/`node-fetch.js:10`; `openapi.yaml` (browse/contact/derived → fork) + `website/api.html` regenerado (16 endpoints); `build-coach-assets.mjs` normaliza CRLF (o `--check` do CI é byte-compare, agora estável entre plataformas); `scripts/` (hevy-id-map comments, tempdir `gytask-pt-br-`). Verificado: jobs 1/1, adapters-http 19/19, `--check` verde, greps `openGym Coach`/`inside openGym` = 0. Mantidos por contrato: `opengym_plan: 1`, salt HKDF `opengym-coach-v1`, UA `opengym-coach/` |
| — | Rodada de features 2026-10-04/05 (3 planos, 50 todos) | ✅ concluído | audit-fixes (31 + F1–F4): segurança functions (CORS allowlist/rate limit/payload caps + guard de bytes no `PUT /api/data`), `firebase-admin` 12→14, suíte `functions/` e lint Biome no CI, a11y (diálogo/aria-labels `t()`/nomes), perf (React.lazy + vendor split, selectors/memo), ~150 testes novos, FCM diário, dead-code/docs. top5-features (7): TDEE adaptativo, proteína por refeição, landmarks musculares (série + presets + edição), memória do Coach (`recent` + PRs), aderência. roadmap-features (12): barcode, deload, onSnapshot, SSE streaming, gráfico combinado, plano alimentar, receitas, revisão semanal agendada, sugestão de refeição, foto→macros (Groq), Apple Health (Shortcuts), bateria final — ver ROADMAP "Entregue" |
| — | Build + testes centrais | ✅ **verde** (contagens 2026-10-08, pós-cardápio-por-texto) | `npm run build` exit 0; `npm test` **2548/2548** (219 arquivos, 1 skip); `check-locales` **1570/1570** (2 locales in sync); `check-source-strings --strict` **0** pendências (1165 strings traduzidas); fingerprint `c2c0dea8…d89794` (inherited **695** / overrides **875**); fatigue-probe ✅; `mcp` **88/88** + `node-loadable`; `api` **205 pass / 0 fail**; `functions` **50/50**; gate Biome ✅ |
| — | Paridade com upstream (merge-base `de7f25c` → upstream `e88062e`; fases 0–6, mídia fora de escopo) | ✅ concluído | merges em `main` + esta rodada: sync core do store portado do upstream (meta por cópia em `WeakMap`, base `gym_sync` + `gym_dirty` para o que se deve ao servidor, listener de `storage` em `gym_sync` → `checkRev(true)`, ação `syncNow()`; teste `useStore.tabs.test.jsx` 10/10), CoachIntake/CoachSetup/CoachChat (fast-failure, demo-failure, cleartext), grip/impressão/progressão/troca de exercício, cartão de peso no Home, nova rotina no Plan, pausa/pronto do descanso, unidade/reset/import sync; **gates de string/locale**: 16 chaves novas em `pt.js` (inherited 676→692), mojibake UTF-8 duplo em 8 arquivos (84 ocorrências — `â€”`→`—` etc. + `Â·`/`Â©`) corrigido na origem, rebrand `Use my self-hosted openGym` → `GymTask` (`CoachSetup.jsx` + teste) |
| — | Deploy Vercel/PWA | 🟡 configs no ar | Projeto `gymtask-jtu8` linkado (`.vercel/` gitignored); **envs 8 production + 6 preview** (6 `VITE_FIREBASE_*` em ambas + `VITE_IMG_BASE`/`VITE_GIF_BASE` em production) via CLI/API (2026-09-28/29); `rootDirectory=frontend` + build settings (`npm ci`/`npm run build`/`dist`) corrigidos via API PATCH; `vercel.json` **duplicado idêntico** (raiz + `frontend/`) com comandos relativos. Dois erros de build resolvidos: `cd: frontend: No such file or directory` (cwd já era o Root Directory) e limite de **12 Serverless Functions do Hobby** (Root Directory vazia via `api/` ~240 `.js`; agora `api/` fica fora do projeto Vercel — functions ficam no Firebase). Build verde ✅ (`1601e6c` READY 2026-09-28 21:18, headers PWA verificados ao vivo); falta `VITE_NUTRITION_PROXY_URL` |
| — | Firebase deploy config | ✅ em produção | `firebase.json` (nodejs22), `.firebaserc` → **`gymtask-ce4b6`** (placeholder trocado 2026-09-28), `firestore.rules` **deployed** (`firebase deploy --only firestore:rules` exit 0, rules released) |
| — | FCM push | ✅ código pronto | `pushDailyReminder` FCM topic `gytask-daily` + `functions/README.md` |
| — | Credenciais reais | 🟡 Firebase ✅ / xAI+Nutritionix ⬜ | Firebase recebido 2026-09-28: `frontend/.env` **criado** (6 `VITE_FIREBASE_*`, gitignored — baseline do vitest intacta), `data/service-account.json` gravado (gitignored; **rotacionar a chave** — foi colada no chat) e envs espelhadas na Vercel (8 production + 6 preview); verificado via API: token OAuth OK, Firestore `(default)` existe, **e-mail/senha já habilitado**, authorizedDomains = localhost + firebaseapp + web.app (falta o domínio Vercel pós-deploy); `measurementId` do snippet Firebase **não** ligado (o app promete sem telemetria); **falta**: `XAI_API_KEY`, `NUTRITIONIX_APP_ID/KEY`, `VITE_FIREBASE_VAPID_KEY`, `VITE_NUTRITION_PROXY_URL` |

## 5. O que falta ser feito (checklist)

### Imediato (retomar daqui)
1. **Fechar o rebrand (sweep final)** — concluídos: `website/` (marca + `api.html` regenerado),
   `mcp/` (só `OPENGYM_*` + atribuição), `.env.example`, `scripts/fetch-media.sh`, CI
   (GitLab/Gitea/mirror/docker-publish apagados), issue templates, FUNDING, Docker/compose,
   reescrita de `README.md`/`ROADMAP.md`/`CLAUDE.md`/`CONTRIBUTING.md`/`SECURITY.md`/`docs/*.md`
   (`bg_d2e34ae5`), conteúdo passkey de `website/docs.html`/`about.html`/`llms.txt` (`bg_b6c0603d`),
   `docs/*` PWA-only + `docs/MOBILE.md` apagado (`bg_2a401c07`), banner `assets/banner.svg`/`banner.png`,
   `api/openapi.yaml` + `website/api.html` (URLs upstream→fork), prompt do Coach → "GymTask Coach"
   (`system-prompt.js`/`prompts/*.md`/`functions/index.js`), `scripts/` (hevy-id-map, tempdir).
   ~~2 agents PWA-only~~ ✅ **CONCLUÍDOS**: frontend (`bg_7a715c51`, 48min) — `android/`/`ios/`/
   `capacitor.config.json` deletados, libs mobile/back/remote/update/CoachSetup/MobileOnboarding
   fora, `package.json`/lock limpos (CoachSetup **restaurado em 2026-09-29** só na forma web — §4); resíduos (`bg_5dbd7edc`, timeout 42min, ~90% + resto manual)
   — `renovate.json` DELETADO, comentários `mcp/README.md`/`mcp/src/state.js`/`credential.test.js`
   limpos. Greps `passkey|webauthn|RP_ID|capacitor` fora de `frontend/`+docs = **0**.
   Sweep `opengym` classificado: só atribuição AGPL + identificadores KEEP (`OPENGYM_*`,
   `opengym_plan`, salt HKDF, UA `opengym-coach/`) + menções históricas em docs.
2. ~~**Passkey residual**~~ ✅ — removido por completo (frontend + api + spec + testes −3;
   `openapi.yaml` tags `data` corrigido, `website/api.html` regenerado limpo: 0 passkey/WebAuthn).
3. ~~**Grok no frontend (BYOK local)**~~ ✅ — `grok`+`groq` em `ADAPTERS`, tela `/coach/setup`
   restaurada (mode picker server/BYOK/off) + gating `coachAvailable` (byok libera o Coach).
4. ~~**Entrada de Nutrition na UI**~~ ✅ — card/link `/nutrition` no `Home.jsx` (rota já existia).
5. ~~**Rotas `/api/pair/*`**~~ ✅ — removidas (único caller era o shell nativo); testes/docs/spec limpos.
6. ~~**Mídia dos exercícios em produção (Library/folha sem imagem)**~~ ✅ (2026-09-29) — causa:
   `lib/exercises.js` caía em `img/`/`gif/` relativos e esses paths **não existem** no host
   estático (404 confirmado em `gymtask-jtu8.vercel.app/img/…`); a mídia é gitignored e o build
   não a baixa. Corrigido com `VITE_IMG_BASE`/`VITE_GIF_BASE` no **production** da Vercel apontando
   para o dataset `@7455efae` no jsDelivr (mesmo pin do `pages.yml`) + fallback de thumb com
   `onError` (`components/Media.jsx`) + docs (`.env.example`, `docs/DEPLOY_VERCEL.md` §2).
   Preview não recebe as envs: `main` é a production branch, e variáveis de preview só aceitam
   branch diferente dela. **Resolvido (2026-09-29)**: produção serve o bundle novo (`index-Dnb2bsEL.js`, deploy
   2026-09-29 20:44) com `VITE_IMG_BASE`/`VITE_GIF_BASE` embutidos (2× jsDelivr no bundle).

### Deploy (requer credenciais — §5.1)
5. **Credenciais**: ~~Firebase~~ ✅ recebido (projeto `gymtask-ce4b6`, e-mail/senha ativo,
   Firestore `(default)` criado, rules no ar); **falta** xAI `XAI_API_KEY`,
   Nutritionix `NUTRITIONIX_APP_ID/KEY`, `VITE_FIREBASE_VAPID_KEY` (push).
6. **Vercel**: ~~apontar repo + envs `VITE_*`~~ ✅ parcial (2026-09-28) — projeto
   `gymtask-jtu8`, Root Directory `frontend`, build `npm run build`/`dist`, 6 `VITE_FIREBASE_*`
   em production **e** preview (CLI/API), `vercel.json` na raiz + `frontend/`.
   ~~build verde pós-push~~ ✅ (`1601e6c` READY). **Falta**: `VITE_NUTRITION_PROXY_URL`
   → URL da function `nutritionProxy` (pós-deploy das functions) e adicionar o domínio
   Vercel em Authentication → Authorized domains.
7. **Firebase**: ~~trocar placeholder no `.firebaserc`~~ ✅ (`gymtask-ce4b6`);
   ~~`firestore.rules` deploy~~ ✅ (no ar). **Deploy das functions adiado por decisão
   (2026-10-08)**: exige plano Blaze; o billing do projeto está bloqueado (conta `015760-…`
   "Pagamento do Firebase" criada mas `open: false`; o Google permite só 1 perfil PF por
   país e o perfil existente tem CPF que não é o do usuário). **Enquanto isso**: tudo que
   existe funciona no Spark — coach chat/foto/cardápio BYOK Groq é 100% client-side
   (`coach-api.js`), nutrição usa OFF/USDA. O Blaze só destrava modo servidor do coach,
   `nutritionProxy` (Nutritionix), rotina semanal e lembrete diário. Quando o billing
   abrir: `functions/.env` já está gravado nesta máquina (gitignored, `GROQ_API_KEY`);
   falta `XAI_API_KEY`/`NUTRITIONIX_*` opcionais → `firebase deploy --only functions`.
8. ~~**README/docs do repo**~~ ✅ — reescritos para GymTask (Vercel/Firebase) por `bg_d2e34ae5`
   (`README.md`, `ROADMAP.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/*.md`).
9. ~~**`api/openapi.yaml`**: surface do coach**~~ ✅ — tags `coach`/`functions`, 10 rotas coach
   + `GET /coach`/`POST /nutritionProxy` com `servers:` da Cloud Functions, responses
   `CoachOff/CoachBusy/CoachDailyCap/CoachConsent/CoachQueued`, schemas
   `CoachDisclosure/CoachJob/CoachPending/CoachStatus/CoachAccount/CoachCohort`, `Error.code`,
   cookieAuth corrigido (refs mortas a `register/verify`/`login/verify` removidas), seção Coach
   no `info.description`; `/api/admin/coach*` fora de propósito (filtradas em `server.js`).
   `website/api.html` regenerado (30 endpoints, 14 schemas, 72 KB; parse OK, 27 paths).
10. ~~**Rodada 2026-10-04/05 — 3 planos de features/auditoria**~~ ✅ — `audit-fixes`
    (31 todos + F1–F4), `top5-features` (7) e `roadmap-features` (12) fechados com
    evidência red→green por todo e verificação independente; 50 commits empurrados
    (`827e5fd..8a782f2`), histórico reescrito para remover trailers de IA dos commits
    (`edc1b42`, force-push), CI corrigido no job `functions` (`31885c1`: `npm ci` de `api/`
    porque o teste da revisão semanal importa `jobs.js` → `undici`) e demo no GitHub Pages
    no ar (Pages habilitado + `pages.yml` verde). **Nada de código restou desta rodada**;
    resto = credenciais/deploy (acima) + 2 PRs do Dependabot para re-base.

### Credenciais (todo 15 — pedir ao usuário antes do deploy)
- ~~Firebase Console: criar projeto, ativar E-mail/senha, app Web → 6 `VITE_FIREBASE_*`~~ ✅
  (2026-09-28: projeto `gymtask-ce4b6`, e-mail/senha confirmado via API, web config em
  `frontend/.env` + service account em `data/service-account.json` — ambos gitignored — e
  espelhada nas 12 envs da Vercel; rules deployed)
- xAI: chave `XAI_API_KEY` (**paga** — ver aviso abaixo) — ⬜ pendente
- Nutritionix: `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (plano gratuito) — ⬜ pendente
- VAPID: `VITE_FIREBASE_VAPID_KEY` (Firebase Console → Cloud Messaging → Web Push certificate) — ⬜ pendente

## 6. Avisos e débitos técnicos conhecidos

- **xAI/Grok não é gratuito** (~US$2/1M in, ~US$6/1M out tokens). Alternativa gratuita já
  implementada: **Groq** (`gsk_…`, tier grátis) via BYOK em `/coach/setup`; ou manter outro
  provider do adapter já existente ou modelo gratuito compatível.
- **Nutritionix sempre pelo proxy** (`nutritionProxy`) — chave nunca no bundle do browser.
- TOCTOU no conflict check Firestore (getDoc→setDoc) tem janela maior que o compare-and-write
  síncrono do servidor — aceito, documentado no código.
- A função `coach` em `functions/` é autocontida (duplica 3 linhas de prompt): Firebase empacota
  só `functions/` no deploy e `api/` é ESM — débito sinalizado no código.
- `pt-br-locale.test.js` faz censo de chaves (**752** overrides / **641** herdados) — qualquer
  agente que adicione/remova chaves deve recomputar; fingerprint
  `frontend/scripts/pt-br-inheritance-fingerprint.mjs` é o guardião (hash novo
  `4f9c1cf24a394a45ac8e14d412a97f0462e9ef4c6a9ae348a27203511aea84f3` após o strip das 20 chaves
  APK/update em `pt.js` + 4 overrides em `pt-BR.js`; recomputar com `node scripts/pt-br-inheritance-fingerprint.mjs --list`).
- Testes apagados pelo strip: `e2e-apikey.test.js`, `server-admin-delete.test.js`,
  `server-admin-state.test.js` (+ `Admin*.test.js`, `audit.test.js`) — comportamento removido
  junto, handlers órfãos em `server.js` devem ser flagrados/limpos pelo agente de rebrand.
- Strings em inglês fora do pacote de locale (`'Live demo…'`, `'Start the demo'`) — pré-existentes.
- ✅ **Fechado (2026-09-28): `sign()` e `SESSION_DAYS` removidos de `server.js`** — `sign()` tinha
  zero callers e `SESSION_DAYS` não era mais lido (a expiração da sessão vem do próprio token).
  Docs de sessão atualizados: `openapi.yaml` ("Sessions last 90 days"), bloco "Session length"
  tirado de `.env.example`, `docs/SELF_HOSTING.md`, row de `website/docs.html`, env list de
  `api/codemap.md`, `website/api.html` regenerado; `node --check` exit 0. A nota de auth que segue
  em aberto: ninguém mais emite `Set-Cookie` de sessão (só `clearCookie`).
- ✅ **Fechado (2026-09-28): `assets/screenshots/*.png` (5) e `assets/social.jpg` re-capturados** —
  dev server com `VITE_DEMO=1` (seed do demo), api local em :3000, dataset de mídia baixado em
  `media/` (`fetch-media.sh` via clone manual — bash/WSL indisponível no Windows) + server estático
  em :8888 (`MEDIA_TARGET` do vite proxy). Playwright (viewport 390×844 @3x → 1170×2532):
  home/plan/stats/library + workout em sessão (check-in de peso → "Salvar e iniciar treino").
  `social.jpg` 1200×630 recomposto (marca GymTask, slogan pt-BR, badges, mockup da home).

## 7. Comandos

```bash
# Frontend (dev) — proxy de /api para :3000
cd frontend && npm install && npm run dev

# Testes / build (validação central — rodar após todos os agentes terminarem)
cd frontend && npm test && npm run build

# Cloud Functions (local)
cd functions && npm install

# Deploy
#  Vercel: Root Directory=frontend/, build=`npm run build`, envs VITE_* (8 prod + 6 preview) no ar
#  Functions: firebase deploy --only functions   (requer firebase.json + login)
```

## 8. Ideias futuras (melhorias)

### Nutrição
- ✅ **Scanner de código de barras nos alimentos** (RF1, 2026-10-04) — `BarcodeDetector`
  nativo quando existe, jsQR como fallback; EAN → entrada de alimento pré-preenchida
  (`@capacitor-mlkit` saiu com a decisão PWA-only).
- ✅ **Sugestão automática de refeições** (RF9) — chips com os macros restantes do dia no
  Nutrition, com pratos prontos do banco TBCA.
- ✅ **Fotos de refeição → estimativa de macros** (RF10) — visão Groq gratuita (decisão 2)
  + categoria de consentimento "foto"; `functions/photo`.
- ✅ **Receitas** (RF7) — macros por porção, adicionáveis ao log.
- ✅ **Tendências** (RF5) — peso corporal × ingestão calórica × volume de treino no mesmo
  gráfico do Stats.

### Coach
- ✅ **Streaming das respostas** (RF4, 2026-10-04) — SSE de deltas de token no `CoachChat`
  com fallback por polling quando o transporte não dá suporte.
- ✅ **Memória de treinos** (top5 C1) — bloco `recent` (últimas sessões) + detalhe de PRs
  injetado no payload do create-plan.
- ✅ **Revisão semanal automática** (RF8) — scheduled function gera proposta pendente;
  o app a serve via `status()`/`resolvePending()` (o prompt `review.md` já existia).
- ✅ **Plano alimentar pelo Coach** (RF6) — kind `mealplan` a partir do TDEE registrado
  (prompt `mealplan.md`).

### Treino/experiência
- ✅ **Deload automático** (RF2) — regras de periodização/deload no motor de progressão,
  com copy própria na UI.
- **Widgets** (Android/iOS) do treino do dia — ⬜ não feito.
- **Escrita Google Fit / Apple Health** — ✅ **Apple Health** (RF11, opção A decidida):
  ponte via Atalhos do iOS, envia peso e treinos; ⬜ **Google Fit** continua pendente.
- **Modo social**: compartilhar prints de evolução / PRs (share via Web Share API — o share
  Capacitor do upstream saiu com o PWA-only) — ⬜ não feito.
- **Vídeo/looping dos exercícios** (dataset CDN já parametrizado por `VITE_IMG_BASE/VITE_GIF_BASE`) — ⬜ não feito.

### Infra
- ✅ **Firestore real-time** (RF3) — `onSnapshot` no `lib/api.js`, sync instantâneo entre
  dispositivos (substitui o pull/push manual).
- **Multi-perfil familiar** no mesmo Firebase project — ⬜ não feito.
- **Backup/export**: dump completo do Firestore para JSON (portabilidade — espírito "you own your data") — ⬜ não feito.

---

*Última atualização: 2026-10-08 — **cardápio por texto**. O painel de nutrição ganhou um
campo "Escreve o cardápio…" + "Interpretar o cardápio": o texto vai à IA (`menuFromText` —
BYOK Groq direto ou rota `/photo` com `task:'menu'` + `text`, mesmo `MENU_PROMPT`), vira os
mesmos chips do fluxo de foto e faz merge com o que a foto já leu; consentimento e demo
bloqueiam como no foto. **Contagens 2026-10-08 (local)**: frontend vitest
**2548/2548 (219 arq, 1 skip)**, `npm run build` exit 0, `check-locales` **1570/1570**,
`check-source-strings --strict` 0 (1165 strings), fingerprint `c2c0dea8…d89794`
(inherited 695 / overrides 875), fatigue-probe ✅, `functions` **50/50**, gate Biome ✅.*

*Anterior (2026-10-05) — **nutrição: cardápio→foto→macros + barcode**. Novo fluxo
"Foto do cardápio" (leitura do cardápio com `MENU_SYSTEM`/`parseMenu`, chips que excluem o
não comido, e a foto da refeição vai com os pratos mantidos como `context` — rota `/photo`
ganhou `task:'menu'` e `context`, dois prompts allowlistados no server key), barcode
consertado (`lookupBarcode` → endpoint de produto OFF v2 para EANs numéricos, antes da
busca textual; `CameraScan` não reinicia mais a câmera a cada render — `onFound` em ref).
5 chaves de locale (3 com override pt-BR). **Contagens 2026-10-05 (local)**: frontend
vitest **2540/2540 (219 arq, 1 skip)**, `npm run build` exit 0, `check-locales`
**1568/1568**, `check-source-strings --strict` 0 (1163 strings), fingerprint
`bfe30211…f8b91c` (inherited 694 / overrides 874), fatigue-probe ✅, `functions` **48/48**,
gate Biome ✅.*

*Anterior (2026-10-05) — **paridade com upstream** (fases 0–6 do plano de merge,
mídia/Fase 4 fora de escopo por decisão): sync core por aba no store portado, testes
upstream (grip/impressão/progressão/troca/Coach/weight-card/add-routine), 16 chaves de
locale, mojibake corrigido + rebrand final. **Contagens 2026-10-05 (local)**: frontend
vitest **2526/2526 (218 arq, 1 skip)**, `npm run build` exit 0, `check-locales`
**1563/1563**, `check-source-strings --strict` 0 (1158 strings), fingerprint
`b9e98403…25209f` (inherited 692 / overrides 871), fatigue-probe ✅, gate Biome ✅.*

*Anterior (2026-10-05) — **rodada de 3 planos** (audit-fixes 31 + top5-features 7
+ roadmap-features 12 = 50 todos, todos com evidência red→green e verificação independente;
ver ROADMAP "Entregue"). **Contagens 2026-10-05** (CI `edc1b42` = local): frontend vitest
**2015/2015 (162 arq)**, `npm run build` exit 0, `check-locales` **1455/1455**,
`check-source-strings --strict` 0 (1083 strings), census **814/641** + fingerprint
`4f9c1cf2.aea84f3` inalterado, `mcp` **88/88** + node-loadable, `api` **205/0**,
`functions` **46/46**, gate Biome ✅. **CI/infra desta rodada**: job `functions` corrigido
(`31885c1` — instala deps de `api/` porque o teste da revisão semanal importa `jobs.js` →
`undici`), demo no GitHub Pages no ar (Pages habilitado + `pages.yml` verde),
bundle da Vercel verificado ao vivo com os features novos, histórico git reescrito para
remover trailers de IA dos commits (force-push `edc1b42`). Pendências = só credenciais
(§5.1) e 2 PRs do Dependabot.*

*Checkpoint (2026-10-03) - **stale-docs pass** (audit-fixes todo 30). → Docs corrigidos
contra a realidade do HEAD `8b4fe12`: README (frontend já no ar em produção
`gymtask-jtu8.vercel.app`), ROADMAP (projeto Vercel já importado com Root Directory
`frontend/`), `functions/README.md` (firebase-functions v7 / firebase-admin v14 + envs
`ALLOWED_ORIGINS`/`RATE_LIMIT_*`), GYMTASK (contagens §2/§4/§6). **Verdes em 2026-10-03**:
frontend vitest **1827/1827 (142 arq)**, `npm run build` exit 0, `check-locales`
**1393/1393**, `check-source-strings --strict` 0, `mcp` **88/88**, `api` **185 pass / 0
fail** (falhas CRLF resolvidas em `8b4fe12`), census **752/641**, fingerprint
`4f9c1cf2.aea84f3` inalterado.*

- Checkpoint (2026-10-01): **CI destravada** (dois
bugs desde `1645e9e`): `api/package-lock.json` regenerado com npm 10 (o npm 11 tinha gerado
lock sem a árvore opcional do claude-agent-sdk e o `npm ci` do CI falhava com
`Missing: isexe@2.0.0`) + `api/Dockerfile` deixou de copiar `verify-error.js` (arquivo
apagado no mesmo commit; o job `api-image` falhava no build). **npm audit** fechado:
`undici` 7.30.0 (api), `js-yaml` (raiz), `fast-uri`/`hono`/`ip-address`/`qs` (mcp); 4 highs
de `firebase`/`@grpc/grpc-js` (frontend) **aceitos** - só resolvem com downgrade breaking
para firebase@9.14.0, e o app usa `firebase@^12.19.0`. **i18n**: 33 strings de
`coach-demo`/`Settings`/`Login`/`plan-share`/`i18n-core` adicionadas a `pt.js` +
`PT_BR_OVERRIDES` (overrides 702 → **735**, herdados **641**, fingerprint
`4f9c1cf2.aea84f3` inalterado) e `check-source-strings --strict` agora falha build.
**Codemaps**: `plates`/`speed`/`workout-date`/`session-routines` mapeados + contagens de
locale. **Docs**: GYMTASK, ROADMAP, README (Grok/Groq + envs de mídia), AI_COACH (row Groq,
"phone app" → PWA). **Verdes**: frontend vitest **1747/1747 (126 arq)**, `npm run build`
exit 0, `check-locales` **1376/1376**, `mcp` **63/63**, `api` **160 pass/18 fail**
(baseline CRLF inalterado), `node --check server.js` exit 0. Env Vercel: **8 production +
6 preview**.
- Checkpoint anterior (2026-09-29): ✅ Nesta rodada: **tela BYOK do Coach restaurada**
(`views/CoachSetup.jsx` + `CoachSetup.test.jsx` de volta na forma web — rota `/coach/setup`, row
"AI Coach" em `Settings.jsx`, mode picker server/BYOK/off, default `groq`) + **provider Groq**
(row em `providers.js` `https://api.groq.com/openai`/`qwen/qwen3.8-27b`/`GROQ_API_KEY`, adapter
`adapters/groq.js` via `chatCompletionsSpec` com `max_tokens`+`temperature:0`, wire em
`adapters-http.test.js`) + **gating BYOK** (`coachAvailable(config, user, {demo, coachMode})` com
`byok→true` em CoachChat/CoachIntake/Plan; community só server) + **codemaps** (7 arquivos) +
checklist atualizado. **Verdes**: frontend vitest **1531/1531 (122 arq)**, `npm run build`
exit 0, api **163 pass/18 fail** (baseline de controle via stash 162/18 — mesmas 18 falhas CRLF,
delta +1 = teste Groq), `mcp` **58/58**, `check-locales` 1336/1336 em sincope,
`pt-br-locale.test.js` 4/4, `node --check server.js` exit 0.
— Checkpoint anterior (2026-09-28): ✅ **§5.9 openapi surface do
coach** fechada (tags `coach`/`functions`, 10 rotas coach + 2 de functions com `servers:` próprio,
responses `CoachOff/CoachBusy/CoachDailyCap/CoachConsent/CoachQueued`, schemas
`CoachDisclosure/CoachJob/CoachPending/CoachStatus/CoachAccount/CoachCohort`, `Error.code`,
cookieAuth corrigido, seção Coach no `info.description`, `website/api.html` regenerado →
30 endpoints/14 schemas/72 KB, parse + 27 paths OK); **débitos §6 fechados** (`sign()` e
`SESSION_DAYS` removidos + docs de sessão; 20 keys APK/update órfãs fora de `pt.js` + 4 overrides
fora de `pt-BR.js`; census **695/641**, fingerprint `4f9c1cf2…aea84f3`, teste 4/4);
**codemap completo** (20 `codemap.md` de diretório + atlas `codemap.md` + `AGENTS.md`, 9 fixers
sem placeholders — 0 `<!--` em todos); **screenshots/social re-capturados** (5 PNG 1170×2532 +
`social.jpg` 1200×630, marca GymTask/pt-BR — ver débito §6 fechado). ⚠️ `node_modules` de
frontend/api/mcp estavam ausentes e
foram reinstalados (`npm ci`; no api, `npm install --omit=optional` porque o lock sai de sincro
com a optional `claude-agent-sdk` — lock restaurado, não commitar).
**Verdes**: frontend vitest **1527/1527 (121 arq)**, `npm run build` **exit 0**, mcp **58/58**,
api **159 pass/18 fail** (baseline CRLF, intacto), `check-locales` 1336/1336 em sincope,
`node --check server.js` exit 0. ✅ **Deploy Vercel (2026-09-28)**: projeto `gymtask-jtu8`
linkado (`.vercel/` gitignored), **12 envs** criadas via CLI/API (`VITE_FIREBASE_*` × 6 em
production **e** preview), `rootDirectory=frontend` + build settings (`npm ci`/`npm run build`/
`dist`) corrigidos via API e `vercel.json` **duplicado idêntico** (raiz + `frontend/`) — os
**dois erros de build resolvidos**: `cd: frontend: No such file or directory` (os comandos
antigos rodavam com cwd já dentro do Root Directory) e o limite de **12 Serverless Functions do
Hobby** (Root Directory vazia expunha `api/`, ~240 `.js`, como functions; agora fica fora do
projeto Vercel — as functions ficam no Firebase). `frontend/.env` **criado** (6 vars, gitignored),
`data/service-account.json` gravado (gitignored; **rotacionar a chave** — foi colada no chat),
`measurementId`/analytics do snippet Firebase deliberadamente não ligado (app sem telemetria).
Docs sincronizados: `README.md`, `ROADMAP.md`, `docs/DEPLOY_VERCEL.md` (§1 reescrito +
troubleshooting dos 2 erros). ✅ **Push `1601e6c` + build VERDE** (production READY 2026-09-28 21:18; ao vivo: `/` 200
com "GymTask", `sw.js` `must-revalidate`, `/assets/*` `immutable` — o build anterior `27c4cb9`
era o do erro de 12 functions). 🔴 **Falta**: 1) `VITE_NUTRITION_PROXY_URL` +
`firebase deploy --only functions` (espera `XAI_API_KEY`/`NUTRITIONIX_*`); 2) domínio Vercel em
Firebase → Authorized domains; 3) no outro PC, refazer `frontend/.env` (gitignored — não vai no
push). Firebase `gymtask-ce4b6` ao vivo (rules deployed,
e-mail/senha ativo); `data/*` staged gitignored. Itens 2/4 do checkpoint anterior (capa §5.9 e
fingerprint "sumido") resolvidos — o script sempre esteve em `frontend/scripts/`.
