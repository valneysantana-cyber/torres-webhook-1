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
const { detectLanguage } = require('../utils/matchers');
const { getResponseForTenant } = require('../responses/strings');

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
  shouldSendReceptionExtension,
  shouldSendVoltage,
  shouldSendTransfer,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldEscalateLateCheckout,
  shouldEscalateThirdPartyReservation,
  shouldEscalateLuggageStorage,
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
  RECEPTION_EXTENSION_RESPONSE,
  VOLTAGE_RESPONSE,
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

// Helpers dinâmicos (precisam tenant/lang pra montar resposta)
let buildBreakfastResponse, buildParkingResponse, getTransferResponse,
    getGreetingResponse, getCurrentDateResponse, getCurrentTimeResponse,
    getCurrentDateBRT, getCurrentTimeBRT;
try {
  ({ buildBreakfastResponse, buildParkingResponse } = require('../responses/strings'));
} catch (_) { /* opcional */ }
try {
  ({ getTransferResponse } = require('../responses/strings'));
} catch (_) { /* opcional */ }
try {
  ({ getGreetingResponse, getCurrentDateResponse, getCurrentTimeResponse } = require('../responses/strings'));
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
  // Bug fix 18/05/2026 — caso LV01J (Booking):
  // Todas as replies agora passam (lang, tenant) e usam getResponseForTenant
  // pra retornar a resposta no idioma certo. Antes ignoravam o lang e
  // respondiam sempre em PT, mesmo com hóspede escrevendo em EN/ES/FR.
  const i18n = (key, fallback) => (lang, tenant) => {
    const r = getResponseForTenant(key, lang || 'pt', tenant);
    return r || fallback;
  };

  return [
    // ── Documentos / Acesso ── ESPECÍFICOS primeiro
    { check: shouldSendDocuments,   reply: i18n('DOCUMENTS',     DOCUMENTS_RESPONSE),     source: 'documents' },
    { check: shouldSendHotelAccess, reply: i18n('HOTEL_ACCESS',  HOTEL_ACCESS_RESPONSE),  source: 'hotel_access' },
    { check: shouldSendSafe,        reply: i18n('SAFE',          SAFE_RESPONSE),          source: 'safe' },
    { check: shouldSendInvoice,     reply: i18n('INVOICE',       INVOICE_RESPONSE),       source: 'invoice' },

    // ── Check-in/out timing (ANTES de current_time pra "que horas check-in") ──
    // Pré-checkin "quem pode fazer" ANTES de shouldSendCheckin (pra não cair em
    // resposta genérica sobre horário). Caso Sofia 13/05/2026.
    { check: shouldSendPreCheckinWhoCan, reply: i18n('PRE_CHECKIN_WHO_CAN', PRE_CHECKIN_WHO_CAN_RESPONSE), source: 'pre_checkin_who_can' },
    { check: shouldSendCheckin,     reply: i18n('CHECKIN',       CHECKIN_RESPONSE),       source: 'checkin' },
    { check: shouldSendParkingEarly, reply: i18n('PARKING_EARLY', PARKING_EARLY_RESPONSE), source: 'parking_early' },

    // ── Pertences / bagagem (ANTES de security pra "deixar malas na recepção") ──
    { check: shouldSendLuggage,     reply: i18n('LUGGAGE',       LUGGAGE_RESPONSE),       source: 'luggage' },

    // ── Serviços do flat ──
    { check: shouldSendWifi,        reply: i18n('WIFI',          WIFI_RESPONSE),          source: 'wifi' },
    { check: shouldSendInternet,    reply: i18n('INTERNET',      INTERNET_RESPONSE),      source: 'internet' },
    { check: shouldSendBreakfast,   reply: (lang, t) => buildBreakfastResponse ? buildBreakfastResponse(t, lang) : 'Café da manhã incluso, servido das 06:30 às 10:00 no restaurante do hotel.', source: 'breakfast' },
    { check: shouldSendBreakfastCompanion, reply: i18n('BREAKFAST_COMPANION', BREAKFAST_COMPANION_RESPONSE), source: 'breakfast_companion' },
    { check: shouldSendPool,        reply: i18n('POOL',          POOL_RESPONSE),          source: 'pool' },
    { check: shouldSendParking,     reply: (lang, t) => buildParkingResponse ? buildParkingResponse(t, lang) : 'Estacionamento valet incluso — ao chegar, informe "Flat condomínio".', source: 'parking' },
    { check: shouldSendSnacks,      reply: i18n('SNACKS',        SNACKS_RESPONSE),        source: 'snacks' },
    // Frigobar PIX / pagamento — ANTES de towels/bedding/cleaning pra capturar
    // "Qual o pix para pagamento da água?" sem cair em reposição/Limpeza.
    // Adicionado 13/05/2026.
    { check: shouldSendFrigobarPix, reply: i18n('FRIGOBAR_PIX', FRIGOBAR_PIX_RESPONSE), source: 'frigobar_pix' },
    { check: shouldSendTowels,      reply: i18n('TOWELS',        TOWELS_RESPONSE),        source: 'towels' },
    { check: shouldSendFoodOrder,   reply: i18n('FOOD_ORDER', FOOD_ORDER_RESPONSE), source: 'food_order' },
    { check: shouldSendRestaurant,  reply: i18n('RESTAURANT',    RESTAURANT_RESPONSE),    source: 'restaurant' },
    { check: shouldSendCommonAreas, reply: i18n('COMMON_AREAS',  COMMON_AREAS_RESPONSE),  source: 'common_areas' },
    { check: shouldSendBedding,     reply: i18n('BEDDING',       BEDDING_RESPONSE),       source: 'bedding' },
    { check: shouldSendCleaning,    reply: i18n('CLEANING',      CLEANING_RESPONSE),      source: 'cleaning' },

    // ── Mudança / atendimento ──
    { check: shouldHandleDateChange, reply: i18n('DATE_CHANGE',  DATE_CHANGE_RESPONSE),   source: 'date_change' },
    { check: shouldSendHotelMaintenance, reply: i18n('HOTEL_MAINTENANCE', HOTEL_MAINTENANCE_RESPONSE), source: 'hotel_maintenance' },
    { check: shouldSendTransfer,    reply: (lang) => getTransferResponse ? getTransferResponse(lang) : 'Recepção do hotel arruma táxi/Uber. Disque *9 do telefone do quarto.', source: 'transfer' },
    // Bug fix 30/05/2026 — caso real Adilson KR07J (Glauco Flat 1704 via Airbnb):
    // Antes passava só lang, ignorando tenant → resposta usava branding "TorresGuest"
    // hardcoded em vez do endereço real do tenant Glauco. Agora passa tenant pra
    // hidratar settings.address_full + landmarks específicos do flat.
    { check: shouldSendLocation,    reply: (lang, tenant) => getLocationResponse(lang || 'pt', tenant), source: 'location' },
    { check: shouldSendLongStay,    reply: i18n('LONG_STAY',     LONG_STAY_RESPONSE),     source: 'long_stay' },
    // Reception extension ANTES de security — caso real Valney 19/05/2026
    // ("Qual o ramal da recepção?"). Discagem interna *1 ou 9.
    { check: shouldSendReceptionExtension, reply: i18n('RECEPTION_EXTENSION', RECEPTION_EXTENSION_RESPONSE), source: 'reception_extension' },
    // Voltage/outlet ANTES de location/security — caso real 31/05: LLM alucinou
    // "tem 220V" pra hóspede. Agora resposta direta: 110V only + recomenda adaptador.
    { check: shouldSendVoltage,     reply: i18n('VOLTAGE',       VOLTAGE_RESPONSE),       source: 'voltage' },
    { check: shouldSendSecurity,    reply: i18n('SECURITY',      SECURITY_RESPONSE),      source: 'security' },
    { check: shouldSendHostingCourse, reply: i18n('HOSTING_COURSE', HOSTING_COURSE_RESPONSE), source: 'hosting_course' },

    // ── Genéricos por último ──
    { check: shouldSendCurrentDate, reply: (lang) => getCurrentDateResponse ? getCurrentDateResponse(lang, getCurrentDateBRT && getCurrentDateBRT()) : `Hoje é ${new Date().toLocaleDateString('pt-BR')}.`, source: 'current_date' },
    { check: shouldSendCurrentTime, reply: (lang) => getCurrentTimeResponse ? getCurrentTimeResponse(lang, getCurrentTimeBRT && getCurrentTimeBRT()) : `Agora é ${new Date().toLocaleTimeString('pt-BR')}.`, source: 'current_time' },
    { check: shouldSendHuman,       reply: i18n('HUMAN_ESCALATION', HUMAN_ESCALATION_RESPONSE), source: 'human' },
  ];
}

