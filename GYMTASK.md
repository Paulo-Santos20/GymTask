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
| Coach | Anthropic/OpenAI/Gemini/compatível | **+ Grok (xAI)** e proxy via **Cloud Functions** |
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
│   └── coach/           # núcleo do Coach: prompts, providers, adapters (inclui grok.js)
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

### Coach + Grok

- Providers em `api/coach/core/providers.js` (row `grok` → `https://api.x.ai`, `/v1/chat/completions`),
  adapter em `api/coach/core/adapters/grok.js` (via `chatCompletionsSpec`, JSON mode com retry).
- Chave/nunca no bundle: `XAI_API_KEY` / `XAI_MODEL` (default **`grok-3-mini`**) via env no servidor.
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
- i18n: 42 keys em `pt.js` + `PT_BR_OVERRIDES` (censo **699** overrides, inherited 657, fingerprint intacto)

## 3. Configuração / variáveis de ambiente

**Frontend** (`frontend/.env`, ver `.env.example`):

```
VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / STORAGE_BUCKET / MESSAGING_SENDER_ID / APP_ID
VITE_NUTRITION_PROXY_URL=https://us-central1-<proj>.cloudfunctions.net/nutritionProxy
```

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
| — | Grok BYOK no frontend | ✅ concluído | `grok` importado e em `ADAPTERS` (`lib/coach-local.js`) |
| — | Card Nutrition no Home | ✅ concluído | link `/nutrition` em `views/Home.jsx`; rota existia desde o módulo |
| — | Rebrand do prompt do Coach + URLs upstream no `openapi` | ✅ concluído | `system-prompt.js`, `prompts/common.md` (+ `prompts.js` regenerado), `functions/index.js` → "GymTask Coach"; assertion `jobs.test.js:458` ajustada; comentários `config.js:19`/`node-fetch.js:10`; `openapi.yaml` (browse/contact/derived → fork) + `website/api.html` regenerado (16 endpoints); `build-coach-assets.mjs` normaliza CRLF (o `--check` do CI é byte-compare, agora estável entre plataformas); `scripts/` (hevy-id-map comments, tempdir `gytask-pt-br-`). Verificado: jobs 1/1, adapters-http 19/19, `--check` verde, greps `openGym Coach`/`inside openGym` = 0. Mantidos por contrato: `opengym_plan: 1`, salt HKDF `opengym-coach-v1`, UA `opengym-coach/` |
| — | Build + testes centrais | ✅ **verde** (contagens finais pós-PWA-only) | `npm run build` exit 0; `npm test` **1527/1527** (121 arquivos — baseline 1581/126 menos 54 testes/5 arquivos = suites das libs móveis removidas `mobile/back/remote/update` + `CoachSetup.test.jsx`, todas deletadas junto com o código); census locale **695/641** (após strips passkey e APK/update; `pt-br-locale.test.js` 4/4 com fingerprint novo `4f9c1cf2…aea84f3`); `mcp` **58/58**; `api` **159 pass / 18 fail** (falhas pré-existentes CRLF Windows: `prompts.test.js` + `routes.test.js:70` — não corrigir) |
| — | Deploy Vercel/PWA | 🟡 configs no ar | Projeto `gymtask-jtu8` linkado (`.vercel/` gitignored); **envs 6 production + 6 preview** (`VITE_FIREBASE_*`) via CLI/API (2026-09-28); `rootDirectory=frontend` + build settings (`npm ci`/`npm run build`/`dist`) corrigidos via API PATCH; `vercel.json` **duplicado idêntico** (raiz + `frontend/`) com comandos relativos. Dois erros de build resolvidos: `cd: frontend: No such file or directory` (cwd já era o Root Directory) e limite de **12 Serverless Functions do Hobby** (Root Directory vazia via `api/` ~240 `.js`; agora `api/` fica fora do projeto Vercel — functions ficam no Firebase). Falta: build verde pós-push + `VITE_NUTRITION_PROXY_URL` |
| — | Firebase deploy config | ✅ em produção | `firebase.json` (nodejs22), `.firebaserc` → **`gymtask-ce4b6`** (placeholder trocado 2026-09-28), `firestore.rules` **deployed** (`firebase deploy --only firestore:rules` exit 0, rules released) |
| — | FCM push | ✅ código pronto | `pushDailyReminder` FCM topic `gytask-daily` + `functions/README.md` |
| — | Credenciais reais | 🟡 Firebase ✅ / xAI+Nutritionix ⬜ | Firebase recebido 2026-09-28: `frontend/.env` **criado** (6 `VITE_FIREBASE_*`, gitignored — baseline do vitest intacta), `data/service-account.json` gravado (gitignored; **rotacionar a chave** — foi colada no chat) e envs espelhadas na Vercel (6 production + 6 preview); verificado via API: token OAuth OK, Firestore `(default)` existe, **e-mail/senha já habilitado**, authorizedDomains = localhost + firebaseapp + web.app (falta o domínio Vercel pós-deploy); `measurementId` do snippet Firebase **não** ligado (o app promete sem telemetria); **falta**: `XAI_API_KEY`, `NUTRITIONIX_APP_ID/KEY`, `VITE_FIREBASE_VAPID_KEY`, `VITE_NUTRITION_PROXY_URL` |

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
   fora, `package.json`/lock limpos; resíduos (`bg_5dbd7edc`, timeout 42min, ~90% + resto manual)
   — `renovate.json` DELETADO, comentários `mcp/README.md`/`mcp/src/state.js`/`credential.test.js`
   limpos. Greps `passkey|webauthn|RP_ID|capacitor` fora de `frontend/`+docs = **0**.
   Sweep `opengym` classificado: só atribuição AGPL + identificadores KEEP (`OPENGYM_*`,
   `opengym_plan`, salt HKDF, UA `opengym-coach/`) + menções históricas em docs.
