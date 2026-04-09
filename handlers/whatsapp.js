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
  CHECKIN_RESPONSE,
  SECURITY_RESPONSE,
  TRANSFER_RESPONSE,
  LONG_STAY_RESPONSE,
  CLEANING_RESPONSE,
  INTERNET_RESPONSE,
  LUGGAGE_RESPONSE,
  GREETING_RESPONSE,
  THANKS_RESPONSE,
  RESERVATION_NOT_FOUND,
  getReservationResponse,
  FRIGOBAR_PIX_RESPONSE,
  FRIGOBAR_RESTOCK_RESPONSE,
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
  shouldSendCheckin,
  shouldSendTransfer,
  shouldSendHuman,
  shouldRedirectToReservationSite,
  shouldSendSecurity,
  shouldSendLocation,
  shouldSendLongStay,
  shouldSendCleaning,
  shouldSendInternet,
  shouldSendLuggage,
  shouldSendGreeting,
  shouldSendThanks,
  shouldSendCurrentDate,
  shouldSendCurrentTime,
  shouldHandleReservationConfirmation,
  detectLanguage,
  extractReservationCode,
  shouldSendFrigobarPix,
  shouldRequestFrigobarRestock,
} = require('../utils/matchers');
const { fetchReservationByCode } = require('../services/stays');
const { getChatGptFallbackReply, transcribeAudioBuffer } = require('../services/openai');
const { downloadWhatsAppMedia, replyToGuest, markReadAndTyping } = require('../services/whatsapp');
const { saveMessage, getContext, getProfile, updateProfile } = require('../services/crm');
const { classifyMessage } = require('../services/classifier');
const {
  sendEscalationAlert,
  sendFrigobarRestockNotification,
  sendTransferAlert,
  sendRoomRequestNotification,
} = require('../services/dispatch');

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
const PT_DISPATCH = [
  { check: shouldSendWifi,        reply: () => WIFI_RESPONSE },
  { check: shouldSendBreakfast,   reply: () => BREAKFAST_RESPONSE },
  { check: shouldSendPool,        reply: () => POOL_RESPONSE },
  { check: shouldSendParking,     reply: () => PARKING_RESPONSE },
  {
    check: shouldSendSnacks,
    reply: () => SNACKS_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Snacks / Conveniência'),
  },
  {
    check: shouldSendTowels,
    reply: () => TOWELS_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Toalhas'),
  },
  { check: shouldSendRestaurant,  reply: () => RESTAURANT_RESPONSE },
  { check: shouldSendCheckin,     reply: () => CHECKIN_RESPONSE },
  { check: shouldSendSecurity,    reply: () => SECURITY_RESPONSE },
  {
    check: shouldSendTransfer,
    reply: () => TRANSFER_RESPONSE,
    notify: (from, body) => sendTransferAlert(from, body),
  },
  { check: shouldSendLocation,    reply: (lang) => getLocationResponse(lang) },
  { check: shouldSendLongStay,    reply: () => LONG_STAY_RESPONSE },
  {
    check: shouldSendCleaning,
    reply: () => CLEANING_RESPONSE,
    notify: (from, body) => sendRoomRequestNotification(from, body, 'Limpeza / Governança'),
  },
  { check: shouldSendInternet,    reply: () => INTERNET_RESPONSE },
  { check: shouldSendLuggage,     reply: () => LUGGAGE_RESPONSE },
  { check: shouldSendCurrentDate, reply: () => `Hoje e ${getCurrentDateBRT()}.` },
  { check: shouldSendCurrentTime, reply: () => `Agora sao ${getCurrentTimeBRT()}, horario de Brasilia.` },
  { check: shouldSendHuman,       reply: () => HUMAN_ESCALATION_RESPONSE },
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

      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        // ── UX imediato: visto azul antes de processar ──
        markReadAndTyping(from, message.id).catch(() => {});

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

        // ---- escalation classifier (prioridade máxima) ------------------
        const escalation = classifyMessage(body);
        if (escalation) {
          console.log('[classifier] escalacao detectada:', escalation.name, escalation.level);
          await replyAndSave(from, escalation.guestReply, { alsoSendAudio: camFromAudio });
          if (!escalation.noAlert) await sendEscalationAlert(from, body, escalation);
          continue;
        }

        // ---- greeting ---------------------------------------------------
        if (shouldSendGreeting(normalized)) {
          await replyAndSave(from, GREETING_RESPONSE(contactName), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- thanks -----------------------------------------------------
        if (shouldSendThanks(normalized)) {
          await replyAndSave(from, THANKS_RESPONSE, { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- menu -------------------------------------------------------
        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          await replyAndSave(from, MENU_RESPONSE, { alsoSendAudio: camFromAudio });
          pendingConfirmations.delete(from);
          continue;
        }

        // ---- reservation confirmation flow ------------------------------
        if (await maybeHandleReservationConfirmation({ rawText: body, normalizedText: normalized, from, camFromAudio })) {
          continue;
        }

        // ---- reservation site redirect ----------------------------------
        if (
          shouldRedirectToReservationSite(normalized) ||
          /\b\d{1,2}[\/.-]\d{1,2}\b/.test(body) ||
          /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(body)
        ) {
          await replyAndSave(from, getReservationResponse(language), { alsoSendAudio: camFromAudio });
          continue;
        }

        // ---- frigobar: PIX de pagamento ---------------------------------
        // IMPORTANTE: sempre responder com PIX + lista de produtos.
        // NUNCA informar que o pagamento é feito no checkout da recepção.
        // O matcher foi expandido (2026-04-09) para capturar perguntas
        // genéricas como "como eu pago" / "preciso saber como pago".
        if (shouldSendFrigobarPix(normalized)) {
          await replyAndSave(from, FRIGOBAR_PIX_RESPONSE, { alsoSendAudio: camFromAudio });
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
          const match = PT_DISPATCH.find(({ check }) => check(normalized));
          if (match) {
            const dispatchReply = match.reply(language);
            await replyAndSave(from, dispatchReply, { alsoSendAudio: camFromAudio });
            if (match.notify) match.notify(from, body).catch(() => {});
            continue;
          }
        }

        // ---- AI fallback (contexto + perfil de fidelidade) -------------
        const [context, profile] = await Promise.all([getContext(from), getProfile(from)]);
        const aiReply = await getChatGptFallbackReply(body, from, context, profile);
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
