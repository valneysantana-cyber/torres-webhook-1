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
    checkInTime: '15:00', // 05/10/2026: padrao TorresGuest = 15h (se ficar pronto antes, avisamos)
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
// Cancelamento recente: manter tenant original em vez de cair em cc_sales.
// Janela de 7 dias cobre: hóspede cancela e volta com dúvida/reembolso/remarcação.
const RECENT_CANCELLATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Hospede-cues: indicadores fortes de que a mensagem vem de hóspede ATIVO numa
// unidade (não prospect querendo saber do produto). Adicionado 01/05/2026 após
// caso Cecilia (phone 5511913375485) — disse "estou no 1206" mas não tinha
// reserva linkada via phone (gap stays_sync OU formato divergente) → caía em
// cc_sales e bot respondia como vendedor B2B em vez de concierge TorresGuest.
function hasActiveGuestCues(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return (
    /\bestou\s+(no|na)\s+(\d{2,5}|flat|apartamento|quarto|suite|suíte|hotel|hospedagem)\b/.test(t) ||
    /\b(minha|meu)\s+(reserva|estadia|check.?in|check.?out|hospedagem|estad\w+)\b/.test(t) ||
    /\b(no|na)\s+(quarto|apartamento|suite|suíte|flat|unidade)\s+\d/.test(t) ||
    /\b(check.?out|check.?in)\s+(às|ate|até|por\s+volta)/.test(t) ||
    /\bunidade\s+\d/.test(t) ||
    // Amenities / comodidades — hóspede já hospedado se queixando da unidade.
    // Adicionado 12/05/2026 após caso Rhavi (JV05J): bot caiu em cc_sales e
    // respondeu como vendedor pra "O quarto não tem shampoo".
    /\b(o |a |meu |minha )?(quarto|banheiro|apartamento|unidade|flat|suite|suíte)\s+(n[aã]o\s+)?(tem|t[aá]|est[aá]\s+sem)\b/.test(t) ||
    // amenities — referência direta a item de quarto (com ou sem palavras "tem mais", "sem", "falta")
    /\b(shampoo|sabonete|condicionador|chinelo|amenities|amenidade)\b/.test(t) ||
    /\bpapel\s+higi/.test(t) ||
    /\btoalha\s+(de\s+)?(banho|rosto|piso)/.test(t) ||
    /\b(sem|falta|faltando|cad[eê]|onde\s+(t[aá]|tem)|tem\s+mais)\s+(toalha|len[çc]ol|fronha|secador|escova)/.test(t) ||
    /\b(preciso|queria|gostaria)\s+(de\s+)?(mais\s+)?(toalha|len[çc]ol|fronha|shampoo|sabonete|papel\s+higi|amenities|amenidade)/.test(t)
  );
}

// Brazilian mobile phones têm 2 formatos comuns:
//   • 12 dígitos: 55DDXXXXXXXX (formato antigo / desktop / OTAs antigas)
//   • 13 dígitos: 55DD9XXXXXXXX (formato moderno com 9-prefix, padrão Meta WhatsApp)
// Se a reserva foi salva num formato e a msg WhatsApp chega no outro, o match
// exato falha. Gera as duas variantes pra busca com $in.
// Caso real (Rhavi, JV05J, 12/05/2026): WA enviou 554199404012 mas reserva tinha
// 5541999404012 — exact match falhou e tenant resolveu pra cc_sales (prospect).
function phoneVariants(phone) {
  if (!phone) return [];
  const digits = String(phone).replace(/\D/g, '');
  const out = new Set([digits]);
  // BR mobile padrão 55 + DDD (2) + 9 (mobile prefix) + 8 dígitos = 13 dígitos
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    // 13 → 12 (remove o 9)
    out.add(digits.slice(0, 4) + digits.slice(5));
  } else if (digits.length === 12 && digits.startsWith('55')) {
    // 12 → 13 (insere o 9 após DDD)
    out.add(digits.slice(0, 4) + '9' + digits.slice(4));
  }
  return [...out];
}