2. ~~**Passkey residual**~~ ✅ — removido por completo (frontend + api + spec + testes −3;
   `openapi.yaml` tags `data` corrigido, `website/api.html` regenerado limpo: 0 passkey/WebAuthn).
3. ~~**Grok no frontend (BYOK local)**~~ ✅ — `grok` em `ADAPTERS` (`lib/coach-local.js`).
4. ~~**Entrada de Nutrition na UI**~~ ✅ — card/link `/nutrition` no `Home.jsx` (rota já existia).
5. ~~**Rotas `/api/pair/*`**~~ ✅ — removidas (único caller era o shell nativo); testes/docs/spec limpos.

### Deploy (requer credenciais — §5.1)
5. **Credenciais**: ~~Firebase~~ ✅ recebido (projeto `gymtask-ce4b6`, e-mail/senha ativo,
   Firestore `(default)` criado, rules no ar); **falta** xAI `XAI_API_KEY`,
   Nutritionix `NUTRITIONIX_APP_ID/KEY`, `VITE_FIREBASE_VAPID_KEY` (push).
6. **Vercel**: ~~apontar repo + envs `VITE_*`~~ ✅ parcial (2026-09-28) — projeto
   `gymtask-jtu8`, Root Directory `frontend`, build `npm run build`/`dist`, 6 `VITE_FIREBASE_*`
   em production **e** preview (CLI/API), `vercel.json` na raiz + `frontend/`.
   **Falta**: build verde pós-push, `VITE_NUTRITION_PROXY_URL` → URL da function
   `nutritionProxy` (pós-deploy das functions) e adicionar o domínio Vercel em
   Authentication → Authorized domains.
7. **Firebase**: ~~trocar placeholder no `.firebaserc`~~ ✅ (`gymtask-ce4b6`);
   ~~`firestore.rules` deploy~~ ✅ (no ar). **Falta**: `firebase deploy --only functions`
   (espera `XAI_API_KEY`/`NUTRITIONIX_*` em `functions/.env`).
8. ~~**README/docs do repo**~~ ✅ — reescritos para GymTask (Vercel/Firebase) por `bg_d2e34ae5`
   (`README.md`, `ROADMAP.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/*.md`).
9. ~~**`api/openapi.yaml`**: surface do coach**~~ ✅ — tags `coach`/`functions`, 10 rotas coach
   + `GET /coach`/`POST /nutritionProxy` com `servers:` da Cloud Functions, responses
   `CoachOff/CoachBusy/CoachDailyCap/CoachConsent/CoachQueued`, schemas
   `CoachDisclosure/CoachJob/CoachPending/CoachStatus/CoachAccount/CoachCohort`, `Error.code`,
   cookieAuth corrigido (refs mortas a `register/verify`/`login/verify` removidas), seção Coach
   no `info.description`; `/api/admin/coach*` fora de propósito (filtradas em `server.js`).
   `website/api.html` regenerado (30 endpoints, 14 schemas, 72 KB; parse OK, 27 paths).

