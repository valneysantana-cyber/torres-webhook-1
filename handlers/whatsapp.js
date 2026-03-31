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
  getLocationResponse,
} = require('../responses/strings');
const { getFaqResponse }          = require('../responses/faq');
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
} = require('../utils/matchers');
const { fetchReservationByCode }              = require('../services/stays');
const { getChatGptFallbackReply, transcribeAudioBuffer } = require('../services/openai');
const { downloadWhatsAppMedia, replyToGuest } = require('../services/whatsapp');

// ---------------------------------------------------------------------------
// Pending confirmation state (in-memory, per process)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// PT_DISPATCH — replaces the 15-branch if-else chain
// Each entry: { check(normalizedText) => bool, reply(lang) => string }
// ---------------------------------------------------------------------------
const PT_DISPATCH = [
  { check: shouldSendWifi,        reply: ()     => WIFI_RESPONSE },
  { check: shouldSendBreakfast,   reply: ()     => BREAKFAST_RESPONSE },
  { check: shouldSendPool,        reply: ()     => POOL_RESPONSE },
  { check: shouldSendParking,     reply: ()     => PARKING_RESPONSE },
  { check: shouldSendSnacks,      reply: ()     => SNACKS_RESPONSE },
  { check: shouldSendTowels,      reply: ()     => TOWELS_RESPONSE },
  { check: shouldSendRestaurant,  reply: ()     => RESTAURANT_RESPONSE },
  { check: shouldSendCheckin,     reply: ()     => CHECKIN_RESPONSE },
  { check: shouldSendSecurity,    reply: ()     => SECURITY_RESPONSE },
  { check: shouldSendTransfer,    reply: ()     => TRANSFER_RESPONSE },
  { check: shouldSendLocation,    reply: (lang) => getLocationResponse(lang) },
  { check: shouldSendLongStay,    reply: ()     => LONG_STAY_RESPONSE },
  { check: shouldSendCleaning,    reply: ()     => CLEANING_RESPONSE },
  { check: shouldSendInternet,    reply: ()     => INTERNET_RESPONSE },
  { check: shouldSendLuggage,     reply: ()     => LUGGAGE_RESPONSE },
  { check: shouldSendCurrentDate, reply: ()     => `Hoje \u00e9 ${getCurrentDateBRT()}.` },
  { check: shouldSendCurrentTime, reply: ()     => `Agora s\u00e3o ${getCurrentTimeBRT()}, hor\u00e1rio de Bras\u00edlia.` },
  { check: shouldSendHuman,       reply: ()     => HUMAN_ESCALATION_RESPONSE },
];

