# Roteiro do GymTask

Para onde o GymTask vai, na ordem em que deve acontecer. O detalhe técnico vive em
[GYMTASK.md](GYMTASK.md) (§5 o que falta, §8 ideias futuras); aqui vai o resumo legível.
Sem datas inventadas: cada item anda quando tiver credencial, tempo e teste verde.

> O GymTask é um derivado de openGym (https://github.com/DuarteSantos8/openGym), licença AGPL-3.0 mantida.

## Agora (pendências imediatas)

- **Fechar o rebrand (~1% restante)** — varredura final de marca upstream; identificadores de env `OPENGYM_*` do `mcp/` ficam como estão por decisão.
- **Credenciais** — Firebase ✅ (projeto `gymtask-ce4b6`, e-mail/senha ativo, rules no ar); ainda falta:
  - xAI: chave `XAI_API_KEY` (**paga** — ~US$2/1M tokens de entrada, ~US$6/1M de saída; vale considerar um provider gratuito compatível)
  - Nutritionix: `NUTRITIONIX_APP_ID` + `NUTRITIONIX_APP_KEY` (plano gratuito)
  - VAPID: `VITE_FIREBASE_VAPID_KEY` (push diário, opcional)
- **Deploy Vercel** — apontar o repo com raiz em `frontend/`, build `npm run build`, envs `VITE_*` (bloco pronto em `data/deploy-env.txt`) + `VITE_NUTRITION_PROXY_URL` (ver [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md)); depois adicionar o domínio em Authentication → Authorized domains.
- **Deploy Firebase** — rules ✅ no ar; falta `firebase deploy --only functions` (espera `XAI_API_KEY`/`NUTRITIONIX_*` em `functions/.env`).

## Ideias futuras

### Nutrição

- Scanner de código de barras nos alimentos (o decoder `jsqr` já existe no projeto)
- Sugestão automática de refeições a partir das calorias/macros restantes do dia
- Fotos de refeição com estimativa de macros
- Receitas com macros por porção, adicionáveis ao diário
- Tendências: peso corporal × ingestão calórica × volume de treino no mesmo gráfico

### Coach

- Streaming das respostas (SSE) no chat — hoje a resposta chega em bloco
- Memória de treinos: injetar resumo das últimas sessões + PRs no prompt automaticamente
- Revisão semanal automática disparada por function agendada
- Plano alimentar gerado pelo Coach a partir do TDEE registrado

### Treino e experiência

- Deload automático e periodização mais rica no motor de progressão
- Escrita no Google Fit / Apple Health (hoje só importação)
- Vídeos dos exercícios (dataset CDN já parametrizado por `VITE_IMG_BASE`/`VITE_GIF_BASE`)

### Infra

- Firestore em tempo real (`onSnapshot`) para sync instantâneo entre aparelhos (hoje é pull/push)
- Multi-perfil familiar no mesmo projeto Firebase
- CI com GitHub Actions rodando `npm test` + `npm run build` no push (ver `.github/workflows/test.yml`)
- Backup/export: dump completo do Firestore para JSON (portabilidade — espírito "seus dados, seus mesmo")
