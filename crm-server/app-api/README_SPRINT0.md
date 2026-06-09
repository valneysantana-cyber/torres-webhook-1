# App de Operação & Vistorias — Sprint 0 (runbook)

Implementação inicial da API do aplicativo móvel (iOS + Android via Capacitor),
montada de forma **aditiva** no `crm-server` sob o prefixo **`/app/v1`**.
Não altera nenhuma rota existente; usa autenticação própria (Bearer JWT).

## O que foi entregue

**Backend (`crm-server/app-api/`)**
- `auth.js` — login JWT, papéis (`admin|host|provider|owner`), escopo por imóvel, criação de usuários, registro de dispositivo (push).
- `inspections.js` — vistorias (checklist + fotos + geolocalização/geofencing), listagem com escopo por papel, disparo do relatório por IA.
- `ai.js` — geração do relatório por IA (Claude vision); degrada com segurança sem `ANTHROPIC_API_KEY`.
- `owner.js` — visão quantitativa do proprietário (reservas passadas/futuras + ocupação) **sem nenhum valor financeiro**.
- `index.js` — `attachAppApi(router, db)` / `createAppApi(db)` + `ensureAppIndexes(db)`.
- `seed.js` — cria primeiros usuários e cadastra o imóvel (com coords p/ geofencing).
- `smoke-test.js` — 20 asserções end-to-end com MongoDB em memória (não toca dados reais).

**App móvel (`mobile-app/`)**
- `www/` — SPA (login, home por papel, vistoria com câmera/geo/fila offline, detalhe + relatório IA, painel do proprietário).
- `capacitor.config.json` + `package.json` — prontos para `npx cap add ios` / `android`.
- `serve-dev.js` — servidor estático para testar no navegador.

## Variáveis de ambiente (crm-server)
| Var | Obrigatória | Para quê |
|-----|-------------|----------|
| `APP_JWT_SECRET` | **sim** | assinar/validar os tokens do app |
| `APP_JWT_TTL` | não (12h) | validade do token |
| `ANTHROPIC_API_KEY` | p/ IA | relatório de vistoria por IA (já existe no projeto) |
| `APP_AI_MODEL` | não | default `claude-sonnet-4-5` |
| `APP_GEOFENCE_METERS` | não (200) | raio aceito na validação de presença |
| `MONGODB_URI` | já existe | mesmo banco do CRM |

## Rodar localmente
```bash
# 1) backend
cd crm-server && npm install
APP_JWT_SECRET=dev MONGODB_URI=mongodb://localhost:27017/torresguest npm start

# 2) seed dos primeiros usuários (defina senhas reais)
SEED_RESET_PW=1 SEED_PW_GLAUCO='...' SEED_PW_PROVIDER='...' SEED_PW_ADMIN='...' \
  APP_JWT_SECRET=dev MONGODB_URI=mongodb://localhost:27017/torresguest npm run seed:app

# 3) app no navegador
cd ../mobile-app && node serve-dev.js   # http://localhost:5173
# no console do navegador, aponte para a API:
#   localStorage.setItem('API_BASE','http://localhost:3001/app/v1'); location.reload()
```

## Testar
```bash
cd crm-server && APP_JWT_SECRET=test npm run test:app   # 20/20 esperado
```

## Empacotar para as lojas (Capacitor)
```bash
cd mobile-app && npm install
npx cap add ios          # requer Mac + Xcode
npx cap add android      # requer Android Studio
npx cap sync
npx cap open ios         # / open android  → build e envio pela loja
```
Antes do build, ajuste `www/config.js` (`API_BASE`) para a URL pública do crm-server.

## Deploy no VPS (quando aprovado)
1. `cd crm-server && npm install` (novas deps: jsonwebtoken, bcryptjs, @anthropic-ai/sdk).
2. Definir `APP_JWT_SECRET` (e garantir `ANTHROPIC_API_KEY`).
3. Liberar `/app/v1` no nginx (sem `auth_basic` — o app usa JWT próprio).
4. `pm2 reload` do crm-server.
5. Rodar o seed uma vez para criar os usuários.

## Ainda NÃO incluído (próximos sprints)
- Offload das fotos para Cloudflare R2 (hoje as fotos trafegam/armazenam em base64; bom para piloto, trocar por upload assinado no R2 antes de escalar).
- Envio de push pelo servidor (FCM/APNs) — o registro de device já existe (`POST /devices`); falta o emissor.
- Convite/onboarding do proprietário e tela de gestão de usuários no app.
- Limites de vistoria/IA por plano e trilha de auditoria detalhada.
- Testes de isolamento como parte do CI antes de publicar.