// ---- Roteamento de vendas por intencao (Valney 19/08/2026) ----------------
// Prospect SEM reserva pode ser lead de DUAS ofertas distintas no MESMO numero:
//   - cc_saas_erp: HubGenial (site+loja+ERP p/ PMEs) — oferta nova
//   - cc_sales:    ConciergeCloud hospedagem (Airbnb/pousadas) — oferta legada
// Sinais de ouro: os CTAs do site HubGenial pre-preenchem a msg com
// "HubGenial"/"plano Presenca|Operacao|Inteligencia" → deteccao confiavel.
// Ambiguo → cc_saas_erp: o prompt dele ABRE perguntando o tipo de negocio
// (triagem natural) e tem instrucao de encaminhar hospedagem ao time certo.
// A escolha e PERSISTIDA por telefone (ProspectContext) p/ nao pular de
// contexto no meio da conversa; sinal explicito posterior pode trocar.
const _strip = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const HUB_SALES_RE = /(hubgenial|hub genial|plano (presenca|operacao|inteligencia)|15 dias|teste gratis|site profissional|loja online|loja virtual|\berp\b|sistema de gestao|gestao (financeira|do negocio|da loja|da clinica)|emissao fiscal|nota fiscal|nf-?e|nfs-?e|prontuario|odontograma|agenda(mento)? online|salao|barbearia|clinica|consultorio|petshop|restaurante|delivery|corretor|consultoria financeira|memoria de cliente|quero um site|fazer meu site|criar (um )?site)/;
const HOSP_SALES_RE = /(airbnb|pousada|hotel|hospedagem|anfitria|anfitriao|hospede|temporada|reserva|check.?in|check.?out|stays|flat|apartamento de temporada|concierge)/;
const HUB_GOLD_RE = /(hubgenial|hub genial|concierge ia|plano (vitrine|loja|gestao|empresa|presenca|operacao|inteligencia))/;
function pickProspectTenant(messageText, storedTenantId) {
  const t = _strip(messageText);
  const hub = HUB_SALES_RE.test(t);
  const hosp = HOSP_SALES_RE.test(t);
  if (hub && !hosp) return 'cc_saas_erp';
  if (hosp && !hub) return 'cc_sales';
  if (storedTenantId) return storedTenantId;      // ambiguo/sem sinal: mantem o contexto ja escolhido
  return 'cc_saas_erp';                          // 1o contato ambiguo: Hub abre com pergunta de triagem
}