// ---------------------------------------------------------------------------
// Reservation confirmation flow
// ---------------------------------------------------------------------------
async function maybeHandleReservationConfirmation({ rawText, normalizedText, from, cameFromAudio = false }) {
  const expectingCode            = isAwaitingCode(from);
  const explicitlyWantsConfirm   = shouldHandleReservationConfirmation(normalizedText);
  const code                     = extractReservationCode(rawText);
  const wantsConfirmation        = explicitlyWantsConfirm || (expectingCode && !!code);

  if (!wantsConfirmation) {
    if (expectingCode) pendingConfirmations.delete(from);
    return false;
  }

  if (!code) {
    rememberPendingConfirmation(from);
    await replyToGuest(from, CONFIRMATION_PROMPT, { alsoSendAudio: cameFromAudio });
    return true;
  }

  const reservation = await fetchReservationByCode(code);
  if (reservation) {
    pendingConfirmations.delete(from);
    await replyToGuest(from, formatReservationMessage(reservation), { alsoSendAudio: cameFromAudio });
  } else {
    rememberPendingConfirmation(from);
    await replyToGuest(from, RESERVATION_NOT_FOUND(code), { alsoSendAudio: cameFromAudio });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function handleIncoming(payload) {
  if (!payload?.entry) return;

  for (const entry of payload.entry) {
    for (const change of (entry.changes || [])) {
      if (change.field !== 'messages') continue;

      const value       = change.value || {};
      const messages    = value.messages || [];
      const contactName = value.contacts?.[0]?.profile?.name || '';

      for (const message of messages) {
        const from = message.from;
        if (!from) continue;

        let cameFromAudio = false;
        let body          = '';

        // ---- resolve body ------------------------------------------------
        if (message.type === 'text') {
          body = message.text?.body || '';
        } else if (message.type === 'audio') {
          cameFromAudio = true;
          try {
            const mediaId = message.audio?.id;
            if (!mediaId) {
              await replyToGuest(from, 'Recebi seu \u00e1udio, mas n\u00e3o consegui identificar o arquivo. Pode tentar novamente? \ud83c\udfa4', { alsoSendAudio: cameFromAudio });
              continue;
            }
            const audioBuffer = await downloadWhatsAppMedia(mediaId);
            const transcript  = await transcribeAudioBuffer(audioBuffer, message.audio?.mime_type || 'audio/ogg');
            if (!transcript) {
              await replyToGuest(from, 'Recebi seu \u00e1udio, mas n\u00e3o consegui entender bem. Pode me mandar novamente ou escrever por texto? \ud83d\ude0a', { alsoSendAudio: cameFromAudio });
              continue;
            }
            body = transcript;
            console.log('[audio transcript]', { from, transcript });
          } catch (err) {
            console.error('Failed to process audio message', err);
            await replyToGuest(from, 'Recebi seu \u00e1udio, mas tive uma falha para processar agora. Pode tentar novamente ou me escrever por texto? \ud83d\ude0a', { alsoSendAudio: cameFromAudio });
            continue;
          }
        } else {
          continue; // ignore unsupported message types
        }

        const normalized = normalizeText(body);
        const language   = detectLanguage(body);
        console.log('[incoming]', { from, body, normalized, language });

        // ---- greeting ----------------------------------------------------
        if (shouldSendGreeting(normalized)) {
          await replyToGuest(from, GREETING_RESPONSE(contactName), { alsoSendAudio: cameFromAudio });
          continue;
        }

        // ---- thanks -------------------------------------------------------
        if (shouldSendThanks(normalized)) {
          await replyToGuest(from, THANKS_RESPONSE, { alsoSendAudio: cameFromAudio });
          continue;
        }

        // ---- menu ---------------------------------------------------------
        if (shouldSendMenu(normalized)) {
          console.log('[menu] sending menu response');
          await replyToGuest(from, MENU_RESPONSE, { alsoSendAudio: cameFromAudio });
          pendingConfirmations.delete(from);
          continue;
        }

        // ---- reservation confirmation flow --------------------------------
        if (await maybeHandleReservationConfirmation({ rawText: body, normalizedText: normalized, from, cameFromAudio })) {
          continue;
        }

        // ---- reservation site redirect ------------------------------------
        if (
          shouldRedirectToReservationSite(normalized) ||
          /\b\d{1,2}[\/.-]\d{1,2}\b/.test(body) ||
          /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/.test(body)
        ) {
          await replyToGuest(from, getReservationResponse(language), { alsoSendAudio: cameFromAudio });
          continue;
        }

        // ---- PT_DISPATCH (Portuguese only) --------------------------------
        if (language === 'pt') {
          const match = PT_DISPATCH.find(({ check }) => check(normalized));
          if (match) {
            await replyToGuest(from, match.reply(language), { alsoSendAudio: cameFromAudio });
            continue;
          }
        }

        // ---- AI fallback --------------------------------------------------
        const aiReply = await getChatGptFallbackReply(body, from);
        if (aiReply) {
          await replyToGuest(from, aiReply, { alsoSendAudio: cameFromAudio });
          continue;
        }

        // ---- FAQ ----------------------------------------------------------
        const faqResponse = getFaqResponse(normalized);
        if (faqResponse) {
          await replyToGuest(from, faqResponse, { alsoSendAudio: cameFromAudio });
          continue;
        }

        // ---- final fallback -----------------------------------------------
        await replyToGuest(
          from,
          `${HUMAN_ESCALATION_RESPONSE}\n\nSe quiser voltar ao menu, \u00e9 s\u00f3 digitar "menu".`,
          { alsoSendAudio: cameFromAudio }
        );
      }
    }
  }
}

module.exports = { handleIncoming };
