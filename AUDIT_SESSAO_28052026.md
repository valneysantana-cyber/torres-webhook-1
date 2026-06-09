# Auditoria de Sessão — 2026-05-28

**Contexto:** onboarding do tenant `glauco-vaz` (Glauco Vaz, Flat 1704) revelou múltiplos bugs em cascata nos fluxos de tenant lifecycle, sync e cancelamento.

**Documentação relacionada:**
- `ISSUE_KIWIFY_WEBHOOK_BUG.md` (bug Kiwify cancelar → criar tenant fantasma)
- `ISSUE_EMAIL_FALLBACK_GHOST_STUBS.md` (stubs fantasma com staysId curto)

---

## 1. Bugs descobertos (em ordem de criticidade)

### 🔴 Bug 1 — Kiwify cancel → cria tenant fantasma + dispara email "conta ativa"
**Severidade:** Alta. Vai impactar TODO cliente futuro que cancelar.
**Estado:** Documentado em `ISSUE_KIWIFY_WEBHOOK_BUG.md`. Patch proposto, **não aplicado**.

### 🔴 Bug 2 — `cancellation_check.js` NÃO popula `process.env` → emails de cancelamento falham silenciosamente
**Severidade:** Alta. Recepção/anfitrião nunca recebem aviso de cancelamento.
**Estado:** NOVO. Fix de 1 linha (`Object.assign(process.env, crmEnv)`). Pendente patch.

**Repro:** Cancelar reserva no Stays → cron 06h roda → email NÃO sai (log diz "vazio — skip" apesar do `.env` ter os destinatários).

### 🟠 Bug 3 — `email_fallback.js` cria stubs com `staysId = código curto`
**Severidade:** Média. Quebra multi-tenant lookup quando listing não está vinculado.
**Estado:** Documentado em `ISSUE_EMAIL_FALLBACK_GHOST_STUBS.md`. Stubs antigos limpos. Patch proposto, **não aplicado**.

### 🟠 Bug 4 — Handler `/checkin/:code/submit` pega doc fantasma primeiro no `$or`
**Severidade:** Média. Pré-check-in vai pro tenant errado quando há doc duplicado.
**Estado:** Documentado em `ISSUE_EMAIL_FALLBACK_GHOST_STUBS.md` (Bug C). Fix proposto, **não aplicado**.

### 🟠 Bug 5 — Admin UI permite criar tenantId com hífen ou underscore inconsistentemente
**Severidade:** Média. Geração de tenants futuros pode replicar problema hífen vs underscore.
**Estado:** NOVO. Sugestão: normalizar tudo pra hífen ao criar (ou padronizar). Pendente.

### 🟠 Bug 6 — Email de cancelamento não inclui anfitrião proprietário do tenant
**Severidade:** Média. Anfitriões Agency externos (como Glauco) não são notificados quando reserva deles é cancelada.
**Estado:** NOVO. Patch sugerido: incluir `tenant.settings.owner.email` no recipient list.

### 🟡 Bug 7 — Stays sync (30min) não detecta cancelamentos
**Severidade:** Baixa. Tem `cancellation_check.js` diário 06h como compensação. Mas tem gap de até 24h.
**Estado:** Conhecido (comentário no código). Não fixável sem mudar API Stays.

### 🟡 Bug 8 — PUT `/admin/tenants/:id` bloqueia rename de `tenantId` no body
**Severidade:** Baixa. Funciona como design pra prevenir inconsistência.
**Estado:** Não é bug, é proteção. Mas precisa de endpoint de rename adequado se for caso necessário.

### 🟡 Bug 9 — Não há endpoint DELETE pra tenants
**Severidade:** Baixa. Funciona como design (preserva histórico).
**Estado:** Funcionou — precisei deletar via Mongo direto pra `valney-santana-1`.

### 🟡 Bug 10 — Webhook Kiwify de cancelamento NÃO desativa tenant
**Severidade:** Baixa. Junto com Bug 1.
**Estado:** Coberto em `ISSUE_KIWIFY_WEBHOOK_BUG.md`.

---

## 2. Estado pós-correções desta sessão

| Item | Antes | Depois |
|---|---|---|
| Tenant `glauco-vaz` ativo | não existia | ✅ ativo, plano Agency |
| Mismatch hífen/underscore | sim (htpasswd vs Mongo) | ✅ alinhado em `glauco-vaz` |
| `valney-santana-1` (fantasma do Kiwify) | existia ativo | ✅ deletado |
| Listing 1704 vinculado a tenant | não | ✅ vinculado a `glauco-vaz` |
| 2 reservas (KR04J, KQ05J) | só no Stays | ✅ sincronizadas Atlas |
| Stubs fantasma do email_fallback | 3 (NH01J, NU01J, KQ05J) | ✅ deletados |
| Pré-check-in KQ05J | salvo em `torres` | ✅ realocado pra `glauco-vaz` |
| OY01J (reserva 21/09 cancelada) | aparecia em fluxos | ✅ marcada como canceled |
| KQ05J cancelada no Stays | type=booked no Mongo | ✅ type=canceled |
| Email cancelamento KQ05J | não disparado (bug 2) | ✅ disparado manualmente |

---

## 3. Auditoria sistemática proposta (próximo ciclo)

Para garantir que casos futuros não repitam esses bugs, sugiro varrer:

### 3.1 Auditoria de tenants existentes

