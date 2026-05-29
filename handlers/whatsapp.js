'use strict';

const { CONFIRMATION_TTL_MS } = require('../config');
const {
  MENU_RESPONSE,
  HUMAN_ESCALATION_RESPONSE,
  CONFIRMATION_PROMPT,
  WIFI_RESPONSE,
  BREAKFAST_RESPONSE,
  POOL_RESPONSE,
  PARKING_RESPONSE,
  SNACKS_RESPONSE,
  TOWELS_RESPONSE,
  RESTAURANT_RESPONSE,
  FOOD_ORDER_RESPONSE,
  getFoodOrderResponse,
  HOSTING_COURSE_RESPONSE,
  CHECKIN_RESPONSE,
  DOCUMENTS_RESPONSE,
  HOTEL_ACCESS_RESPONSE,
  SAFE_RESPONSE,
  INVOICE_RESPONSE,
  COMMON_AREAS_RESPONSE,
  BEDDING_RESPONSE,
  DATE_CHANGE_RESPONSE,
  HOTEL_MAINTENANCE_RESPONSE,
  BREAKFAST_COMPANION_RESPONSE,
  PARKING_EARLY_RESPONSE,
  buildBreakfastResponse,
  buildParkingResponse,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
  getTransferResponse,
  getLocationResponse,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  GREETING_RESPONSE,
  THANKS_RESPONSE,
  getI18nResponse,
  getResponseForTenant,
  buildGratitudeFarewellResponse,
  RESERVATION_NOT_FOUND,
  getReservationResponse,
  FRIGOBAR_PIX_RESPONSE,
  FRIGOBAR_RESTOCK_RESPONSE,
  getEarlyCompanionArrivalResponse,
  getGreetingResponse,
  getCurrentDateResponse,
  getCurrentTimeResponse,
} = require('../responses/strings');
const { getFaqResponse } = require('../responses/faq');
const {
  normalizeText,
  getCurrentDateBRT,
  getCurrentTimeBRT,
  formatReservationMessage,
} = require('../utils/formatters');
const {
  shouldSendMenu,
  shouldSendWifi,
  shouldSendBreakfast,
  shouldSendPool,
  shouldSendParking,
  shouldSendSnacks,
  shouldSendTowels,
  shouldSendRestaurant,
  shouldSendFoodOrder,
  shouldSendRestaurantMenuI18n,
  shouldSendCheckin,
  shouldEscalateLateCheckout,
  shouldEscalateThirdPartyReservation,
  shouldEscalateLuggageStorage,
  shouldSendHostingCourse,
  shouldSendDocuments,
  shouldSendHotelAccess,
  shouldSendSafe,
  shouldSendInvoice,
  shouldSendCommonAreas,
  shouldSendBedding,
  shouldHandleDateChange,
  shouldSendHotelMaintenance,
  shouldSendBreakfastCompanion,
  shouldSendParkingEarly,
  shouldSendTransfer,
  shouldSendHuman,
  shouldHandleCancellationRequest,
  shouldRedirectToReservationSite,
  shouldSendSecurity,
  shouldSendReceptionExtension,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldSendGreeting,
  shouldSendThanks,
  shouldSendGratitudeFarewell,
  detectGratitudeFarewell,
  shouldSendCurrentDate,
  shouldSendCurrentTime,
  shouldHandleReservationConfirmation,
  shouldHandleEarlyCompanionArrival,
  detectLanguage,
  extractReservationCode,
  shouldSendFrigobarPix,
  shouldRequestFrigobarRestock,
} = require('../utils/matchers');
const { fetchReservationByCode } = require('../services/stays');
const { getChatGptFallbackReply, transcribeAudioBuffer } = require('../services/openai');
const { getTenantByPhoneId, resolveTenantByGuestPhone } = require('../services/tenant');
const { downloadWhatsAppMedia, replyToGuest, markReadAndTyping, sendWelcomeKit, sendWhatsAppText } = require('../services/whatsapp');
const windowGuard = require('../services/windowGuard');
const { saveMessage, getContext, getProfile, updateProfile } = require('../services/crm');
const { classifyMessage } = require('../services/classifier');
const {
  sendEscalationAlert,
  sendFrigobarRestockNotification,
  sendTransferAlert,
  sendRoomRequestNotification,
  sendCancellationReasonToHost,
} = require('../services/dispatch');
let Reservation;
try { Reservation = require('../models/Reservation'); }
catch (e) { console.warn('[whatsapp] Reservation model not available:', e.message); }

// ───────────────────────────────────────────────────────────────────────────────
// Pending confirmation state (in-memory, per process)
// ───────────────────────────────────────────────────────────────────────────────
const pendingConfirmations = new Map();

function cleanupPendingConfirmations() {
  const now = Date.now();
  for (const [key, ts] of pendingConfirmations.entries()) {
    if (now - ts > CONFIRMATION_TTL_MS) pendingConfirmations.delete(key);
  }
}

