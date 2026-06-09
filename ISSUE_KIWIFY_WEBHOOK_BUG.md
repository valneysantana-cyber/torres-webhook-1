# Bug crítico: webhook Kiwify cria tenant fantasma ao cancelar assinatura

**Severidade:** 🔴 Alta
**Componente:** Webhook handler Kiwify (CRM server)
**Descoberto em:** 2026-05-28 13:40 BRT
**Reportado por:** Valney Santana
**Documentado por:** Claude (assistant)

---

## 1. Sintoma observado

Quando uma assinatura Kiwify é cancelada, o webhook handler do ConciergeCloud
**cria um tenant novo** ao invés de marcar o tenant existente como inativo.
Também dispara o email de boas-vindas "Sua conta está ativa! 🎉" no momento do cancelamento.

## 2. Evidência forense (caso real)

### Evento Kiwify (13:38)
- Email enviado por `naoresponder@kiwify.com.br` ao titular
- Assunto: **"Assinatura Cancelada: ConciergeCloud Starter"**
- Corpo: "A sua assinatura foi cancelada. Não ocorrerão novas cobranças
  automáticas desse produto."
- Status no painel Kiwify: `Cancelado pelo produtor`

### Reação do ConciergeCloud (13:40 — 2 minutos depois)
- Email enviado por `torresguest.reserva@gmail.com` ao titular
- Assunto: **"🎉 Configure sua propriedade ConciergeCloud"**
- Corpo: "Recebemos seu pagamento do plano starter. Sua conta já está ativa!"
- Mongo: tenant `valney-santana-1` criado automaticamente (sufixado porque
  já existia `valney-santana`)
- Notificação interna admin: "💰 Novo pagamento Kiwify aprovado"

### Estado do Mongo após o bug
```
tenants:
  - valney-santana     (status: active, mas tenant antigo desativado manualmente)
  - valney-santana-1   (status: active, criado pelo bug)  ← LIXO
```

## 3. Causa raiz (hipótese forte)

Ao cancelar uma assinatura, o Kiwify envia webhook com payload contendo dados
da assinatura **incluindo o status original `paid`/`approved`** em alguma chave
(provavelmente `order.status` ou `subscription.charge.status`). O handler atual
do ConciergeCloud provavelmente faz algo assim:

```javascript
// código atual hipotético (precisa confirmar olhando o handler real)
if (payload.status === 'approved' || payload.status === 'paid') {
  await createTenant(payload);
  await sendWelcomeEmail(payload);
}
```

→ ignora o **tipo do evento** (`webhook_event_type`) e olha só status final.

### 3 falhas combinadas

| # | Falha | Impacto |
|---|---|---|
| 1 | Não distingue `webhook_event_type` (purchase.approved vs subscription.canceled vs subscription.renewed vs order.refunded) | Qualquer evento com status pago é tratado como nova compra |
| 2 | Não tem idempotência por `subscription_id` ou `order_id` | Re-envios do mesmo evento criam tenants duplicados |
| 3 | Não trata cancelamentos como `active: false` | Cancela na Kiwify mas continua "ativo" no ConciergeCloud |

## 4. Fix proposto

### Mudanças no handler do webhook Kiwify

