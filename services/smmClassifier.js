'use strict';
/**
 * smmClassifier.js — unifica a lógica de classificação/resposta usada no
 * canal WhatsApp (handlers/whatsapp.js) pra que o pipeline SMM (Central de
 * Mensagens Stays, lendo Booking/Airbnb/Expedia) reuse os MESMOS matchers,
 * respostas e fallback AI já desenvolvidos ao longo de 4 semanas.
 *
 * Criado 13/05/2026. Substitui o array AUTO_REPLY_RULES inline hardcoded
 * que existia em /root/smm_sync.js (11 regras locais — agora deprecado).
 */

const { normalizeText } = require('../utils/formatters');
const { classifyMessage } = require('./classifier');
const { getChatGptFallbackReply } = require('./openai');

// Todos os matchers torres-flavored (mesmos usados no PT_DISPATCH do WA).
const {
  shouldSendGreeting,
  shouldSendThanks,
  shouldSendMenu,
  shouldSendWifi,
  shouldSendBreakfast,
  shouldSendBreakfastCompanion,
  shouldSendPool,
  shouldSendParking,
  shouldSendParkingEarly,
  shouldSendSnacks,
  shouldSendTowels,
  shouldSendFoodOrder,
  shouldSendRestaurant,
  shouldSendDocuments,
  shouldSendHotelAccess,
  shouldSendSafe,
  shouldSendInvoice,
  shouldSendCheckin,
  shouldSendHostingCourse,
  shouldSendCommonAreas,
  shouldSendBedding,
  shouldHandleDateChange,
  shouldSendHotelMaintenance,
  shouldSendSecurity,
  shouldSendTransfer,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldSendCurrentDate,
  shouldSendCurrentTime,
  shouldSendHuman,
} = require('../utils/matchers');

const {
  WIFI_RESPONSE,
  POOL_RESPONSE,
  SNACKS_RESPONSE,
  TOWELS_RESPONSE,
  RESTAURANT_RESPONSE,
  FOOD_ORDER_RESPONSE,
  DOCUMENTS_RESPONSE,
  HOTEL_ACCESS_RESPONSE,
  SAFE_RESPONSE,
  INVOICE_RESPONSE,
  PARKING_EARLY_RESPONSE,
  CHECKIN_RESPONSE,
  HOSTING_COURSE_RESPONSE,
  BREAKFAST_COMPANION_RESPONSE,
  COMMON_AREAS_RESPONSE,
  BEDDING_RESPONSE,
  DATE_CHANGE_RESPONSE,
  HOTEL_MAINTENANCE_RESPONSE,
  SECURITY_RESPONSE,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  HUMAN_ESCALATION_RESPONSE,
  GREETING_RESPONSE,
  THANKS_RESPONSE,
  MENU_RESPONSE,
  getLocationResponse,
} = require('../responses/strings');

// Helpers dinâmicos (precisam tenant pra montar resposta)
let buildBreakfastResponse, buildParkingResponse, getTransferResponse, getCurrentDateBRT, getCurrentTimeBRT;
try {
  ({ buildBreakfastResponse, buildParkingResponse } = require('../responses/strings'));
} catch (_) { /* opcional */ }
try {
  ({ getTransferResponse } = require('../responses/strings'));
} catch (_) { /* opcional */ }
try {
  ({ getCurrentDateBRT, getCurrentTimeBRT } = require('../utils/formatters'));
} catch (_) { /* opcional */ }

