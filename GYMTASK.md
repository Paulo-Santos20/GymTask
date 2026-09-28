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
shell Capacitor (Android/iOS), MCP server, PWA instalável.

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
- i18n: 42 keys em `pt.js` + `PT_BR_OVERRIDES` (censo 668→**710**, inherited 657, fingerprint intacto)

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
| ⑤ | Rebrand + strip (admin/convites/idiomas) | 🟡 ~95% (agente **cancelado** a pedido do usuário na fase final) | ✅ 12 locales, `instr/*`, `Admin.jsx`, `audit.js`, testes admin, README, `App.jsx`, `server.js`, manifest/sw, mobile strings, docker-compose. ⚠️ **Restam**: `website/` (60+ refs), `mcp/`, `.env.example` seção admin, `scripts/fetch-media.sh`, sweep final de verificação |
| — | Build + testes centrais | ✅ **verde** | `npm run build` exit 0; `npm test` **1584/1584** (126 arquivos), 00:38 |
| — | Deploy Vercel/PWA | 🟡 configs prontas | `vercel.json` + `docs/DEPLOY_VERCEL.md` criados; deploy real = credenciais |
| — | Firebase deploy config | 🟡 configs prontas | `firebase.json` (nodejs22), `.firebaserc` (placeholder `GYTASK-PROJECT-ID-TBD`), `firestore.rules` |
| — | FCM push | ✅ código pronto | `pushDailyReminder` FCM topic `gytask-daily` + `functions/README.md` |
| — | Credenciais reais | ⬜ pendente | Firebase/xAI/Nutritionix a fornecer pelo usuário |

## 5. O que falta ser feito (checklist)

### Imediato (amanhã — retomar daqui)
1. **Fechar o rebrand (~5% restante)**: `website/` (60+ refs de marca), `mcp/` (README/descrições
   de tools — decisão: identificadores de env `OPENGYM_*` mantidos), `.env.example` (seção morta
   `ADMIN_UIDS`/`INVITE_ONLY` + prosa de admin), `scripts/fetch-media.sh`, varredura final
   `grep -ri opengym` classificando comentário vs user-facing. O agente foi cancelado no sweep
   final; relatório não entregue — refazer sweep manual.
2. **Passkey residual** — remover restos: exports `webauthnOK`/`passkeyRegister`/`passkeyLogin`/
   `BIO`/`VAULT` em `api.js`, referências em `Settings.jsx`/`demo.js`, rotas em `api/server.js`,
   chaves de locale (`'Sign in with passkey'`) e testes associados.
3. **Grok no frontend (BYOK local)**: registrar adapter em `coach-local.js`
   (`ADAPTERS` hoje = anthropic/openai/gemini/compatible — escolher Grok falha com aviso gracioso).
4. **Entrada de Nutrition na UI** — hoje a rota `/nutrition` existe mas não há link no TabBar/Home
   (TabBar tem 5 itens; decidir acesso: card Home, substituir item, ou menu Settings).

### Deploy (requer credenciais — §5.1)
5. **Credenciais**: Firebase Console (projeto, E-mail/senha, app Web → 6 `VITE_FIREBASE_*`),
   xAI `XAI_API_KEY`, Nutritionix `NUTRITIONIX_APP_ID/KEY`.
6. **Vercel**: apontar repo com root `frontend/`, build `npm run build`, envs `VITE_*` +
   `VITE_NUTRITION_PROXY_URL` → URL da function `nutritionProxy`.
7. **Firebase**: trocar `GYMT-PROJECT-ID-TBD` no `.firebaserc`, `firebase deploy --only functions,firestore:rules`.
8. **README/docs do repo**: `README.md`, `ROADMAP.md`, `CLAUDE.md`, `docs/*` ainda descrevem
   openGym/Docker/GitLab — reescrever para GymTask (Vercel/Firebase) ou arquivar.
9. **`api/openapi.yaml`**: surface do coach inteira ausente da spec (documentar coach + URLs das functions).

### Credenciais (todo 15 — pedir ao usuário antes do deploy)
- Firebase Console: criar projeto, ativar E-mail/senha, app Web → 6 `VITE_FIREBASE_*`
- xAI: chave `XAI_API_KEY` (**paga** — ver aviso abaixo)
- Nutritionix: `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (plano gratuito)

## 6. Avisos e débitos técnicos conhecidos

- **xAI/Grok não é gratuito** (~US$2/1M in, ~US$6/1M out tokens). Alternativa gratuita:
  manter outro provider do adapter já existente ou modelo gratuito compatível.
- **Nutritionix sempre pelo proxy** (`nutritionProxy`) — chave nunca no bundle do browser.
- TOCTOU no conflict check Firestore (getDoc→setDoc) tem janela maior que o compare-and-write
  síncrono do servidor — aceito, documentado no código.
- A função `coach` em `functions/` é autocontida (duplica 3 linhas de prompt): Firebase empacota
  só `functions/` no deploy e `api/` é ESM — débito sinalizado no código.
- `pt-br-locale.test.js` faz censo de chaves (**710** overrides / 657 herdados) — qualquer agente
  que adicione/remova chaves deve recomputar; fingerprint `scripts/pt-br-inheritance-fingerprint.mjs`
  é o guardião (bump atual: 668→710, hash inalterado pois as 42 keys novas são overrides).
- Testes apagados pelo strip: `e2e-apikey.test.js`, `server-admin-delete.test.js`,
  `server-admin-state.test.js` (+ `Admin*.test.js`, `audit.test.js`) — comportamento removido
  junto, handlers órfãos em `server.js` devem ser flagrados/limpos pelo agente de rebrand.
- Strings em inglês fora do pacote de locale (`'Live demo…'`, `'Start the demo'`) — pré-existentes.

## 7. Comandos

```bash
# Frontend (dev) — proxy de /api para :3000
cd frontend && npm install && npm run dev

# Testes / build (validação central — rodar após todos os agentes terminarem)
cd frontend && npm test && npm run build

# Cloud Functions (local)
cd functions && npm install

# Deploy
#  Vercel: apontar root=frontend/, build=`npm run build`, envs VITE_* configuradas
#  Functions: firebase deploy --only functions   (requer firebase.json + login)
```

## 8. Ideias futuras (melhorias)

### Nutrição
- **Scanner de código de barras** nos alimentos — os deps já existem
  (`@capacitor-mlkit/barcode-scanning` + `jsqr`) e hoje só são usados pelo importador de treinos.
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
- **Modo social**: compartilhar prints de evolução / PRs (upstream já tem share via Capacitor).
- **Vídeo/looping dos exercícios** (dataset CDN já parametrizado por `VITE_IMG_BASE/VITE_GIF_BASE`).

### Infra
- **Firestore real-time** (`onSnapshot`) para sync instantâneo entre dispositivos (hoje pull/push).
- **Multi-perfil familiar** no mesmo Firebase project.
- **CI**: GitHub Actions rodando `npm test` + `npm run build` no push (o upstream usava GitLab CI).
- **Backup/export**: dump completo do Firestore para JSON (portabilidade — espírito "you own your data").

---

*Última atualização: 2026-09-29 — 4 de 5 frentes concluídas (Auth, Firestore, Grok/Functions,
Nutrition); rebrand ~95% (cancelado no sweep final, ver §5.1); **build exit 0 + 1584/1584 testes
verdes**; configs Vercel/Firebase prontas; deploy aguarda credenciais.*
