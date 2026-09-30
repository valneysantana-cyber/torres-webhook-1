'use strict';
/**
 * breakfastStatus.js — cliente da FONTE DE VERDADE de cafe da manha.
 *
 * O bot NAO reimplementa a regra: pergunta ao CRM (GET /admin/breakfast-status),
 * que aplica a regra canonica de /opt/torres-crm-api/cafe_rule.js (a mesma do
 * repasse ao proprietario: partner + breakfastIncluded + semcafe_flags + cafe_exempt).
 *
 * FAIL-CLOSED: qualquer falha (CRM fora, timeout, reserva nao identificada,
 * reservas divergentes) devolve { known:false } — e quem chama NAO afirma nada,
 * encaminha pra Sofia. Incidente Calebe QF04J 30/09/2026.
 */
const { CRM_API_URL, CRM_API_KEY } = require('../config');

const TTL_MS = 60 * 1000;   // cache curto: hospede repete a pergunta no mesmo turno
const TIMEOUT_MS = 3500;    // nunca travar a resposta ao hospede
const cache = new Map();
const unknown = reason => ({ known: false, reason, escalate: true });

async function getBreakfastStatus(opts = {}) {
  const { phone, code, partnerCode, guestName, tenantId } = opts;
  if (!CRM_API_URL || !CRM_API_KEY) return unknown('crm-not-configured');
  const qs = new URLSearchParams();
  if (code) qs.set('code', String(code));
  else if (partnerCode) qs.set('partnerCode', String(partnerCode));
  else if (phone) qs.set('phone', String(phone));
  else if (guestName) qs.set('guestName', String(guestName));
  else return unknown('no-identifier');
  if (tenantId) qs.set('tenantId', String(tenantId));

  const key = qs.toString();
  const hit = cache.get(key);
  if (hit && (Date.now() - hit.ts) < TTL_MS) return hit.val;

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${CRM_API_URL}/admin/breakfast-status?${key}`, {
      headers: { 'x-api-key': CRM_API_KEY, Accept: 'application/json' },
      signal: ac.signal,
    });
    if (!r.ok) { console.error('[breakfast] CRM HTTP ' + r.status); return unknown('crm-http-' + r.status); }
    const j = await r.json();
    const ok = j && j.known === true && (j.breakfast === 'included' || j.breakfast === 'not_included');
    const val = ok ? j : unknown((j && j.reason) || 'unknown');
    console.log('[breakfast] ' + key + ' → ' + (ok ? j.breakfast + ' (' + j.reason + ')' : 'DESCONHECIDO (' + val.reason + ')'));
    cache.set(key, { ts: Date.now(), val });
    if (cache.size > 500) { for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 400) break; } }
    return val;
  } catch (e) {
    console.error('[breakfast] CRM err:', e.message);
    return unknown('crm-unreachable');
  } finally { clearTimeout(to); }
}

module.exports = { getBreakfastStatus };