// ── Dispatch table (replica do PT_DISPATCH em handlers/whatsapp.js) ──
// Mantenha em sincronia: qualquer rule nova lá deve aparecer aqui.
function getDispatchTable() {
  // Ordem otimizada pra SMM: matchers ESPECÍFICOS antes dos GENÉRICOS.
  // Difere do PT_DISPATCH WhatsApp em alguns pontos (luggage antes de security,
  // checkin antes de current_time) pra evitar falsos positivos vistos no canal.
  return [
    // ── Documentos / Acesso ── ESPECÍFICOS primeiro
    { check: shouldSendDocuments,   reply: () => DOCUMENTS_RESPONSE, source: 'documents' },
    { check: shouldSendHotelAccess, reply: () => HOTEL_ACCESS_RESPONSE, source: 'hotel_access' },
    { check: shouldSendSafe,        reply: () => SAFE_RESPONSE, source: 'safe' },
    { check: shouldSendInvoice,     reply: () => INVOICE_RESPONSE, source: 'invoice' },

    // ── Check-in/out timing (ANTES de current_time pra "que horas check-in") ──
    { check: shouldSendCheckin,     reply: () => CHECKIN_RESPONSE, source: 'checkin' },
    { check: shouldSendParkingEarly, reply: () => PARKING_EARLY_RESPONSE, source: 'parking_early' },

    // ── Pertences / bagagem (ANTES de security pra "deixar malas na recepção") ──
    { check: shouldSendLuggage,     reply: () => LUGGAGE_RESPONSE, source: 'luggage' },

    // ── Serviços do flat ──
    { check: shouldSendWifi,        reply: () => WIFI_RESPONSE, source: 'wifi' },
    { check: shouldSendInternet,    reply: () => INTERNET_RESPONSE, source: 'internet' },
    { check: shouldSendBreakfast,   reply: (_l, t) => buildBreakfastResponse ? buildBreakfastResponse(t) : 'Café da manhã incluso, servido das 06:30 às 10:00 no restaurante do hotel.', source: 'breakfast' },
    { check: shouldSendBreakfastCompanion, reply: () => BREAKFAST_COMPANION_RESPONSE, source: 'breakfast_companion' },
    { check: shouldSendPool,        reply: () => POOL_RESPONSE, source: 'pool' },
    { check: shouldSendParking,     reply: (_l, t) => buildParkingResponse ? buildParkingResponse(t) : 'Estacionamento valet incluso — ao chegar, informe "Flat condomínio".', source: 'parking' },
    { check: shouldSendSnacks,      reply: () => SNACKS_RESPONSE, source: 'snacks' },
    { check: shouldSendTowels,      reply: () => TOWELS_RESPONSE, source: 'towels' },
    { check: shouldSendFoodOrder,   reply: () => FOOD_ORDER_RESPONSE, source: 'food_order' },
    { check: shouldSendRestaurant,  reply: () => RESTAURANT_RESPONSE, source: 'restaurant' },
    { check: shouldSendCommonAreas, reply: () => COMMON_AREAS_RESPONSE, source: 'common_areas' },
    { check: shouldSendBedding,     reply: () => BEDDING_RESPONSE, source: 'bedding' },
    { check: shouldSendCleaning,    reply: () => CLEANING_RESPONSE, source: 'cleaning' },

    // ── Mudança / atendimento ──
    { check: shouldHandleDateChange, reply: () => DATE_CHANGE_RESPONSE, source: 'date_change' },
    { check: shouldSendHotelMaintenance, reply: () => HOTEL_MAINTENANCE_RESPONSE, source: 'hotel_maintenance' },
    { check: shouldSendTransfer,    reply: (lang) => getTransferResponse ? getTransferResponse(lang) : 'Recepção do hotel arruma táxi/Uber. Disque *9 do telefone do quarto.', source: 'transfer' },
    { check: shouldSendLocation,    reply: (lang) => getLocationResponse(lang || 'pt'), source: 'location' },
    { check: shouldSendLongStay,    reply: () => LONG_STAY_RESPONSE, source: 'long_stay' },
    { check: shouldSendSecurity,    reply: () => SECURITY_RESPONSE, source: 'security' },
    { check: shouldSendHostingCourse, reply: () => HOSTING_COURSE_RESPONSE, source: 'hosting_course' },

    // ── Genéricos por último ──
    { check: shouldSendCurrentDate, reply: () => getCurrentDateBRT ? `Hoje é ${getCurrentDateBRT()}.` : `Hoje é ${new Date().toLocaleDateString('pt-BR')}.`, source: 'current_date' },
    { check: shouldSendCurrentTime, reply: () => getCurrentTimeBRT ? `Agora são ${getCurrentTimeBRT()}, horário de Brasília.` : `Agora é ${new Date().toLocaleTimeString('pt-BR')}.`, source: 'current_time' },
    { check: shouldSendHuman,       reply: () => HUMAN_ESCALATION_RESPONSE, source: 'human' },
  ];
}