async function resolveTenantByGuestPhone(phone, fallbackTenant, messageText) {
  if (!phone || !fallbackTenant) return fallbackTenant;
  // SINAL-OURO (Valney 19/08): msg cita a marca/planos HubGenial → bot de vendas
  // cc_saas_erp MESMO que o telefone tenha reserva TorresGuest. Caso real: o
  // proprio Valney (numero cadastrado como hospede de teste) clicou no CTA do
  // site e caiu no concierge. Ninguem digita "HubGenial" por acaso — e hospede
  // com negocio proprio e cross-sell legitimo. Regex ESTREITA de proposito.
  try {
    if (messageText && HUB_GOLD_RE.test(_strip(messageText))) {
      const hubT = await fetchTenantById('cc_saas_erp');
      if (hubT && hubT.active !== false) {
        console.log('[tenant] phone=' + phone + ' sinal-ouro HubGenial → cc_saas_erp (override, ignora reserva)');
        return hubT;
      }
    }
  } catch (e) { console.warn('[tenant] gold-override falhou:', e.message); }
  try {
    const Reservation = require('../models/Reservation');
    const phones = phoneVariants(phone);

    // 1. Busca reserva ATIVA (não cancelada) mais recente — tenta TODAS variantes
    const active = await Reservation.findOne({
      guestPhoneClean: { $in: phones },
      status: { $nin: ['cancelado', 'no-show'] },
    }).sort({ checkInDate: -1, createdAt: -1 }).lean();

    if (active && active.tenantId) {
      if (active.tenantId === fallbackTenant.tenantId) return fallbackTenant;
      const t = await fetchTenantById(active.tenantId);
      return (t && t.tenantId) ? t : fallbackTenant;
    }

    // 2. Sem reserva ativa: checar cancelamento recente (janela 7d)
    // Mantém o tenant original pra hóspede cancelado conversar sobre
    // reembolso/remarcação no contexto certo, em vez de virar prospect SaaS.
    const recentCancel = await Reservation.findOne({
      guestPhoneClean: { $in: phones },
      status: { $in: ['cancelado', 'no-show'] },
    }).sort({ updatedAt: -1, checkInDate: -1 }).lean();

    if (recentCancel && recentCancel.tenantId) {
      const cancelTs = recentCancel.cancellationReasonReceivedAt
        || recentCancel.cancellationRetentionSentAt
        || recentCancel.updatedAt
        || recentCancel.createdAt;
      const ageMs = cancelTs ? (Date.now() - new Date(cancelTs).getTime()) : Infinity;
      if (ageMs < RECENT_CANCELLATION_WINDOW_MS) {
        console.log('[tenant] phone=' + phone + ' cancelamento recente (' + Math.round(ageMs / 3600000) + 'h) → mantendo tenant=' + recentCancel.tenantId);
        if (recentCancel.tenantId === fallbackTenant.tenantId) return fallbackTenant;
        const t = await fetchTenantById(recentCancel.tenantId);
        if (t && t.tenantId) return t;
      }
    }

    // 3. Sem reserva ativa nem cancelada recente → prospect cc_sales
    // GUARD (01/05/2026): se a msg tem sinal forte de hóspede ATUAL ("estou no 1206",
    // "minha reserva", "checkout até 14h") NÃO cair em cc_sales — provavelmente
    // hóspede legítimo cuja reserva não foi linkada pelo phone (gap sync OU
    // formato divergente). Mantém fallback (torres) que tem prompt de concierge.
    if (messageText && hasActiveGuestCues(messageText)) {
      console.log('[tenant] phone=' + phone + ' sem reserva mas msg tem hospede-cues → mantendo fallbackTenant=' + fallbackTenant.tenantId + ' (não cc_sales)');
      return fallbackTenant;
    }
    // Roteia o prospect entre as ofertas (site+ERP vs hospedagem) e persiste.
    let storedId = null;
    let ProspectContext = null;
    try {
      ProspectContext = require('../models/ProspectContext');
      const stored = await ProspectContext.findOne({ phoneClean: { $in: phones } }).lean();
      if (stored) storedId = stored.tenantId;
    } catch (e) { console.warn('[tenant] prospect-context read falhou:', e.message); }
    const targetId = pickProspectTenant(messageText, storedId);
    if (ProspectContext && targetId !== storedId) {
      try {
        await ProspectContext.updateOne({ phoneClean: phones[0] }, { $set: { tenantId: targetId, updatedAt: new Date() } }, { upsert: true });
      } catch (e) { console.warn('[tenant] prospect-context write falhou:', e.message); }
    }
    const sales = await fetchTenantById(targetId);
    if (sales && sales.active !== false) {
      console.log('[tenant] phone=' + phone + ' sem reserva → ' + targetId + ' (prospect' + (storedId ? ', contexto salvo: ' + storedId : '') + ')');
      return sales;
    }
    // tenant alvo inativo/inexistente → tenta o outro balde de vendas; senao legado
    const alt = targetId === 'cc_sales' ? 'cc_saas_erp' : 'cc_sales';
    const salesAlt = await fetchTenantById(alt);
    if (salesAlt && salesAlt.active !== false) {
      console.log('[tenant] phone=' + phone + ' sem reserva → ' + alt + ' (fallback: ' + targetId + ' indisponivel)');
      return salesAlt;
    }
    return fallbackTenant;
  } catch (e) {
    console.error('[tenant] resolveTenantByGuestPhone error:', e.message);
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
  pickProspectTenant,
  resolveTenantByGuestPhone,
  resolveTenantByAccommodation,
  fetchTenantById,
  invalidateCache,
  phoneVariants,
  hasActiveGuestCues,
  TORRES_DEFAULT,
};
