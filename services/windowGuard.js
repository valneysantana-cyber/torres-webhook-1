'use strict';

/**
 * windowGuard.js — Meta WhatsApp 24h service window guard
 *
 * Meta só entrega texto livre dentro da janela de 24h após a última mensagem
 * recebida do hóspede. Fora dela, Meta aceita o request e retorna messageId
 * mas DROPA silenciosamente. Templates não abrem essa janela; só inbound do
 * hóspede abre.
 *
 * Este módulo:
 *   1. isWindowOpen(phone) — verifica se há inbound ('user' role) nos últimos 24h
 *      via /guest/:phone/context (CRM API).
 *   2. enqueuePending / getPending / ackPending — fila no CRM API (multi-tenant
 *      via tenantId derivado do header X-Remote-User no backend).
 *   3. sendOrQueue(phone, body, sendFn, opts) — wrap aditivo: se janela aberta
 *      executa sendFn; senão enfileira pra drenar quando hóspede mandar inbound.
 *   4. drainPending(phone, sendFn) — chamado no início do webhook inbound;
 *      drena fila ANTES de qualquer outra lógica (idempotente, tolerante a falha).
 *
 * Multi-tenant: o tenantId é resolvido pelo backend CRM via header X-Remote-User
 * (mesma convenção dos outros endpoints /guest/:phone/*). O bot envia X-Remote-User
 * via crmHeaders se CRM_BASIC_AUTH estiver setado, OU passa explicitamente quando
 * o tenant é conhecido (futuro: quando vários tenants usarem este bot).
 */

const { CRM_API_URL, CRM_API_KEY } = require('../config');
const CRM_BASIC_AUTH = process.env.CRM_BASIC_AUTH;
const WINDOW_HOURS = 24;

function crmHeaders(tenantHint) {
  const h = { 'Content-Type': 'application/json' };
  if (CRM_API_KEY)    h['x-api-key'] = CRM_API_KEY;
  if (CRM_BASIC_AUTH) h['Authorization'] = CRM_BASIC_AUTH;
  // tenantHint permite forçar o tenant quando o caller souber. Backend usa
  // este header se CRM_BASIC_AUTH não vier com user, ou aceita por compat.
  if (tenantHint)     h['X-Remote-User'] = tenantHint;
  return h;
}

// ---------- Window check ----------

/**
 * Verifica se a janela de 24h está aberta pra este phone consultando os últimos
 * 30 mensagens no CRM. Janela considera aberta se houver pelo menos uma
 * mensagem com role='user' nos últimos 24h.
 *
 * @param {string} phone Phone limpo (ex: '5511999862133')
 * @returns {Promise<boolean>}
 */
async function isWindowOpen(phone) {
  if (!CRM_API_URL || !phone) return false;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/context?limit=30`, {
      headers: crmHeaders(),
    });
    if (!res.ok) {
      console.warn(`[wg] context fetch failed phone=${phone} status=${res.status}`);
      // Fail-open: se CRM down, deixa enviar — comportamento atual da plataforma
      return true;
    }
    const msgs = await res.json();
    if (!Array.isArray(msgs)) return true;
    const cutoffMs = Date.now() - WINDOW_HOURS * 3600 * 1000;
    return msgs.some((m) => m && m.role === 'user' && m.ts && new Date(m.ts).getTime() >= cutoffMs);
  } catch (err) {
    console.warn(`[wg] isWindowOpen error phone=${phone}:`, err.message);
    return true; // fail-open
  }
}

// ---------- Pending queue (CRM-backed) ----------

async function enqueuePending(phone, body, opts = {}) {
  if (!CRM_API_URL || !phone || !body) return null;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/pending`, {
      method: 'POST',
      headers: crmHeaders(opts.tenantId),
      body: JSON.stringify({ body, reason: opts.reason || null }),
    });
    if (!res.ok) {
      console.error(`[wg] enqueue failed phone=${phone} status=${res.status} ${await res.text()}`);
      return null;
    }
    const j = await res.json();
    console.log(`[wg] enqueued pending id=${j.id} phone=${phone} reason=${opts.reason || '-'} bytes=${body.length}`);
    return j.id;
  } catch (err) {
    console.error('[wg] enqueue error:', err.message);
    return null;
  }
}

async function getPending(phone) {
  if (!CRM_API_URL || !phone) return [];
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/pending`, { headers: crmHeaders() });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j.items) ? j.items : [];
  } catch (err) {
    console.warn('[wg] getPending error:', err.message);
    return [];
  }
}

async function ackPending(phone, id) {
  if (!CRM_API_URL || !phone || !id) return false;
  try {
    const res = await fetch(`${CRM_API_URL}/guest/${phone}/pending/${id}/ack`, {
      method: 'POST', headers: crmHeaders(),
    });
    return res.ok;
  } catch (err) {
    console.warn('[wg] ack error:', err.message);
    return false;
  }
}

// ---------- High-level wrappers ----------

/**
 * Envia se janela aberta; senão enfileira.
 *
 * @param {string} phone
 * @param {string} body Texto pra enviar
 * @param {Function} sendFn Async function que executa o envio (ex: () => sendWhatsAppText(phone, body))
 * @param {object} [opts]
 * @param {string} [opts.tenantId] Hint pra multi-tenant
 * @param {string} [opts.reason] Razão da mensagem (ex: 'email_reply', 'cancellation_followup')
 * @returns {Promise<{sent:boolean, queued:boolean, queuedId?:string}>}
 */
async function sendOrQueue(phone, body, sendFn, opts = {}) {
  const open = await isWindowOpen(phone);
  if (open) {
    try {
      await sendFn();
      return { sent: true, queued: false };
    } catch (err) {
      console.error(`[wg] send failed phone=${phone} — falling back to queue:`, err.message);
      const id = await enqueuePending(phone, body, { ...opts, reason: (opts.reason || '') + '_send_error' });
      return { sent: false, queued: !!id, queuedId: id };
    }
  }
  console.log(`[wg] window CLOSED phone=${phone} reason=${opts.reason || '-'} → queueing`);
  const id = await enqueuePending(phone, body, opts);
  return { sent: false, queued: !!id, queuedId: id };
}

/**
 * Drena pendentes pra este phone. Chamar no início do webhook inbound, ANTES
 * de qualquer outro handler — assim a primeira inbound do hóspede dispara as
 * respostas perdidas antes do bot processar o novo turno.
 *
 * Tolerante a falha: erros não interrompem o fluxo do webhook.
 *
 * @param {string} phone
 * @param {Function} sendFn (body:string) => Promise — função que envia 1 texto
 * @returns {Promise<number>} quantos drenados com sucesso
 */
async function drainPending(phone, sendFn) {
  if (!phone || typeof sendFn !== 'function') return 0;
  let drained = 0;
  try {
    const items = await getPending(phone);
    if (!items.length) return 0;
    console.log(`[wg] draining ${items.length} pending message(s) for phone=${phone}`);
    for (const it of items) {
      try {
        await sendFn(it.body);
        await ackPending(phone, it._id);
        drained++;
        // pequena pausa pra preservar ordem na UI WhatsApp
        await new Promise((r) => setTimeout(r, 800));
      } catch (err) {
        console.error(`[wg] drain item failed id=${it._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[wg] drain error:', err.message);
  }
  return drained;
}

module.exports = {
  isWindowOpen,
  enqueuePending,
  getPending,
  ackPending,
  sendOrQueue,
  drainPending,
};