// ── Sanitização channel-aware ──
// Airbnb anti-side-channel: bloqueia URLs, telefones BR, palavra "WhatsApp".
// Booking/Expedia/Direct: aceitam.
function sanitizeForChannel(text, channel) {
  if (!text) return text;
  if (channel !== 'airbnb') return text;
  // 1) Remove URLs (https/http e wa.me/...)
  let out = String(text).replace(/https?:\/\/\S+/gi, '').replace(/\bwa\.me\/\S+/gi, '');
  // 2) Remove números de telefone BR formatados: (DD) NNNN-NNNN, +55 13 99615-5505, 11 92543 9200
  out = out.replace(/\+?\d{0,3}\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g, '');
  // 3) Remove menção a "WhatsApp" / "Whats App" / "WA"
  out = out.replace(/\b(whats\s*app|whatsapp|wa\b)/gi, 'atendimento');
  // 4) Limpa quebras / pontuação solta deixada
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[:\s\-]+$/gm, '').trim();
  return out;
}

// ── Função principal ──
/**
 * @param {object} args
 * @param {string} args.text          — texto da última mensagem do hóspede
 * @param {string} args.channel       — 'airbnb' | 'bookingcom' | 'expedia' | 'direct' | etc
 * @param {string} [args.guestName]   — nome do hóspede (pra context)
 * @param {object} [args.tenant]      — tenant doc (pra prompts dinâmicos)
 * @param {Array}  [args.history]     — histórico anterior da thread {role, content}
 * @param {string} [args.lang]        — idioma detectado ('pt'|'en'|'es'|'fr')
 * @param {boolean} [args.allowAi]    — se true, AI fallback quando nada match (default false)
 * @returns {Promise<{reply: string|null, source: string, channel: string}>}
 */
async function classifyAndRespond(args) {
  const { text, channel = 'unknown', guestName = '', tenant = null, history = [], lang = 'pt', allowAi = false } = args || {};
  if (!text || !String(text).trim()) {
    return { reply: null, source: 'noop:empty', channel };
  }
  const normalized = normalizeText(text);

  // (1) Escalation classifier (Urgência/Praga/Manutenção/Limpeza/etc) — tem Sofia line nativo
  try {
    const escalation = classifyMessage(text);
    if (escalation && escalation.guestReply) {
      return {
        reply: sanitizeForChannel(escalation.guestReply, channel),
        source: 'classifier:' + escalation.name,
        channel,
      };
    }
  } catch (e) { /* falha silencioso, segue pra matchers */ }

  // (2) Greeting / Thanks / Menu — só se faz sentido (msg curta)
  const words = normalized.trim().split(/\s+/);
  if (shouldSendGreeting(normalized) && !text.includes('?') && words.length <= 5) {
    const greet = typeof GREETING_RESPONSE === 'function' ? GREETING_RESPONSE(guestName) : GREETING_RESPONSE;
    return { reply: sanitizeForChannel(greet, channel), source: 'greeting', channel };
  }
  if (shouldSendThanks(normalized)) {
    return { reply: sanitizeForChannel(THANKS_RESPONSE, channel), source: 'thanks', channel };
  }
  if (shouldSendMenu(normalized)) {
    return { reply: sanitizeForChannel(MENU_RESPONSE, channel), source: 'menu', channel };
  }

  // (3) PT_DISPATCH table — todos os matchers torres
  const table = getDispatchTable();
  for (const entry of table) {
    let matched = false;
    try { matched = !!entry.check(normalized); } catch (e) { /* skip */ }
    if (!matched) continue;
    let reply;
    try { reply = entry.reply(lang, tenant); } catch (e) { reply = null; }
    if (reply) {
      return { reply: sanitizeForChannel(reply, channel), source: 'matcher:' + entry.source, channel };
    }
  }

  // (4) AI fallback (opcional — só se allowAi=true)
  if (allowAi) {
    try {
      const ai = await getChatGptFallbackReply(text, '', history, null, tenant);
      if (ai) {
        return { reply: sanitizeForChannel(ai, channel), source: 'ai', channel };
      }
    } catch (e) {
      console.error('[smmClassifier] AI fallback err:', e.message);
    }
  }

  return { reply: null, source: 'noop:nomatch', channel };
}

module.exports = { classifyAndRespond, sanitizeForChannel };
