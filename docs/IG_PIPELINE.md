# Instagram Auto-Posting Pipeline (@conciergecloud.app)

**Branch:** `feat/ig-pipeline`
**Spec completo:** `INSTAGRAM_PIPELINE_SPEC_06052026.md` (OneDrive)
**Conta:** `@conciergecloud.app` (criada 2026-05-06)
**Não confundir com:** `services/instagram.js` que serve `@torresguest`

---

## Como funciona

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SEED (manual, 1× ao mês)                                │
│    node scripts/instagram/seed-queue.js --commit            │
│    → popula MongoDB.instagram_queue com 30 dias de posts    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. APROVAÇÃO (semanal, manual via CLI)                     │
│    node scripts/instagram/cli.js approve-week               │
│    → status pending → approved                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. RENDER + UPLOAD (manual ou futuro auto-render)          │
│    Você renderiza imagens (Canva/Figma/Photoshop),          │
│    sobe pro Cloudflare R2 (cdn.conciergecloud.com.br),      │
│    e marca o post como ready:                               │
│    node scripts/instagram/cli.js set-ready <id>             │
│      --image https://cdn.cc/ig/2026-05-07/slide1.png        │
│      --image https://cdn.cc/ig/2026-05-07/slide2.png        │
│    → status approved → ready                                │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. PUBLISH (Render Cron Job, automático)                   │
│    schedule: */15 12-22 * * *  (a cada 15min, 9-19h BRT)    │
│    command:  node scripts/instagram/run-publisher.js        │
│    → ready → publishing → published (via Meta IG Graph API) │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. MÉTRICAS (Render Cron Job, diário 23h BRT)              │
│    schedule: 0 2 * * *                                      │
│    command:  node scripts/instagram/run-metrics.js          │
│    → atualiza metrics.{impressions,likes,saves...}          │
└─────────────────────────────────────────────────────────────┘
```

---

## Pré-requisitos (uma vez só)

### 1. Conta `@conciergecloud.app` profissional Business
✅ Criada e configurada em 2026-05-06.

### 2. Página Facebook ConciergeCloud
- Criar em [facebook.com/pages/create](https://facebook.com/pages/create)
- Categoria: Software/Tech
- Logo + bio iguais ao IG

### 3. Conectar IG → FB Page
- Meta Business Suite → Centro de Contas → Add Account → Instagram
- Confirmar que `@conciergecloud.app` aparece linkada à página FB

### 4. Long-Lived Page Access Token
- App: `OpenClaw` (já existe, App ID `1667526337778117`)
- [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
- Selecionar app OpenClaw
- Get User Access Token com scopes:
  - `instagram_basic`
  - `instagram_content_publish`
  - `pages_show_list`
  - `pages_read_engagement`
  - `pages_manage_posts`
- Trocar por Long-Lived (60 dias):
  ```
  GET https://graph.facebook.com/v23.0/oauth/access_token
    ?grant_type=fb_exchange_token
    &client_id={IG_CC_APP_ID}
    &client_secret={IG_CC_APP_SECRET}
    &fb_exchange_token={SHORT_LIVED_TOKEN}
  ```
- Pegar Page Access Token específico da Page ConciergeCloud:
  ```
  GET https://graph.facebook.com/v23.0/me/accounts?access_token={USER_LL_TOKEN}
  ```
  → copiar o `access_token` do node da Page ConciergeCloud

### 5. Pegar IG_CC_BUSINESS_ID
```
GET https://graph.facebook.com/v23.0/{FB_CC_PAGE_ID}?fields=instagram_business_account&access_token={PAGE_TOKEN}
```
→ pega `instagram_business_account.id`

---

## Variáveis de ambiente Render

Adicionar em **cada Render Cron Job** (publisher + metrics):

| Var | Valor | Notas |
|---|---|---|
| `MONGODB_URI` | (já existe) | mesma do torres-webhook |
| `IG_CC_BUSINESS_ID` | `1784...` | passo 5 acima |
| `IG_CC_ACCESS_TOKEN` | `EAAX...` | Page token long-lived |
| `IG_CC_APP_ID` | `1667526337778117` | reusa OpenClaw |
| `IG_CC_APP_SECRET` | (do app OpenClaw) | só se for usar refresh |
| `FB_CC_PAGE_ID` | `xxx...` | ID da Page ConciergeCloud |
| `IG_CC_AUTO_PUBLISH` | `false` | **DEFAULT OFF** — só `true` quando validar 1 post manual |

---

## Setup dos Render Cron Jobs

No dashboard do Render:

### Cron 1 — Publisher
- **Type:** Cron Job
- **Build Command:** `npm install`
- **Schedule:** `*/15 12-22 * * *`  (cada 15min entre 9-19h BRT)
- **Command:** `node scripts/instagram/run-publisher.js`
- Conectar mesmo repo `torres-webhook`, mesmo branch (após merge)
- Setar todas as envs acima

### Cron 2 — Metrics
- **Type:** Cron Job
- **Build Command:** `npm install`
- **Schedule:** `0 2 * * *`  (02h UTC = 23h BRT diário)
- **Command:** `node scripts/instagram/run-metrics.js`
- Mesma config

---

## Fluxo operacional (semana típica)

### Domingo à noite — preparar próxima semana
```bash
# Ver o que tá previsto
node scripts/instagram/cli.js list --status pending --limit 7

