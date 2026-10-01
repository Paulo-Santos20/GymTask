# CI + Auditoria pós-cf81bc5 (exceto GitHub Pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Destravar a CI quebrada desde `1645e9e`, fechar o npm audit, traduzir as últimas 33 strings de fonte, atualizar codemaps e corrigir a documentação desatualizada — tudo exceto GitHub Pages.

**Architecture:** Dois bugs independentes derrubam a CI hoje: o `api/package-lock.json` foi truncado (314 linhas em vez de ~1731, árvore opcional do claude-agent-sdk ausente) e o `api/Dockerfile` ainda copia `verify-error.js`, apagado no mesmo commit. As correções são cirúrgicas: regenerar o lock com npm 10 (o que o CI usa), remover a linha órfã do COPY, aplicar `npm audit fix` em cada workspace, e fechar o backlog de i18n adicionando as 33 keys a `pt.js` + `PT_BR_OVERRIDES` (herdados ficam 641 → fingerprint inalterado), depois travar o CI com `--strict`.

**Tech Stack:** Node 22 / npm 10 no CI (npm 11 local), vitest (frontend/mcp), `node --test` (api), Docker builds no job `api-image`, Vercel (hosting de produção), GitHub Actions (`.github/workflows/test.yml`).

**Spec:** `GYMTASK.md` (spec do projeto) + achados da auditoria de 2026-10-01, materializados em Context abaixo.

## Context (evidência dos achados)

- **CI vermelha desde `1645e9e` (28/09)** — dois bugs:
  1. `api/package-lock.json` tem 314 linhas (deveria ter ~1731). `npx -y npm@10 ci --omit=optional` falha hoje com `Missing: isexe@2.0.0 from lock file`. Regenerado com `npx -y npm@10 install --package-lock-only` em diretório temp → 1731 linhas → `npm@10 ci` exit 0 em ambas as flags do CI.
  2. `api/verify-error.js` foi deletado em `1645e9e`, mas `api/Dockerfile:54` ainda faz `COPY server.js push-messages.js verify-error.js ./` → job `api-image` falha no `docker build --target default` mesmo com lock válido. Prova: o PR7 da dependabot (lock regenerado pelo bot, `npm@10 ci` exit 0) passa o job `api` e falha só `api-image`; `git grep verify-error -- api` acha apenas o Dockerfile.
- **npm audit:** api = 1 high (`undici` 7.29.0; fix em 7.30.0, dentro de `^7.29.0`); raiz = high (`js-yaml` ^4.1.0, usado por `scripts/build-api-docs.mjs`); mcp = 1 high + 3 moderate (`fast-uri`, `hono`, `ip-address`, `qs` — todos `fix: true`); frontend = 4 highs da família `firebase`/`@firebase/firestore`/`@grpc/grpc-js` (fix npm exige downgrade breaking para firebase@9.14.0 → **não aplicar**; aceitar e documentar) + parte não-breaking corrigível.
- **i18n:** 33 strings definidas em nenhum pack (`node scripts/check-source-strings.mjs` reporta): 19 em `src/lib/coach-demo.js`, 9 em `src/views/Settings.jsx`, 3 em `src/views/Login.jsx`, 1 em `src/lib/plan-share.js`, 1 em `src/lib/i18n-core.js`. Padrão do projeto (`cf81bc5`): keys novas entram em **ambos** `pt.js` (base pt-PT) e `PT_BR_OVERRIDES` (pt-BR) → herdados permanecem 641 → fingerprint `4f9c1cf24a394a45ac8e14d412a97f0462e9ef4c6a9ae348a27203511aea84f3` não muda; só a constante `toHaveLength(702)` vira 735.
- **Docs desatualizados:** `GYMTASK.md` (linha 134 com contagens antigas 1531/1336/58/695; pendência de redeploy já resolvida; "6 prod + 6 preview"; checkpoint de 29/09), `ROADMAP.md` (contagens de env; bullet de CI listado como futuro embora exista), `README.md` (bullet "Coach com IA (Grok)" sem Groq; tabela de envs sem `VITE_IMG_BASE`/`VITE_GIF_BASE`), `docs/AI_COACH.md` (nota "phone app", tabela de providers sem Groq, lista de providers da seção "On the phone" sem Grok/Groq).
- **Codemaps:** `frontend/src/lib/codemap.md` não cita `plates.js`, `speed.js`, `workout-date.js`, `session-routines.js` (nem a contagem atual de módulos); `frontend/src/locales/codemap.md` com "~1300 entries"/"~699 overrides" e referência de linha velha.

## Global Constraints

- **GitHub Pages fora de escopo:** `.github/workflows/pages.yml` não é tocado (produção = Vercel `gymtask-jtu8`).
- **Credenciais fora de escopo** (bloqueadas no usuário): Nutritionix, `VITE_FIREBASE_VAPID_KEY`, Authorized domain, rotação de `service-account.json` + Groq keys, `VITE_NUTRITION_PROXY_URL`.
- **Baseline api invariante:** `160 pass / 18 fail` via `npm test` (= `node --test test/*.test.js`, o glob que o CI roda). `node --test` puro (descoberta recursiva) também encontra `api/push-messages.test.js` (fora de `test/`) e dá `163/18` — os dois números são corretos para a sua invocação; todo `Expected` deste plano usa o comando escrito ao lado. 18 falhas CRLF pré-existentes em `prompts.test.js` + `routes.test.js:70` — não corrigir, não recontar.
- **Fingerprint pt-BR invariante:** `4f9c1cf24a394a45ac8e14d412a97f0462e9ef4c6a9ae348a27203511aea84f3`; `inherited` = 641; `PT_BR_OVERRIDES` 702 → 735.
- **Toda mutação de lockfile/package com npm 10:** `npx -y npm@10 <cmd>` — o CI roda npm 10 (node 22) e npm 11 é justamente o que gerou o lock incompleto.
- **PowerShell 5.1:** sem `&&` — encadear com `; if ($?) { ... }` ou `;` simples. Sem `gh`, `docker`, `rg` instalados.
- **Nenhuma dependência nova** — apenas updates dentro dos ranges já declarados (audit fix).
- **Contagens finais esperadas** (usadas pelos docs da Task 6): frontend `1747/1747 (126 arq)`, `check-locales` `1376/1376`, `check-source-strings --strict` 0 pendências, mcp `63/63`, api `160/18` (`npm test`), census `735/641`, envs Vercel `8 production + 6 preview`.
- **Push único ao final** (após a Task 6), na branch `main` de `origin`. Nenhum commit fora das Tasks.

