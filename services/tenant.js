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

module.exports = {
  getTenantByPhoneId,
  invalidateCache,
  TORRES_DEFAULT,
};
