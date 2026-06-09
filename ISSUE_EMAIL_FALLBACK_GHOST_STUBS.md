# Bug: email_fallback cria stubs fantasma que poluem busca de pré-check-in

**Severidade:** 🟡 Média (degradação multi-tenant, não loss-of-data)
**Componente:** `/root/email_fallback.js` (cron L2 na VPS) + handler `/checkin/:code/submit`
**Descoberto em:** 2026-05-28 14:38 BRT
**Reportado por:** Valney Santana
**Documentado por:** Claude (assistant)

---

## 1. Sintoma observado

Hóspede preenche o pré-check-in pelo link público (`/checkin/:code`), o
formulário é salvo em `checkin_forms`, mas o registro fica vinculado ao
**tenant errado** (`torres` em vez do tenant proprietário real, `glauco-vaz`).

Como consequência: o pré-check-in **não aparece** no dashboard do anfitrião
correto, mas aparece no dashboard do master/torres.

## 2. Caso real documentado

- Reserva **KQ05J** (Flat 1704, hóspede Valney Santana, CI 2026-06-01)
  - tenant correto: `glauco-vaz` (vinculado via `listings` array)
  - Pré-check-in foi salvo como `tenantId: "torres"` ❌

## 3. Causa raiz (2 bugs em cascata)

### Bug A — `email_fallback.js` cria stub com `staysId` errado

Em `/root/email_fallback.js` linha ~296:
```javascript
await reservations.updateOne(
  { staysId: d.staysId },               // ❌ d.staysId aqui é confirmationCode (5 chars)
  {
    $setOnInsert: {
      staysId: d.staysId,                // ❌ persiste a string curta como staysId
      tenantId: ownerTenantId,
      source: 'email_fallback',
      ...
    },
    $set: { confirmationCode: d.staysId, ... }
  },
  { upsert: true }
);
```

O `d.staysId` extraído do e-mail de notificação do Stays é o
**código alfanumérico de 5 chars** (ex: `KQ05J`), não o `ObjectId` do
MongoDB do Stays (ex: `6a1878e35896af44b59f0bd6`).

Depois quando o `stays_sync.js` roda, ele puxa via API o doc completo da
reserva (que tem `_id = 6a1878e35...`) e faz upsert com
`{ staysId: details._id }` — **cria um doc NOVO** porque o `staysId` é
diferente (`6a1878e35...` ≠ `"KQ05J"`).

Resultado: **2 docs com mesmo `confirmationCode`**.

### Bug B — `email_fallback.resolveOwner()` cai em fallback master quando listing ainda não está mapeado

Quando o stub é criado pelo email_fallback **antes** do tenant correto
ter o listing vinculado (race condition no onboarding de novos tenants),
`resolveOwner(d.accommodation)` cai no fallback (`torres`).

### Bug C — Handler `/checkin/:code/submit` (`index.js` linha 690) pega o doc errado

```javascript
const r = await atlasDb.collection('reservations').findOne({
  $or: [
    { staysId: code },                  // ← bate primeiro no STUB FANTASMA (staysId == code literal)
    { confirmationCode: code },
    { staysReservationId: code }
  ]
});
```

Mongo retorna **o primeiro match do $or**, e o stub fantasma tem
`staysId == code` (texto exato), enquanto o doc real tem `staysId = ObjectId`.

→ Handler usa o `tenantId` do stub fantasma (`torres`) ao gravar o
`checkin_form`.

Note: o handler **GET `/checkin/:code/data`** já tem comentário ciente
desse problema (linha 539-542) mas só fala de "stub do email parser" com
`staysReservationId+PT-strings` — não cobriu este caso onde o stub tem
`staysId` igual ao código.

## 4. Estado descoberto em 2026-05-28

3 stubs fantasma encontrados no Atlas via:
```javascript
db.reservations.find({
  source: "email_fallback",
  $expr: { $eq: [{ $strLenCP: "$staysId" }, 5] },
  syncedAt: { $exists: false }
})
```

