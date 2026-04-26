'use strict';

/**
 * tenant.js — Fetcher de configuracao de tenant a partir da CRM API.
 *
 * Cacheia em memoria por 5min (TTL) pra reduzir chamadas HTTP por webhook.
 * Usa phone_number_id do WhatsApp Meta como chave primaria de lookup.
 *
 * Fallback: se tenant nao encontrado, retorna TORRES_DEFAULT (comportamento legado).
 */

const { CRM_API_URL, CRM_API_KEY } = require('../config');

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // phoneId -> { tenant, ts }

const TORRES_DEFAULT = {
  tenantId: 'torres',
  name: 'Apartamento Torres',
  plan: 'starter',
  settings: {
    systemPrompt: null, // null => usa SYSTEM_PROMPT hardcoded em openai.js
    welcomeMessage: null,
    humanEscalationNumber: '5513996155505',
    checkInTime: '14:00',
    checkOutTime: '12:00',
    brandName: 'TorresGuest',
  },
  active: true,
  _isDefault: true,
};

async function fetchTenantByPhoneId(phoneId) {
  if (!CRM_API_URL || !CRM_API_KEY) return null;
  try {
    const r = await fetch(`${CRM_API_URL}/admin/tenant-by-phoneid/${encodeURIComponent(phoneId)}`, {
      method: 'GET',
      headers: { 'x-api-key': CRM_API_KEY, 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.tenant || null;
  } catch (e) {
    console.error('[tenant] fetch error:', e.message);
    return null;
  }
}

/**
 * Retorna tenant completo ou Torres default.
 * @param {string} phoneId - WhatsApp Business phone_number_id
 * @returns {Promise<object>}
 */
async function getTenantByPhoneId(phoneId) {
  if (!phoneId) return TORRES_DEFAULT;
  const now = Date.now();
  const c = cache.get(phoneId);
  if (c && (now - c.ts) < CACHE_TTL_MS) return c.tenant;

  const t = await fetchTenantByPhoneId(phoneId);
  const finalTenant = t || TORRES_DEFAULT;
  cache.set(phoneId, { tenant: finalTenant, ts: now });
  return finalTenant;
}

/** Invalida cache (usado quando admin atualiza config) */
function invalidateCache(phoneId) {
  if (phoneId) cache.delete(phoneId);
  else cache.clear();
}

/**
 * Resolve tenant dono de uma reserva ativa do hospede.
 *
 * Em shared-infra (1 WABA Meta atende vários tenants), todas as msgs entram
 * pelo mesmo `phone_number_id` → `getTenantByPhoneId` retorna o master.
 * Pra customizar respostas por propriedade, precisamos saber QUAL reserva do
 * hospede tá ativa agora e usar o `tenantId` dela.
 *
 * Fluxo:
 *   1. phone → Reservation.findActive(phone) → reservation.tenantId → fetch tenant config
 *   2. Sem reserva: tenta `cc_sales` (contexto pré-vendas/produto ConciergeCloud)
 *   3. Sem cc_sales: cai no fallbackTenant (legacy comportamento)
 *
 * Por que cc_sales: o número do WhatsApp ConciergeCloud é divulgado na landing
 * pra prospects/visitantes do site. Sem reserva = lead querendo saber do produto,
 * NÃO hóspede TorresGuest. cc_sales tem systemPrompt de vendas (vide tenant doc).
 *
 * @param {string} phone Guest phone E.164 digits (e.g. "5511999999999")
 * @param {object} fallbackTenant Master tenant (do getTenantByPhoneId)
 * @returns {Promise<object>} Tenant com settings do dono da reserva ativa OU cc_sales
 */
async function resolveTenantByGuestPhone(phone, fallbackTenant) {
  if (!phone || !fallbackTenant) {
    console.log('[tenant-debug] skip phone=' + phone + ' fallback=' + (fallbackTenant && fallbackTenant.tenantId));
    return fallbackTenant;
  }
  try {
    const Reservation = require('../models/Reservation');
    // Busca reserva mais recente do phone, com preferência pra ativa (check-out futuro)
    const res = await Reservation.findOne({
      guestPhoneClean: phone,
      status: { $nin: ['cancelado', 'no-show'] },
    }).sort({ checkInDate: -1, createdAt: -1 }).lean();

    console.log('[tenant-debug] phone=' + phone + ' reservation=' + (res ? JSON.stringify({tenantId: res.tenantId, status: res.status, name: res.guestName}) : 'NULL'));

    // Sem reserva → é prospect do site. Tenta cc_sales.
    if (!res || !res.tenantId) {
      const sales = await fetchTenantById('cc_sales');
      console.log('[tenant-debug] cc_sales fetch: ' + (sales ? 'tenantId=' + sales.tenantId + ' active=' + sales.active : 'NULL/error'));
      if (sales && sales.active !== false) {
        console.log('[tenant] phone=' + phone + ' sem reserva → cc_sales (prospect)');
        return sales;
      }
      console.warn('[tenant] cc_sales unavailable → fallback ' + fallbackTenant.tenantId);
      return fallbackTenant;
    }

    if (res.tenantId === fallbackTenant.tenantId) {
      console.log('[tenant-debug] reserva matches fallback (' + fallbackTenant.tenantId + '), no fetch');
      return fallbackTenant;
    }

    // Reserva ativa → carrega tenant dono
    const t = await fetchTenantById(res.tenantId);
    console.log('[tenant-debug] fetched ' + res.tenantId + ': ' + (t ? 'OK' : 'NULL'));
    return (t && t.tenantId) ? t : fallbackTenant;
  } catch (e) {
    console.error('[tenant] resolveTenantByGuestPhone error:', e.message, e.stack);
    return fallbackTenant;
  }
}

async function fetchTenantById(tenantId) {
  if (!CRM_API_URL || !tenantId) return null;
  try {
    const r = await fetch(`${CRM_API_URL}/admin/tenant-by-id/${encodeURIComponent(tenantId)}`, {
      method: 'GET',
      headers: { 'x-api-key': CRM_API_KEY, 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.tenant || data || null;
  } catch (e) {
    console.error('[tenant] fetchTenantById error:', e.message);
    return null;
  }
}

/**
 * Resolve tenant + listingStaysId pelo NOME da acomodação (campo "Acomodação"
 * do email Stays). Usado pelo email parser que não tem o ObjectId do listing.
 *
 * Faz reverse-lookup via CRM API `/admin/tenant-by-accommodation/:name` que
 * percorre tenants ativos e procura match em credentials.listingNamesJson.
 *
 * @param {string} accommodationName Ex: "1607" ou "404"
 * @returns {Promise<{ tenant: object, listingStaysId: string }|null>}
 */
async function resolveTenantByAccommodation(accommodationName) {
  if (!accommodationName || !CRM_API_URL) return null;
  try {
    const r = await fetch(`${CRM_API_URL}/admin/tenant-by-accommodation/${encodeURIComponent(String(accommodationName).trim())}`, {
      method: 'GET',
      headers: { 'x-api-key': CRM_API_KEY, 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.tenant ? { tenant: data.tenant, listingStaysId: data.listingStaysId } : null;
  } catch (e) {
    console.error('[tenant] resolveTenantByAccommodation error:', e.message);
    return null;
  }
}

module.exports = {
  getTenantByPhoneId,
  resolveTenantByGuestPhone,
  resolveTenantByAccommodation,
  invalidateCache,
  TORRES_DEFAULT,
};
