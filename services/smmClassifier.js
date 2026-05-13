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
  shouldSendPreCheckinWhoCan,
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
  shouldSendFrigobarPix,
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
  PRE_CHECKIN_WHO_CAN_RESPONSE,
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
  FRIGOBAR_PIX_RESPONSE,
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
    // Pré-checkin "quem pode fazer" ANTES de shouldSendCheckin (pra não cair em
    // resposta genérica sobre horário). Caso Sofia 13/05/2026.
    { check: shouldSendPreCheckinWhoCan, reply: () => PRE_CHECKIN_WHO_CAN_RESPONSE, source: 'pre_checkin_who_can' },
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
    // Frigobar PIX / pagamento — ANTES de towels/bedding/cleaning pra capturar
    // "Qual o pix para pagamento da água?" sem cair em reposição/Limpeza.
    // Adicionado 13/05/2026.
    { check: shouldSendFrigobarPix, reply: () => FRIGOBAR_PIX_RESPONSE, source: 'frigobar_pix' },
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
// Detecta pedido de contato externo no Airbnb. Airbnb bloqueia URLs/telefones/
// "WhatsApp" — respostas com contato viram inúteis após sanitize. Fluxo correto:
// 1) Reply neutra ao hóspede ("conecto com humano em instantes")
// 2) Dispatch WhatsApp pra Sofia/operacional responder no canal manualmente
function isAirbnbContactRequest(text) {
  const t = normalizeText(text);
  return /\b(qual\s+(e|o|a)\s+(o\s+)?(numero|telefone|contato|whats|wa|zap)|qual\s+o\s+whats|como\s+(eu\s+)?(falo|chamo|converso|contato)|telefone|n[uú]mero\s+(da|do|de)|whats\s*a?p?p?|\bwpp\b|fale\s+com\s+(a\s+)?(sofia|valney|atendimento|recep[cç][aã]o)|conversar\s+(com|por))\b/.test(t);
}