### Credenciais (todo 15 — pedir ao usuário antes do deploy)
- ~~Firebase Console: criar projeto, ativar E-mail/senha, app Web → 6 `VITE_FIREBASE_*`~~ ✅
  (2026-09-28: projeto `gymtask-ce4b6`, e-mail/senha confirmado via API, web config em
  `frontend/.env` + service account em `data/service-account.json` — ambos gitignored — e
  espelhada nas 12 envs da Vercel; rules deployed)
- xAI: chave `XAI_API_KEY` (**paga** — ver aviso abaixo) — ⬜ pendente
- Nutritionix: `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (plano gratuito) — ⬜ pendente
- VAPID: `VITE_FIREBASE_VAPID_KEY` (Firebase Console → Cloud Messaging → Web Push certificate) — ⬜ pendente

## 6. Avisos e débitos técnicos conhecidos

- **xAI/Grok não é gratuito** (~US$2/1M in, ~US$6/1M out tokens). Alternativa gratuita:
  manter outro provider do adapter já existente ou modelo gratuito compatível.
- **Nutritionix sempre pelo proxy** (`nutritionProxy`) — chave nunca no bundle do browser.
- TOCTOU no conflict check Firestore (getDoc→setDoc) tem janela maior que o compare-and-write
  síncrono do servidor — aceito, documentado no código.
- A função `coach` em `functions/` é autocontida (duplica 3 linhas de prompt): Firebase empacota
  só `functions/` no deploy e `api/` é ESM — débito sinalizado no código.
- `pt-br-locale.test.js` faz censo de chaves (**695** overrides / **641** herdados) — qualquer
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
#  Vercel: Root Directory=frontend/, build=`npm run build`, envs VITE_* (6 prod + 6 preview) no ar
#  Functions: firebase deploy --only functions   (requer firebase.json + login)
```

## 8. Ideias futuras (melhorias)

### Nutrição
- **Scanner de código de barras nos alimentos** — o decoder web `jsqr` + renderer `lean-qr` já
  existem no projeto (`@capacitor-mlkit` saiu com a decisão PWA-only; o scan usa `BarcodeDetector`
  nativo quando existe, jsQR como fallback).
- **Sugestão automática de refeições**: distribuir calorias/macro restantes do dia nas próximas
  refeições, com pratos prontos do banco TBCA.
- **Fotos de refeição** → estimativa de macros (OCR / API de visão).
- **Receitas** com cálculo de macros por porção e adicionáveis ao log.
- **Tendências**: peso corporal × ingestão calórica × volume de treino no mesmo gráfico (Stats).

### Coach
- **Streaming das respostas** (SSE) no `CoachChat` — hoje resposta em bloco.
- **Memória de treinos**: injetar resumo das últimas N sessões + PRs no prompt automaticamente.
- **Revisão semanal automática** (o prompt `review.md` já existe) disparada por scheduled function.
- **Plano alimentar pelo Coach**: gerar/dieta ajustada ao TDEE registrado.

### Treino/experiência
- **Deload automático** e periodização mais rica no motor de progressão.
- **Widgets** (Android/iOS) do treino do dia.
- **Integração Google Fit / Apple Health** de escrita (hoje só import).
- **Modo social**: compartilhar prints de evolução / PRs (share via Web Share API — o share Capacitor do upstream saiu com o PWA-only).
- **Vídeo/looping dos exercícios** (dataset CDN já parametrizado por `VITE_IMG_BASE/VITE_GIF_BASE`).

### Infra
- **Firestore real-time** (`onSnapshot`) para sync instantâneo entre dispositivos (hoje pull/push).
- **Multi-perfil familiar** no mesmo Firebase project.
- **CI**: GitHub Actions rodando `npm test` + `npm run build` no push (o upstream usava GitLab CI).
- **Backup/export**: dump completo do Firestore para JSON (portabilidade — espírito "you own your data").

---

*Última atualização: 2026-09-28 — **checkpoint**. ✅ Nesta rodada: **§5.9 openapi surface do
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
troubleshooting dos 2 erros). 🔴 **Falta**: 1) push + confirmar build verde na Vercel;
2) `VITE_NUTRITION_PROXY_URL` + `firebase deploy --only functions` (espera `XAI_API_KEY`/
`NUTRITIONIX_*`); 3) domínio Vercel em Firebase → Authorized domains; 4) no outro PC, refazer
`frontend/.env` (gitignored — não vai no push). Firebase `gymtask-ce4b6` ao vivo (rules deployed,
e-mail/senha ativo); `data/*` staged gitignored. Itens 2/4 do checkpoint anterior (capa §5.9 e
fingerprint "sumido") resolvidos — o script sempre esteve em `frontend/scripts/`.*