## File Structure

| Arquivo | Ação | Task |
| --- | --- | --- |
| `api/package-lock.json` | regenerar (npm 10) + audit fix | 1, 3 |
| `api/Dockerfile:54` | remover `verify-error.js` do COPY | 2 |
| `mcp/package-lock.json`, `package-lock.json` (raiz), `frontend/package-lock.json` | audit fix | 3 |
| `frontend/src/locales/pt.js` | +33 entradas (pt-PT) | 4 |
| `frontend/src/locales/pt-BR.js` | +33 entradas em `PT_BR_OVERRIDES` (pt-BR) | 4 |
| `frontend/src/lib/pt-br-locale.test.js:29` | `702` → `735` | 4 |
| `.github/workflows/test.yml` | `check-source-strings --strict` | 4 |
| `frontend/src/lib/codemap.md` | +4 módulos, contagens | 5 |
| `frontend/src/locales/codemap.md` | contagens/linha | 5 |
| `GYMTASK.md`, `ROADMAP.md`, `README.md`, `docs/AI_COACH.md` | atualizar números/provedores/checkpoint | 6 |
| `frontend/.env` (gitignored) | `VITE_IMG_BASE`/`VITE_GIF_BASE` locais | 7 |

---

### Task 1: Regenerar `api/package-lock.json` com npm 10 (job `api` do CI)

**Files:**
- Modify: `api/package-lock.json` (regenerado por comando — nenhuma edição manual)

**Interfaces:**
- Consumes: nada anterior.
- Produces: lock compatível com `npm@10 ci` nas duas variações de flag do CI; a Task 3 re-muta este lock (audit fix) e a Task 7 re-verifica.

- [ ] **Step 1: Reproduzir a falha (vermelho inicial)**

Run (workdir `api/`): `npx -y npm@10 ci --omit=optional`
Expected: FAIL com `Missing: isexe@2.0.0 from lock file` (prova de que este é o lock que derruba o job `api`).

- [ ] **Step 2: Regenerar o lock com npm 10**

Run (workdir `api/`): `npx -y npm@10 install --package-lock-only`
Expected: exit 0; `Get-Content package-lock.json | Measure-Object -Line` → ~1731 linhas (antes: 314).

- [ ] **Step 3: Verificar a variação de flags do job `api-image` (docker)**

Run (workdir `api/`): `npx -y npm@10 ci --omit=dev --omit=optional`
Expected: exit 0.

- [ ] **Step 4: Verificar a variação de flags do job `api` (CI)**

Run (workdir `api/`): `npx -y npm@10 ci --omit=optional`
Expected: exit 0 (deixa o node_modules no estado exato do CI).

- [ ] **Step 5: Rodar os testes da api**

Run (workdir `api/`): `npm test`
Expected: `160 pass / 18 fail` — exatamente o baseline via `npm test` (as 18 falhas CRLF pré-existentes; `node --test` puro daria 163/18 por `push-messages.test.js`).

- [ ] **Step 6: Rodar os meta-steps que o job `api` roda após os testes**

Run (raiz do repo): `node scripts/build-coach-assets.mjs --check`
Expected: exit 0.
Run (raiz do repo): `node api/scripts/check-core-loadable.mjs`
Expected: exit 0.

- [ ] **Step 7: Commit**

```powershell
git add api/package-lock.json
git commit -m "fix(api): regenerate package-lock.json with npm 10 (CI npm ci broken since 1645e9e)"
```

---

### Task 2: Remover `verify-error.js` órfão do COPY do Dockerfile (job `api-image`)

**Files:**
- Modify: `api/Dockerfile:54`

**Interfaces:**
- Consumes: nada anterior.
- Produces: build da imagem sem cópia de arquivo inexistente; verificação real só no CI (Task 7) — aqui vale a prova por inspeção.

- [ ] **Step 1: Confirmar a evidência (vermelho inicial por inspeção)**

Run: `git log --oneline --diff-filter=D -1 -- api/verify-error.js` → `1645e9e`.
Run: `Test-Path api\verify-error.js` → `False`.
Run: `git grep -n verify-error -- api` → única ocorrência em `api/Dockerfile`.
Run: `git grep -n "require(.*verify-error\|import .*verify-error" -- api` → vazio (nenhuma referência em runtime).

- [ ] **Step 2: Editar o Dockerfile**

Na linha 54 de `api/Dockerfile`, trocar:

```dockerfile
COPY server.js push-messages.js verify-error.js ./
```

por:

```dockerfile
COPY server.js push-messages.js ./
```

- [ ] **Step 3: Verificar**

Run: `git grep -n verify-error -- api` → vazio.
Run: `Test-Path api\server.js` → `True`; `Test-Path api\push-messages.js` → `True` (todas as fontes do COPY existem).
Run: `node --check api/server.js` → exit 0.

- [ ] **Step 4: Commit**

