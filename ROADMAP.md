# Roteiro do GymTask

Para onde o GymTask vai, na ordem em que deve acontecer. O detalhe técnico vive em
[GYMTASK.md](GYMTASK.md) (§5 o que falta, §8 ideias futuras); aqui vai o resumo legível.
Sem datas inventadas: cada item anda quando tiver credencial, tempo e teste verde.

> O GymTask é um derivado de openGym (https://github.com/DuarteSantos8/openGym), licença AGPL-3.0 mantida.

## Entregue (2026-10-04 e 05)

Três planos fechados em sequência, cada todo com evidência red→green e verificação
independente — **50 todos no total**, CI verde no `edc1b42` (frontend 2015/2015 em 162
arquivos, api 205/0, functions 46/46, mcp 88/88, lint Biome, build, locales e strict todos
verdes; Actions ✅, demo no GitHub Pages ✅, bundle da Vercel no ar com os features novos).

- **audit-fixes (31 todos + auditoria F1–F4)** — segurança das functions (allowlist de CORS
  por origem, rate limit por IP, cap de payload, e o mesmo guard de bytes no
  `PUT /api/data`), `firebase-admin` 12→14, suíte `functions/` no CI, `/api/admin/*`
  realmente filtrado, CRLF resolvido na raiz (`.gitattributes`), acessibilidade (semântica
  de diálogo, aria-labels via `t()` em pt-BR, nomes de switch/input, `aria-current`), perf
  (React.lazy por rota + vendor split, store selectors + memo no Stats), gate de lint
  Biome no CI, ~150 testes de cobertura novos (views, stores, libs, mcp), lembrete FCM
  diário no cliente, dead-code e docs stale removidos.
- **top5-features (7 todos)** — TDEE adaptativo com botão "Aplicar" no Nutrition; proteína
  por refeição (barras nas seções); landmarks musculares (série semanal, presets,
  `DEF.muscleTargets`, linhas por músculo no Stats + edição em Settings); memória do Coach
  (bloco `recent` com sessões e PRs no payload do plano); aderência (lib + tile no Stats +
  denominador do Home corrigido); bateria final.
- **roadmap-features (12 todos)** — as 11 features marcadas ✅ nas "Ideias futuras" abaixo
  + bateria final.

## Agora (pendências imediatas)

- **Fechar o rebrand (~1% restante)** — varredura final de marca upstream; identificadores de env `OPENGYM_*` do `mcp/` ficam como estão por decisão.
- **Credenciais** — Firebase ✅ (projeto `gymtask-ce4b6`, e-mail/senha ativo, rules no ar); ainda falta:
  - xAI: chave `XAI_API_KEY` (**paga** — ~US$2/1M tokens de entrada, ~US$6/1M de saída; vale considerar um provider gratuito compatível — o Groq BYOK já está implementado)
  - Nutritionix: `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (plano gratuito)
  - VAPID: `VITE_FIREBASE_VAPID_KEY` (push diário, opcional)
- **Deploy Vercel** — ✅ projeto já importado com **Root Directory = `frontend/`** (obrigatório: sem isso a Vercel tenta registrar os ~240 `.js` de `api/` como Serverless Functions e o plano Hobby estoura no limite de 12; as functions de verdade rodam no Firebase) e build verde no ar desde 2026-09-28; bundle de produção já serve os features desta rodada (verificado ao vivo em 2026-10-05). Env `VITE_FIREBASE_*` já no ar (8 production - 6 `VITE_FIREBASE_*` + `VITE_IMG_BASE`/`VITE_GIF_BASE` - e 6 preview, adicionadas via CLI/API em 2026-09-28/29); **falta**: `VITE_NUTRITION_PROXY_URL` (depende do deploy das functions — ver [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)) e adicionar o domínio em Authentication → Authorized domains.
- **Deploy Firebase** — rules ✅ no ar; `firebase deploy --only functions` **adiado por
  decisão (2026-10-08)**: exige Blaze e o billing está travado (perfil de pagamento com
  CPF alheio não dá pra trocar/fechar; Google limita a 1 PF por país). Sem Blaze nada
  quebra: coach/foto/cardápio BYOK Groq é client-side; a function destrava modo servidor,
  Nutritionix e jobs agendados. `functions/.env` já tem `GROQ_API_KEY` nesta máquina.
- **Demo no GitHub Pages** — ✅ no ar em https://paulo-santos20.github.io/GymTask/ (Pages habilitado com build via Actions em 2026-10-05; workflow `pages.yml` verde; só redeploya quando `frontend/**` muda).
- **Dependabot** — 2 PRs de dependências criados antes do fix do job `functions` falharam no CI antigo; re-base/merge quando quiser (o fix `31885c1` resolve o teste; as versões propostas são só bumps de frontend).

## Ideias futuras

### Nutrição

- ✅ **Scanner de código de barras nos alimentos** (RF1 — câmera/foto → EAN → entrada pré-preenchida; `BarcodeDetector` nativo com fallback jsQR)
- ✅ **Sugestão automática de refeições** (RF9 — chips com os macros restantes do dia no Nutrition)
- ✅ **Fotos de refeição com estimativa de macros** (RF10 — visão Groq gratuita + categoria de consentimento "foto")
- ✅ **Receitas com macros por porção** (RF7 — adicionáveis ao diário)
- ✅ **Tendências: peso corporal × ingestão calórica × volume de treino no mesmo gráfico** (RF5 — Stats)

### Coach

- ✅ **Streaming das respostas (SSE) no chat** (RF4 — deltas de token com fallback por polling)
- ✅ **Memória de treinos** (top5 C1 — bloco `recent` com as últimas sessões + detalhe de PRs no prompt)
- ✅ **Revisão semanal automática disparada por function agendada** (RF8 — proposta pendente que o app serve via status/resolve)
- ✅ **Plano alimentar gerado pelo Coach a partir do TDEE registrado** (RF6)

### Treino e experiência

- ✅ **Deload automático e periodização mais rica no motor de progressão** (RF2 — regras de deload + copy)
- **Escrita no Google Fit / Apple Health** — ✅ Apple Health (RF11 — ponte via Atalhos do iOS: peso e treinos); Google Fit fica pendente
- **Widgets** (Android/iOS) do treino do dia — não feito
- **Modo social**: compartilhar prints de evolução / PRs — não feito
- **Vídeos dos exercícios** (dataset CDN já parametrizado por `VITE_IMG_BASE`/`VITE_GIF_BASE`) — não feito

### Infra

- ✅ **Firestore em tempo real (`onSnapshot`) para sync instantâneo entre aparelhos** (RF3 — substitui o pull/push manual)
- **Multi-perfil familiar no mesmo projeto Firebase** — não feito
- **Backup/export: dump completo do Firestore para JSON** (portabilidade — espírito "seus dados, seus mesmo") — não feito
