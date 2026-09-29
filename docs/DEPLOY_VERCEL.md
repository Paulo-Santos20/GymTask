# Deploy na Vercel (frontend) + Firebase (backend)

O GymTask roda como SPA estática servida pela Vercel; Auth, Firestore e as Cloud Functions
continuam no Firebase. Este guia leva do repositório importado ao app no ar.

## 1. Importar o repositório

1. Em [vercel.com/new](https://vercel.com/new), importe o repositório do GymTask.
2. Em **Settings → General → Root Directory**, defina `frontend`. É **obrigatório**: com o
   Root Directory vazio a Vercel enxerga a raiz do repositório, tenta registrar os ~240
   `.js` de `api/` como Serverless Functions e falha com *"No more than 12 Serverless
   Functions …"* no plano Hobby. Com Root Directory em `frontend/`, o backend local fica
   fora do projeto Vercel — as functions de verdade rodam no **Firebase** (seção 3).
3. O build usa o `vercel.json` (presente na raiz **e** em `frontend/`, valores idênticos) e
   os campos do painel — as três fontes dizem o mesmo:
   - `installCommand`: `npm ci`
   - `buildCommand`: `npm run build`
   - `outputDirectory`: `dist` (relativo ao Root Directory → `frontend/dist`)
   - os cabeçalhos de cache (seção 4 abaixo).
4. Clique em **Deploy**. O primeiro build já passa sem segredos (o app entra em modo visitante),
   mas o login só funciona com as variáveis da próxima seção.

> **Por que não há `rewrites` de SPA no `vercel.json`?** O app usa `HashRouter`
> (`frontend/src/App.jsx`), então toda rota vive depois do `#` (`/#/treino`, `/#/historico`).
> O servidor só precisa entregar `index.html` em `/` — que é exatamente o comportamento
> padrão da Vercel para arquivos estáticos. Um rewrite `(.*)` → `/index.html` seria inútil e
> quebraria o cache do `sw.js` e de `/assets/*` sem motivo.

> **Troubleshooting — os dois erros de build já encontrados neste projeto:**
>
> - `cd: frontend: No such file or directory` — versões antigas do `vercel.json` usavam
>   `cd frontend && …`; com o Root Directory preenchido o cwd **já é** `frontend/`, e o `cd`
>   falhava. Corrigido: comandos relativos (`npm ci`, `npm run build`, `dist`) em três fontes
>   idênticas — `vercel.json` na raiz, `frontend/vercel.json` e os Build settings do painel.
> - `No more than 12 Serverless Functions can be added …` — Root Directory vazio fazia a
>   Vercel ler `api/` (os ~240 `.js` do servidor local de fallback) como Serverless
>   Functions do plano Hobby. Corrigido: Root Directory = `frontend`, então `api/` fica
>   fora do projeto Vercel.

## 2. Variáveis de ambiente obrigatórias

Em **Settings → Environment Variables**, adicione para cada ambiente (Production, Preview,
Development). Os nomes são exatamente os de `frontend/.env.example`:

| Variável | Origem |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase Console → Configurações do app → Web |
| `VITE_FIREBASE_AUTH_DOMAIN` | `<projeto>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | id do projeto |
| `VITE_FIREBASE_STORAGE_BUCKET` | `<projeto>.appspot.com` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | id do remetente |
| `VITE_FIREBASE_APP_ID` | id do app web |
| `VITE_NUTRITION_PROXY_URL` | `https://us-central1-<projeto>.cloudfunctions.net/nutritionProxy` |

Detalhes importantes:

- As variáveis `VITE_*` são **inlinhadas no bundle em tempo de build**. Depois de adicioná-las
  ou alterá-las, faça um **Redeploy** — mudar a env sem rebuild não muda o app.
- Sem as variáveis do Firebase o build continua funcionando, mas o login mostra
  "Configure o Firebase no arquivo .env para fazer login" (modo visitante continua disponível).
- Opcional: `VITE_UMAMI_SRC` + `VITE_UMAMI_ID` ativam analytics opcional (sem elas o build
  permanece sem telemetria).

## 3. Pós-deploy no Firebase

1. **Authorized domains**: Firebase Console → Authentication → Settings → **Authorized
   domains** → adicione o domínio do Vercel (ex.: `gytask.vercel.app` e o domínio próprio,
   se houver). Sem isso o login Firebase é bloqueado no navegador.
2. **Firestore**: comece com regras restritivas por usuário:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   (A forma simplificada `allow read, write: if request.auth != null` também funciona, mas
   deixa qualquer usuário autenticado ler dados de outros — prefira checar `uid`.)
3. **CORS**: as Cloud Functions (`functions/index.js`) já respondem com
   `Access-Control-Allow-Origin: *`, então a origem do Vercel é aceita automaticamente —
   nenhuma configuração extra de CORS é necessária no deploy.

## 4. Checklist PWA

- [ ] `GET /manifest.json` responde 200 com `Content-Type: application/json`.
- [ ] `GET /sw.js` responde 200 com `Cache-Control: public, max-age=0, must-revalidate`
      (definido no `vercel.json` — um service worker cacheado com stale mata atualizações).
- [ ] `/assets/*` responde com `Cache-Control: public, max-age=31536000, immutable`
      (hashes do Vite; também no `vercel.json`).
- [ ] Abrir DevTools → Application → **Service Workers**: `activated`, status `is using cache`.
- [ ] **Install**: no Chrome, ícone de instalar na barra de endereço; no Android, menu
      → "Adicionar à tela inicial"; no iOS, Safari → Compartilhar → "Adicionar à Tela de
      Início". O app abre em `display: standalone` sem barra do navegador.
- [ ] After um deploy novo: fechar todas as abas, reabrir e conferir que a versão em
      Settings → sobre/atualização mudou (o `sw.js` troca de cache a cada build).

Como o app usa `HashRouter`, navegar para `https://<dominio>/#/treino` e recarregar deve
cair em `index.html` normalmente — é essa ausência de rotas no servidor que elimina a
necessidade de rewrites de SPA.

## 5. Alternativa: Firebase Hosting

O Firebase Hosting também serviria este frontend estático (`firebase deploy --only hosting`
apontando `public: frontend/dist` e usando `firebase.json` para os mesmos headers), já que
Auth/Firestore/Functions já estão no Firebase. A Vercel foi escolhida pela integração com o
repositório e previews automáticos — as duas opções são igualmente válidas.