# Editar um post se necessário
node scripts/instagram/cli.js edit <id> --caption "novo texto"

# Renderizar imagens (manual: Canva/Figma/Photoshop)
# Subir pro R2: aws s3 cp slide1.png s3://conciergecloud-ig/ig/2026-05-07/

# Marcar todos da semana como ready (manual por enquanto)
node scripts/instagram/cli.js set-ready <id1> --image https://cdn.cc/...
node scripts/instagram/cli.js set-ready <id2> --image https://cdn.cc/...

# Aprovar batch
node scripts/instagram/cli.js approve-week --next
```

### Durante a semana — só monitorar
```bash
# Ver stats
node scripts/instagram/cli.js stats

# Ver posts agendados
node scripts/instagram/cli.js list --status ready --limit 7
```

### Quando algo der errado
```bash
# Ver detalhes de um post que falhou
node scripts/instagram/cli.js show <id>

# Reagendar
node scripts/instagram/cli.js postpone <id> 1

# Pular o post
node scripts/instagram/cli.js skip <id> "imagem com bug"
```

---

## Aquecimento da conta (CRÍTICO antes de ativar cron)

Conta IG nova postar 7×/semana via API logo no D1 = risco alto de spam-flag pelo Meta.

**Recomendação:** **7 dias de aquecimento manual** (você posta pelo app mobile, não API):

| Dia | Ação |
|---|---|
| D1-D2 | 1 story por dia (sem post feed) |
| D3-D4 | 1 post feed simples (foto única) + 1 story |
| D5 | 1 carrossel + responder qualquer DM |
| D6-D7 | 1 reel + 1 carrossel |

Só na **semana 2** (após 7d de "comportamento humano") liga `IG_CC_AUTO_PUBLISH=true`.

---

## Limites Meta IG Graph API

| Coisa | Limite |
|---|---|
| Posts/dia/conta IG Business | 25 (cabe folgado) |
| Carousel items | 2-10 |
| Image URL | precisa ser HTTPS público |
| Video Reels | precisa MP4 público; processamento async |
| Token long-lived | 60d → renovar aos 50d |
| Quota chamadas API | 200/h por usuário |
| Stories via API | suportado desde 2024 |
| Highlights | **NÃO suportado** — só app mobile |
| Boost pago via API | **NÃO** — só Ads Manager |

---

## Troubleshooting

### `IG_CC envs não configurados`
Falta setar `IG_CC_BUSINESS_ID` ou `IG_CC_ACCESS_TOKEN` no Cron Job.

### `Meta API ... code 190`
Token expirou. Gerar novo Long-Lived Token (passo 4 dos pré-requisitos).

### `Meta API ... code 200 The user must be administrator`
A IG Business não tá conectada à Page Facebook. Refazer passo 3.

### `Container timeout após 300000ms` (reels)
Vídeo MP4 grande/quebrado. Tem que ser <100MB, encoding H.264, max 90s pro feed reel.

### Post foi publicado mas status="failed" no banco
Chamada do `media_publish` deu timeout, mas o post já foi. Buscar manualmente o ig_media_id no [graph explorer](https://developers.facebook.com/tools/explorer/) e setar via `cli.js show <id>` + atualização manual no Mongo.

### Quota 25/dia esgotada
Esperar 24h ou checar `cli.js dry-run` que retorna a quota atual.

---

## Próximas iterações (não MVP)

- [ ] Render engine (Puppeteer HTML→PNG → R2 automático)
- [ ] Admin UI web em `crm-server` (porta 3001 VPS)
- [ ] Email digest semanal (Gmail) com 1 botão "aprovar tudo"
- [ ] Token refresh cron (renova long-lived aos 50d)
- [ ] Comparativo de pilares (qual gera mais engajamento)
- [ ] Suporte multi-idioma (PT mês 1 → EN mês 2)
- [ ] Integração com Buffer/Hootsuite como fallback se Meta API cair

---

*Mantenedor: Valney Santana · valney.santana@gmail.com*
*Última atualização: 2026-05-06*