function rememberPendingConfirmation(phone) {
  pendingConfirmations.set(phone, Date.now());
}

function isAwaitingCode(phone) {
  cleanupPendingConfirmations();
  return pendingConfirmations.has(phone);
}

// ───────────────────────────────────────────────────────────────────────────────
// Helper: responde ao hóspede E salva no CRM de uma vez (Fase 1 — memória completa)
// ───────────────────────────────────────────────────────────────────────────────
async function replyAndSave(from, text, opts = {}) {
  await replyToGuest(from, text, opts);
  saveMessage(from, 'assistant', text).catch(() => {});
  // Fire-and-forget: if this guest has a welcome kit pending (Meta 24h window
  // was closed when the check-in template fired), deliver it now — the inbound
  // msg that triggered this reply just opened the window.
  maybeDeliverDelayedWelcomeKit(from).catch(err =>
    console.error('[welcome-kit][delayed] dispatch failed:', err.message)
  );
}

/**
 * Idempotent: finds a reservation whose welcome kit is still pending within
 * the 48h window, sends it, and flips the pending flag. Safe to call after
 * every outbound reply — O(1) Mongo lookup + early return when nothing pending.
 */
async function maybeDeliverDelayedWelcomeKit(from) {
  if (!Reservation) return;
  const pending = await Reservation.findPendingWelcomeKitByPhone(from);
  if (!pending) return;

  // Atomic claim: only the request that flips welcomeKitPending false wins.
  // Prevents double-send if multiple replies fire in the same tick.
  // Use the Mongoose model (not .collection) so the return shape is stable
  // across driver versions — native driver v5+ returns the doc directly,
  // v4- wraps in { value: doc }. Mongoose.findOneAndUpdate always returns
  // the doc or null, which is what we want.
  const claimedDoc = await Reservation.findOneAndUpdate(
    { _id: pending._id, welcomeKitPending: true },
    { $set: { welcomeKitPending: false } },
    { new: true }
  );
  if (!claimedDoc) return; // someone else grabbed it, or no match

  const ctx = claimedDoc.welcomeKitContext || pending.welcomeKitContext || {};
  console.log(`[welcome-kit][delayed] sending to ${from} (reservation ${pending.staysReservationId})`);
  // Brief delay so welcome kit doesn't crowd the bot's reply to the guest.
  await new Promise(res => setTimeout(res, 1200));
  const r = await sendWelcomeKit(from, ctx);
  if (r.ok) {
    await Reservation.updateOne({ _id: pending._id }, { $set: { welcomeKitSentAt: new Date() } });
    console.log(`[welcome-kit][delayed] OK messageId=${r.messageId}`);
  } else if (!r.skipped) {
    // Failure → release claim so next inbound msg retries
    await Reservation.updateOne({ _id: pending._id }, { $set: { welcomeKitPending: true } });
    console.error('[welcome-kit][delayed] FAIL, released claim:', JSON.stringify(r.error).slice(0, 300));
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// PT_DISPATCH
//
// Cada entrada pode ter um campo opcional `notify` — uma função async(from, body)
// que dispara uma notificação para a operação sem bloquear a resposta ao hóspede.
//
// Ajustes 2026-04-09:
//  - shouldSendTransfer: agora aciona sendTransferAlert (táxi/Robson)
//  - shouldSendTowels: agora aciona sendRoomRequestNotification
//  - shouldSendCleaning: agora aciona sendRoomRequestNotification
//  - shouldSendSnacks: agora aciona sendRoomRequestNotification
// ───────────────────────────────────────────────────────────────────────────────
// Signature: reply(language, tenant) — tenant é opcional; só usado por respostas
// dinâmicas (BREAKFAST, PARKING, etc) pra ler tenant.settings. Static responses
// ignoram os args.
const PT_DISPATCH = [
  { check: shouldSendWifi,        reply: (lang, tenant) => getResponseForTenant('WIFI', lang, tenant) },
  { check: shouldSendBreakfast,   reply: (lang, tenant) => buildBreakfastResponse(tenant, lang) },
  { check: shouldSendPool,        reply: (lang, tenant) => getResponseForTenant('POOL', lang, tenant) },
  { check: shouldSendParking,     reply: (lang, tenant) => buildParkingResponse(tenant, lang) },
  {
    check: shouldSendSnacks,
    reply: (lang, tenant) => getResponseForTenant('SNACKS', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Snacks / Conveniência'),
  },
  {
    check: shouldSendTowels,
    reply: (lang, tenant) => getResponseForTenant('TOWELS', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Toalhas'),
  },
  { check: shouldSendFoodOrder,   reply: (lang, tenant) => getResponseForTenant('FOOD_ORDER', lang, tenant) || FOOD_ORDER_RESPONSE },
  { check: shouldSendRestaurant,  reply: (lang, tenant) => getResponseForTenant('RESTAURANT', lang, tenant) },
  // FAQ coverage (06/05/2026) — críticos avaliados ANTES de shouldSendCheckin
  // pra evitar colisão (ex: "documentos para checkin" cair em Checkin genérico).
  { check: shouldSendDocuments,    reply: (lang, tenant) => getResponseForTenant('DOCUMENTS', lang, tenant) },
  { check: shouldSendHotelAccess,  reply: (lang, tenant) => getResponseForTenant('HOTEL_ACCESS', lang, tenant) },
  { check: shouldSendSafe,         reply: (lang, tenant) => getResponseForTenant('SAFE', lang, tenant) },
  {
    check: shouldSendInvoice,
    reply: (lang, tenant) => getResponseForTenant('INVOICE', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Solicitação de Nota Fiscal'),
  },
  { check: shouldSendParkingEarly, reply: (lang, tenant) => getResponseForTenant('PARKING_EARLY', lang, tenant) },
  // Late check-out + guarda-malas — exige decisão humana, NUNCA FAQ horário.
  // Avaliados ANTES de shouldSendCheckin porque o intent "late checkout" tem
  // gatilhos sobrepostos (check-out + horas + late) que faziam shouldSendCheckin
  // capturar erroneamente. Caso real 21/05/2026 (Cícero, defesa tese PUC).
  {
    check: shouldEscalateLateCheckout,
    reply: () => 'Combinado! Já estou repassando seu pedido pra Sofia agora — ela responde aqui em instantes confirmando o horário estendido. 🙌',
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Late check-out solicitado'),
  },
  {
    check: shouldEscalateLuggageStorage,
    reply: () => 'Vou conferir agora com a Sofia o melhor jeito de te ajudar com as malas — em instantes respondemos aqui mesmo. 🧳',
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Guarda-malas no check-out'),
  },
  {
    // Reserva em nome de terceiro (esposa→marido, empresa→funcionário, etc).
    // Caso real 22/05/2026 (Luciano/Jonas via SMM Booking).
    check: shouldEscalateThirdPartyReservation,
    reply: () => 'Entendi — a reserva é pra outra pessoa. Já estou acionando a Sofia que organiza tudo direto aqui na conversa. Se quiser adiantar, me passa o nome completo do hóspede e o CPF (qualquer um dos dois já basta). 🌴',
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Reserva em nome de terceiro'),
  },
  { check: shouldSendCheckin,      reply: (lang, tenant) => getResponseForTenant('CHECKIN', lang, tenant) },
  // Hosting course (Hotmart "Desvendando o Airbnb") — prospects que querem ser anfitriões.
  // Avaliado APÓS shouldSendCheckin pra evitar matchar hóspede atual perguntando sobre check-in.
  { check: shouldSendHostingCourse, reply: (lang, tenant) => getResponseForTenant('HOSTING_COURSE', lang, tenant) },
  // Médios
  { check: shouldSendBreakfastCompanion, reply: (lang, tenant) => getResponseForTenant('BREAKFAST_COMPANION', lang, tenant) },
  { check: shouldSendCommonAreas,        reply: (lang, tenant) => getResponseForTenant('COMMON_AREAS', lang, tenant) },
  {
    check: shouldSendBedding,
    reply: (lang, tenant) => getResponseForTenant('BEDDING', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Roupa de cama / enxoval extra'),
  },
  {
    check: shouldHandleDateChange,
    reply: (lang, tenant) => getResponseForTenant('DATE_CHANGE', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Pedido de alteração de datas'),
  },
  { check: shouldSendHotelMaintenance, reply: (lang, tenant) => getResponseForTenant('HOTEL_MAINTENANCE', lang, tenant) },
  // Reception extension ANTES de security — caso real Valney 19/05/2026
  // ("Qual o ramal da recepção?"). Discagem interna *1 ou 9.
  { check: shouldSendReceptionExtension, reply: (lang, tenant) => getResponseForTenant('RECEPTION_EXTENSION', lang, tenant) },
  { check: shouldSendSecurity,    reply: (lang, tenant) => getResponseForTenant('SECURITY', lang, tenant) },
  {
    check: shouldSendTransfer,
    reply: (lang) => getTransferResponse(lang),
    notify: (from, body) => sendTransferAlert(from, body),
  },
  { check: shouldSendLocation,    reply: (lang, tenant) => getLocationResponse(lang, tenant) },
  { check: shouldSendLongStay,    reply: (lang, tenant) => getResponseForTenant('LONG_STAY', lang, tenant) },
  {
    check: shouldSendCleaning,
    reply: (lang, tenant) => getResponseForTenant('CLEANING', lang, tenant),
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Limpeza / Governança'),
  },
  { check: shouldSendInternet,    reply: (lang, tenant) => getResponseForTenant('INTERNET', lang, tenant) },
  { check: shouldSendLuggage,     reply: (lang, tenant) => getResponseForTenant('LUGGAGE', lang, tenant) },
  { check: shouldSendCurrentDate, reply: (lang) => getCurrentDateResponse ? getCurrentDateResponse(lang, getCurrentDateBRT()) : `Hoje e ${getCurrentDateBRT()}.` },
  { check: shouldSendCurrentTime, reply: (lang) => getCurrentTimeResponse ? getCurrentTimeResponse(lang, getCurrentTimeBRT()) : `Agora sao ${getCurrentTimeBRT()}, horario de Brasilia.` },
  { check: shouldSendHuman,       reply: (lang, tenant) => getResponseForTenant('HUMAN_ESCALATION', lang, tenant) },
];

// ───────────────────────────────────────────────────────────────────────────────
// Reservation confirmation flow
// ───────────────────────────────────────────────────────────────────────────────
async function maybeHandleReservationConfirmation({ rawText, normalizedText, from, camFromAudio = false }) {
  const expectingCode = isAwaitingCode(from);
  const explicitlyWantsConfirm = shouldHandleReservationConfirmation(normalizedText);
  const code = extractReservationCode(rawText);
  const wantsConfirmation = explicitlyWantsConfirm || (expectingCode && !!code);

  if (!wantsConfirmation) {
    if (expectingCode) pendingConfirmations.delete(from);
    return false;
  }

  if (!code) {
    rememberPendingConfirmation(from);
    await replyAndSave(from, CONFIRMATION_PROMPT, { alsoSendAudio: camFromAudio });
    return true;
  }

  const reservation = await fetchReservationByCode(code);
  if (reservation) {
    pendingConfirmations.delete(from);
    await replyAndSave(from, formatReservationMessage(reservation), { alsoSendAudio: camFromAudio });
  } else {
    rememberPendingConfirmation(from);
    await replyAndSave(from, RESERVATION_NOT_FOUND(code), { alsoSendAudio: camFromAudio });
  }
  return true;
}

// ───────────────────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────────────────
async function handleIncoming(payload) {
  if (!payload?.entry) return;

  for (const entry of payload.entry) {
    for (const change of (entry.changes || [])) {
      if (change.field !== 'messages') continue;

      const value = change.value || {};
      const messages = value.messages || [];
      const contactName = value.contacts?.[0]?.profile?.name || '';

      // Multi-tenant: identifica tenant pelo phone_number_id (Meta WhatsApp Business)
      const phoneNumberId = value.metadata?.phone_number_id || null;
      const tenant = await getTenantByPhoneId(phoneNumberId);
      if (tenant && !tenant._isDefault) {
        console.log(`[tenant] ${phoneNumberId} -> ${tenant.tenantId} (${tenant.name})`);
      }

      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        // ── UX imediato: visto azul antes de processar ──
        markReadAndTyping(from, message.id).catch(() => {});

        // ── Window guard: drena pendentes (mensagens que não puderam ser
        //    enviadas antes por janela 24h fechada). Esta inbound abre a janela,
        //    então enviamos as pendentes ANTES de processar o turno atual.
        //    Tolerante a falha — não interrompe o fluxo se algo der errado.
        windowGuard.drainPending(from, (text) => sendWhatsAppText(from, text))
          .then((n) => { if (n > 0) console.log(`[wg] drained ${n} pending message(s) for ${from}`); })
          .catch((err) => console.error('[wg] drain bg error:', err.message));

        let camFromAudio = false;
        let body = '';

        // ---- resolve body ------------------------------------------------
        if (message.type === 'text') {
          body = message.text?.body || '';
        } else if (message.type === 'audio') {
          camFromAudio = true;
          try {
            const mediaId = message.audio?.id;
            if (!mediaId) {
              await replyAndSave(from, 'Recebi seu audio, mas nao consegui identificar o arquivo. Pode tentar novamente? 🌄', { alsoSendAudio: camFromAudio });
              continue;
            }
            const audioBuffer = await downloadWhatsAppMedia(mediaId);
            const transcript = await transcribeAudioBuffer(audioBuffer, message.audio?.mime_type || 'audio/ogg');
            if (!transcript) {
              await replyAndSave(from, 'Recebi seu audio, mas nao consegui entender bem. Pode me mandar novamente ou escrever por texto? 😊', { alsoSendAudio: camFromAudio });
              continue;
            }
            body = transcript;
            console.log('[audio transcript]', { from, transcript });
          } catch (err) {
            console.error('Failed to process audio message', err);
            await replyAndSave(from, 'Recebi seu audio, mas tive uma falha para processar agora. Pode tentar novamente ou me escrever por texto? 😊', { alsoSendAudio: camFromAudio });
            continue;
          }
        } else {
          continue; // ignorar tipos nao suportados
        }

        const normalized = normalizeText(body);
        const language = detectLanguage(body);
        console.log('[incoming]', { from, body, normalized, language });

        // ── Fase 1: salvar mensagem do usuário no CRM (fire-and-forget) ──
        saveMessage(from, 'user', body).catch(() => {});

        // ── Fase 2: salvar nome do WhatsApp no perfil (fire-and-forget) ──
        if (contactName) updateProfile(from, { name: contactName }).catch(() => {});

        // ---- cancellation retention: capture reason (HIGHEST PRIORITY) ---
        // Must run BEFORE the escalation classifier and any keyword handler
        // because the guest's reason often contains words like "reserva",
        // "cancel", "checkout", which are intercepted by other flows (e.g.
        // observed 24/04 with Carlos Frederico JI03J — classifier caught
        // "Reserva INFO" first and the reason was lost).
        //
        // If this phone has a reservation with cancellationReason='pending'
        // sent in the last 72h, the NEXT text they send IS the reason.
        if (Reservation && body && body.trim().length > 0) {
          try {
            const pending = await Reservation.findPendingRetentionByPhone(from);
            if (pending) {
              const reason = body.trim().slice(0, 500);
              const firstName = (pending.guestName || '').split(' ')[0] || 'Hospede';
              pending.cancellationReason = reason;
              pending.cancellationReasonReceivedAt = new Date();
              try { await pending.save(); } catch (e) { console.warn('[retention] save reason failed:', e.message); }

              console.log(`[retention] captured reason from ${firstName} (${from}) staysId=${pending.staysReservationId}`);
              await replyAndSave(
                from,
                `Muito obrigado, ${firstName}! 🙏\n\nSeu feedback chegou aqui e vai nos ajudar a melhorar. Se mudar de ideia ou quiser reservar outra data, é só me chamar. 💙`,
                { alsoSendAudio: camFromAudio }
              );

              // Fire-and-forget: dispatch para o host
              sendCancellationReasonToHost({
                guestName: pending.guestName,
                staysId: pending.staysReservationId,
                ota: pending.cancellationOta || 'reserva',
                reason,
                phone: from,
              }).then(async () => {
                pending.cancellationDispatchedToHostAt = new Date();
                try { await pending.save(); } catch (e) {}
              }).catch(err => console.error('[retention] dispatch to host failed:', err.message));

              continue;
            }
          } catch (e) {
            console.error('[retention] lookup failed (fallthrough to normal flow):', e.message);
          }
        }

        // ---- check-in template quick-reply (template v3+) ---------------
        // Match SOMENTE no payload exato dos quick-reply buttons do template Meta.
        // Variações de free-text ("quero", "não") caem no classifier/AI normal —
        // antes match permissivo causou falso-positivo: "quero falar com humano"
        // foi interpretado como "Fazer agora" e respondeu com link de checkin.
        // FIX 10/05/2026: stays_sync.js (cron VPS) é quem dispara o template
        // automático e grava no Atlas reservations com fields { staysId,
        // confirmationCode, guestPhone (já limpo), autoCheckinSentAt }. NÃO grava
        // os fields da mongoose Reservation model (guestPhoneClean,
        // staysReservationId — aqueles vêm do email parser). O lookup antigo
        // procurava SÓ pelos fields mongoose → match falhava → bot ficava mudo
        // (caso Wandress 09/05 noite, KZ02J). Agora aceitamos AMBOS os shapes.
        if (Reservation && body) {
          const txt = body.trim().toLowerCase();
          const isYes = txt === 'fazer agora';
          const isNo = txt === 'na recepção' || txt === 'na recepcao';
          if (isYes || isNo) {
            try {
              const since = new Date(Date.now() - 48 * 3600 * 1000);
              const recent = await Reservation.findOne({
                $or: [
                  { guestPhoneClean: from },           // emailMonitor (mongoose) shape
                  { guestPhone: from },                // stays_sync (Atlas raw) shape
                ],
                autoCheckinSentAt: { $gte: since },
              }).sort({ autoCheckinSentAt: -1 }).lean();
              const reservationCode = recent && (
                recent.staysReservationId ||  // mongoose shape (email parser)
                recent.confirmationCode ||    // stays_sync shape (preferred — humano-amigável)
                recent.staysId                // fallback ObjectId
              );
              if (recent && reservationCode) {
                const publicUrl = process.env.PUBLIC_URL || 'https://conciergecloud.com.br';
                const menuHint = '\n\n💡 Em qualquer momento durante a hospedagem, digite *MENU* aqui pra ver todas as opções (Wi-Fi, café, piscina, transfer, recepção, etc).';
                if (isYes) {
                  const url = `${publicUrl}/checkin/${reservationCode}`;
                  await replyAndSave(from,
                    `Perfeito! 📲 Aqui está seu pré-check-in:\n\n${url}\n\nLeva 2 minutos. Seus dados são protegidos conforme a LGPD. 🔒${menuHint}`,
                    { alsoSendAudio: camFromAudio }
                  );
                } else {
                  await replyAndSave(from,
                    `Combinado! 🏨 Quando chegar, é só ir direto à recepção do hotel.\n\n📄 *Importante:* leve um documento oficial com foto (RG, CNH ou passaporte) — é exigido pra liberar seu cartão de acesso.\n\nRecepção 24h. Qualquer dúvida, me chama por aqui. 😊${menuHint}`,
                    { alsoSendAudio: camFromAudio }
                  );
                }
                console.log(`[checkin-reply] phone=${from} choice=${isYes?'yes':'no'} reservation=${reservationCode}`);
                continue;
              }
              // Lookup falhou (sem reserva matching nas últimas 48h) — loga e cai no fluxo normal
              console.warn(`[checkin-reply] phone=${from} clicou "${txt}" mas sem reserva matching nas últimas 48h — fallthrough`);
            } catch (e) {
              console.warn('[checkin-reply] lookup failed (fallthrough):', e.message);
            }
          }
        }

        // ---- resolve guest tenant EARLY (antes dos matchers torres-flavored) ----
        // Bug observado 08/05/2026: prospect cc_sales mandando "Qual o preço?" pro
        // WhatsApp ConciergeCloud caía no `shouldRedirectToReservationSite` e o
        // classifier categoria "Reserva" — ambos torres-hardcoded — e respondia
        // sobre torresguest.com.br/Sofia. Resolver o guestTenant aqui permite
        // gatear matchers torres-only (`isTorresContext`) e deixar non-torres
        // cair direto no AI fallback (que recebe o systemPrompt do tenant).
        const guestTenant = await resolveTenantByGuestPhone(from, tenant, body);
        const isTorresContext = !guestTenant || guestTenant.tenantId === 'torres';
        if (!isTorresContext) {
          console.log('[tenant-guest] from=' + from + ' → ' + guestTenant.tenantId + ' (skip torres-flavored matchers)');
        }

        // ---- escalation classifier (prioridade máxima p/ fluxo normal) --
        // Categorias do classifier (Reserva, Recepção, etc.) usam guestReply
        // torres-hardcoded ("Sofia +55 13 99615-5505", "*9 ou *1 no telefone do
        // quarto"). Skip pra non-torres — cai no AI fallback do tenant correto.
        if (isTorresContext) {
          const escalation = classifyMessage(body);
          if (escalation) {
            console.log('[classifier] escalacao detectada:', escalation.name, escalation.level);
            await replyAndSave(from, escalation.guestReply, { alsoSendAudio: camFromAudio });
            if (!escalation.noAlert) await sendEscalationAlert(from, body, escalation);
            continue;
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // BLOCO TORRES-FLAVORED — só executa pra tenant torres
        // ─────────────────────────────────────────────────────────────────
        // Todos os matchers abaixo (greeting, menu, frigobar PIX/restock,
        // restaurant Don Maitre, reservation flows, PT_DISPATCH, etc) usam
        // respostas hardcoded torresguest.com.br/Sofia/PIX CNPJ TorresGuest
        // OU pressupõem hóspede com reserva ativa numa unidade física.
        // Pra prospects cc_sales (perguntando "quanto custa?", "quero falar
        // com atendimento") essas respostas vazam contexto do cliente errado.
        //
        // Bug confirmado 09/05/2026: prospect Nailton (13 99163-2189) perguntou
        // "Quanto custa?" pro WhatsApp ConciergeCloud → recebeu cardápio do
        // frigobar TorresGuest com PIX CNPJ 62.169.624/0001-94.
        //
        // Non-torres (cc_sales, futuros tenants) cai direto no AI fallback
        // que recebe o systemPrompt do próprio tenant.
        // ═══════════════════════════════════════════════════════════════════
        if (isTorresContext) {
        // ---- greeting ---------------------------------------------------
        // Pure greeting only (no '?'). Greeting+question falls through to the AI.
        // FIX (Valney 17/05): cooldown 30min. Se bot ja respondeu recente,
        // nao redispara greeting (vai pro LLM que mantem fluidez).
        const words = normalized.trim().split(/\s+/);
        let isJustGreeting = shouldSendGreeting(normalized) && !body.includes('?') && words.length <= 5;
        if (isJustGreeting) {
          try {
            const earlyCtx = await getContext(from, 5);
            if (Array.isArray(earlyCtx) && earlyCtx.length) {
              const lastBotMsg = earlyCtx.filter(m => m.role === 'assistant').slice(-1)[0];
              if (lastBotMsg && lastBotMsg.ts) {
                const ageMin = (Date.now() - new Date(lastBotMsg.ts).getTime()) / 60000;
                if (ageMin < 30) {
                  console.log('[greeting] cooldown active — last bot reply ' + Math.round(ageMin) + 'min ago — skipping greeting');
                  isJustGreeting = false;
                }
              }
            }
          } catch (e) { console.warn('[greeting cooldown] err:', e.message); }
        }
        if (isJustGreeting) {
          const greet = getGreetingResponse ? getGreetingResponse(language, contactName) : GREETING_RESPONSE(contactName);
          await replyAndSave(from, greet, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- gratitude+farewell (warm reciprocal) -----------------------
        const gfSig = detectGratitudeFarewell(body, contactName);
        if (gfSig) {
          const warmReply = buildGratitudeFarewellResponse(gfSig);
          await replyAndSave(from, warmReply, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- thanks (pure short) ----------------------------------------
        if (shouldSendThanks(normalized)) {
          const thanks = getResponseForTenant('THANKS', language, tenant) || THANKS_RESPONSE;
          await replyAndSave(from, thanks, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- menu -------------------------------------------------------
        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          const menu = getResponseForTenant('MENU', language, tenant) || MENU_RESPONSE;
          await replyAndSave(from, menu, { alsoSendAudio: camFromAudio });
          pendingConfirmations.delete(from);
          continue;
        }

        // ---- reservation confirmation flow ------------------------------
        if (await maybeHandleReservationConfirmation({ rawText: body, normalizedText: normalized, from, camFromAudio })) {
          continue;
        }

        // ---- EARLY COMPANION ARRIVAL ------------------------------------
        // Titular avisa que outra pessoa da reserva chegará antes ou pede
        // acesso sem sua presença. Política TorresGuest permite. Estratégia:
        // localizar a reserva ativa e devolver o link do pré-checkin
        // (`/checkin/{staysId}`) pra que o titular encaminhe pra acompanhante
        // — ela mesma sobe doc + nome + horário no formulário, que dispara o
        // email pra recepção AHI (Feature B). Sem máquina de estados, sem
        // template Meta extra: reusa a infra de pré-checkin que já existe.
        //
        // Posicionado antes de cancellation/redirect (frase típica não
        // envolve "reserva") e antes do AI fallback (GPT por padrão nega).
        if (shouldHandleEarlyCompanionArrival(body)) {
          console.log('[early-companion] detected from', from);
          let staysId = null;
          if (Reservation) {
            try {
              const reservation = await Reservation.findOne({
                guestPhoneClean: from,
                status: { $in: ['reservado', 'confirmado', 'checkin'] },
              }).sort({ createdAt: -1 }).lean();
              staysId = reservation?.staysReservationId || null;
            } catch (e) {
              console.warn('[early-companion] reservation lookup failed:', e.message);
            }
          }
          const publicUrl = process.env.PUBLIC_URL || 'https://conciergecloud.com.br';
          await replyAndSave(from, getEarlyCompanionArrivalResponse(staysId, publicUrl), { alsoSendAudio: camFromAudio });
          sendRoomRequestNotification(from, body, 'Antecipação de Chegada — Acompanhante').catch(() => {});
          continue;
        }

        // ---- ACTIVE CANCELLATION REQUEST (escalation) -------------------
        // Hospede pedindo pra cancelar reserva via WhatsApp. Direciona pra
        // plataforma de origem + escala humano. ANTES do redirect-to-site
        // pra evitar match em "reserva" → "fazer nova reserva".
        if (shouldHandleCancellationRequest(normalized)) {
          console.log('[cancellation] active request detected from', from);
          await replyAndSave(from,
            `Entendi! 😔 Pra cancelar sua reserva, normalmente é direto na plataforma onde você reservou (Booking, Airbnb, site da Stays).\n\nSe precisar de ajuda ou quiser que eu repasse pro nosso time, te conecto com a Sofia: 📱 +55 13 99615-5505 — ela cuida do cancelamento direto com você.`,
            { alsoSendAudio: camFromAudio }
          );
          await sendEscalationAlert(from, body, { name: 'Cancelamento', level: 'alta' }).catch(() => {});
          continue;
        }

        // ---- reservation site redirect ----------------------------------
        // Resposta canned em PT/EN/ES cita literalmente torresguest.com.br.
        if (
          shouldRedirectToReservationSite(normalized) ||
          /\b\d{1,2}[\/.-]\d{1,2}\b/.test(body) ||
          /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(body)
        ) {
          await replyAndSave(from, getReservationResponse(language), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- restaurant menu (i18n PT/EN/FR/ES) -------------------------
        // Captura "cardapio do restaurante" / "restaurant menu" / "menu du
        // restaurant" / "menu del restaurante" e envia link Don Maitre +
        // cupom CONCIERGECLOUD10 em qualquer idioma. Adicionado 04/05 —
        // antes caia em FRIGOBAR_PIX (cardápio do frigobar, errado).
        if (shouldSendRestaurantMenuI18n(normalized)) {
          await replyAndSave(from, getFoodOrderResponse(language), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- frigobar: PIX de pagamento ---------------------------------
        // IMPORTANTE: sempre responder com PIX + lista de produtos.
        // NUNCA informar que o pagamento é feito no checkout da recepção.
        // O matcher foi expandido (2026-04-09) para capturar perguntas
        // genéricas como "como eu pago" / "preciso saber como pago".
        if (shouldSendFrigobarPix(normalized)) {
          const pix = getResponseForTenant('FRIGOBAR_PIX', language, tenant) || FRIGOBAR_PIX_RESPONSE;
          await replyAndSave(from, pix, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- frigobar: reposição -> avisa governança --------------------
        if (shouldRequestFrigobarRestock(normalized)) {
          await replyAndSave(from, FRIGOBAR_RESTOCK_RESPONSE, { alsoSendAudio: camFromAudio });
          await sendFrigobarRestockNotification(from, body);
          continue;
        }

        // ---- PT_DISPATCH ------------------------------------------------
        // Para entradas com campo `notify`, dispara a notificação em paralelo
        // sem bloquear a resposta ao hóspede (fire-and-forget via .catch).
        if (language === 'pt') {
          // Multi-intent / multi-question detection — roteia pra AI fallback
          // quando há sinais de pergunta complexa pra resposta holística.
          //
          // FIX 11/05/2026: heurística antiga usava `qCount >= 2 || sentenceCount >= 3`
          // sozinhos, mas saudações brasileiras ("Olá! Bom dia. Tudo bem?")
          // inflam ambos facilmente — bastava o hóspede saudar antes de
          // perguntar 1 coisa pra cair no AI fallback genérico, ignorando o
          // matcher operacional. Caso real Wandress 11/05: "Olá! Bom dia.
          // Tudo bem? Nós chegamos agora em SP. Podemos deixar a mala aí?"
          // → shouldSendLuggage matchava sozinho, MAS qCount=2 + sentence=5
          // bumpava pra AI, perdendo a resposta correta sobre Sr. Alberto.
          //
          // Nova regra:
          //  (a) 2+ matchers do PT_DISPATCH → multi-intent operacional real → AI
          //  (b) 0 matchers + 2+ "?" → várias perguntas sem categoria → AI
          //  (c) queryCount >= 3 → frase complexa multi-pergunta → AI
          // qCount/sentenceCount NÃO mais bumpam single-matcher pra AI: se
          // hóspede saudou e fez 1 pergunta de categoria conhecida, responde a
          // categoria diretamente (resposta correta + rápida).
          const matches = PT_DISPATCH.filter(({ check }) => check(normalized));
          const qCount = (body.match(/\?/g) || []).length;
          const sentenceCount = (body.match(/[.!?]+/g) || []).length;
          // Conta palavras de consulta (cada uma indica uma pergunta separada).
          // Captura caso "Estou indo com uma pessoa a mais e gostaria de confirmar
          // se tem X e se podemos Y e se tem Z... qual W?" — 5 indicators, mas 0 ?.
          const queryWordRegex = /\b(tem|se|qual|quais|podemos|posso|consigo|gostaria|como|onde|quanto|quantos|preciso|gostaríamos)\b/gi;
          const queryCount = (body.match(queryWordRegex) || []).length;
          const isMultiIntent =
            matches.length >= 2 ||
            (matches.length === 0 && qCount >= 2) ||
            queryCount >= 3;
          // Sinaliza pra log quando saudação salva da heurística antiga
          if (matches.length === 1 && (qCount >= 2 || sentenceCount >= 3)) {
            console.log(`[dispatch] single-matcher (${matches[0].check.name || 'anon'}) com ${qCount}q/${sentenceCount}s — resposta direta (saudacao+pergunta, antes caia em AI)`);
          }

          if (matches.length > 0 && !isMultiIntent) {
            // Single-intent: comportamento original
            const m = matches[0];
            const dispatchReply = m.reply(language, tenant);
            await replyAndSave(from, dispatchReply, { alsoSendAudio: camFromAudio });
            if (m.notify) m.notify(from, body).catch(() => {});
            continue;
          }
          // Multi-intent: dispara TODOS os notifies aplicáveis (pra dispatch
          // não perder solicitações operacionais como bedding/cleaning) e cai
          // no AI fallback abaixo, que responde holisticamente.
          if (isMultiIntent && matches.length > 0) {
            const notifySent = new Set();
            for (const m of matches) {
              if (m.notify && !notifySent.has(m.check.name)) {
                notifySent.add(m.check.name);
                m.notify(from, body).catch(() => {});
              }
            }
            // intencionalmente NÃO continue — deixa cair no AI fallback
          }
        }
        } // end if (isTorresContext) — todos matchers acima são torres-flavored

        // ---- AI fallback (contexto + perfil de fidelidade) -------------
        // guestTenant já resolvido lá em cima (pra gatear matchers torres-only).
        const [context, profile] = await Promise.all([getContext(from), getProfile(from)]);
        const aiReply = await getChatGptFallbackReply(body, from, context, profile, guestTenant);
        if (aiReply) {
          await replyAndSave(from, aiReply, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- FAQ --------------------------------------------------------
        const faqResponse = getFaqResponse(normalized);
        if (faqResponse) {
          await replyAndSave(from, faqResponse, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- fallback final ---------------------------------------------
        await replyAndSave(from, `${HUMAN_ESCALATION_RESPONSE}\n\nSe quiser voltar ao menu, e so digitar "menu".`, { alsoSendAudio: camFromAudio });
      }
    }
  }
}

module.exports = { handleIncoming };