```powershell
git add api/Dockerfile
git commit -m "fix(api): stop copying deleted verify-error.js in Dockerfile (api-image job)"
```

---

### Task 3: `npm audit fix` nos quatro workspaces

**Files:**
- Modify: `api/package-lock.json`, `mcp/package-lock.json`, `package-lock.json` (raiz), `frontend/package-lock.json` (só locks; `package.json` só muda no fallback de undici)

**Interfaces:**
- Consumes: Task 1 (lock api já válido para npm 10).
- Produce: audit limpo (ou residual documentado) — a Task 6 escreve os números no GYMTASK; a Task 7 re-rodamos os gates.

- [ ] **Step 1: api — fechar o high do undici**

Run (workdir `api/`): `npx -y npm@10 audit fix`
Run (workdir `api/`): `npm ls undici` → esperado `undici@7.30.0` (ou ≥ `7.29.1`).
Run (workdir `api/`): `npm audit` → esperado `found 0 vulnerabilities`.
Fallback se ainda restar o high: `npx -y npm@10 install undici@7.30.0` (aceita bump de `^7.29.0` → `^7.30.0` no manifest) e repetir `npm audit`.

- [ ] **Step 2: api — re-verificar tudo (o lock mudou de novo)**

Run (workdir `api/`): `npx -y npm@10 ci --omit=dev --omit=optional` → exit 0.
Run (workdir `api/`): `npx -y npm@10 ci --omit=optional` → exit 0.
Run (workdir `api/`): `npm test` → `160 pass / 18 fail` (baseline).
Run (raiz): `node scripts/build-coach-assets.mjs --check` → exit 0; `node api/scripts/check-core-loadable.mjs` → exit 0.

- [ ] **Step 3: raiz — fechar o high do js-yaml**

Run (raiz): `npx -y npm@10 audit fix`
Run (raiz): `npm audit` → esperado `found 0 vulnerabilities` (js-yaml atualizado dentro de `^4.1.0`).

- [ ] **Step 4: mcp — fechar 1 high + 3 moderate**

Run (workdir `mcp/`): `npx -y npm@10 audit fix`
Run (workdir `mcp/`): `npm audit` → esperado `found 0 vulnerabilities` (`fast-uri`, `hono`, `ip-address`, `qs` — todos `fix: true`, sem breaking).
Run (workdir `mcp/`): `npx -y npm@10 ci` → exit 0.
Run (workdir `mcp/`): `npm test` → `63 pass`.
Run (workdir `mcp/`): `npm run check:node-loadable` → exit 0.

- [ ] **Step 5: frontend — parte não-breaking + documentar residual**

Run (workdir `frontend/`): `npx -y npm@10 audit fix` (nunca `--force`).
Run (workdir `frontend/`): `npm audit --omit=dev` → gravar o residual.
Esperado residual: os 4 highs da família `firebase`/`@firebase/firestore`/`@grpc/grpc-js` (corrigir exige downgrade breaking para `firebase@9.14.0` — recusado; `firebase@^12.19.0` é o que o app usa). Se o residual for outro, registrar o número real para a Task 6.
Run (workdir `frontend/`): `npx -y npm@10 ci` → exit 0.
Run (workdir `frontend/`): `npm test` → `1747/1747 (126 arquivos)`.
Run (workdir `frontend/`): `npm run build` → exit 0.

- [ ] **Step 6: Revisar o diff e commitar**

Run: `git status` → apenas os arquivos planejados (`*/package-lock.json`, e `api/package.json` somente no fallback de undici). Se algum `package.json` mudou sem ser o fallback, inspecionar antes de seguir.

```powershell
git add package-lock.json api/package-lock.json mcp/package-lock.json frontend/package-lock.json
git commit -m "chore(deps): npm audit fix in api/root/mcp/frontend (undici 7.30.0, js-yaml, fast-uri/hono/ip-address/qs; firebase highs accepted)"
```

---

### Task 4: Traduzir as 33 strings de fonte e travar o CI com `--strict`

**Files:**
- Modify: `frontend/src/locales/pt.js` (inserir 33 entradas pt-PT antes do `}` final)
- Modify: `frontend/src/locales/pt-BR.js` (inserir 33 entradas pt-BR em `PT_BR_OVERRIDES` antes do `}` final)
- Modify: `frontend/src/lib/pt-br-locale.test.js:29` (`toHaveLength(702)` → `toHaveLength(735)`)
- Modify: `.github/workflows/test.yml` (comentário + `--strict`)

**Interfaces:**
- Consumes: nada anterior.
- Produces: `check-locales` = 1376 keys; overrides 735 / herdados 641 / fingerprint inalterado; CI falha para qualquer string nova sem locale. As Tasks 5 e 6 citam esses números.

- [ ] **Step 1: Baseline (vermelho inicial)**

Run (workdir `frontend/`): `node scripts/check-source-strings.mjs`
Expected: reporta `33 defined in no locale pack`, exit 0 (report-only).

- [ ] **Step 2: Ler as âncoras dos arquivos de locale**

Read o final de `frontend/src/locales/pt.js` (última entrada é `'No weight logged last time - enter what you lift and progression takes it from there.': 'Nenhum peso registado ...'`, depois linha em branco e `}`) e o final de `frontend/src/locales/pt-BR.js` (mesma chave com valor pt-BR, `}` na linha 738, `export default` na 740).

- [ ] **Step 3: Inserir as 33 entradas pt-PT em `pt.js`**

Após a última entrada (antes do `}` final), acrescentar o bloco — a lista é exatamente as 33 keys que o Step 1 reportou, em ordem alfabética de key:

```js
  'A pull for every press, so the shoulders stay balanced.': 'Uma puxada para cada empurrada, para os ombros ficarem equilibrados.',
  'A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.': 'Uma rotação de dois dias com três sessões por semana, montada à volta do equipamento que listaste. Compoundes primeiro, uma puxada para cada empurrada, e sobreposição suficiente entre os dias para que nada fique duas semanas sem ser treinado.',
  'Based on the training already in this demo profile.': 'Baseado no treino já registado neste perfil de demonstração.',
  'Body weight has been flat for four weeks while the goal is to gain. That is a kitchen problem rather than a training one — the plan is not what is holding it back.': 'O peso corporal está estagnado há quatro semanas mesmo com o objetivo de ganhar. Isso é um problema de cozinha e não de treino — o plano não é o que está a segurar isso.',
  'Demo': 'Demo',
  'Demo data reset': 'Dados da demo redefinidos',
  'Direct arm work, since you asked for it.': 'Treino direto de braços, já que pediste.',
  'Every top set on this one came in at RPE 9.5 or above for three sessions and the weight has not moved. Swapping the movement for four weeks usually breaks that stall faster than grinding the same one.': 'Toda a série pesada neste exercício saiu em RPE 9,5 ou acima durante três sessões e o peso não se mexeu. Trocar o movimento durante quatro semanas costuma quebrar essa estagnação mais rápido do que insistir no mesmo.',
  'Example data, stored only in this browser — change anything you like.': 'Dados de exemplo, guardados apenas neste navegador — muda o que quiseres.',
  'Full body A': 'Full body A',
  'Full body B': 'Full body B',
  'Horizontal pressing, the other half of the session.': 'Empurrada horizontal, a outra metade da sessão.',
  'Live demo — everything stays in this browser.': 'Demo ao vivo — tudo fica neste navegador.',
  'No training history yet — starting conservatively.': 'Ainda sem histórico de treino — a começar de forma conservadora.',
  'Puts the example plan, workouts and weigh-ins back the way they started.': 'Coloca o plano de exemplo, treinos e pesagens de volta ao início.',
  'Reset': 'Redefinir',
  'Reset demo data': 'Redefinir dados da demo',
  'Reset demo data?': 'Redefinir dados da demo?',
  'Revised as you asked. Everything you did not question is exactly as it was.': 'Revisado como pediste. Tudo o que não questionaste ficou exatamente como estava.',
  'Same pattern, higher reps than day A.': 'Mesmo padrão, repetições mais altas que no dia A.',
  'Self-host GymTask': 'Hospedar o teu próprio GymTask',
  'Self-host it in a minute →': 'Hospede você mesmo em um minuto →',
  'Sessions have been running about fifteen minutes over. This is the accessory with the least to lose from one set fewer.': 'As sessões estão a ficar cerca de quinze minutos acima do previsto. Este é o acessório que menos perde com uma série a menos.',
  'Start the demo': 'Começar a demo',
  'The main lower-body driver — where most of the strength comes from.': 'O principal motor do corpo inferior — de onde vem a maior parte da força.',
  'The same patterns, different variations — enough overlap to progress, enough difference to stay fresh.': 'Os mesmos padrões, variações diferentes — sobreposição suficiente para progredir, diferença suficiente para não saturar.',
  'The two big lower-body and pressing patterns first, while you are fresh.': 'Os dois grandes padrões de corpo inferior e empurrada primeiro, enquanto estás descansado.',
  'Three things worth changing, and one worth knowing about. Everything else is working — the squat and the pulls are both progressing on schedule.': 'Três coisas que valem a pena mudar, e uma que vale saber. O resto está a funcionar — o agachamento e as puxadas estão a progredir conforme o programa.',
  'Vertical pressing.': 'Empurrada vertical.',
  'You have moved this session to Saturday three weeks running. Better the plan says so than that you keep overriding it.': 'Adiaste esta sessão para sábado três semanas seguidas. Melhor o plano dizer isso do que continuares a mudar a data.',
  'You’re in the demo': 'Estás na demo',
  'this isn’t a GymTask plan file': 'isto não é um ficheiro de plano do GymTask',
  '…': '…',
```

(33 entradas; as keys com `’`/`—`/`→`/`…` devem ser copiadas byte a byte — o script do Step 5 falha se divergirem.)

- [ ] **Step 4: Inserir as 33 entradas pt-BR em `PT_BR_OVERRIDES` (mesmas keys, valores pt-BR)**

Após a última entrada de `frontend/src/locales/pt-BR.js` (antes do `}` da linha ~738), acrescentar:

```js
  'A pull for every press, so the shoulders stay balanced.': 'Uma puxada para cada empurrada, para os ombros ficarem equilibrados.',
  'A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.': 'Uma rotação de dois dias com três sessões por semana, montada em torno do equipamento que você listou. Compoundes primeiro, uma puxada para cada empurrada, e sobreposição suficiente entre os dias para que nada fique duas semanas sem ser treinado.',
  'Based on the training already in this demo profile.': 'Baseado no treino já registrado neste perfil de demonstração.',
  'Body weight has been flat for four weeks while the goal is to gain. That is a kitchen problem rather than a training one — the plan is not what is holding it back.': 'O peso corporal está parado há quatro semanas mesmo com a meta de ganhar. Isso é um problema de cozinha e não de treino — o plano não é o que está segurando isso.',
  'Demo': 'Demo',
  'Demo data reset': 'Dados da demo redefinidos',
  'Direct arm work, since you asked for it.': 'Treino direto de braços, já que você pediu.',
  'Every top set on this one came in at RPE 9.5 or above for three sessions and the weight has not moved. Swapping the movement for four weeks usually breaks that stall faster than grinding the same one.': 'Toda série pesada neste exercício saiu em RPE 9,5 ou acima por três sessões e o peso não se mexeu. Trocar o movimento por quatro semanas costuma quebrar essa estagnação mais rápido do que insistir no mesmo.',
  'Example data, stored only in this browser — change anything you like.': 'Dados de exemplo, salvos apenas neste navegador — mude o que quiser.',
  'Full body A': 'Full body A',
  'Full body B': 'Full body B',
  'Horizontal pressing, the other half of the session.': 'Empurrada horizontal, a outra metade da sessão.',
  'Live demo — everything stays in this browser.': 'Demo ao vivo — tudo fica neste navegador.',
  'No training history yet — starting conservatively.': 'Ainda sem histórico de treino — começando de forma conservadora.',
  'Puts the example plan, workouts and weigh-ins back the way they started.': 'Coloca o plano de exemplo, treinos e pesagens de volta ao início.',
  'Reset': 'Redefinir',
  'Reset demo data': 'Redefinir dados da demo',
  'Reset demo data?': 'Redefinir dados da demo?',
  'Revised as you asked. Everything you did not question is exactly as it was.': 'Revisado como você pediu. Tudo o que você não questionou ficou exatamente como estava.',
  'Same pattern, higher reps than day A.': 'Mesmo padrão, repetições mais altas que no dia A.',
  'Self-host GymTask': 'Hospedar seu próprio GymTask',
  'Self-host it in a minute →': 'Hospede você mesmo em um minuto →',
  'Sessions have been running about fifteen minutes over. This is the accessory with the least to lose from one set fewer.': 'As sessões estão ficando cerca de quinze minutos acima do previsto. Este é o acessório que menos perde com uma série a menos.',
  'Start the demo': 'Começar a demo',
  'The main lower-body driver — where most of the strength comes from.': 'O principal motor do corpo inferior — de onde vem a maior parte da força.',
  'The same patterns, different variations — enough overlap to progress, enough difference to stay fresh.': 'Os mesmos padrões, variações diferentes — sobreposição suficiente para progredir, diferença suficiente para não saturar.',
  'The two big lower-body and pressing patterns first, while you are fresh.': 'Os dois grandes padrões de corpo inferior e empurrada primeiro, enquanto você está descansado.',
  'Three things worth changing, and one worth knowing about. Everything else is working — the squat and the pulls are both progressing on schedule.': 'Três coisas que valem a pena mudar, e uma que vale saber. O resto está funcionando — o agachamento e as puxadas estão progredindo conforme o programa.',
  'Vertical pressing.': 'Empurrada vertical.',
  'You have moved this session to Saturday three weeks running. Better the plan says so than that you keep overriding it.': 'Você adiou esta sessão para sábado três semanas seguidas. Melhor o plano dizer isso do que você continuar mudando a data.',
  'You’re in the demo': 'Você está na demo',
  'this isn’t a GymTask plan file': 'isto não é um arquivo de plano do GymTask',
  '…': '…',
```

Os valores pt-BR foram revisados contra a denylist do teste de leak de português europeu (`ficheiro`, `telemóvel`, `ecrã`, `definições`, `regist+o|am|ado…`, `eliminad…`, `guardados` só no pt-PT etc.) — não contêm termos proibidos.

- [ ] **Step 5: Atualizar a constante de contagem no teste**

Edit `frontend/src/lib/pt-br-locale.test.js:29`:

```js
expect(Object.keys(PT_BR_OVERRIDES)).toHaveLength(735)
```

(`toHaveLength(641)` de herdados e o hash da linha seguinte **não** mudam — as 33 keys entram em ambos os packs, então herdados continuam 641.)

- [ ] **Step 6: Verificar o report limpo**

Run (workdir `frontend/`): `node scripts/check-source-strings.mjs`
Expected: nenhuma key listada (0 defined in no locale pack), exit 0.

- [ ] **Step 7: Verificar em modo estrito**

Run (workdir `frontend/`): `node scripts/check-source-strings.mjs --strict`
Expected: exit 0 (o flag existe: `scripts/check-source-strings.mjs:21` lê `--strict`, linha 69 faz `process.exit(strict ? 1 : 0)`).

- [ ] **Step 8: Verificar chaves em sincope**

Run (workdir `frontend/`): `node scripts/check-locales.mjs`
Expected: exit 0, `1376 keys in sync` (1343 + 33).

- [ ] **Step 9: Verificar fingerprint/census**

Run (workdir `frontend/`): `node scripts/pt-br-inheritance-fingerprint.mjs`
Expected: `overrides 735`, `inherited 641`, fingerprint `4f9c1cf24a394a45ac8e14d412a97f0462e9ef4c6a9ae348a27203511aea84f3` (idêntico ao atual).

- [ ] **Step 10: Rodar a suíte completa do frontend**

Run (workdir `frontend/`): `npm test`
Expected: `1747/1747 (126 arquivos)`, incluindo `pt-br-locale.test.js` 4/4.
Contingência: se algum teste renderizar as strings inglesas com o pack carregado, trocar a expectativa para o valor pt-BR. Os quatro arquivos que citam `'Full body A'` (`lib/coach.test.js`, `lib/starter.test.js`, `views/CoachChat.test.jsx`, `views/sheets.starter.test.jsx`) usam a string como fixture direta (sem `t()`), então devem passar sem alteração — `Full body A`/`B` mantêm valor idêntico ao key de propósito (nome de rotina, empréstimo consagrado).

- [ ] **Step 11: Travar o CI com `--strict`**

Edit `.github/workflows/test.yml` — trocar o bloco:

```yaml
      # invisible to it. This walks src/ instead. Report-only for now: there is a known
      # backlog of untranslated demo-view strings to clear before it can fail the build.
      - run: node scripts/check-source-strings.mjs
```

por:

```yaml
      # invisible to it. This walks src/ instead. Strict since 2026-10-01: the demo-view
      # backlog was translated, so any new untranslated source string fails the build.
      - run: node scripts/check-source-strings.mjs --strict
```