Códigos: **NH01J** (24/04), **NU01J** (08/05), **KQ05J** (28/05).
Todos com `tenantId: "torres"` (fallback).

Os 2 primeiros já viraram lixo histórico (reservas passaram). O KQ05J
era atual e causou o bug visível.

## 5. Fix proposto

### Fix A — `email_fallback.js` (mudança crítica)

Trocar a chave de upsert de `staysId` para `staysReservationId`:

```javascript
await reservations.updateOne(
  { staysReservationId: d.staysId, source: 'email_fallback' },   // ← nova chave
  {
    $setOnInsert: {
      staysReservationId: d.staysId,    // ← código curto como staysReservationId
      confirmationCode: d.staysId,
      tenantId: ownerTenantId,
      source: 'email_fallback',
      createdAt: nowTs,
    },
    $set: {
      // NÃO grava staysId — vai ser preenchido depois pelo stays_sync com o ObjectId real
      guestName: d.guestName,
      ...
    },
  },
  { upsert: true }
);
```

E quando o `stays_sync.js` for processar a mesma reserva, ele faz um
**merge** ao invés de criar doc novo (a chave de upsert do sync vira algo
como `{ $or: [{ staysId: details._id }, { staysReservationId: details.id }] }`
priorizando o doc mais rico).

### Fix B — Handler `/checkin/:code/submit` priorizar doc synced

Aplicar a mesma lógica de 2 passos que o handler GET `/checkin/:code/data`
já usa:

```javascript
let r = await atlasDb.collection('reservations').findOne(
  { confirmationCode: code, syncedAt: { $exists: true } }    // primeiro tenta doc synced
);
if (!r) {
  r = await atlasDb.collection('reservations').findOne(
    { $or: [{ staysId: code }, { confirmationCode: code }, { staysReservationId: code }] }
  );
}
```

### Fix C — Cron de garbage-collection de stubs antigos

Adicionar um job semanal que deleta stubs antigos:
```javascript
db.reservations.deleteMany({
  source: 'email_fallback',
  $expr: { $eq: [{ $strLenCP: '$staysId' }, 5] },
  syncedAt: { $exists: false },
  createdAt: { $lt: new Date(Date.now() - 14 * 24 * 3600 * 1000) }  // > 14 dias
});
```

## 6. Workaround manual

Após cada cancelamento Kiwify (ver issue `ISSUE_KIWIFY_WEBHOOK_BUG.md`)
OU sempre que houver onboarding de tenant novo:

- Auditar `db.reservations.find({source:"email_fallback", $expr:{$eq:[{$strLenCP:"$staysId"},5]}})`
- Para cada stub, verificar se há doc synced correspondente (`confirmationCode` match com `syncedAt` presente)
- Se sim, deletar o stub
- Se há `checkin_form` apontando pro stub, atualizar para apontar pro doc synced (corrigir `staysId`, `tenantId`, `listingName`, etc)

## 7. Test plan

- [ ] Simular criação de tenant novo + envio de email Stays ANTES do listing ser vinculado
- [ ] Confirmar que email_fallback NÃO cria stub com `staysId` curto
- [ ] Disparar `stays_sync` depois — confirma que doc é único
- [ ] Acessar link de pré-check-in da reserva — handler deve achar o doc correto
- [ ] Submeter pré-check-in — `checkin_form` salvo com `tenantId` correto
- [ ] Confirmar que dashboard do tenant correto mostra o pré-check-in

## 8. Localização do código

- `email_fallback.js` — `/root/email_fallback.js` (na VPS, não versionado neste clone local)
- `/checkin/:code/submit` handler — `/root/torres-crm-api/index.js` linha 690
- `/checkin/:code/data` handler — `/root/torres-crm-api/index.js` linha 564
- `stays_sync.js` — `/root/stays_sync.js`