```javascript
// Listar todos os tenants e verificar consistência
db.tenants.aggregate([
  { $lookup: { from: "reservations", localField: "tenantId", foreignField: "tenantId", as: "reservations" } },
  { $project: {
      tenantId: 1, name: 1, active: 1,
      reservationsCount: { $size: "$reservations" },
      listingsCount: { $size: { $ifNull: ["$listings", []] } },
      hasOwnerEmail: { $cond: [{ $ifNull: ["$settings.owner.email", false] }, true, false] }
  }}
]);
```

### 3.2 Auditoria de reservations órfãs

```javascript
// Reservas sem tenant correspondente ativo
db.reservations.aggregate([
  { $lookup: { from: "tenants", localField: "tenantId", foreignField: "tenantId", as: "tenant" } },
  { $match: { $or: [
      { tenant: { $size: 0 } },
      { "tenant.active": false }
  ]}}
]);
```

### 3.3 Auditoria de stubs fantasma

```javascript
db.reservations.find({
  source: "email_fallback",
  $expr: { $eq: [{ $strLenCP: "$staysId" }, 5] },
  syncedAt: { $exists: false },
  createdAt: { $lt: new Date(Date.now() - 7*24*3600*1000) }  // > 7 dias
});
```

### 3.4 Auditoria de checkin_forms desalinhados

```javascript
// Pré-check-in com tenantId diferente do tenant da reserva
const forms = db.getCollection('checkin_forms').find({}).toArray();
for (const f of forms) {
  const r = db.reservations.findOne({ confirmationCode: f.confirmationCode });
  if (r && r.tenantId !== f.tenantId) {
    print('MISMATCH:', f.confirmationCode, 'form=' + f.tenantId, 'reserva=' + r.tenantId);
  }
}
```

### 3.5 Auditoria de duplicatas no Atlas

```javascript
db.reservations.aggregate([
  { $group: { _id: "$confirmationCode", count: { $sum: 1 }, docs: { $push: { staysId: "$staysId", tenantId: "$tenantId", source: "$source" }}}},
  { $match: { count: { $gt: 1 } } }
]);
```

### 3.6 Auditoria de htpasswd vs tenants

```bash
# No SSH:
TENANTS=$(node -e "require('dotenv').config(); const {MongoClient}=require('mongodb'); (async()=>{const c=new MongoClient(process.env.MONGODB_URI); await c.connect(); const r=await c.db().collection('tenants').find({active:true},{projection:{tenantId:1}}).toArray(); console.log(r.map(t=>t.tenantId).join('\n')); await c.close();})()" )
HTPASSWD_USERS=$(cut -d: -f1 /etc/nginx/.htpasswd)
# Comparar — deve ter 1:1 (ignorando admin/cliente que são contas técnicas)
```

---

## 4. Ações recomendadas (em ordem de prioridade)

### Imediato (esta semana)
- [ ] Aplicar patch Bug 2 (`Object.assign(process.env, crmEnv)` no cancellation_check.js)
- [ ] Aplicar patch Bug 1 (handler Kiwify webhook reconhecer cancel)
- [ ] Aplicar patch Bug 6 (incluir tenant owner email no recipient de cancelamento)

### Próximas 2 semanas
- [ ] Patch Bug 3 (email_fallback usar staysReservationId)
- [ ] Patch Bug 4 (handler submit preferir doc synced)
- [ ] Adicionar endpoint admin pra rename de tenant (com validação cross-collection)
- [ ] Adicionar endpoint admin pra delete físico (com confirmação)

### Próximo mês
- [ ] Criar test suite cobrindo:
  - Cadastro Kiwify happy path
  - Cancelamento Kiwify
  - Onboarding manual de tenant + sync inicial
  - Pré-check-in com tenant correto
  - Cancelamento de reserva (Stays → email recepção → email anfitrião)
- [ ] Cron de garbage collection de stubs antigos
- [ ] Dashboard admin de "saúde do tenant" (consistência cross-coll)

---

## 5. Apêndice — comandos úteis pra rodar a auditoria

(documentação interna — copy/paste no SSH)

```bash
# Estado dos tenants
ssh -i ~/.ssh/id_ed25519_torres -p 22022 root@129.121.49.120 'cd /root/torres-crm-api && node -e "require(\"dotenv\").config(); const {MongoClient}=require(\"mongodb\"); (async()=>{const c=new MongoClient(process.env.MONGODB_URI); await c.connect(); const t=await c.db().collection(\"tenants\").find({},{projection:{tenantId:1,name:1,active:1,plan:1,\"settings.owner.email\":1}}).toArray(); t.forEach(x=>console.log(JSON.stringify(x))); await c.close();})()"'

# Reservas duplicadas (mesmo confirmationCode)
ssh -i ~/.ssh/id_ed25519_torres -p 22022 root@129.121.49.120 'cd /root/torres-crm-api && node -e "require(\"dotenv\").config(); const {MongoClient}=require(\"mongodb\"); (async()=>{const c=new MongoClient(process.env.MONGODB_ATLAS_URI); await c.connect(); const dups=await c.db().collection(\"reservations\").aggregate([{\\$group:{_id:\"\\$confirmationCode\",count:{\\$sum:1},docs:{\\$push:{staysId:\"\\$staysId\",tenantId:\"\\$tenantId\",source:\"\\$source\"}}}},{\\$match:{count:{\\$gt:1}}}]).toArray(); console.log(\"Duplicatas:\",dups.length); dups.forEach(d=>console.log(JSON.stringify(d))); await c.close();})()"'
```