- [ ] **Step 12: Commit**

```powershell
git add frontend/src/locales/pt.js frontend/src/locales/pt-BR.js frontend/src/lib/pt-br-locale.test.js .github/workflows/test.yml
git commit -m "i18n: translate the 33 remaining source strings and enforce --strict in CI"
```

---

### Task 5: Codemaps — 4 módulos novos + contagens de locale

**Files:**
- Modify: `frontend/src/lib/codemap.md` (linha 5, bullet "Session lifecycle", bullet "UI plumbing", linha 63)
- Modify: `frontend/src/locales/codemap.md` (linhas 8, 12, 13)

**Interfaces:**
- Consumes: Task 4 (linhas do `pt-BR.js` deslocaram +33; contagens 1376/735).
- Produce: codemaps fiéis; a Task 6 não depende deles, mas cita as mesmas contagens.

- [ ] **Step 1: Recontar módulos e testes do `lib/`**

Run: `(Get-ChildItem frontend\src\lib\*.js | Where-Object { $_.Name -notlike '*.test.*' }).Count`
Run: `(Get-ChildItem frontend\src\lib\*.test.*).Count`
Expected: 69 módulos e o total de testes atual (eram 65 e 72 antes dos 4 arquivos novos do `cf81bc5`).

- [ ] **Step 2: Atualizar as contagens em `frontend/src/lib/codemap.md`**

- Linha 5: `Domain layer: 65 plain .js modules` → o número apurado no Step 1 (esperado 69).
- Linha 63: `(...) — 72 of them, npm test in frontend/` → o número de testes apurado no Step 1 (se os 4 módulos novos tiverem teste junto, esperado 76; se manter, deixar 72).

- [ ] **Step 3: Inserir os 4 módulos no bullet "Session lifecycle"**

Edit — trocar:

```markdown
- **Session lifecycle:** `session-start.buildSessionEntries`, `session-merge`, `backfill`,
  `finish-workout.buildCompletedWorkout`, plus `active-workout-order`, `active-exercise-swap`,
  `workout-controls`, `rep-range`, `effort` (RIR summary/histogram), `bar` (`plateSplit`),
  `starter`, `plan-share` (`buildPlanBundle`/`parsePlan`) → mostly `sheets.jsx`.
```

por:

```markdown
- **Session lifecycle:** `session-start.buildSessionEntries`, `session-merge`, `backfill`,
  `finish-workout.buildCompletedWorkout`, `workout-date` (move a logged session to another
  date/time: re-files history in date order, keeps session length, re-derives PR badges),
  `session-routines` (copy a saved workout's flat exercise setup into a routine — explicit
  action only, never on finish), plus `active-workout-order`, `active-exercise-swap`,
  `workout-controls`, `rep-range`, `effort` (RIR summary/histogram), `bar` (`plateSplit`),
  `plates` (plate/stack weights loaded from `S.plates`), `starter`, `plan-share`
  (`buildPlanBundle`/`parsePlan`) → mostly `sheets.jsx`.
```

- [ ] **Step 4: Inserir `speed` no bullet "UI plumbing"**

Edit — trocar:

```markdown
- **UI plumbing:** `format` (dates/weeks/`fmtNum`/`uid`), `i18n-core`/`i18n`, `units`
  (`convertStateUnit`), `sound`, `push`, `wakelock`, `viewport-guard`, `use-sheet-keyboard`,
  `qr`, `scan`/`scan-web`, `hchips`, `nav`, `guest`, `demo`/`demoSeed`.
```

por:

```markdown
- **UI plumbing:** `format` (dates/weeks/`fmtNum`/`uid`), `i18n-core`/`i18n`, `units`
  (`convertStateUnit`), `speed` (cardio speed stored as km/h; display follows the profile
  unit, km/h or mph), `sound`, `push`, `wakelock`, `viewport-guard`, `use-sheet-keyboard`,
  `qr`, `scan`/`scan-web`, `hchips`, `nav`, `guest`, `demo`/`demoSeed`.
```

- [ ] **Step 5: Atualizar `frontend/src/locales/codemap.md`**

- Linha 8: `European Portuguese base pack (~1300 entries)` → `(~1376 entries)`.
- Linha 12: `PT_BR_OVERRIDES (~699 Brazilian-specific entries)` → `PT_BR_OVERRIDES (735 Brazilian-specific entries)`.
- Linha 13: a referência `(pt-BR.js:735)` aponta para a linha do `export default` — após a Task 4 essa linha mudou. Run: `Select-String -Path frontend\src\locales\pt-BR.js -Pattern 'export default'` → usar o número real (esperado 773).

- [ ] **Step 6: Verificar**