// ── Sanitização channel-aware ──
// Airbnb anti-side-channel: bloqueia URLs, telefones BR, palavra "WhatsApp", CNPJ.
// Regra do Airbnb: PRÉ-confirmação NENHUM dado de contato externo (telefone, PIX,
// CNPJ, site, contatos externos). PÓS-confirmação a plataforma libera. Como o
// classifier não tem visibilidade confiável do status (smm_sync ainda não passa
// bookingConfirmed), defaultamos para o modo strict (pré-confirmação).
// Booking/Expedia/Direct: aceitam sempre.
function sanitizeForChannel(text, channel, bookingConfirmed = false) {
  if (!text) return text;
  if (channel !== 'airbnb') return text;
  // 1) Remove URLs (https/http e wa.me/...)
  let out = String(text).replace(/https?:\/\/\S+/gi, '').replace(/\bwa\.me\/\S+/gi, '');
  // 1b) URLs "peladas" (www. e dominios da marca sem http://) — Airbnb bloqueia [RM-062]
  out = out.replace(/\bwww\.\S+/gi, '').replace(/\b(?:torresguest|conciergecloud)\.com(?:\.br)?\S*/gi, '').replace(/\u{1F310}\s*(?=\n|$)/gu, '');
  // 2) Remove números de telefone BR formatados: (DD) NNNN-NNNN, +55 13 99615-5505, 11 92543 9200
  out = out.replace(/\+?\d{0,3}\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g, '');
  // 3) Remove menção a "WhatsApp" / "Whats App" / "WA"
  out = out.replace(/\b(whats\s*app|whatsapp|wa\b)/gi, 'atendimento');
  // 4) Strip CNPJ patterns (XX.XXX.XXX/XXXX-XX) — Airbnb bloqueia pré e pós.
  //    Adicionado 13/05/2026 (regra reportada pelo Valney).
  out = out.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '[dados após confirmação]');
  // 5) Em pré-confirmação: também strip CPF (XXX.XXX.XXX-XX) e "chave PIX" literal.
  if (!bookingConfirmed) {
    out = out.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[dados após confirmação]');
    // Linha que começa com "💳" ou contém "PIX" como meio de pagamento → suprime
    // (preserva linhas que apenas mencionam preços sem dados bancários)
    // Heurística conservadora: remove apenas se a linha tiver CNPJ/CPF ou chave PIX
    out = out.replace(/^.*\b(chave\s+pix|pix\s*:)\b.*$/gim, '');
  }
  // 5b) Resposta de reserva/contato fica gutada no airbnb apos sanitize -> troca por msg limpa de OTA [RM-062]
  if (/acesse nosso site|nosso site oficial|fale com a \*?Sofia/i.test(out)) {
    out = 'Para sua reserva, já estou acionando a Sofia, que organiza tudo direto aqui na conversa. 🌴';
  }
  // 6) Limpa quebras / pontuação solta deixada
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
 * @param {boolean} [args.bookingConfirmed] — se true (apenas Airbnb), libera envio
 *                                            de PIX/CNPJ/contatos. Default false (strict,
 *                                            assume pré-confirmação — Airbnb bloqueia
 *                                            envio de dados externos pré-booking).
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
  const {
    text, channel = 'unknown', guestName = '', tenant = null,
    history = [], lang: callerLang, allowAi = false,
    bookingConfirmed = false, // padrão strict: assume pré-confirmação
  } = args || {};
  if (!text || !String(text).trim()) {
    return { reply: null, source: 'noop:empty', channel };
  }

  // Bug fix 18/05/2026 — caso LV01J (Booking):
  // Auto-detecta idioma da mensagem atual. Antes default 'pt' silencioso fazia
  // bot responder em PT pra hóspede que escrevia em EN/ES/FR.
  // Política conservadora: se caller passou lang explícito não-default ('en'/
  // 'es'/'fr'), respeita. Caso contrário detecta. Se detector retorna 'pt'
  // (default conservador), mantém o caller (ou 'pt').
  let lang = callerLang || 'pt';
  try {
    const auto = detectLanguage(text);
    if (auto && auto !== 'pt') {
      // Auto-detect só sobrescreve se for não-PT (PT é o default conservador).
      lang = auto;
    }
  } catch (_) { /* manter callerLang/pt */ }

  const normalized = normalizeText(text);
  const isAirbnbPrebooking = channel === 'airbnb' && !bookingConfirmed;

  // (0.4) AIRBNB pré-confirmação: PIX/pagamento/CNPJ é HARD-BLOCK pela plataforma.
  // Airbnb não libera dados de contato externo (PIX, CNPJ, site, telefone)
  // até a reserva ser confirmada. Mesmo que o bot envie, a plataforma bloqueia
  // ou filtra a mensagem.
  // Estratégia: responde neutra ao hóspede + dispatch pra Sofia tratar manualmente
  // depois que a reserva confirmar.
  // Adicionado 13/05/2026 após feedback Valney.
  if (isAirbnbPrebooking && shouldSendFrigobarPix(normalized)) {
    return {
      reply: '🍽️ O cardápio do frigobar + dados de pagamento (PIX) ficam disponíveis assim que sua reserva for confirmada por aqui. Qualquer dúvida sobre o flat, comodidades ou check-in posso responder agora! 🌴',
      source: 'dispatch:airbnb_payment_prebooking',
      channel,
      dispatchAlert: true,
      dispatchBody: '💳 *Airbnb — pedido de PIX/cardápio antes de confirmação*\n👤 ' + (guestName || 'sem nome') + '\n💬 "' + String(text).slice(0, 200) + '"\n\nAirbnb bloqueia dados externos (CNPJ, PIX) pré-booking. Responder via SMM apenas após confirmação:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

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

  // (0.7) Late check-out request — exige decisão humana (Sofia coordena com
  // governança caso a caso). NUNCA responder FAQ de horário aqui — o hóspede
  // já sabe os horários padrão; ele está pedindo exceção.
  // Caso real 21/05/2026: Cícero (Airbnb, defesa tese PUC) pediu late check-out
  // até 13:30 + onde guardar malas. Bot caiu em shouldSendCheckin (gatilho
  // "late"+"check-out"+"horas"+"antes") e respondeu horários padrão. Agora
  // bloqueamos ANTES de shouldSendCheckin e despachamos pra Sofia.
  if (shouldEscalateLateCheckout(normalized)) {
    return {
      reply: 'Combinado! Já estou repassando seu pedido pra Sofia agora — ela responde aqui em instantes confirmando o horário estendido. 🙌',
      source: 'dispatch:late_checkout_request',
      channel,
      dispatchAlert: true,
      dispatchBody: '🕐 *Late check-out solicitado*\n👤 Hóspede: ' + (guestName || 'sem nome') + ' (' + channel + ')\n💬 "' + String(text).slice(0, 250) + '"\n\nDecidir caso a caso com governança. Responder via SMM:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

  // (0.8) Pedido específico de guarda-malas durante checkout window — flat não
  // tem armário próprio do hotel; Sofia avalia (armário do apto, locker, etc).
  // Diferente de shouldSendLuggage (FAQ sobre franquia/quantidade).
  if (shouldEscalateLuggageStorage(normalized)) {
    return {
      reply: 'Vou conferir agora com a Sofia o melhor jeito de te ajudar com as malas — em instantes respondemos aqui mesmo. 🧳',
      source: 'dispatch:luggage_storage',
      channel,
      dispatchAlert: true,
      dispatchBody: '🧳 *Pedido de guarda-malas no check-out*\n👤 Hóspede: ' + (guestName || 'sem nome') + ' (' + channel + ')\n💬 "' + String(text).slice(0, 250) + '"\n\nFlat sem armário do hotel — coordenar via SMM:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

  // (0.95) Reserva em nome de terceiro — esposa/empresa reserva pra alguém.
  // Caso real 22/05/2026 (Luciano via SMM Booking, reserva pro Jonas): bot pediu
  // código 5x, alucinou Airbnb num thread Booking, mandou wa.me (sanitize bloqueia)
  // e Luciano desistiu. Agora escala direto com dispatch interno (NÃO wa.me).
  if (shouldEscalateThirdPartyReservation(normalized)) {
    return {
      reply: 'Entendi — a reserva é pra outra pessoa. Já estou acionando a Sofia que organiza tudo direto aqui na conversa. Se quiser adiantar, me passa o nome completo do hóspede e o CPF (qualquer um dos dois já basta). 🌴',
      source: 'dispatch:third_party_reservation',
      channel,
      dispatchAlert: true,
      dispatchBody: '👥 *Reserva em nome de terceiro*\n👤 Quem fala: ' + (guestName || 'sem nome') + ' (' + channel + ')\n💬 "' + String(text).slice(0, 250) + '"\n\nIdentificar hóspede real via nome/CPF e ajustar via SMM:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

  // (0.9) Alteração de datas — exige Sofia decidir caso a caso (política da reserva,
  // disponibilidade no PMS, canal OTA). NUNCA tentar processar via bot.
  // Caso real 22/05/2026 (Paulo Bincoletto): bot pedia 4 dados (nome, data atual,
  // nova data, canal) mas não tinha como processar — só Sofia. Agora dispara dispatch.
  if (shouldHandleDateChange(normalized)) {
    return {
      reply: getResponseForTenant('DATE_CHANGE', lang || 'pt', tenant) || DATE_CHANGE_RESPONSE,
      source: 'dispatch:date_change',
      channel,
      dispatchAlert: true,
      dispatchBody: '📅 *Pedido de alteração de datas*\n👤 Hóspede: ' + (guestName || 'sem nome') + ' (' + channel + ')\n💬 "' + String(text).slice(0, 250) + '"\n\nVerificar política/disponibilidade/canal e responder via SMM:\nhttps://conciergecloud.com.br/admin/mensagens.html',
    };
  }

  // (1) Escalation classifier (Urgência/Praga/Manutenção/Limpeza/etc) — tem Sofia line nativo
  // Bug 15/05/2026 (caso Mayra/Airbnb KF04J "lâmpada não acende"): hóspede recebia
  // reply mas Sofia NÃO recebia o dispatch WhatsApp — o canal SMM nunca setou
  // dispatchAlert/dispatchBody nesse branch. No canal WhatsApp o sendEscalationAlert
  // é chamado direto em handlers/whatsapp.js:502. Aqui replicamos o mesmo formato,
  // pulando categorias com noAlert: true (Contato Recepção / Reserva = só INFO).
  try {
    const escalation = classifyMessage(text);
    if (escalation && escalation.guestReply) {
      const ret = {
        reply: sanitizeForChannel(escalation.guestReply, channel, bookingConfirmed),
        source: 'classifier:' + escalation.name,
        channel,
      };
      if (!escalation.noAlert) {
        const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        ret.dispatchAlert = true;
        ret.dispatchBody = [
          `${escalation.emoji} *TorresGuest — ALERTA ${escalation.level}*`,
          ``,
          `📡 *Canal:* ${channel}`,
          `👤 *Hóspede:* ${guestName || 'sem nome'}`,
          `📋 *Categoria:* ${escalation.name}`,
          `⏰ *Horário (BRT):* ${now}`,
          ``,
          `💬 *Mensagem do hóspede:*`,
          `"${String(text).slice(0, 400)}"`,
          ``,
          `👉 Responder via Stays SMM (Airbnb/Booking bloqueiam contato externo):`,
          `https://conciergecloud.com.br/admin/mensagens.html`,
        ].join('\n');
      }
      return ret;
    }
  } catch (e) { /* falha silencioso, segue pra matchers */ }

  // (2) Greeting / Thanks / Menu — só se faz sentido (msg curta)
  // i18n: usa helpers/getResponseForTenant pra responder no idioma do hóspede.
  const words = normalized.trim().split(/\s+/);
  if (shouldSendGreeting(normalized) && !text.includes('?') && words.length <= 5) {
    const greet = getGreetingResponse
      ? getGreetingResponse(lang, guestName)
      : (typeof GREETING_RESPONSE === 'function' ? GREETING_RESPONSE(guestName) : GREETING_RESPONSE);
    return { reply: sanitizeForChannel(greet, channel, bookingConfirmed), source: 'greeting', channel };
  }
  if (shouldSendThanks(normalized)) {
    const thanks = getResponseForTenant('THANKS', lang, tenant) || THANKS_RESPONSE;
    return { reply: sanitizeForChannel(thanks, channel, bookingConfirmed), source: 'thanks', channel };
  }
  if (shouldSendMenu(normalized)) {
    const menu = getResponseForTenant('MENU', lang, tenant) || MENU_RESPONSE;
    return { reply: sanitizeForChannel(menu, channel, bookingConfirmed), source: 'menu', channel };
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
      return { reply: sanitizeForChannel(reply, channel, bookingConfirmed), source: 'matcher:' + entry.source, channel };
    }
  }

  // (4) AI fallback (opcional — só se allowAi=true)
  if (allowAi) {
    try {
      const ai = await getChatGptFallbackReply(text, '', history, null, tenant);
      if (ai) {
        return { reply: sanitizeForChannel(ai, channel, bookingConfirmed), source: 'ai', channel };
      }
    } catch (e) {
      console.error('[smmClassifier] AI fallback err:', e.message);
    }
  }

  return { reply: null, source: 'noop:nomatch', channel };
}

module.exports = { classifyAndRespond, sanitizeForChannel };