```javascript
router.post('/kiwify/webhook', async (req, res) => {
  // Validação básica de assinatura HMAC (já deve existir; se não, é OUTRO bug)
  // ...

  const evt = req.body;
  const eventType = evt.webhook_event_type || evt.event;  // ex: "order_approved", "subscription_canceled"
  const orderId = evt.order_id || evt.order?.id;
  const subscriptionId = evt.subscription_id || evt.subscription?.id;
  const customerEmail = evt.Customer?.email || evt.customer?.email;

  // 1. Cancelamentos / reembolsos → desativar tenant
  const cancelEvents = [
    'subscription_canceled',
    'subscription.canceled',
    'order_refunded',
    'order.refunded',
    'chargeback',
  ];
  if (cancelEvents.includes(eventType)) {
    const existing = await tenants.findOne({
      $or: [
        { kiwifySubscriptionId: subscriptionId },
        { kiwifyOrderId: orderId },
      ],
    });
    if (existing) {
      await tenants.updateOne(
        { _id: existing._id },
        {
          $set: {
            active: false,
            cancelledAt: new Date(),
            cancellationReason: eventType,
            updatedAt: new Date(),
          },
        }
      );
      // NÃO disparar email de boas-vindas. NÃO criar tenant novo.
      logger.info(`[kiwify] tenant ${existing.tenantId} desativado por ${eventType}`);
    }
    return res.json({ ok: true, action: 'deactivated' });
  }

  // 2. Renovações → só atualizar updatedAt
  const renewEvents = ['subscription_renewed', 'subscription.renewed', 'recurring_payment'];
  if (renewEvents.includes(eventType)) {
    await tenants.updateOne(
      { kiwifySubscriptionId: subscriptionId },
      { $set: { active: true, lastRenewalAt: new Date(), updatedAt: new Date() } }
    );
    return res.json({ ok: true, action: 'renewed' });
  }

  // 3. Aprovações (compra nova) → idempotência + criação
  const approveEvents = ['order_approved', 'order.approved', 'purchase_approved', 'purchase.approved'];
  if (approveEvents.includes(eventType)) {
    // Idempotência: já existe tenant com esse subscription_id ou order_id?
    const existing = await tenants.findOne({
      $or: [
        { kiwifySubscriptionId: subscriptionId },
        { kiwifyOrderId: orderId },
      ],
    });

    if (existing) {
      // Tenant já existia — só reativa se estava inativo, atualiza dados
      if (!existing.active) {
        await tenants.updateOne(
          { _id: existing._id },
          { $set: { active: true, reactivatedAt: new Date(), updatedAt: new Date() } }
        );
      }
      logger.info(`[kiwify] tenant ${existing.tenantId} já existe — re-evento ignorado`);
      return res.json({ ok: true, action: 'reactivated_or_noop', tenantId: existing.tenantId });
    }

    // Cria tenant novo
    const newTenant = await createTenant({
      ...payload,
      kiwifySubscriptionId: subscriptionId,
      kiwifyOrderId: orderId,
    });
    await sendWelcomeEmail(customerEmail, newTenant);
    return res.json({ ok: true, action: 'created', tenantId: newTenant.tenantId });
  }

  // 4. Eventos não tratados → log e ignora
  logger.warn(`[kiwify] evento não tratado: ${eventType}`);
  return res.json({ ok: true, ignored: eventType });
});
```

### Mudanças no schema do tenant

Adicionar 3 campos opcionais:

```javascript
{
  // ... campos existentes ...
  kiwifySubscriptionId: String,    // chave de idempotência
  kiwifyOrderId: String,            // chave de idempotência alternativa
  cancelledAt: Date,
  cancellationReason: String,       // "subscription_canceled" | "order_refunded" | etc
  lastRenewalAt: Date,
}
```

E criar índices:
```javascript
db.tenants.createIndex({ kiwifySubscriptionId: 1 }, { sparse: true });
db.tenants.createIndex({ kiwifyOrderId: 1 }, { sparse: true });
```

## 5. Test plan

### Antes de subir o fix
- [ ] Identificar o arquivo do webhook handler (provável: `crm-server/routes/kiwify.js` ou similar — não encontrado no clone local; vive na VPS)
- [ ] Conferir formato exato do payload Kiwify nos logs (que campo carrega `event_type`)
- [ ] Confirmar se já existe HMAC validation; se não, adicionar antes de qualquer mudança

### Testes manuais (com Postman simulando webhook Kiwify)
- [ ] Disparar `order_approved` com cliente novo → cria tenant + envia email
- [ ] Disparar `order_approved` com mesmo `subscription_id` → não duplica
- [ ] Disparar `subscription_renewed` → não duplica, atualiza `lastRenewalAt`
- [ ] Disparar `subscription_canceled` → marca `active: false`, NÃO envia email de boas-vindas
- [ ] Disparar `order_refunded` → marca `active: false`
- [ ] Disparar evento não conhecido → ignora silencioso, retorna 200

### Limpeza pós-deploy
- [ ] Auditar `tenants` collection: existem outros tenants `valney-santana-N` ou similares?
- [ ] Backfill: para tenants cancelados via Kiwify mas que ficaram `active: true`, marcar `active: false`

## 6. Workaround manual enquanto não tem fix

- Ao cancelar qualquer assinatura no Kiwify, verificar imediatamente no admin se
  apareceu tenant fantasma novo (`<nome>-1`) e desativar manualmente.
- Não confiar no email de "Sua conta está ativa!" que chega no momento do
  cancelamento — esse é o sintoma do bug.

## 7. Localização do código (TODO)

- Não encontrado em `/Users/valneysantana/projetos/torres-webhook/crm-server/index.js`
- Provavelmente em servidor da VPS (`129.121.49.120`), em arquivo separado do
  CRM server que não está versionado neste repo, ou em outro repo.
- **Próximo passo:** localizar e versionar.