Run: `git grep -n "plates\|speed\.js\|workout-date\|session-routines" -- frontend/src/lib/codemap.md` → os quatro aparecem.
Notas de revisão sem alteração (não estão errados): `codemap.md` linha 54 traz uma lista exemplar de `lib/` (arquivos citados continuam existentes); `mcp/codemap.md:24` cita `preview_session` de forma genérica; `api/coach/core/adapters/codemap.md` já cita `GROQ_API_KEY`.

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/lib/codemap.md frontend/src/locales/codemap.md
git commit -m "docs(codemaps): map plates/speed/workout-date/session-routines; refresh locale counts"
```

---

### Task 6: Docs — GYMTASK, ROADMAP, README, AI_COACH

**Files:**
- Modify: `GYMTASK.md` (linha 134, pendência de redeploy ~171, comentário de envs ~250, checkpoint ~288, eventual bullet de CI em "Ideias futuras")
- Modify: `ROADMAP.md` (~16 contagens de env, ~46 bullet de CI)
- Modify: `README.md` (linha 61 bullet do Coach, tabela de envs ~130-134)
- Modify: `docs/AI_COACH.md` (nota de fork ~7-10, tabela de providers ~37, heading ~57, lista ~421)

**Interfaces:**
- Consumes: Task 3 (números de audit), Task 4 (1376/735/strict), Task 5 (codemaps).
- Produce: docs coerentes com o estado final; a Task 7 faz o push.

- [ ] **Step 1: GYMTASK — linha 134, status "Build + testes centrais"**

Read em `GYMTASK.md` a linha da tabela `| - | Build + testes centrais | ...` e substituir a linha inteira por:

```markdown
| - | Build + testes centrais | ✅ **verde** (contagens pós-ci/i18n 2026-10-01) | `npm run build` exit 0; `npm test` **1747/1747** (126 arquivos); census locale **735/641** (`pt-br-locale.test.js` 4/4, fingerprint `4f9c1cf2.aea84f3` inalterado; `check-locales` **1376/1376**); `check-source-strings --strict` **0** pendências; `mcp` **63/63**; `api` **160 pass / 18 fail** via `npm test` (`node --test` recursivo: 163/18, inclui `push-messages.test.js`) (mesmas 18 falhas CRLF pré-existentes: `prompts.test.js` + `routes.test.js:70` - não corrigir) |
```

- [ ] **Step 2: GYMTASK — pendência de redeploy resolvida**

Trocar a frase `**Pendência**: fazer o Redeploy (envs de build mudam só com rebuild).` por:

```markdown
**Resolvido (2026-09-29)**: produção serve o bundle novo (`index-Dnb2bsEL.js`, deploy
   2026-09-29 20:44) com `VITE_IMG_BASE`/`VITE_GIF_BASE` embutidos (2× jsDelivr no bundle).