async function classifyAndRespond(args) {
  const { text, channel = 'unknown', guestName = '', tenant = null, history = [], lang = 'pt', allowAi = false } = args || {};
  if (!text || !String(text).trim()) {
    return { reply: null, source: 'noop:empty', channel };
  }
  const normalized = normalizeText(text);

  // (0.5) Airbnb-only: pedido de contato externo → dispatch + reply neutra.
  // Adicionado 13/05/2026 após observação real: hóspedes Sofia, Jade etc.
  // pedem "Qual é o número?", "Como falo com a Sofia?" — Airbnb bloqueia
  // qualquer resposta com URL/fone/palavra "WhatsApp" via sanitize, então
  // a resposta automatizada vira inútil ("fale com Sofia no atendimento").
  // Em vez disso: aciona humano via dispatch WA + responde neutra ao hóspede.
  if (channel === 'airbnb' && isAirbnbContactRequest(text)) {
    return {
      reply: 'Já te conectei com nossa equipe! 😊 Em instantes alguém responde por aqui mesmo. Aguenta firme!',
      source: 'dispatch:airbnb_contact_request',
      channel,
      dispatchAlert: true,
      dispatchBody: '🚨 *Airbnb — Pedido de contato externo*\n👤 Hóspede: ' + (guestName || 'sem nome') + '\n💬 "' + String(text).slice(0, 200) + '"\n\nAirbnb bloqueia URLs/telefones — responda diretamente no Stays SMM:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

  // (0.6) Pedidos de reposição física de amenities → dispatch pra equipe Sofia
  // executar fisicamente. Aplica a TODOS os canais porque é ação humana.
  // Adicionado 13/05/2026 após casos reais:
  //   - "Para repor água?" (caso 1) — Valney respondeu manualmente
  //   - "Tem shampoo?" (caso 2) — classifier Limpeza respondeu mas sem dispatch
  //
  // Usa normalizeText (strip diacríticos) porque \b em JS regex falha com
  // "água"/"manhã"/etc — "ã" não é \w → boundary quebra. NFD strip resolve.
  {
    const tn = normalized;
    // Items de amenities físicas que governança/Sofia repõe
    const items = {
      agua: /\bagua\b/,
      shampoo: /\bshampoo\b/,
      sabonete: /\bsabonete\b/,
      condicionador: /\bcondicionador\b/,
      papel_higienico: /\bpapel\s+higienico\b/,
      toalha: /\btoalha(s)?\b/,
      lencol: /\blenco(l|is)\b/,
      fronha: /\bfronha(s)?\b/,
      // Bedding items adicionados 13/05/2026: antes caíam em Limpeza category
      // (genérica) — agora geram dispatch específico pra Sofia/governança.
      travesseiro: /\btravesseiro(s)?\b/,
      cobertor: /\bcobertor(es)?\b/,
      edredom: /\bedrede?om\b|\bedredon(s)?\b/,
      colcha: /\bcolcha(s)?\b/,
      chinelo: /\bchinelo(s)?\b/,
      escova_dente: /\bescova(\s+de\s+dente)?\b|\bcreme\s+dental\b|\bpasta\s+dente\b/,
      amenidades: /\bamenidades?\b|\bamenities\b/,
    };
    // Verbos/expressões de intenção (precisa OU tem item + presença)
    const intent = /\b(repor|reposicao|trocar|colocar|acabou|terminou|sem|falta|faltando|preciso|precisamos|gostaria|queria|mais|tem(\s+como|\s+mais)?|cad[eê]|onde|pode|trazer|providenciar?|nova|novo|nao\s+tem|nao\s+ha|nova\s+garrafa|garrafa)\b/;
    let matchedItem = null;
    for (const [key, rx] of Object.entries(items)) {
      if (rx.test(tn)) { matchedItem = key; break; }
    }
    // Exclusões: perguntas geográficas que mencionam "agua" mas não são pedido
    // (água termal, parque aquático, fonte de água, etc).
    const isLocationLike = /\b(termal|aquatic|aquatico|parque|fonte|cachoeira|lago|rio|praia|piscina|onde\s+fica|onde\s+tem|mais\s+proxima)\b/.test(tn);
    // Fix 13/05/2026 (caso Sofia "Qual o pix para pagamento da água?"):
    // perguntas de PAGAMENTO/PIX/cardápio/valor NÃO são pedido de reposição —
    // são pergunta de consumo (frigobar). Pular bloco amenity_refill e deixar
    // PT_DISPATCH table tratar via shouldSendFrigobarPix → FRIGOBAR_PIX_RESPONSE
    // (que tem CNPJ PIX + cardápio completo).
    const isPaymentIntent = /\b(pix|pagar|pagamento|pagaria|consumo|cardapio|cardápio|quanto\s+(custa|vale|e)|qual\s+(o\s+)?(valor|preco|preço)|valor\s+(da|do)|preco\s+(da|do)|preço\s+(da|do))\b/.test(tn);
    // Pra item match + intent OU pergunta direta com "?" no item ("Tem shampoo?")
    const isQuestion = text.includes('?');
    if (matchedItem && !isLocationLike && !isPaymentIntent && (intent.test(tn) || isQuestion)) {
      const labels = {
        agua: 'água', shampoo: 'shampoo', sabonete: 'sabonete', condicionador: 'condicionador',
        papel_higienico: 'papel higiênico', toalha: 'toalha', lencol: 'lençol', fronha: 'fronha',
        travesseiro: 'travesseiro', cobertor: 'cobertor', edredom: 'edredom', colcha: 'colcha',
        chinelo: 'chinelo', escova_dente: 'escova/creme dental', amenidades: 'amenidades',
      };
      const label = labels[matchedItem] || matchedItem;
      // Ícone temático por categoria
      const beddingItems = ['travesseiro', 'cobertor', 'edredom', 'colcha', 'lencol', 'fronha'];
      const icon = matchedItem === 'agua' ? '💧'
        : beddingItems.includes(matchedItem) ? '🛏️'
        : '🧴';
      return {
        reply: `${icon} Anotei! Já estou solicitando à governança a reposição de ${label} no seu apartamento. Em breve alguém passa por aí. 🌴`,
        source: 'dispatch:amenity_refill:' + matchedItem,
        channel,
        dispatchAlert: true,
        dispatchBody: `${icon} *Reposição de ${label} — pedido do hóspede*\n👤 ${guestName || 'sem nome'} (${channel})\n💬 "${String(text).slice(0, 200)}"\n\nProvidenciar ${label} no quarto. Thread no dashboard:\nhttps://conciergecloud.com.br/admin/mensagens.html`,
      };
    }
  }

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