```

- [ ] **Step 3: GYMTASK — contagens de env (dois pontos)**

3a. Na linha da tabela `Deploy Vercel/PWA`, trocar o trecho `**envs 6 production + 6 preview** (\`VITE_FIREBASE_*\`) via CLI/API (2026-09-28)` por:

```markdown
**envs 8 production + 6 preview** (6 `VITE_FIREBASE_*` em ambas + `VITE_IMG_BASE`/`VITE_GIF_BASE` em production) via CLI/API (2026-09-28/29)
```

3b. No comentário de comandos (~linha 250), trocar o trecho `envs VITE_* (6 prod + 6 preview) no ar` por `envs VITE_* (8 prod + 6 preview) no ar`.

- [ ] **Step 4: GYMTASK — novo checkpoint**

Read em `GYMTASK.md` a região das linhas ~285-315 (bloco `*Última atualização: 2026-09-29 ...*` e o bullet `- Checkpoint anterior (2026-09-28): ...`).

4a. Inserir, imediatamente **antes** da linha `*Última atualização: 2026-09-29 - **checkpoint**.`:

```markdown
*Última atualização: 2026-10-01 - **checkpoint**. → Nesta rodada: **CI destravada** (dois
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
6 preview**.*
```

4b. Reescrever o primeiro trecho do checkpoint antigo: trocar `*Última atualização: 2026-09-29 - **checkpoint**. → Nesta rodada:` por `- Checkpoint anterior (2026-09-29): → Nesta rodada:` (mesmo padrão do bullet `- Checkpoint anterior (2026-09-28):` logo abaixo).

4c. Se o parágrafo do checkpoint de 29/09 terminar com um `*` de fechamento de itálico, removê-lo (o bloco virou bullet, não mais itálico). Verificar com: `Select-String -Path GYMTASK.md -Pattern '^\*.*\*$'` não deve achar resquício desse parágrafo.

- [ ] **Step 5: GYMTASK — checar bullet de CI em "Ideias futuras"**

Run: `Select-String -Path GYMTASK.md -Pattern 'GitHub Actions'`
Se existir um bullet listando a CI como futura (como no ROADMAP), removê-lo — a CI existe e roda (`.github/workflows/test.yml`). Se não existir, seguir.

- [ ] **Step 6: ROADMAP — contagens de env**

Trocar o trecho `(6 production + 6 preview, adicionadas via CLI/API em 2026-09-28)` por:

```markdown
(8 production - 6 `VITE_FIREBASE_*` + `VITE_IMG_BASE`/`VITE_GIF_BASE` - e 6 preview, adicionadas via CLI/API em 2026-09-28/29)
```

- [ ] **Step 7: ROADMAP — remover bullet de CI futura**

Remover a linha inteira:

```markdown
- CI com GitHub Actions rodando `npm test` + `npm run build` no push (ver `.github/workflows/test.yml`)
```

(a CI já existe e roda esses comandos; listá-la como ideia futura está errado.)

- [ ] **Step 8: README — bullet do Coach**

Trocar `**Coach com IA (Grok)**` por `**Coach com IA (Grok, Groq)**` (o restante da linha fica igual).

- [ ] **Step 9: README — linha de env de mídia na tabela**

Inserir, logo após a linha da tabela da `NUTRITIONIX_APP_ID` / `NUTRITIONIX_APP_KEY`:

```markdown
| `VITE_IMG_BASE` / `VITE_GIF_BASE` | Base da CDN das mídias dos exercícios (jsDelivr, dataset `@7455efae`) - embutida no build do frontend (produção Vercel) |
```

Nota (não vira linha na tabela): `GROQ_API_KEY` não é uma env que se configura — nada lê `process.env.GROQ_API_KEY` diretamente; `jobEnv` (`api/coach/config.js`) injeta a credencial guardada (`data/coach.json`) no job com esse nome, e o BYOK roda no navegador.

- [ ] **Step 10: AI_COACH — nota de fork no topo**

Na nota `> - **Grok (xAI) is a provider here** ... adapter in \`api/coach/core/adapters/grok.js\`. The phone app also lists it (`lib/coach-local.js` \`ADAPTERS\`):`:

1. Após `adapter in \`api/coach/core/adapters/grok.js\`.` inserir: ` **Groq is a provider here too** - row \`groq\` → \`https://api.groq.com/openai\`, default model \`qwen/qwen3.8-27b\`, adapter in \`api/coach/core/adapters/groq.js\`.`
2. Trocar `The phone app also lists it` por `The PWA also lists it`.

- [ ] **Step 11: AI_COACH — row Groq na tabela de providers**

Inserir, logo após a linha da tabela do Grok:

```markdown
| **Groq** | plain HTTPS to `api.groq.com/openai`, default model `qwen/qwen3.8-27b` | an API key (`GROQ_API_KEY` in the job env, delivered from the stored credential) | default |
```

- [ ] **Step 12: AI_COACH — heading da seção "With an API key"**

Trocar `### With an API key (Anthropic, OpenAI, Gemini, Grok, compatible)` por `### With an API key (Anthropic, OpenAI, Gemini, Grok, Groq, compatible)`.

- [ ] **Step 13: AI_COACH — lista de providers da seção "On the phone"**

Trocar `the phone calls Anthropic, OpenAI, Gemini or a compatible endpoint directly,` por `the app calls Anthropic, OpenAI, Gemini, Grok, Groq or a compatible endpoint directly,`.

- [ ] **Step 14: Verificar números velhos restantes**

Run: `Select-String -Path GYMTASK.md,ROADMAP.md,README.md -Pattern '1531|1336/1336|58/58|695/641|6 production \+ 6 preview|\(6 prod \+ 6 preview\)'` → nenhuma ocorrência restante (o checkpoint antigo de 2026-09-29 pode manter os números dele — é histórico, aceitável; os alvos são as linhas de status/tabela/comentário).
Run: `Select-String -Path docs\AI_COACH.md -Pattern 'phone app'` → vazio.

- [ ] **Step 15: Commit**

```powershell
git add GYMTASK.md ROADMAP.md README.md docs/AI_COACH.md
git commit -m "docs: refresh checkpoint, env counts, README providers and AI_COACH Groq/PWA"
```

---

### Task 7: Gates finais, env local de mídia, push e relatório

**Files:**
- Modify: `frontend/.env` (gitignored — não entra em commit)
- Push: todos os commits das Tasks 1-6 para `origin main`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produce: CI verde (confirmação final), relatório de entrega.

- [ ] **Step 1: Env local de mídia**

Acrescentar ao final de `frontend/.env` (criar se não existir) — mesmo pin de `pages.yml:27` e de `docs/DEPLOY_VERCEL.md` §2:

```env
VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/
VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/
```

(Não é commitado — `.env` é gitignored. Motivo: sem essas envs, `lib/exercises.js` busca `img/`/`gif/` relativos que não existem no host estático.)

- [ ] **Step 2: Verificar o inline da env no build**

Run (workdir `frontend/`): `npm run build` → exit 0.
Run: `Select-String -Path frontend\dist\assets\*.js -Pattern 'cdn.jsdelivr.net/gh/hasaneyldrm' | Measure-Object` → contagem ≥ 1 (env embutida no bundle).

- [ ] **Step 3: Gates finais de todas as suítes**

Run (workdir `frontend/`): `npm test` → `1747/1747 (126 arquivos)`.
Run (workdir `frontend/`): `node scripts/check-locales.mjs` → exit 0, `1376 keys in sync`.
Run (workdir `frontend/`): `node scripts/check-source-strings.mjs --strict` → exit 0.
Run (workdir `mcp/`): `npm test` → `63 pass`.
Run (workdir `api/`): `npm test` → `160 pass / 18 fail` (baseline).
Run (raiz): `node scripts/build-coach-assets.mjs --check` → exit 0; `node api/scripts/check-core-loadable.mjs` → exit 0.

- [ ] **Step 4: Estado do git**

Run: `git status` → limpo (exceto `frontend/.env` gitignored).
Run: `git log --oneline origin/main..HEAD` → exatamente os 6 commits das Tasks 1-6.
Run: `git diff --stat origin/main..HEAD` → só os arquivos planejados.

- [ ] **Step 5: Push**

Run: `git remote -v` (confirmar `origin`) e `git push origin main` → exit 0.

- [ ] **Step 6: CI e PRs da dependabot**

O CLI não consegue ler Actions (sem `gh`; API 403 sem token). Evidência local já reproduz os dois jobs: `npm@10 ci` (job `api`) foi verificado nas duas variações de flag, e o `COPY` do Dockerfile não referencia mais arquivo inexistente (o job `api-image` é determinístico — `COPY` de arquivo ausente falha sempre; `docker` não existe localmente para rodar o build). Registrar no relatório:
- Pedir ao usuário para conferir a aba Actions após o push (4 jobs: `test`, `mcp`, `api`, `api-image` verdes esperados; `pages` continua vermelho — fora de escopo, usuário usa Vercel).
- PRs da dependabot com base antiga (#1, #3, #7, #8, #9) só ficam verdes após rebase em cima destes fixes → botão "Update branch" na UI do GitHub (ou `@dependabot rebase`).

- [ ] **Step 7: Relatório final ao usuário**

Resumo: 2 bugs de CI + audit por workspace (4 highs de firebase aceitos, com justificativa) + 33 strings traduzidas + `--strict` no CI + codemaps + docs + env local de mídia; contagens finais (1747/126, 1376, 735/641, fingerprint idêntico, 63/63, 160/18); pendências que seguem fora de escopo (Pages, credenciais do usuário, `VITE_NUTRITION_PROXY_URL`).
